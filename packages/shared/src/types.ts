/** Core domain types shared by web, api and workers. */

export type CppStandard = "c++17" | "c++20" | "c++23" | "c++26";
export type CompilerId = "gcc" | "clang" | "mingw-gcc" | "msvc";
export type BuildTarget = "linux-elf" | "windows-exe";
export type BuildMode = "debug" | "release";
export type ProjectKind = "auto" | "single" | "multi" | "cmake" | "make";
export type OutputKind = "executable" | "static-lib" | "shared-lib";

export interface BuildConfig {
  compiler: CompilerId;
  standard: CppStandard;
  target: BuildTarget;
  mode: BuildMode;
  kind: ProjectKind;
  output: OutputKind;
  /** Extra compiler flags, validated by @mcs/compiler sanitizeFlags. */
  extraFlags: string[];
  /** Extra linker flags (e.g. -lgdi32), validated. */
  linkFlags: string[];
  /** Name of the produced artifact without extension. */
  outputName: string;
  /** Windows subsystem for GUI apps. */
  windowsSubsystem: "console" | "windows";
  /** Environment variables passed to runs (not builds). */
  runEnv: Record<string, string>;
}

export const DEFAULT_BUILD_CONFIG: BuildConfig = {
  compiler: "mingw-gcc",
  standard: "c++20",
  target: "windows-exe",
  mode: "debug",
  kind: "auto",
  output: "executable",
  extraFlags: [],
  linkFlags: [],
  outputName: "app",
  windowsSubsystem: "console",
  runEnv: {},
};

export type Severity = "error" | "warning" | "note";

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  /** Arabic explanation, when a known pattern matched. */
  explanationAr?: string;
  /** Arabic fix suggestion. */
  suggestionAr?: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "build" | "run";

export interface ProjectFile {
  path: string;
  /** UTF-8 text, or base64 when encoding === "base64". */
  content: string;
  encoding: "utf8" | "base64";
}

export interface ArtifactInfo {
  id: string;
  fileName: string;
  size: number;
  sha256: string;
  /** Detected binary format from header bytes — never from the file name. */
  format: "pe32+" | "pe32" | "elf64" | "elf32" | "archive" | "unknown";
  description: string;
}

export interface BuildResult {
  status: "succeeded" | "failed";
  durationMs: number;
  diagnostics: Diagnostic[];
  exitCode: number | null;
  artifact?: ArtifactInfo;
  summaryAr: string;
}

export interface JobSummary {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  phase: string;
  config: BuildConfig;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: BuildResult | null;
}

/** Messages on the run-session websocket (browser <-> api <-> worker). */
export type RunClientMessage =
  | { type: "stdin"; data: string }
  | { type: "stop" }
  | { type: "mouse"; x: number; y: number; button: 0 | 1 | 2 | 3; action: "move" | "down" | "up" | "click" }
  | { type: "key"; key: string; action: "down" | "up" | "press" }
  | { type: "screenshot" };

export type RunServerMessage =
  | { type: "status"; status: "starting" | "running" | "exited" | "stopped" | "error"; message?: string; exitCode?: number | null; inputMode?: "tty" | "line" }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "frame"; mime: "image/jpeg" | "image/png"; data: string; width: number; height: number }
  | { type: "screenshot"; mime: "image/png"; data: string };

export interface RunRequest {
  /** "native" = run Linux ELF in sandbox; "wine" = run Windows EXE via Wine runner; "windows" = real Windows runner. */
  backend: "native" | "wine" | "windows";
  /** Show a virtual display and stream frames (GUI programs). */
  display: boolean;
  args: string[];
}
