// Smoke test for the Docker Compose deployment: all workers online, a real EXE builds and runs.
// Usage: MCS_BASE_URL=http://127.0.0.1:4000 node tests/e2e/docker-smoke.mjs
const BASE = process.env.MCS_BASE_URL ?? "http://127.0.0.1:4000";
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
  if (caps?.workers?.length >= 6) { console.log("✔ workers:", caps.workers.join(", ")); break; }
  if (i === 89) fail("workers did not come online: " + JSON.stringify(caps?.workers));
  await new Promise((r) => setTimeout(r, 2000));
}
await req("POST", "/api/auth/guest", {});
const { body: { project } } = await req("POST", "/api/projects", { name: "smoke", template: "vat-calculator" });
let job = (await req("POST", `/api/projects/${project.id}/builds`, {})).body.job;
while (!["succeeded", "failed"].includes(job.status)) { await new Promise((r) => setTimeout(r, 1000)); job = (await req("GET", `/api/jobs/${job.id}`)).body.job; }
if (job.status !== "succeeded" || job.result.artifact.format !== "pe32+") fail("build failed:\n" + job.log);
console.log("✔ built", job.result.artifact.fileName, job.result.artifact.format);
const run = (await req("POST", `/api/projects/${project.id}/runs`, { artifactId: job.result.artifact.id, backend: "wine", display: false })).body.job;
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
console.log("✔ ran under Wine: 100 + 15% VAT = 115.00");
process.exit(0);
