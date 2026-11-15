// Smoke test for a running studio (Docker Compose stack or the Windows desktop app):
// workers online, real EXEs build (single file + CMake) and run.
// Usage:
//   MCS_BASE_URL=http://127.0.0.1:4000 node tests/e2e/smoke.mjs                       (Docker / Wine)
//   MCS_BASE_URL=http://127.0.0.1:47321 MCS_SMOKE_BACKEND=windows node tests/e2e/smoke.mjs  (desktop app)
const BASE = process.env.MCS_BASE_URL ?? "http://127.0.0.1:4000";
const BACKEND = process.env.MCS_SMOKE_BACKEND ?? "wine";
const MIN_WORKERS = BACKEND === "windows" ? 2 : 6;
let cookie = "";
const req = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "x-mcs-client": "web", "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
const fail = (m) => { console.error("✖ " + m); process.exit(1); };

for (let i = 0; i < 90; i++) {
  const caps = (await req("GET", "/api/capabilities").catch(() => ({ body: null }))).body;
  if (caps?.workers?.length >= MIN_WORKERS) { console.log("✔ workers:", caps.workers.join(", ")); break; }
  if (i === 89) fail("workers did not come online: " + JSON.stringify(caps?.workers));
  await new Promise((r) => setTimeout(r, 2000));
}
await req("POST", "/api/auth/guest", {});
const { body: { project } } = await req("POST", "/api/projects", { name: "smoke", template: "vat-calculator" });
let job = (await req("POST", `/api/projects/${project.id}/builds`, {})).body.job;
while (!["succeeded", "failed"].includes(job.status)) { await new Promise((r) => setTimeout(r, 1000)); job = (await req("GET", `/api/jobs/${job.id}`)).body.job; }
if (job.status !== "succeeded" || job.result.artifact.format !== "pe32+") fail("build failed:\n" + job.log);
console.log("✔ built", job.result.artifact.fileName, job.result.artifact.format);
const run = (await req("POST", `/api/projects/${project.id}/runs`, { artifactId: job.result.artifact.id, backend: BACKEND, display: false })).body.job;
const ws = new WebSocket(BASE.replace("http", "ws") + `/api/runs/${run.id}/ws`, { headers: { cookie } });
let out = "";
const done = await new Promise((resolve) => {
  setTimeout(() => resolve(false), 120000);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "stdout" || m.type === "stderr") { out += m.data; if (out.includes("ريال)") && !out.includes("@")) { out += "@"; ws.send(JSON.stringify({ type: "stdin", data: "100\n" })); } }
    if (m.type === "status" && ["exited", "error", "stopped"].includes(m.status)) resolve(m.status === "exited" && m.exitCode === 0);
  };
});
if (!done || !out.includes("115.00")) fail("run failed: " + out);
console.log(`✔ ran (${BACKEND}): 100 + 15% VAT = 115.00`);

// CMake project → EXE.
const cm = (await req("POST", "/api/projects", { name: "cmake", template: "cmake-app" })).body.project;
let cj = (await req("POST", `/api/projects/${cm.id}/builds`, {})).body.job;
while (!["succeeded", "failed"].includes(cj.status)) { await new Promise((r) => setTimeout(r, 1000)); cj = (await req("GET", `/api/jobs/${cj.id}`)).body.job; }
if (cj.status !== "succeeded" || cj.result.artifact.format !== "pe32+") fail("CMake build failed:\n" + cj.log);
console.log("✔ CMake project built", cj.result.artifact.fileName);

if (BACKEND === "windows") {
  // A GUI program must start as a real window and be stoppable from the browser.
  const g = (await req("POST", "/api/projects", { name: "gui", template: "tasbeeh-gui" })).body.project;
  let gj = (await req("POST", `/api/projects/${g.id}/builds`, {})).body.job;
  while (!["succeeded", "failed"].includes(gj.status)) { await new Promise((r) => setTimeout(r, 1000)); gj = (await req("GET", `/api/jobs/${gj.id}`)).body.job; }
  if (gj.status !== "succeeded") fail("GUI build failed:\n" + gj.log);
  const gr = (await req("POST", `/api/projects/${g.id}/runs`, { artifactId: gj.result.artifact.id, backend: "windows", display: false })).body.job;
  const gws = new WebSocket(BASE.replace("http", "ws") + `/api/runs/${gr.id}/ws`, { headers: { cookie } });
  const final = await new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), 60000);
    gws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "status" && m.status === "running") setTimeout(() => gws.send(JSON.stringify({ type: "stop" })), 3000);
      if (m.type === "status" && ["exited", "error", "stopped"].includes(m.status)) resolve(m.status);
    };
  });
  if (final !== "stopped") fail("GUI program did not run until stopped: " + final);
  console.log("✔ GUI program ran as a native window and was stopped from the browser");
}
process.exit(0);
