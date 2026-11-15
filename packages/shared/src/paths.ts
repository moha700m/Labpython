import { ALLOWED_BASENAMES, ALLOWED_EXTENSIONS, BINARY_EXTENSIONS, LIMITS } from "./limits.ts";

export class UnsafePathError extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`Unsafe path "${path}": ${reason}`);
    this.name = "UnsafePathError";
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Normalize a user-supplied project-relative path and reject anything that could
 * escape the project root (path traversal, absolute paths, drive letters, NUL bytes,
 * reserved device names). Returns a POSIX-style relative path.
 */
export function normalizeProjectPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) throw new UnsafePathError(String(input), "empty");
  if (input.includes("\0")) throw new UnsafePathError(input, "NUL byte");
  if (/[\x00-\x1f\x7f]/.test(input)) throw new UnsafePathError(input, "control character");
  const unified = input.replace(/\\/g, "/");
  if (unified.startsWith("/")) throw new UnsafePathError(input, "absolute path");
  if (/^[a-zA-Z]:/.test(unified)) throw new UnsafePathError(input, "drive letter");
  if (unified.startsWith("//")) throw new UnsafePathError(input, "UNC path");

  const parts: string[] = [];
  for (const raw of unified.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") throw new UnsafePathError(input, "parent directory reference");
    if (WINDOWS_RESERVED.test(raw)) throw new UnsafePathError(input, "reserved device name");
    if (/[<>:"|?*]/.test(raw)) throw new UnsafePathError(input, "invalid character");
    if (raw.endsWith(" ") || (raw.endsWith(".") && raw !== ".")) throw new UnsafePathError(input, "trailing dot or space");
    parts.push(raw);
  }
  if (parts.length === 0) throw new UnsafePathError(input, "empty");
  if (parts.length > LIMITS.maxPathDepth) throw new UnsafePathError(input, "too deep");
  const out = parts.join("/");
  if (out.length > LIMITS.maxPathLength) throw new UnsafePathError(input, "too long");
  return out;
}

export function extname(path: string): string {
  const base = path.split("/").pop() ?? "";
  if (base.startsWith(".") && base.indexOf(".", 1) === -1) return base; // ".gitignore"
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Whether a (normalized) path is an accepted project file type. */
export function isAllowedProjectFile(path: string): boolean {
  const base = basename(path);
  if ((ALLOWED_BASENAMES as readonly string[]).includes(base)) return true;
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extname(path));
}

export function isBinaryProjectFile(path: string): boolean {
  return (BINARY_EXTENSIONS as readonly string[]).includes(extname(path));
}

/** Monaco language id for a path. */
export function languageForPath(path: string): string {
  const base = basename(path);
  if (base === "CMakeLists.txt" || extname(path) === ".cmake") return "cmake";
  if (/^(GNU)?[Mm]akefile$/.test(base) || extname(path) === ".mk") return "makefile";
  switch (extname(path)) {
    case ".c":
      return "c";
    case ".cpp": case ".cc": case ".cxx": case ".c++": case ".hpp": case ".hh": case ".hxx": case ".h": case ".inl": case ".ipp": case ".tpp":
      return "cpp";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    case ".yml": case ".yaml":
      return "yaml";
    case ".ini": case ".cfg": case ".toml":
      return "ini";
    default:
      return "plaintext";
  }
}
