import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { FlagRejectedError, PlanError, TOOLCHAINS, planBuild } from "@mcs/compiler";
import { LIMITS, UnsafePathError, ZipRejectedError, createZip, extractZipSafe, isAllowedProjectFile, isBinaryProjectFile, normalizeProjectPath } from "@mcs/shared";
import { Auth, AuthError, SESSION_COOKIE, requireUser } from "./auth.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { JobError, Jobs } from "./jobs.ts";
import { ProjectError, Projects, loadTemplates, mergeConfig } from "./projects.ts";
import { RunRelay } from "./relay.ts";
import { RateLimiter, SecurityLog } from "./security.ts";
import { LocalArtifactStorage } from "./storage.ts";
import { type AssistantProvider, createProvider } from "./ai.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");

const FileSchema = z.object({ path: z.string().min(1).max(LIMITS.maxPathLength), content: z.string(), encoding: z.enum(["utf8", "base64"]).default("utf8") });

export interface AppDeps {
  config: AppConfig;
  ai?: AssistantProvider;
  templatesDir?: string;
}

export async function buildApp(deps: Partial<AppDeps> = {}): Promise<FastifyInstance & { ctx: Ctx }> {
  const config = deps.config ?? loadConfig();
  const ctx = makeCtx(config, deps);
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    bodyLimit: LIMITS.maxProjectBytes + 2 * 1024 * 1024,
    trustProxy: true,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: LIMITS.maxZipBytes, files: LIMITS.maxFilesPerProject, fields: 20 } });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req, reply) => {
    req.user = ctx.auth.userForToken(req.cookies[SESSION_COOKIE]);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "DENY");
    // CSRF defence: browsers cannot set custom headers on cross-site form posts.
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (mutating && req.url.startsWith("/api/") && !req.url.startsWith("/api/worker/") && req.headers["x-mcs-client"] !== "web") {
      return reply.code(403).send({ error: "csrf", messageAr: "طلب مرفوض" });
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ProjectError || err instanceof JobError || err instanceof AuthError) {
      const status = "status" in err ? err.status : 400;
      return reply.code(status).send({ error: err.code, messageAr: err.messageAr });
    }
    if (err instanceof UnsafePathError) {
      ctx.security.record("upload.rejected_path", { path: err.path, reason: err.reason }, { userId: req.user?.id, ip: req.ip });
      return reply.code(400).send({ error: "unsafe_path", messageAr: `مسار غير آمن: ${err.path}` });
    }
    if (err instanceof ZipRejectedError) {
      ctx.security.record("upload.rejected_zip", { reason: err.message }, { userId: req.user?.id, ip: req.ip });
      return reply.code(400).send({ error: "zip_rejected", messageAr: `تم رفض ملف ZIP: ${err.message}` });
    }
    if (err instanceof FlagRejectedError) {
      ctx.security.record("build.flag_rejected", { flag: err.flag }, { userId: req.user?.id, ip: req.ip });
      return reply.code(400).send({ error: "flag_rejected", messageAr: `خيار مترجم غير مسموح: ${err.flag}`, detail: err.message });
    }
    if (err instanceof PlanError) return reply.code(400).send({ error: "plan", messageAr: err.messageAr });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "validation", messageAr: "بيانات غير صالحة", issues: err.issues.slice(0, 10) });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: "bad_request", messageAr: e.message ?? "طلب غير صالح" });
    req.log.error(err);
    return reply.code(500).send({ error: "internal", messageAr: "خطأ داخلي في الخادم" });
  });

  registerAuthRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerJobRoutes(app, ctx);
  registerWorkerRoutes(app, ctx);
  registerAssistantRoutes(app, ctx);

  if (config.webDir && existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir, prefix: "/", wildcard: true, index: ["index.html"] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.code(404).sendFile("404.html");
    });
  }

  return Object.assign(app, { ctx }) as unknown as FastifyInstance & { ctx: Ctx };
}

function makeCtx(config: AppConfig, deps: Partial<AppDeps>) {
  const db = openDb(config.dataDir);
  const storage = new LocalArtifactStorage(config.dataDir);
  return {
    config,
    db,
    storage,
    auth: new Auth(db),
    projects: new Projects(db),
    jobs: new Jobs(db, storage),
    relay: new RunRelay(),
    security: new SecurityLog(db),
    ai: deps.ai ?? createProvider(config.ai),
    templates: loadTemplates(deps.templatesDir ?? process.env.MCS_TEMPLATES_DIR ?? join(REPO_ROOT, "templates")),
    loginLimiter: new RateLimiter(10, 60_000),
    buildLimiter: new RateLimiter(30, 60_000),
    aiLimiter: new RateLimiter(20, 60_000),
  };
}
type Ctx = ReturnType<typeof makeCtx>;

// --------------------------------------------------------------------------- auth

function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const Cred = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200) });
  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: ctx.config.cookieSecure, path: "/", maxAge: 14 * 86400 });

  app.post("/api/auth/register", async (req, reply) => {
    if (!ctx.config.allowRegistration) return reply.code(403).send({ error: "registration_closed", messageAr: "التسجيل مغلق" });
    if (!ctx.loginLimiter.take(`reg:${req.ip}`)) return reply.code(429).send({ error: "rate_limited", messageAr: "محاولات كثيرة، حاول لاحقاً" });
    const body = Cred.extend({ name: z.string().min(1).max(80) }).parse(req.body);
    const user = await ctx.auth.register(body.email, body.name, body.password);
    ctx.security.record("auth.register", { email: user.email }, { userId: user.id, ip: req.ip });
    setSession(reply, ctx.auth.createSession(user.id));
    return { user };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = Cred.parse(req.body);
    if (!ctx.loginLimiter.take(`login:${req.ip}`) || !ctx.loginLimiter.take(`login:${body.email.toLowerCase()}`)) {
      ctx.security.record("auth.rate_limited", { email: body.email }, { ip: req.ip });
      return reply.code(429).send({ error: "rate_limited", messageAr: "محاولات كثيرة، حاول بعد دقيقة" });
    }
    const user = await ctx.auth.login(body.email, body.password);
    if (!user) {
      ctx.security.record("auth.login_failed", { email: body.email }, { ip: req.ip });
      return reply.code(401).send({ error: "invalid_credentials", messageAr: "البريد أو كلمة المرور غير صحيحة" });
    }
    ctx.security.record("auth.login", {}, { userId: user.id, ip: req.ip });
    setSession(reply, ctx.auth.createSession(user.id));
    return { user };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) ctx.auth.destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({ user: req.user }));

  app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString() }));

  app.get("/api/capabilities", async () => {
    const live = ctx.jobs.liveCapabilities();
    return {
      workers: live,
      compilers: Object.values(TOOLCHAINS).map((t) => ({ id: t.id, labelAr: t.labelAr, target: t.target, available: live.includes(`build:${t.id}`) })),
      runBackends: {
        native: live.includes("run:native"),
        wine: live.includes("run:wine"),
        windows: live.includes("run:windows"),
        display: live.includes("run:display"),
      },
      ai: { available: ctx.ai.available(), provider: ctx.ai.name, model: ctx.ai.model },
      limits: LIMITS,
    };
  });
}

// ----------------------------------------------------------------------- projects

function registerProjectRoutes(app: FastifyInstance, ctx: Ctx) {
  const user = (req: FastifyRequest, reply: FastifyReply) => requireUser(req, reply);

  app.get("/api/templates", async () =>
    ctx.templates.map((t) => ({ id: t.id, nameAr: t.nameAr, descriptionAr: t.descriptionAr, level: t.level, config: mergeConfig(t.config), files: t.files.map((f) => f.path) })),
  );

  app.get("/api/projects", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    return { projects: ctx.projects.list(u.id) };
  });

  app.post("/api/projects", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const body = z
      .object({ name: z.string().min(1).max(100), description: z.string().max(500).optional(), template: z.string().max(64).optional(), files: z.array(FileSchema).max(LIMITS.maxFilesPerProject).optional() })
      .parse(req.body);
    let files = body.files ?? [];
    let config = undefined;
    if (body.template) {
      const t = ctx.templates.find((x) => x.id === body.template);
      if (!t) return reply.code(400).send({ error: "template", messageAr: "القالب غير موجود" });
      files = t.files;
      config = t.config;
    }
    if (files.length === 0) files = [{ path: "main.cpp", content: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!\\n";\n    return 0;\n}\n', encoding: "utf8" }];
    return { project: ctx.projects.create(u.id, { name: body.name, description: body.description, template: body.template, config, files }) };
  });

  app.post("/api/projects/import-zip", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "no_file", messageAr: "لم يتم إرسال ملف" });
    const buf = await part.toBuffer();
    const nameField = part.fields.name as { value?: string } | undefined;
    const report = extractZipSafe(new Uint8Array(buf));
    if (report.rejected.length) ctx.security.record("upload.rejected_path", { rejected: report.rejected.slice(0, 20) }, { userId: u.id, ip: req.ip });
    if (report.files.length === 0) return reply.code(400).send({ error: "empty", messageAr: "لا توجد ملفات C++ صالحة في الأرشيف", report });
    const name = (nameField?.value || part.filename.replace(/\.zip$/i, "") || "مشروع مستورد").slice(0, 100);
    const project = ctx.projects.create(u.id, { name, files: report.files });
    return { project, skipped: report.skipped, rejected: report.rejected };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    return { project: ctx.projects.toDto(ctx.projects.getOwned(u.id, req.params.id)), files: ctx.projects.listFiles(u.id, req.params.id) };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const body = z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(500).optional(), config: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    return { project: ctx.projects.update(u.id, req.params.id, body as never) };
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    ctx.projects.remove(u.id, req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { path: string } }>("/api/projects/:id/file", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    return { file: ctx.projects.readFile(u.id, req.params.id, req.query.path) };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/files/all", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    ctx.projects.getOwned(u.id, req.params.id);
    return { files: ctx.projects.allFiles(req.params.id) };
  });

  app.put<{ Params: { id: string } }>("/api/projects/:id/files", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const body = z.object({ files: z.array(FileSchema).min(1).max(LIMITS.maxFilesPerProject) }).parse(req.body);
    ctx.projects.saveFiles(u.id, req.params.id, body.files);
    return { files: ctx.projects.listFiles(u.id, req.params.id) };
  });

  app.delete<{ Params: { id: string }; Querystring: { path: string } }>("/api/projects/:id/file", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    ctx.projects.deleteFile(u.id, req.params.id, req.query.path);
    return { files: ctx.projects.listFiles(u.id, req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/rename", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const body = z.object({ from: z.string(), to: z.string() }).parse(req.body);
    ctx.projects.renameFile(u.id, req.params.id, body.from, body.to);
    return { files: ctx.projects.listFiles(u.id, req.params.id) };
  });

  /** Upload a ZIP or loose files (folder upload) into an existing project. */
  app.post<{ Params: { id: string } }>("/api/projects/:id/upload", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    ctx.projects.getOwned(u.id, req.params.id);
    const incoming: { path: string; content: string; encoding: "utf8" | "base64" }[] = [];
    const skipped: { path: string; reason: string }[] = [];
    const rejected: { path: string; reason: string }[] = [];
    // The client sends a "paths" JSON field (relative paths, same order as files) before the files,
    // because multipart file names lose their directory part.
    let paths: string[] = [];
    let index = 0;
    for await (const part of req.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "paths") paths = z.array(z.string().max(LIMITS.maxPathLength)).max(LIMITS.maxFilesPerProject).parse(JSON.parse(String(part.value)));
        continue;
      }
      const buf = await part.toBuffer();
      const rel = paths[index++] ?? part.filename;
      if (/\.zip$/i.test(part.filename)) {
        const rep = extractZipSafe(new Uint8Array(buf));
        incoming.push(...rep.files);
        skipped.push(...rep.skipped);
        rejected.push(...rep.rejected);
        continue;
      }
      try {
        const p = normalizeProjectPath(rel);
        if (!isAllowedProjectFile(p)) {
          skipped.push({ path: p, reason: "unsupported file type" });
          continue;
        }
        if (buf.byteLength > LIMITS.maxFileBytes) {
          skipped.push({ path: p, reason: "file too large" });
          continue;
        }
        incoming.push(isBinaryProjectFile(p) ? { path: p, content: buf.toString("base64"), encoding: "base64" } : { path: p, content: buf.toString("utf8"), encoding: "utf8" });
      } catch (e) {
        rejected.push({ path: rel, reason: e instanceof UnsafePathError ? e.reason : "invalid" });
      }
    }
    if (rejected.length) ctx.security.record("upload.rejected_path", { rejected: rejected.slice(0, 20) }, { userId: u.id, ip: req.ip });
    if (incoming.length) ctx.projects.saveFiles(u.id, req.params.id, incoming);
    return { added: incoming.map((f) => f.path), skipped, rejected, files: ctx.projects.listFiles(u.id, req.params.id) };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/export.zip", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const p = ctx.projects.getOwned(u.id, req.params.id);
    const zip = createZip(ctx.projects.allFiles(p.id));
    const name = p.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "project";
    reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename="${name}.zip"`);
    return reply.send(Buffer.from(zip));
  });

  /** clang-format only parses text; it never executes user code. Bounded by size and time. */
  app.post("/api/format", async (req, reply) => {
    const u = user(req, reply);
    if (!u) return;
    const body = z.object({ content: z.string().max(LIMITS.maxFileBytes), path: z.string().max(240).default("main.cpp"), style: z.enum(["Google", "LLVM", "Microsoft", "Mozilla", "WebKit", "file"]).default("Google") }).parse(req.body);
    const style = body.style === "file" ? "Google" : body.style;
    const ext = /\.(c|h|hpp|cc|cxx|cpp)$/i.exec(body.path)?.[0] ?? ".cpp";
    const formatted = await new Promise<string>((resolveP, reject) => {
      const p = spawn("clang-format", [`--style={BasedOnStyle: ${style}, IndentWidth: 4, ColumnLimit: 110}`, `--assume-filename=input${ext}`], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin" } });
      let out = "";
      const timer = setTimeout(() => p.kill("SIGKILL"), 5000);
      p.stdout.on("data", (d) => (out += d));
      p.on("error", reject);
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolveP(out);
        else reject(new Error("clang-format failed"));
      });
      p.stdin.end(body.content);
    }).catch(() => null);
    if (formatted === null) return reply.code(503).send({ error: "format_unavailable", messageAr: "أداة التنسيق غير متاحة على الخادم" });
    return { content: formatted };
  });
}

// --------------------------------------------------------------------------- jobs

function registerJobRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post<{ Params: { id: string } }>("/api/projects/:id/builds", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    if (!ctx.buildLimiter.take(`build:${u.id}`)) return reply.code(429).send({ error: "rate_limited", messageAr: "طلبات بناء كثيرة، انتظر قليلاً" });
    const p = ctx.projects.getOwned(u.id, req.params.id);
    const body = z.object({ config: z.record(z.string(), z.unknown()).optional() }).parse(req.body ?? {});
    const config = mergeConfig({ ...JSON.parse(p.config_json), ...(body.config ?? {}) });
    const files = ctx.projects.allFiles(p.id);
    // Validate the plan up-front so bad flags/targets fail fast with a clear message.
    planBuild(files.map((f) => f.path), config);
    const job = ctx.jobs.createBuild(u.id, p.id, config, files);
    const live = ctx.jobs.liveCapabilities();
    return { job, workerAvailable: live.includes(`build:${config.compiler}`) };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/jobs", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    ctx.projects.getOwned(u.id, req.params.id);
    return { jobs: ctx.jobs.listForProject(u.id, req.params.id) };
  });

  app.get<{ Params: { id: string }; Querystring: { logOffset?: string } }>("/api/jobs/:id", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    return { job: ctx.jobs.summary(u.id, req.params.id, Number(req.query.logOffset ?? 0) || 0) };
  });

  /** Long-poll variant: resolves as soon as the job changes (or after 20s). */
  app.get<{ Params: { id: string }; Querystring: { logOffset?: string; wait?: string } }>("/api/jobs/:id/wait", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const offset = Number(req.query.logOffset ?? 0) || 0;
    const cur = ctx.jobs.summary(u.id, req.params.id, offset);
    if (cur.log.length > 0 || ["succeeded", "failed", "cancelled"].includes(cur.status)) return { job: cur };
    await new Promise<void>((r) => {
      const ev = `update:${req.params.id}`;
      const t = setTimeout(done, Math.min(Number(req.query.wait ?? 20000), 25000));
      function done() {
        clearTimeout(t);
        ctx.jobs.events.off(ev, done);
        r();
      }
      ctx.jobs.events.on(ev, done);
      req.raw.on("close", done);
    });
    return { job: ctx.jobs.summary(u.id, req.params.id, offset) };
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const job = ctx.jobs.cancel(u.id, req.params.id);
    if (job.type === "run") ctx.relay.stop(req.params.id);
    return { job };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/artifacts", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    ctx.projects.getOwned(u.id, req.params.id);
    return { artifacts: ctx.jobs.listArtifacts(u.id, req.params.id) };
  });

  app.get<{ Params: { id: string } }>("/api/artifacts/:id/download", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const a = ctx.jobs.artifactOwned(u.id, req.params.id);
    reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${a.file_name}"`)
      .header("Content-Length", String(a.size))
      .header("X-Artifact-SHA256", a.sha256)
      .header("X-Artifact-Format", a.format);
    return reply.send(ctx.storage.get(a.storage_key));
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/runs", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    ctx.projects.getOwned(u.id, req.params.id);
    const body = z
      .object({ artifactId: z.string().uuid(), backend: z.enum(["native", "wine", "windows"]), display: z.boolean().default(false), args: z.array(z.string().max(200)).max(20).default([]) })
      .parse(req.body);
    const job = ctx.jobs.createRun(u.id, req.params.id, body.artifactId, { backend: body.backend, display: body.display, args: body.args });
    ctx.security.record("run.started", { jobId: job.id, backend: body.backend, artifactId: body.artifactId }, { userId: u.id, ip: req.ip });
    const live = ctx.jobs.liveCapabilities();
    return { job, workerAvailable: live.includes(`run:${body.backend}`) && (!body.display || live.includes("run:display")) };
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/ws", { websocket: true }, (socket, req) => {
    const u = req.user;
    try {
      if (!u) throw new JobError(401, "unauthorized", "");
      const job = ctx.jobs.getOwned(u.id, req.params.id);
      if (job.type !== "run") throw new JobError(400, "not_run", "");
    } catch {
      ctx.security.record("access.denied", { ws: "run", jobId: req.params.id }, { userId: u?.id, ip: req.ip });
      socket.close(4403, "forbidden");
      return;
    }
    ctx.relay.attachClient(req.params.id, socket);
  });
}

// ------------------------------------------------------------------------- worker

function registerWorkerRoutes(app: FastifyInstance, ctx: Ctx) {
  const expected = Buffer.from(ctx.config.workerToken);
  const workerId = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const auth = req.headers.authorization ?? "";
    const token = Buffer.from(auth.startsWith("Bearer ") ? auth.slice(7) : "");
    const id = String(req.headers["x-worker-id"] ?? "");
    if (token.length !== expected.length || !timingSafeEqual(token, expected) || !/^[A-Za-z0-9_.-]{1,64}$/.test(id)) {
      ctx.security.record("worker.auth_failed", { url: req.url }, { ip: req.ip });
      void reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return id;
  };

  app.post("/api/worker/claim", async (req, reply) => {
    const w = workerId(req, reply);
    if (!w) return;
    const body = z.object({ capabilities: z.array(z.string().regex(/^(build|run):[a-z-]+$/)).max(20) }).parse(req.body);
    const job = ctx.jobs.claim(w, body.capabilities);
    if (!job) return reply.code(204).send();
    return { job };
  });

  app.post<{ Params: { id: string } }>("/api/worker/jobs/:id/events", async (req, reply) => {
    const w = workerId(req, reply);
    if (!w) return;
    const body = z
      .object({
        events: z.array(z.union([z.object({ type: z.literal("log"), data: z.string().max(256 * 1024) }), z.object({ type: z.literal("progress"), progress: z.number(), phase: z.string().max(40) })])).max(500),
      })
      .parse(req.body);
    return ctx.jobs.appendEvents(w, req.params.id, body.events);
  });

  app.put<{ Params: { id: string }; Querystring: { name: string } }>("/api/worker/jobs/:id/artifact", async (req, reply) => {
    const w = workerId(req, reply);
    if (!w) return;
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: "body" });
    return { artifact: await ctx.jobs.storeArtifact(w, req.params.id, String(req.query.name ?? "artifact"), req.body) };
  });

  app.post<{ Params: { id: string } }>("/api/worker/jobs/:id/complete", async (req, reply) => {
    const w = workerId(req, reply);
    if (!w) return;
    ctx.jobs.complete(w, req.params.id, req.body as never);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/worker/artifacts/:id", async (req, reply) => {
    const w = workerId(req, reply);
    if (!w) return;
    const a = ctx.jobs.artifactForWorker(w, req.params.id);
    reply.header("Content-Type", "application/octet-stream").header("X-Artifact-SHA256", a.sha256);
    return reply.send(ctx.storage.get(a.storage_key));
  });

  app.get<{ Params: { id: string } }>("/api/worker/runs/:id/ws", { websocket: true }, (socket, req) => {
    const fake = { code: () => ({ send: () => undefined }) } as unknown as FastifyReply;
    const w = workerId(req, fake);
    try {
      if (!w) throw new Error("auth");
      ctx.jobs.workerJob(w, req.params.id);
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }
    const hb = setInterval(() => {
      try {
        ctx.jobs.heartbeat(w, req.params.id);
      } catch {
        /* job gone */
      }
    }, 20_000);
    ctx.relay.attachWorker(req.params.id, socket, () => clearInterval(hb));
  });
}

// ---------------------------------------------------------------------- assistant

function registerAssistantRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post<{ Params: { id: string } }>("/api/projects/:id/assistant", async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    ctx.projects.getOwned(u.id, req.params.id);
    if (!ctx.ai.available()) return reply.code(503).send({ error: "ai_unavailable", messageAr: "المساعد الذكي غير مُفعّل على هذا الخادم. يحتاج المسؤول لضبط مزود الذكاء الاصطناعي في متغيرات البيئة." });
    if (!ctx.aiLimiter.take(`ai:${u.id}`)) return reply.code(429).send({ error: "rate_limited", messageAr: "طلبات كثيرة للمساعد، انتظر دقيقة" });
    const body = z
      .object({
        task: z.enum(["explain", "fix", "review", "optimize", "generate", "tests", "stacktrace", "teach", "chat"]),
        message: z.string().max(10_000),
        activeFile: z.string().max(240).optional(),
        selection: z.string().max(50_000).optional(),
        diagnostics: z.array(z.object({ file: z.string(), line: z.number(), column: z.number(), severity: z.enum(["error", "warning", "note"]), message: z.string() })).max(100).optional(),
        buildLog: z.string().max(100_000).optional(),
      })
      .parse(req.body);
    const files = ctx.projects.allFiles(req.params.id);
    const res = await ctx.ai.ask({ ...body, files });
    if (res.changes.length) ctx.security.record("ai.proposal", { projectId: req.params.id, paths: res.changes.map((c) => c.path) }, { userId: u.id });
    return res;
  });
}
