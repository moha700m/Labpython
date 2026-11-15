import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { Client, startStack, type Stack } from "../helpers/stack.ts";

let stack: Stack;
let alice: Client;
let bob: Client;
let aliceProject: string;

beforeAll(async () => {
  stack = await startStack();
  alice = new Client(stack.base);
  bob = new Client(stack.base);
  await alice.register();
  await bob.register();
  aliceProject = await alice.project([{ path: "secret.cpp", content: "// alice's secret\nint main(){}\n" }]);
});
afterAll(async () => stack?.close());

/** Build a ZIP whose entry names are written verbatim (fflate would accept them too, we want raw control). */
function zipWith(entries: Record<string, string>) {
  const input: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(entries)) input[k] = strToU8(v);
  return zipSync(input);
}

function symlinkZip(name: string, target: string): Uint8Array {
  // Minimal stored ZIP with one entry whose external attributes mark a Unix symlink.
  const nameB = Buffer.from(name);
  const data = Buffer.from(target);
  const crc = (() => {
    let c = ~0;
    for (const b of data) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  })();
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(10, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE((0o120777 << 16) >>> 0, 38); central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameB, data]);
  const centralPart = Buffer.concat([central, nameB]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16);
  return new Uint8Array(Buffer.concat([localPart, centralPart, end]));
}

async function importZip(c: Client, bytes: Uint8Array, name = "p.zip") {
  const fd = new FormData();
  fd.append("file", new Blob([bytes]), name);
  return c.req("POST", "/api/projects/import-zip", fd);
}

describe("user isolation", () => {
  it("another user cannot read, list, modify, build or delete a project", async () => {
    expect((await bob.req("GET", `/api/projects/${aliceProject}`)).status).toBe(404);
    expect((await bob.req("GET", `/api/projects/${aliceProject}/file?path=secret.cpp`)).status).toBe(404);
    expect((await bob.req("GET", `/api/projects/${aliceProject}/files/all`)).status).toBe(404);
    expect((await bob.req("PUT", `/api/projects/${aliceProject}/files`, { files: [{ path: "x.cpp", content: "", encoding: "utf8" }] })).status).toBe(404);
    expect((await bob.req("POST", `/api/projects/${aliceProject}/builds`, {})).status).toBe(404);
    expect((await bob.req("DELETE", `/api/projects/${aliceProject}`)).status).toBe(404);
    expect((await bob.req("GET", `/api/projects/${aliceProject}/export.zip`)).status).toBe(404);
    const list = (await bob.req("GET", "/api/projects")).body.projects;
    expect(list.find((p: any) => p.id === aliceProject)).toBeUndefined();
  });

  it("another user cannot see jobs of a foreign project", async () => {
    const job = (await alice.req("POST", `/api/projects/${aliceProject}/builds`, {})).body.job;
    expect((await bob.req("GET", `/api/jobs/${job.id}`)).status).toBe(404);
    expect((await bob.req("POST", `/api/jobs/${job.id}/cancel`, {})).status).toBe(404);
  });

  it("unauthenticated requests are rejected", async () => {
    const anon = new Client(stack.base);
    expect((await anon.req("GET", "/api/projects")).status).toBe(401);
    expect((await anon.req("GET", `/api/projects/${aliceProject}`)).status).toBe(401);
  });
});

describe("request hardening", () => {
  it("rejects state-changing requests without the client header (CSRF)", async () => {
    const res = await fetch(stack.base + "/api/projects", { method: "POST", headers: { cookie: alice.cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
    expect(res.status).toBe(403);
  });
  it("sets session cookie HttpOnly + SameSite", async () => {
    const res = await fetch(stack.base + "/api/auth/register", { method: "POST", headers: { "x-mcs-client": "web", "content-type": "application/json" }, body: JSON.stringify({ email: `c${Date.now()}@example.com`, name: "c", password: "password-123" }) });
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
  });
  it("rate-limits repeated failed logins", async () => {
    const c = new Client(stack.base);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await c.req("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong-password" })).status);
    expect(statuses).toContain(429);
  });
  it("worker endpoints require the worker token", async () => {
    const r = await fetch(stack.base + "/api/worker/claim", { method: "POST", headers: { authorization: "Bearer nope", "x-worker-id": "evil", "content-type": "application/json" }, body: JSON.stringify({ capabilities: ["build:gcc"] }) });
    expect(r.status).toBe(401);
    const r2 = await fetch(stack.base + "/api/worker/artifacts/00000000-0000-0000-0000-000000000000", { headers: { authorization: `Bearer ${stack.token}`, "x-worker-id": "w1" } });
    expect(r2.status).toBe(404);
  });
});

describe("malicious files and path traversal", () => {
  it("rejects path traversal and absolute paths when saving files", async () => {
    for (const path of ["../escape.cpp", "/etc/passwd.txt", "src/../../x.cpp", "C:\\\\Windows\\\\x.cpp"]) {
      const r = await alice.req("PUT", `/api/projects/${aliceProject}/files`, { files: [{ path, content: "x", encoding: "utf8" }] });
      expect(r.status, path).toBe(400);
    }
    expect((await alice.req("GET", `/api/projects/${aliceProject}/file?path=../../etc/passwd`)).status).toBe(400);
  });

  it("refuses executable uploads", async () => {
    const r = await alice.req("PUT", `/api/projects/${aliceProject}/files`, { files: [{ path: "tool.exe", content: "TVo=", encoding: "base64" }] });
    expect(r.status).toBe(400);
  });

  it("ZIP import drops traversal entries and keeps safe files", async () => {
    const r = await importZip(alice, zipWith({ "main.cpp": "int main(){}", "../../evil.cpp": "x", "/abs.cpp": "y", "a/../../b.cpp": "z" }));
    expect(r.status).toBe(200);
    const files = (await alice.req("GET", `/api/projects/${r.body.project.id}`)).body.files.map((f: any) => f.path);
    expect(files).toEqual(["main.cpp"]);
    expect(r.body.rejected.length).toBe(3);
  });

  it("ZIP import rejects symlink entries", async () => {
    const r = await importZip(alice, symlinkZip("link.cpp", "/etc/passwd"));
    expect(r.status).toBe(400); // nothing safe left
    expect(JSON.stringify(r.body)).toContain("symlink");
  });

  it("ZIP bombs are refused", async () => {
    const r = await importZip(alice, zipWith({ "main.cpp": "int main(){}", "huge.txt": "A".repeat(900_000) }));
    expect(r.status).toBe(200);
    expect(r.body.rejected.some((x: any) => x.reason.includes("compression ratio"))).toBe(true);
    const big = await importZip(alice, zipWith(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, "B".repeat(1_000_000)]))));
    expect(big.status).toBe(400);
  });

  it("non-ZIP data posing as a ZIP is refused", async () => {
    const r = await importZip(alice, strToU8("MZ this is not a zip"));
    expect(r.status).toBe(400);
  });

  it("records security events", () => {
    const events = stack.app.ctx.security.recent(200) as { kind: string }[];
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has("upload.rejected_path")).toBe(true);
    expect(kinds.has("auth.login_failed")).toBe(true);
    expect(kinds.has("worker.auth_failed")).toBe(true);
  });
});
