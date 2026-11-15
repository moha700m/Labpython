import type { BuildConfig, Diagnostic, JobSummary, ProjectFile } from "@mcs/shared";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public messageAr: string, public body?: unknown) {
    super(messageAr || code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "x-mcs-client": "web",
      ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) {
    let data: { error?: string; messageAr?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, data.error ?? "http_" + res.status, data.messageAr ?? `خطأ ${res.status}`, data);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  template: string | null;
  config: BuildConfig;
  createdAt: string;
  updatedAt: string;
  fileCount?: number;
}
export interface FileEntry {
  path: string;
  size: number;
  encoding: string;
  updated_at: string;
}
export interface Template {
  id: string;
  nameAr: string;
  descriptionAr: string;
  level: "beginner" | "intermediate" | "pro";
  config: BuildConfig;
  files: string[];
}
export interface Capabilities {
  workers: string[];
  compilers: { id: BuildConfig["compiler"]; labelAr: string; target: BuildConfig["target"]; available: boolean }[];
  runBackends: { native: boolean; wine: boolean; windows: boolean; display: boolean };
  ai: { available: boolean; provider: string; model: string };
}
export type JobDetail = JobSummary & { log: string; logLength: number };
export interface ArtifactRow {
  id: string;
  job_id: string;
  file_name: string;
  size: number;
  sha256: string;
  format: string;
  created_at: string;
}
export interface ProposedChange {
  path: string;
  action: "create" | "modify" | "delete";
  content: string;
  reasonAr: string;
}

export const api = {
  me: () => request<{ user: User | null }>("GET", "/api/auth/me"),
  login: (email: string, password: string) => request<{ user: User }>("POST", "/api/auth/login", { email, password }),
  register: (email: string, name: string, password: string) => request<{ user: User }>("POST", "/api/auth/register", { email, name, password }),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout", {}),
  capabilities: () => request<Capabilities>("GET", "/api/capabilities"),
  templates: () => request<Template[]>("GET", "/api/templates"),
  projects: () => request<{ projects: Project[] }>("GET", "/api/projects"),
  createProject: (input: { name: string; template?: string; files?: ProjectFile[]; description?: string }) => request<{ project: Project }>("POST", "/api/projects", input),
  importZip: (file: File, name?: string) => {
    const fd = new FormData();
    if (name) fd.append("name", name);
    fd.append("file", file);
    return request<{ project: Project; skipped: { path: string; reason: string }[]; rejected: { path: string; reason: string }[] }>("POST", "/api/projects/import-zip", fd);
  },
  project: (id: string) => request<{ project: Project; files: FileEntry[] }>("GET", `/api/projects/${id}`),
  updateProject: (id: string, patch: { name?: string; config?: Partial<BuildConfig> }) => request<{ project: Project }>("PATCH", `/api/projects/${id}`, patch),
  deleteProject: (id: string) => request<{ ok: boolean }>("DELETE", `/api/projects/${id}`),
  readFile: (id: string, path: string) => request<{ file: ProjectFile }>("GET", `/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  allFiles: (id: string) => request<{ files: ProjectFile[] }>("GET", `/api/projects/${id}/files/all`),
  saveFiles: (id: string, files: ProjectFile[]) => request<{ files: FileEntry[] }>("PUT", `/api/projects/${id}/files`, { files }),
  deleteFile: (id: string, path: string) => request<{ files: FileEntry[] }>("DELETE", `/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  renameFile: (id: string, from: string, to: string) => request<{ files: FileEntry[] }>("POST", `/api/projects/${id}/rename`, { from, to }),
  upload: (id: string, items: { file: File; path: string }[]) => {
    const fd = new FormData();
    fd.append("paths", JSON.stringify(items.map((i) => i.path)));
    for (const i of items) fd.append("files", i.file, i.file.name);
    return request<{ added: string[]; skipped: { path: string; reason: string }[]; rejected: { path: string; reason: string }[]; files: FileEntry[] }>("POST", `/api/projects/${id}/upload`, fd);
  },
  format: (content: string, path: string) => request<{ content: string }>("POST", "/api/format", { content, path }),
  build: (id: string, config?: Partial<BuildConfig>) => request<{ job: JobDetail; workerAvailable: boolean }>("POST", `/api/projects/${id}/builds`, { config }),
  jobs: (id: string) => request<{ jobs: JobSummary[] }>("GET", `/api/projects/${id}/jobs`),
  job: (jobId: string, logOffset = 0) => request<{ job: JobDetail }>("GET", `/api/jobs/${jobId}?logOffset=${logOffset}`),
  waitJob: (jobId: string, logOffset = 0) => request<{ job: JobDetail }>("GET", `/api/jobs/${jobId}/wait?logOffset=${logOffset}`),
  cancelJob: (jobId: string) => request<{ job: JobDetail }>("POST", `/api/jobs/${jobId}/cancel`, {}),
  artifacts: (id: string) => request<{ artifacts: ArtifactRow[] }>("GET", `/api/projects/${id}/artifacts`),
  startRun: (id: string, artifactId: string, backend: "native" | "wine" | "windows", display: boolean, args: string[] = []) =>
    request<{ job: JobDetail; workerAvailable: boolean }>("POST", `/api/projects/${id}/runs`, { artifactId, backend, display, args }),
  assistant: (id: string, body: { task: string; message: string; activeFile?: string; selection?: string; diagnostics?: Diagnostic[]; buildLog?: string }) =>
    request<{ answerAr: string; changes: ProposedChange[]; provider: string; model: string }>("POST", `/api/projects/${id}/assistant`, body),
};

export function wsUrl(path: string): string {
  const devOrigin = process.env.NEXT_PUBLIC_API_WS_ORIGIN;
  if (devOrigin) return devOrigin + path;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

/** Follow a job with long-polling; calls onUpdate with each new state (log is cumulative). */
export async function followJob(jobId: string, onUpdate: (job: JobDetail, fullLog: string) => void, signal?: AbortSignal): Promise<JobDetail> {
  let offset = 0;
  let log = "";
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { job } = await api.waitJob(jobId, offset);
    log += job.log;
    offset = job.logLength;
    onUpdate(job, log);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return { ...job, log };
  }
}
