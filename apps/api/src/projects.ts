import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DEFAULT_BUILD_CONFIG,
  LIMITS,
  type BuildConfig,
  type ProjectFile,
  isAllowedProjectFile,
  isBinaryProjectFile,
  normalizeProjectPath,
  bytesToBase64,
} from "@mcs/shared";
import { z } from "zod";
import type { DB } from "./db.ts";
import { now } from "./db.ts";

export const BuildConfigSchema = z.object({
  compiler: z.enum(["gcc", "clang", "mingw-gcc", "msvc"]),
  standard: z.enum(["c++17", "c++20", "c++23", "c++26"]),
  target: z.enum(["linux-elf", "windows-exe"]),
  mode: z.enum(["debug", "release"]),
  kind: z.enum(["auto", "single", "multi", "cmake", "make"]),
  output: z.enum(["executable", "static-lib", "shared-lib"]),
  extraFlags: z.array(z.string().max(200)).max(64),
  linkFlags: z.array(z.string().max(200)).max(64),
  outputName: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  windowsSubsystem: z.enum(["console", "windows"]),
  runEnv: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.string().max(1000)),
});

export function mergeConfig(partial: Partial<BuildConfig> | undefined): BuildConfig {
  return BuildConfigSchema.parse({ ...DEFAULT_BUILD_CONFIG, ...(partial ?? {}) });
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  template: string | null;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateInfo {
  id: string;
  nameAr: string;
  descriptionAr: string;
  level: "beginner" | "intermediate" | "pro";
  config: Partial<BuildConfig>;
  files: ProjectFile[];
}

export function loadTemplates(dir: string): TemplateInfo[] {
  if (!existsSync(dir)) return [];
  const out: TemplateInfo[] = [];
  for (const id of readdirSync(dir).sort()) {
    const tdir = join(dir, id);
    const meta = join(tdir, "template.json");
    if (!existsSync(meta)) continue;
    const info = JSON.parse(readFileSync(meta, "utf8"));
    const files: ProjectFile[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name !== "template.json") {
          const path = normalizeProjectPath(relative(tdir, full));
          files.push(
            isBinaryProjectFile(path)
              ? { path, content: bytesToBase64(readFileSync(full)), encoding: "base64" }
              : { path, content: readFileSync(full, "utf8"), encoding: "utf8" },
          );
        }
      }
    };
    walk(tdir);
    out.push({ id, nameAr: info.nameAr, descriptionAr: info.descriptionAr, level: info.level, config: info.config, files });
  }
  return out;
}

/**
 * Infer build settings from uploaded sources: a WinMain/wWinMain entry point means a Win32 GUI
 * program (Windows subsystem, plus -municode for wWinMain); <windows.h> means Windows-only code.
 */
export function inferConfig(files: ProjectFile[]): Partial<BuildConfig> {
  const sources = files.filter((f) => f.encoding === "utf8" && /\.(c|cc|cpp|cxx|c\+\+)$/i.test(f.path)).map((f) => f.content);
  const all = sources.join("\n");
  const cfg: Partial<BuildConfig> = {};
  if (/\bwWinMain\s*\(/.test(all)) {
    cfg.windowsSubsystem = "windows";
    cfg.linkFlags = ["-municode"];
  } else if (/\bWinMain\s*\(/.test(all)) cfg.windowsSubsystem = "windows";
  return cfg;
}

export class ProjectError extends Error {
  constructor(public status: number, public code: string, public messageAr: string) {
    super(code);
  }
}

export class Projects {
  constructor(private db: DB) {}

  list(userId: string) {
    return (
      this.db
        .prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
           FROM projects p WHERE user_id = ? ORDER BY updated_at DESC`,
        )
        .all(userId) as unknown as (ProjectRow & { file_count: number })[]
    ).map((r) => this.toDto(r));
  }

  /** Every read goes through here: a project is only visible to its owner. */
  getOwned(userId: string, projectId: string): ProjectRow {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as ProjectRow | undefined;
    if (!row) throw new ProjectError(404, "not_found", "المشروع غير موجود");
    return row;
  }

  toDto(r: ProjectRow & { file_count?: number }) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      template: r.template,
      config: mergeConfig(JSON.parse(r.config_json)),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      fileCount: r.file_count,
    };
  }

  create(userId: string, input: { name: string; description?: string; template?: string | null; config?: Partial<BuildConfig>; files: ProjectFile[] }) {
    const id = randomUUID();
    // Templates bring their own config; uploaded code gets sensible settings inferred from its content.
    const config = mergeConfig(input.config ?? inferConfig(input.files));
    const t = now();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT INTO projects (id, user_id, name, description, template, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, userId, input.name.slice(0, 100), (input.description ?? "").slice(0, 500), input.template ?? null, JSON.stringify(config), t, t);
      this.writeFiles(id, input.files, { replace: true });
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.toDto(this.getOwned(userId, id));
  }

  update(userId: string, projectId: string, patch: { name?: string; description?: string; config?: Partial<BuildConfig> }) {
    const row = this.getOwned(userId, projectId);
    const config = patch.config ? mergeConfig({ ...JSON.parse(row.config_json), ...patch.config }) : JSON.parse(row.config_json);
    this.db
      .prepare("UPDATE projects SET name = ?, description = ?, config_json = ?, updated_at = ? WHERE id = ?")
      .run((patch.name ?? row.name).slice(0, 100), (patch.description ?? row.description).slice(0, 500), JSON.stringify(config), now(), projectId);
    return this.toDto(this.getOwned(userId, projectId));
  }

  remove(userId: string, projectId: string) {
    this.getOwned(userId, projectId);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }

  listFiles(userId: string, projectId: string) {
    this.getOwned(userId, projectId);
    return this.db.prepare("SELECT path, size, encoding, updated_at FROM files WHERE project_id = ? ORDER BY path").all(projectId) as {
      path: string;
      size: number;
      encoding: string;
      updated_at: string;
    }[];
  }

  readFile(userId: string, projectId: string, path: string): ProjectFile {
    this.getOwned(userId, projectId);
    const p = normalizeProjectPath(path);
    const row = this.db.prepare("SELECT path, content, encoding FROM files WHERE project_id = ? AND path = ?").get(projectId, p) as ProjectFile | undefined;
    if (!row) throw new ProjectError(404, "file_not_found", "الملف غير موجود");
    return row;
  }

  /** All files (used for build snapshots and ZIP export). */
  allFiles(projectId: string): ProjectFile[] {
    return this.db.prepare("SELECT path, content, encoding FROM files WHERE project_id = ? ORDER BY path").all(projectId) as unknown as ProjectFile[];
  }

  validateFile(f: ProjectFile): ProjectFile {
    const path = normalizeProjectPath(f.path);
    if (!isAllowedProjectFile(path)) throw new ProjectError(400, "file_type", `نوع الملف غير مدعوم: ${path}`);
    const size = f.encoding === "base64" ? Math.floor((f.content.length * 3) / 4) : Buffer.byteLength(f.content, "utf8");
    if (size > LIMITS.maxFileBytes) throw new ProjectError(413, "file_too_large", `الملف كبير جداً: ${path}`);
    if (f.encoding === "base64" && !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content)) throw new ProjectError(400, "bad_base64", "ترميز غير صالح");
    if (f.encoding === "utf8" && isBinaryProjectFile(path)) throw new ProjectError(400, "binary_as_text", "ملف ثنائي يجب رفعه بترميز base64");
    return { path, content: f.content, encoding: f.encoding };
  }

  writeFiles(projectId: string, files: ProjectFile[], opts: { replace?: boolean } = {}) {
    const valid = files.map((f) => this.validateFile(f));
    const existing = opts.replace ? [] : (this.db.prepare("SELECT path, size FROM files WHERE project_id = ?").all(projectId) as { path: string; size: number }[]);
    const map = new Map(existing.map((e) => [e.path, e.size]));
    for (const f of valid) map.set(f.path, f.encoding === "base64" ? Math.floor((f.content.length * 3) / 4) : Buffer.byteLength(f.content));
    if (map.size > LIMITS.maxFilesPerProject) throw new ProjectError(413, "too_many_files", "عدد الملفات تجاوز الحد المسموح");
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    if (total > LIMITS.maxProjectBytes) throw new ProjectError(413, "project_too_large", "حجم المشروع تجاوز الحد المسموح");
    // Case-insensitive collisions break Windows builds.
    const lower = new Map<string, string>();
    for (const p of map.keys()) {
      const k = p.toLowerCase();
      if (lower.has(k) && lower.get(k) !== p) throw new ProjectError(409, "case_collision", `تعارض في أسماء الملفات: ${p}`);
      lower.set(k, p);
    }
    if (opts.replace) this.db.prepare("DELETE FROM files WHERE project_id = ?").run(projectId);
    const stmt = this.db.prepare(
      `INSERT INTO files (project_id, path, content, encoding, size, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, path) DO UPDATE SET content = excluded.content, encoding = excluded.encoding, size = excluded.size, updated_at = excluded.updated_at`,
    );
    const t = now();
    for (const f of valid) stmt.run(projectId, f.path, f.content, f.encoding, map.get(f.path)!, t);
    this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(t, projectId);
  }

  saveFiles(userId: string, projectId: string, files: ProjectFile[]) {
    this.getOwned(userId, projectId);
    this.db.exec("BEGIN");
    try {
      this.writeFiles(projectId, files);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  deleteFile(userId: string, projectId: string, path: string) {
    this.getOwned(userId, projectId);
    const p = normalizeProjectPath(path);
    // Deleting a folder deletes everything under it.
    this.db.prepare("DELETE FROM files WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')").run(projectId, p, p.replace(/[%_\\]/g, "\\$&") + "/%");
    this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
  }

  renameFile(userId: string, projectId: string, from: string, to: string) {
    const file = this.readFile(userId, projectId, from);
    const target = this.validateFile({ ...file, path: to });
    const exists = this.db.prepare("SELECT 1 FROM files WHERE project_id = ? AND path = ?").get(projectId, target.path);
    if (exists) throw new ProjectError(409, "exists", "يوجد ملف بنفس الاسم");
    this.db.prepare("UPDATE files SET path = ?, updated_at = ? WHERE project_id = ? AND path = ?").run(target.path, now(), projectId, file.path);
  }
}
