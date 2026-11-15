import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { PlanError, countBySeverity, parseDiagnostics, pickArtifact, planBuild, type BuildPlan } from "@mcs/compiler";
import { LIMITS, base64ToBytes, detectBinaryFormat, normalizeProjectPath, type BuildConfig, type BuildResult, type ProjectFile } from "@mcs/shared";
import { formatBytesAr, formatDurationAr } from "@mcs/localization";
import { EventBatcher, runSandboxed, workRoot, type SandboxMode, type WorkerApi } from "@mcs/worker-runtime";

export interface BuildJob {
  id: string;
  type: "build";
  config: BuildConfig;
  files: ProjectFile[];
}

/** Materialize project files into a fresh temp dir. Paths are re-validated here (defence in depth). */
export async function materialize(root: string, files: ProjectFile[]) {
  for (const f of files) {
    const rel = normalizeProjectPath(f.path);
    const full = join(root, rel);
    const back = relative(root, full);
    if (!back || back.startsWith("..") || isAbsolute(back)) throw new Error(`path escapes work dir: ${f.path}`);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.encoding === "base64" ? base64ToBytes(f.content) : f.content);
  }
}

async function walk(dir: string, base = dir, out: { path: string; size: number; mtimeMs: number; format: string }[] = []) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (ent.name === "CMakeFiles" || ent.name === ".wine") continue;
      await walk(full, base, out);
    } else if (ent.isFile()) {
      const st = await stat(full);
      if (st.size < 64 || st.size > 512 * 1024 * 1024) continue;
      const fh = await readFile(full).then((b) => b.subarray(0, 4096));
      out.push({ path: relative(base, full).split("\\").join("/"), size: st.size, mtimeMs: st.mtimeMs, format: detectBinaryFormat(new Uint8Array(fh)) });
    }
  }
  return out;
}

export async function executeBuild(job: BuildJob, api: WorkerApi, mode: SandboxMode, opts: { keepWorkDir?: boolean; native?: boolean } = {}): Promise<BuildResult> {
  const started = Date.now();
  const ev = new EventBatcher(api, job.id);
  const root = await mkdtemp(join(workRoot(), "mcs-build-"));
  const heartbeat = setInterval(() => ev.progress(lastProgress, lastPhase), 20_000);
  let lastProgress = 0.02;
  let lastPhase = "preparing";
  const setProgress = (p: number, phase: string) => {
    lastProgress = p;
    lastPhase = phase;
    ev.progress(p, phase);
  };
  let allOutput = "";
  const finish = async (result: BuildResult) => {
    clearInterval(heartbeat);
    await ev.close();
    await api.complete(job.id, result);
    if (!opts.keepWorkDir) await rm(root, { recursive: true, force: true });
    return result;
  };

  try {
    setProgress(0.02, "preparing");
    ev.log(`▶ Muhammad C++ Studio Builder\n▶ المترجم: ${job.config.compiler} | المعيار: ${job.config.standard} | الوضع: ${job.config.mode} | الهدف: ${job.config.target}\n`);
    await materialize(root, job.files);
    let plan: BuildPlan;
    try {
      plan = planBuild(job.files.map((f) => normalizeProjectPath(f.path)), job.config, { jobs: 4, native: opts.native });
    } catch (e) {
      const msg = e instanceof PlanError ? e.messageAr : (e as Error).message;
      ev.log(`✖ ${msg}\n`);
      return finish({ status: "failed", durationMs: Date.now() - started, diagnostics: [], exitCode: null, summaryAr: msg });
    }
    for (const [p, content] of Object.entries(plan.generatedFiles)) {
      await mkdir(dirname(join(root, p)), { recursive: true });
      await writeFile(join(root, p), content);
    }
    await mkdir(join(root, ".mcs/obj"), { recursive: true });
    await mkdir(join(root, ".mcs/out"), { recursive: true });
    ev.log(`▶ نوع المشروع: ${plan.kind} — ${plan.steps.length} خطوة\n`);

    let exitCode: number | null = 0;
    const total = plan.steps.length;
    for (let i = 0; i < total; i++) {
      const step = plan.steps[i]!;
      if (ev.cancelRequested) {
        ev.log("\n■ أُلغي البناء بطلب المستخدم\n");
        return finish({ status: "failed", durationMs: Date.now() - started, diagnostics: parseDiagnostics(allOutput), exitCode: null, summaryAr: "أُلغي البناء" });
      }
      setProgress(0.05 + (0.85 * i) / total, step.phase);
      ev.log(`\n$ ${step.argv.join(" ")}\n`);
      const h = runSandboxed(
        {
          workDir: root,
          argv: step.argv,
          cwd: step.cwd,
          limits: {
            timeoutMs: LIMITS.buildTimeoutMs,
            memoryBytes: LIMITS.buildMemoryBytes,
            cpuSeconds: LIMITS.buildCpuSeconds,
            maxProcesses: LIMITS.buildMaxProcesses,
            maxFileBytes: LIMITS.buildMaxOutputFileBytes,
            maxOutputBytes: LIMITS.logMaxBytes,
          },
          onStdout: (s) => {
            allOutput += s;
            ev.log(s);
          },
          onStderr: (s) => {
            allOutput += s;
            ev.log(s);
          },
        },
        mode,
      );
      const cancelPoll = setInterval(() => ev.cancelRequested && h.kill(), 500);
      const r = await h.done;
      clearInterval(cancelPoll);
      exitCode = r.exitCode;
      if (r.timedOut) ev.log(`\n✖ تجاوزت الخطوة الحد الزمني (${LIMITS.buildTimeoutMs / 1000} ثانية)\n`);
      if (r.exitCode !== 0) break;
    }

    const diagnostics = parseDiagnostics(allOutput);
    const { errors, warnings } = countBySeverity(diagnostics);
    if (exitCode !== 0) {
      const summaryAr = `فشل البناء: ${errors} خطأ، ${warnings} تحذير`;
      ev.log(`\n✖ ${summaryAr}\n`);
      setProgress(1, "failed");
      return finish({ status: "failed", durationMs: Date.now() - started, diagnostics, exitCode, summaryAr });
    }

    setProgress(0.93, "packaging");
    let artifactRel = plan.artifactPath;
    if (!artifactRel) {
      const candidates = await walk(root);
      artifactRel = pickArtifact(candidates, job.config);
    }
    if (!artifactRel) {
      const summaryAr = "اكتمل البناء لكن لم يُعثر على ملف ناتج من النوع المطلوب.";
      ev.log(`\n✖ ${summaryAr}\n`);
      return finish({ status: "failed", durationMs: Date.now() - started, diagnostics, exitCode, summaryAr });
    }
    const bytes = await readFile(join(root, artifactRel));
    const format = detectBinaryFormat(new Uint8Array(bytes.subarray(0, 4096)));
    ev.log(`\n▶ الملف الناتج: ${artifactRel} (${formatBytesAr(bytes.byteLength)}) — الصيغة المكتشفة: ${format}\n`);
    const artifact = await api.uploadArtifact(job.id, plan.artifactName, bytes);
    const durationMs = Date.now() - started;
    const summaryAr = `نجح البناء خلال ${formatDurationAr(durationMs)} — ${errors} خطأ، ${warnings} تحذير`;
    ev.log(`✔ ${summaryAr}\n`);
    setProgress(1, "done");
    return finish({ status: "succeeded", durationMs, diagnostics, exitCode, summaryAr, artifact: artifact as BuildResult["artifact"] });
  } catch (e) {
    ev.log(`\n✖ خطأ داخلي في العامل: ${(e as Error).message}\n`);
    return finish({ status: "failed", durationMs: Date.now() - started, diagnostics: parseDiagnostics(allOutput), exitCode: null, summaryAr: "خطأ داخلي في عامل البناء" });
  }
}
