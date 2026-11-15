import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssistantProvider, AssistantRequest } from "../../apps/api/src/ai.ts";
import { buildUserPrompt, sanitizeChanges } from "../../apps/api/src/ai.ts";
import { Client, startStack, type Stack } from "../helpers/stack.ts";

let lastRequest: AssistantRequest | null = null;
const fake: AssistantProvider = {
  name: "fake",
  model: "fake-model",
  available: () => true,
  async ask(req) {
    lastRequest = req;
    return {
      answerAr: "اقتراح",
      provider: "fake",
      model: "fake-model",
      changes: sanitizeChanges([
        { path: "main.cpp", action: "modify", content: "int main(){return 1;}\n", reasonAr: "تعديل" },
        { path: "../../etc/passwd", action: "modify", content: "x", reasonAr: "هجوم" },
      ]),
    };
  },
};

let stack: Stack;
let c: Client;
let p: string;
beforeAll(async () => {
  stack = await startStack({ ai: fake });
  c = new Client(stack.base);
  await c.register();
  p = await c.project([{ path: "main.cpp", content: "int main(){}\n" }]);
});
afterAll(async () => stack?.close());

describe("AI assistant safety", () => {
  it("returns proposals only and never modifies project files", async () => {
    const r = await c.req("POST", `/api/projects/${p}/assistant`, { task: "fix", message: "أصلح الكود" });
    expect(r.status).toBe(200);
    expect(r.body.changes.map((x: any) => x.path)).toEqual(["main.cpp"]); // traversal proposal dropped
    const file = (await c.req("GET", `/api/projects/${p}/file?path=main.cpp`)).body.file;
    expect(file.content).toBe("int main(){}\n"); // unchanged until the user approves
    expect(lastRequest?.files.map((f) => f.path)).toEqual(["main.cpp"]);
  });

  it("is not reachable for another user's project", async () => {
    const other = new Client(stack.base);
    await other.register();
    expect((await other.req("POST", `/api/projects/${p}/assistant`, { task: "chat", message: "x" })).status).toBe(404);
  });

  it("puts project files, diagnostics and the question into a delimited prompt", () => {
    const prompt = buildUserPrompt({ task: "explain", message: "ما هذا؟", files: [{ path: "a.cpp", content: "int x;", encoding: "utf8" }], diagnostics: [{ file: "a.cpp", line: 1, column: 1, severity: "error", message: "boom" }] });
    expect(prompt).toContain('<file path="a.cpp">');
    expect(prompt).toContain("a.cpp:1:1: error: boom");
    expect(prompt).toContain("<user_message>\nما هذا؟\n</user_message>");
  });
});

describe("AI assistant without a provider", () => {
  it("reports unavailable instead of pretending", async () => {
    const s2 = await startStack();
    const c2 = new Client(s2.base);
    await c2.register();
    const p2 = await c2.project([{ path: "main.cpp", content: "int main(){}\n" }]);
    const r = await c2.req("POST", `/api/projects/${p2}/assistant`, { task: "chat", message: "hi" });
    expect(r.status).toBe(503);
    expect((await c2.req("GET", "/api/capabilities")).body.ai.available).toBe(false);
    await s2.close();
  });
});
