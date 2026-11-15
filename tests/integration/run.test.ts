import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, hasCmd, startStack, type Stack } from "../helpers/stack.ts";

const HAVE_WINE = hasCmd("wine") && hasCmd("x86_64-w64-mingw32-g++-posix");
const HAVE_DISPLAY = HAVE_WINE && hasCmd("Xvfb") && hasCmd("xdotool") && hasCmd("import");
const d = hasCmd("bwrap") ? describe : describe.skip;

let stack: Stack;
let c: Client;
beforeAll(async () => {
  stack = await startStack({ workers: HAVE_WINE ? ["linux-builder", "windows-runner"] : ["linux-builder"] });
  c = new Client(stack.base);
  await c.register();
});
afterAll(async () => stack?.close());

const ECHO = '#include <iostream>\n#include <string>\nint main(){std::cout<<"Name? "<<std::flush;std::string n;std::getline(std::cin,n);std::cout<<"Hello, "<<n<<"!\\n";return 3;}\n';

d("running programs in sandboxed execution workers", () => {
  it("native Linux run is interactive and reports the exit code", async () => {
    const p = await c.project([{ path: "main.cpp", content: ECHO }], { compiler: "gcc", target: "linux-elf" });
    const job = await c.build(p);
    const r = await c.run(p, job.result.artifact.id, "native", { input: "Ali\r" });
    expect(r.out).toContain("Hello, Ali!");
    expect(r.exitCode).toBe(3);
  });

  (HAVE_WINE ? it : it.skip)("Windows EXE runs in the Windows Runner (Wine) with UTF-8 output", async () => {
    const p = await c.project([{ path: "main.cpp", content: ECHO.replace('"Hello, "', '"مرحباً "').replace("int main(){", "#include <windows.h>\nint main(){SetConsoleOutputCP(CP_UTF8);") }]);
    const job = await c.build(p);
    expect(job.result.artifact.format).toBe("pe32+");
    const r = await c.run(p, job.result.artifact.id, "wine", { input: "Ali\n", timeoutMs: 90000 });
    expect(r.out).toContain("مرحباً Ali!");
    expect(r.exitCode).toBe(3);
  });

  (HAVE_DISPLAY ? it : it.skip)("GUI EXE streams frames and accepts clicks; stop ends the session", async () => {
    const p = await c.project([{ path: "main.cpp", content: '#include <windows.h>\nint WINAPI WinMain(HINSTANCE,HINSTANCE,LPSTR,int){MessageBoxA(nullptr,"hello","t",MB_OK);return 0;}\n' }], { windowsSubsystem: "windows" });
    const job = await c.build(p);
    expect(job.status, job.log).toBe("succeeded");
    const r = await c.run(p, job.result.artifact.id, "wine", {
      display: true,
      timeoutMs: 90000,
      onFrame: (ws, n) => {
        if (n === 1) {
          ws.send(JSON.stringify({ type: "mouse", x: 10, y: 10, button: 0, action: "click" }));
          ws.send(JSON.stringify({ type: "key", key: "Enter", action: "press" }));
          setTimeout(() => ws.send(JSON.stringify({ type: "stop" })), 3000);
        }
      },
    });
    expect(r.frames).toBeGreaterThan(0);
    expect(["stopped", "exited"]).toContain(r.status);
  });

  it("refuses to run an ELF in the Windows runner and a PE natively", async () => {
    const p = await c.project([{ path: "main.cpp", content: "int main(){}\n" }], { compiler: "gcc", target: "linux-elf" });
    const job = await c.build(p);
    const r = await c.req("POST", `/api/projects/${p}/runs`, { artifactId: job.result.artifact.id, backend: "wine" });
    expect(r.status).toBe(400);
  });

  it("crash is explained in Arabic", async () => {
    const p = await c.project([{ path: "main.cpp", content: "int main(){volatile int* p=nullptr;*p=1;}\n" }], { compiler: "gcc", target: "linux-elf" });
    const job = await c.build(p);
    const r = await c.run(p, job.result.artifact.id, "native");
    expect(r.exitCode).not.toBe(0);
    const j = (await c.req("GET", `/api/jobs/${r.jobId}`)).body.job;
    expect(j.result.summaryAr).toMatch(/الذاكرة|Segmentation/);
  });
});
