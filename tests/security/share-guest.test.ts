import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startStack, type Stack } from "../helpers/stack.ts";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack?.close());

describe("guest sessions and share links", () => {
  it("a guest gets a working session with one call", async () => {
    const g = new Client(stack.base);
    const r = await g.req("POST", "/api/auth/guest", {});
    expect(r.status).toBe(200);
    expect(r.body.user.name).toBe("ضيف");
    expect((await g.req("GET", "/api/projects")).status).toBe(200);
  });

  it("guest creation is rate limited", async () => {
    const g = new Client(stack.base);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await new Client(stack.base).req("POST", "/api/auth/guest", {})).status);
    expect(statuses).toContain(429);
    void g;
  });

  it("a share is a public read-only snapshot; forking copies it into the caller's account", async () => {
    const owner = new Client(stack.base);
    await owner.register();
    const p = await owner.project([{ path: "main.cpp", content: "int main(){return 0;}\n" }]);
    const share = (await owner.req("POST", `/api/projects/${p}/share`, {})).body;
    expect(share.id).toMatch(/^[A-Za-z0-9]{10}$/);

    // Anyone can read it without signing in…
    const anon = new Client(stack.base);
    const view = await anon.req("GET", `/api/shares/${share.id}`);
    expect(view.status).toBe(200);
    expect(view.body.files[0].content).toContain("int main");
    expect(JSON.stringify(view.body)).not.toContain(p); // no project id / owner data leaked

    // …but cannot fork without a session, and the original stays private.
    expect((await anon.req("POST", `/api/shares/${share.id}/fork`, {})).status).toBe(401);
    expect((await anon.req("GET", `/api/projects/${p}`)).status).toBe(401);

    // Editing the original later does not change the snapshot.
    await owner.req("PUT", `/api/projects/${p}/files`, { files: [{ path: "main.cpp", content: "// changed\n", encoding: "utf8" }] });
    expect((await anon.req("GET", `/api/shares/${share.id}`)).body.files[0].content).toContain("int main");

    const other = new Client(stack.base);
    await other.register(); // guest creation is rate-limited by the previous test on this IP
    const fork = await other.req("POST", `/api/shares/${share.id}/fork`, {});
    expect(fork.status).toBe(200);
    expect(fork.body.project.id).not.toBe(p);
    expect((await other.req("GET", `/api/projects/${p}`)).status).toBe(404);
  });

  it("only the owner can share a project; bad share ids are rejected", async () => {
    const a = new Client(stack.base);
    await a.register();
    const p = await a.project([{ path: "main.cpp", content: "int main(){}\n" }]);
    const b = new Client(stack.base);
    await b.register();
    expect((await b.req("POST", `/api/projects/${p}/share`, {})).status).toBe(404);
    expect((await b.req("GET", "/api/shares/../../etc")).status).toBe(404);
  });
});
