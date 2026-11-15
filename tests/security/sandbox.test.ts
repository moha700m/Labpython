import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectSandboxMode, runSandboxed, type SandboxLimits } from "../../packages/worker-runtime/src/index.ts";

const HAVE_BWRAP = spawnSync("sh", ["-c", "command -v bwrap && command -v gcc"]).status === 0;
const d = HAVE_BWRAP ? describe : describe.skip;

const LIMITS: SandboxLimits = { timeoutMs: 8000, memoryBytes: 256 * 1024 * 1024, cpuSeconds: 3, maxProcesses: 32, maxFileBytes: 4 * 1024 * 1024, maxOutputBytes: 64 * 1024 };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcs-sbx-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Compile a C snippet on the host (trusted test code) and run it inside the sandbox. */
async function runC(name: string, src: string, limits: Partial<SandboxLimits> = {}) {
  writeFileSync(join(dir, `${name}.c`), src);
  const cc = spawnSync("gcc", ["-O0", "-o", join(dir, name), join(dir, `${name}.c`)]);
  if (cc.status !== 0) throw new Error(cc.stderr.toString());
  let out = "";
  const h = runSandboxed({ workDir: dir, argv: [`./${name}`], limits: { ...LIMITS, ...limits }, onStdout: (s) => (out += s), onStderr: (s) => (out += s) }, detectSandboxMode());
  const r = await h.done;
  return { ...r, out };
}

d("sandbox isolation (bubblewrap + rlimits)", () => {
  it("has no network access", async () => {
    const r = await runC(
      "net",
      `#include <stdio.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main(){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_port=htons(80);inet_pton(AF_INET,"1.1.1.1",&a.sin_addr);
int rc=connect(s,(struct sockaddr*)&a,sizeof a);printf("connect=%d\\n",rc);return rc==0;}`,
    );
    expect(r.out).toContain("connect=-1");
    expect(r.exitCode).toBe(0);
  });

  it("cannot read host secrets or the server's environment", async () => {
    process.env.MCS_SECRET_PROBE = "leak-me";
    const r = await runC(
      "secrets",
      `#include <stdio.h>
#include <stdlib.h>
int main(){FILE*f=fopen("/etc/shadow","r");printf("shadow=%s\\n",f?"open":"blocked");
FILE*g=fopen("/root/.bashrc","r");printf("home=%s\\n",g?"open":"blocked");
printf("env=%s\\n",getenv("MCS_SECRET_PROBE")?"leaked":"clean");return 0;}`,
    );
    expect(r.out).toContain("shadow=blocked");
    expect(r.out).toContain("home=blocked");
    expect(r.out).toContain("env=clean");
  });

  it("cannot write outside its work directory", async () => {
    const r = await runC(
      "write",
      `#include <stdio.h>
int main(){FILE*f=fopen("/usr/evil","w");printf("usr=%s\\n",f?"written":"blocked");
FILE*g=fopen("ok.txt","w");printf("work=%s\\n",g?"written":"blocked");return 0;}`,
    );
    expect(r.out).toContain("usr=blocked");
    expect(r.out).toContain("work=written");
  });

  it("an infinite loop is stopped by the CPU limit", async () => {
    const r = await runC("loop", "int main(){volatile unsigned long i=0;for(;;)i++;}", { cpuSeconds: 1 });
    expect(r.exitCode === 0).toBe(false);
    expect(r.durationMs).toBeLessThan(7000);
  });

  it("a blocking program is stopped by the wall-clock timeout", async () => {
    const r = await runC("sleep", "#include <unistd.h>\nint main(){sleep(60);}", { timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
  });

  it("memory exhaustion is contained", async () => {
    const r = await runC(
      "mem",
      `#include <stdlib.h>
#include <string.h>
#include <stdio.h>
int main(){size_t total=0;for(;;){char*p=malloc(16<<20);if(!p){printf("malloc failed at %zu MB\\n",total>>20);return 0;}memset(p,1,16<<20);total+=16<<20;}}`,
    );
    expect(r.out).toMatch(/malloc failed at \d+ MB/);
    const mb = Number(/at (\d+) MB/.exec(r.out)![1]);
    expect(mb).toBeLessThanOrEqual(256);
  });

  it("output flooding is truncated", async () => {
    const r = await runC("flood", '#include <stdio.h>\nint main(){for(;;)puts("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");}');
    expect(r.outputTruncated).toBe(true);
    expect(r.out.length).toBeLessThan(200 * 1024);
  });

  it("a fork bomb is bounded and every process dies with the session", async () => {
    // 2^12 potential processes. As a non-root worker user RLIMIT_NPROC caps this at maxProcesses;
    // as root (this dev container) only the pid namespace + session kill contain it.
    const r = await runC(
      "forkbomb",
      `#include <unistd.h>
#include <stdio.h>
int main(){int failed=0;for(int i=0;i<12;i++){if(fork()<0)failed++;}if(failed)printf("fork refused\\n");fflush(stdout);sleep(30);}`,
      { timeoutMs: 2500 },
    );
    expect(r.timedOut).toBe(true);
    await new Promise((res) => setTimeout(res, 500));
    const left = spawnSync("pgrep", ["-c", "-x", "forkbomb"]).stdout.toString().trim();
    expect(left === "" || left === "0").toBe(true);
    if (process.getuid?.() !== 0) expect(r.out).toContain("fork refused");
  });

  it("file size limit is enforced", async () => {
    const r = await runC(
      "fsize",
      `#include <stdio.h>
#include <signal.h>
int main(){signal(SIGXFSZ,SIG_IGN);FILE*f=fopen("big.bin","w");char b[65536]={0};long w=0;for(int i=0;i<200;i++){size_t n=fwrite(b,1,sizeof b,f);fflush(f);w+=n;if(n<sizeof b)break;}printf("wrote=%ld\\n",w);return 0;}`,
    );
    expect(r.out).toContain("wrote=");
    // What reached the disk is what matters (stdio may report buffered bytes).
    expect(statSync(join(dir, "big.bin")).size).toBeLessThanOrEqual(LIMITS.maxFileBytes);
  });
});
