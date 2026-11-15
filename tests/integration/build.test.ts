import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, hasCmd, startStack, type Stack } from "../helpers/stack.ts";

const HAVE_MINGW = hasCmd("x86_64-w64-mingw32-g++-posix");
const HAVE_BWRAP = hasCmd("bwrap");
const d = HAVE_BWRAP ? describe : describe.skip;

let stack: Stack;
let c: Client;
beforeAll(async () => {
  stack = await startStack({ workers: ["linux-builder"] });
  c = new Client(stack.base);
  await c.register();
});
afterAll(async () => stack?.close());

async function download(id: string) {
  const res = await c.raw(`/api/artifacts/${id}/download`);
  return Buffer.from(await res.arrayBuffer());
}
const isPe = (b: Buffer) => b[0] === 0x4d && b[1] === 0x5a && b.toString("latin1", b.readUInt32LE(0x3c), b.readUInt32LE(0x3c) + 4) === "PE\0\0";
const isElf = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));

d("real builds through API + Linux build worker", () => {
  (HAVE_MINGW ? it : it.skip)("single-file project → real Windows PE32+ EXE", async () => {
    const p = await c.project([{ path: "main.cpp", content: '#include <iostream>\nint main(){std::cout<<"hi\\n";}\n' }]);
    const job = await c.build(p);
    expect(job.status).toBe("succeeded");
    expect(job.result.artifact.format).toBe("pe32+");
    expect(job.result.artifact.fileName).toBe("app.exe");
    const bin = await download(job.result.artifact.id);
    expect(isPe(bin)).toBe(true);
    expect(bin.length).toBe(job.result.artifact.size);
    expect(job.log).toContain("x86_64-w64-mingw32-g++-posix");
  });

  (HAVE_MINGW ? it : it.skip)("multi-file project with include dir", async () => {
    const p = await c.project([
      { path: "include/calc.hpp", content: "#pragma once\nint add(int,int);\n" },
      { path: "src/calc.cpp", content: '#include "calc.hpp"\nint add(int a,int b){return a+b;}\n' },
      { path: "src/main.cpp", content: '#include <cstdio>\n#include "calc.hpp"\nint main(){std::printf("%d\\n",add(2,3));}\n' },
    ]);
    const job = await c.build(p, { outputName: "calc" });
    expect(job.status).toBe("succeeded");
    expect(job.result.artifact.fileName).toBe("calc.exe");
  });

  (HAVE_MINGW && hasCmd("cmake") ? it : it.skip)("CMake project cross-compiled to EXE", async () => {
    const p = await c.project([
      { path: "CMakeLists.txt", content: "cmake_minimum_required(VERSION 3.16)\nproject(demo CXX)\nadd_library(g STATIC g.cpp)\nadd_executable(demo main.cpp)\ntarget_link_libraries(demo g)\n" },
      { path: "g.cpp", content: "int g(){return 7;}\n" },
      { path: "main.cpp", content: "int g();\nint main(){return g()-7;}\n" },
    ]);
    const job = await c.build(p, { outputName: "demo" });
    expect(job.status, job.log).toBe("succeeded");
    expect(job.result.artifact.format).toBe("pe32+");
    expect(isPe(await download(job.result.artifact.id))).toBe(true);
  });

  (HAVE_MINGW ? it : it.skip)("Makefile project", async () => {
    const p = await c.project([
      { path: "Makefile", content: "all: app.exe\napp.exe: main.cpp\n\t$(CXX) -static -o $@ main.cpp\n" },
      { path: "main.cpp", content: "int main(){}\n" },
    ]);
    const job = await c.build(p);
    expect(job.status, job.log).toBe("succeeded");
    expect(job.result.artifact.format).toBe("pe32+");
  });

  (HAVE_MINGW ? it : it.skip)("static and dynamic libraries", async () => {
    const p = await c.project([{ path: "m.cpp", content: "int sq(int x){return x*x;}\n" }]);
    const lib = await c.build(p, { output: "static-lib", outputName: "m" });
    expect(lib.status).toBe("succeeded");
    expect(lib.result.artifact).toMatchObject({ fileName: "libm.a", format: "archive" });
    const dll = await c.build(p, { output: "shared-lib", outputName: "m" });
    expect(dll.status).toBe("succeeded");
    expect(dll.result.artifact).toMatchObject({ fileName: "m.dll", format: "pe32+" });
  });

  it.each(["gcc", "clang"])("%s produces a Linux ELF (never labelled EXE)", async (compiler) => {
    const p = await c.project([{ path: "main.cpp", content: "int main(){}\n" }]);
    const job = await c.build(p, { compiler, target: "linux-elf" });
    expect(job.status).toBe("succeeded");
    expect(job.result.artifact.format).toBe("elf64");
    expect(job.result.artifact.fileName).toBe("app");
    expect(isElf(await download(job.result.artifact.id))).toBe(true);
  });

  it.each([
    ["gcc", "c++17"],
    ["gcc", "c++20"],
    ["gcc", "c++23"],
    ["clang", "c++26"],
  ])("%s with standard %s compiles", async (compiler, standard) => {
    const p = await c.project([{ path: "main.cpp", content: "#include <vector>\nint main(){std::vector<int> v{1,2};return (int)v.size()-2;}\n" }]);
    const job = await c.build(p, { compiler, target: "linux-elf", standard });
    expect(job.status, job.log).toBe("succeeded");
    expect(job.log).toContain(standard === "c++26" ? "-std=c++2c" : `-std=${standard}`);
  });

  it("C++26 on a compiler without support fails with a clear Arabic explanation", async () => {
    const p = await c.project([{ path: "main.cpp", content: "int main(){}\n" }]);
    const job = await c.build(p, { compiler: "gcc", target: "linux-elf", standard: "c++26" });
    if (job.status === "succeeded") return; // newer GCC (14+) supports it — nothing to explain
    expect(job.result.diagnostics.some((x: any) => x.explanationAr?.includes("C++26")), JSON.stringify(job.result) + job.log).toBe(true);
  });

  it("compile errors become structured Arabic diagnostics", async () => {
    const p = await c.project([{ path: "src/main.cpp", content: "int main() {\n  cout << 1\n}\n" }]);
    const job = await c.build(p, { compiler: "gcc", target: "linux-elf" });
    expect(job.status).toBe("failed");
    const errs = job.result.diagnostics.filter((x: any) => x.severity === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatchObject({ file: "src/main.cpp", line: 2 });
    expect(errs.some((x: any) => x.explanationAr)).toBe(true);
    expect(job.result.artifact).toBeUndefined();
  });

  it("rejects unsafe compiler flags before queueing", async () => {
    const p = await c.project([{ path: "main.cpp", content: "int main(){}\n" }]);
    const r = await c.req("POST", `/api/projects/${p}/builds`, { config: { extraFlags: ["-fplugin=/tmp/evil.so"] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("flag_rejected");
  });

  it("shows progress, duration and size", async () => {
    const p = await c.project([{ path: "main.cpp", content: "int main(){}\n" }]);
    const job = await c.build(p, { compiler: "gcc", target: "linux-elf" });
    expect(job.progress).toBe(1);
    expect(job.result.durationMs).toBeGreaterThan(0);
    expect(job.result.artifact.size).toBeGreaterThan(1000);
    expect(job.result.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

d("smart auto-fix through the API", () => {
  it("fixes a broken program so the next build succeeds", async () => {
    const p = await c.project([{ path: "main.cpp", content: 'int main() {\n    std::string s = "x";\n    cout << s\n    return 0;\n}\n' }]);
    const failed = await c.build(p, { compiler: "gcc", target: "linux-elf" });
    expect(failed.status).toBe("failed");
    const preview = await c.req("POST", `/api/projects/${p}/autofix`, { jobId: failed.id, apply: false });
    expect(preview.body.fixes.length).toBeGreaterThan(0);
    // Preview must not change files.
    expect((await c.req("GET", `/api/projects/${p}/file?path=main.cpp`)).body.file.content).toContain("cout << s\n");
    await c.req("POST", `/api/projects/${p}/autofix`, { jobId: failed.id, apply: true });
    let job = await c.build(p, { compiler: "gcc", target: "linux-elf" });
    if (job.status !== "succeeded") {
      // A second pass may be needed when the first build hid follow-up errors.
      await c.req("POST", `/api/projects/${p}/autofix`, { jobId: job.id, apply: true });
      job = await c.build(p, { compiler: "gcc", target: "linux-elf" });
    }
    expect(job.status, job.log).toBe("succeeded");
  });

  it.each(["vat-calculator", "zakat-calculator", "hijri-date", "guess-game", "tasbeeh-gui"])("Saudi example %s builds into a PE32+ EXE", async (template) => {
    const r = await c.req("POST", "/api/projects", { name: template, template });
    const job = await c.build(r.body.project.id);
    expect(job.status, job.log).toBe("succeeded");
    expect(job.result.artifact.format).toBe("pe32+");
  });
});
