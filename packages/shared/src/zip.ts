import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { LIMITS } from "./limits.ts";
import { UnsafePathError, isAllowedProjectFile, isBinaryProjectFile, normalizeProjectPath } from "./paths.ts";
import type { ProjectFile } from "./types.ts";

export interface ZipExtractReport {
  files: ProjectFile[];
  skipped: { path: string; reason: string }[];
  rejected: { path: string; reason: string }[];
}

export class ZipRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipRejectedError";
  }
}

/**
 * Extract a ZIP archive into in-memory project files with defence against:
 *  - path traversal (../, absolute, drive letters) — entry is rejected and reported
 *  - zip bombs (entry count, total size, per-entry compression ratio)
 *  - disallowed file types (skipped)
 *  - symlinks (zip "external attributes" with S_IFLNK are rejected)
 * Nothing is ever written to disk here.
 */
export function extractZipSafe(data: Uint8Array): ZipExtractReport {
  if (data.byteLength > LIMITS.maxZipBytes) throw new ZipRejectedError("ZIP file too large");
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw new ZipRejectedError("Not a ZIP file");

  const report: ZipExtractReport = { files: [], skipped: [], rejected: [] };
  let entryCount = 0;
  let declaredTotal = 0;

  const entries = unzipSync(data, {
    filter(file) {
      entryCount++;
      if (entryCount > LIMITS.maxZipEntries) throw new ZipRejectedError("Too many entries in ZIP");
      if (file.name.endsWith("/")) return false; // directory
      declaredTotal += file.originalSize;
      if (declaredTotal > LIMITS.maxProjectBytes) throw new ZipRejectedError("ZIP expands beyond project size limit");
      if (file.originalSize > LIMITS.maxFileBytes) {
        report.skipped.push({ path: file.name, reason: "file too large" });
        return false;
      }
      if (file.size > 0 && file.originalSize / file.size > LIMITS.maxZipRatio) {
        report.rejected.push({ path: file.name, reason: "suspicious compression ratio" });
        return false;
      }
      let normalized: string;
      try {
        normalized = normalizeProjectPath(file.name);
      } catch (e) {
        report.rejected.push({ path: file.name, reason: e instanceof UnsafePathError ? e.reason : "invalid path" });
        return false;
      }
      if (/(^|\/)(__MACOSX|\.git|node_modules|build|out|\.vs)(\/|$)/.test(normalized)) {
        report.skipped.push({ path: normalized, reason: "ignored directory" });
        return false;
      }
      if (!isAllowedProjectFile(normalized)) {
        report.skipped.push({ path: normalized, reason: "unsupported file type" });
        return false;
      }
      return true;
    },
  });

  // Symlink detection is not exposed by fflate's filter; scan the central directory.
  const symlinks = findSymlinkEntries(data);

  let actualTotal = 0;
  const seen = new Set<string>();
  for (const [name, bytes] of Object.entries(entries)) {
    const path = normalizeProjectPath(name);
    if (symlinks.has(name)) {
      report.rejected.push({ path, reason: "symlink" });
      continue;
    }
    actualTotal += bytes.byteLength;
    if (bytes.byteLength > LIMITS.maxFileBytes) {
      report.skipped.push({ path, reason: "file too large" });
      continue;
    }
    if (actualTotal > LIMITS.maxProjectBytes) throw new ZipRejectedError("ZIP expands beyond project size limit");
    if (seen.has(path.toLowerCase())) {
      report.rejected.push({ path, reason: "duplicate path" });
      continue;
    }
    seen.add(path.toLowerCase());
    if (isBinaryProjectFile(path)) {
      report.files.push({ path, content: bytesToBase64(bytes), encoding: "base64" });
    } else {
      report.files.push({ path, content: strFromU8(bytes), encoding: "utf8" });
    }
  }
  if (report.files.length > LIMITS.maxFilesPerProject) throw new ZipRejectedError("Too many files");

  // If every file shares a single top-level folder, strip it ("my-project/src/main.cpp" -> "src/main.cpp").
  const tops = new Set(report.files.map((f) => f.path.split("/")[0]));
  if (tops.size === 1 && report.files.every((f) => f.path.includes("/"))) {
    for (const f of report.files) f.path = f.path.slice(f.path.indexOf("/") + 1);
  }
  report.files.sort((a, b) => a.path.localeCompare(b.path));
  return report;
}

/** Scan the ZIP central directory for entries whose Unix mode is a symlink. */
function findSymlinkEntries(data: Uint8Array): Set<string> {
  const out = new Set<string>();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Locate End Of Central Directory record.
  let eocd = -1;
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count && p + 46 <= data.byteLength; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const madeBy = view.getUint16(p + 4, true) >> 8;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const extAttr = view.getUint32(p + 38, true);
    const name = strFromU8(data.subarray(p + 46, p + 46 + nameLen));
    const unixMode = extAttr >>> 16;
    if (madeBy === 3 && (unixMode & 0o170000) === 0o120000) out.add(name);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function createZip(files: ProjectFile[]): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const f of files) {
    input[normalizeProjectPath(f.path)] = f.encoding === "base64" ? base64ToBytes(f.content) : strToU8(f.content);
  }
  return zipSync(input, { level: 6 });
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
