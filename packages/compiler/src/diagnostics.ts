import type { Diagnostic, Severity } from "@mcs/shared";
import { explainDiagnostic } from "@mcs/localization";

// GCC / Clang: path:line:col: severity: message
const GNU_RE = /^(.+?):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$/;
// MSVC: path(line[,col]): severity CODE: message
const MSVC_RE = /^(.+?)\((\d+)(?:,(\d+))?\): (fatal error|error|warning|note) ?([A-Z]+\d+)?: (.*)$/;
// GNU ld / lld style: path:(.text+0x..): undefined reference to `x'  or  /usr/bin/ld: ...
const LD_RE = /^(?:.*?[\\/])?(?:[\w.-]+-)?(?:ld(?:\.lld|\.bfd|\.gold)?|collect2)(?:\.exe)?: (?:error: )?(.*)$/;
const LD_REF_RE = /^(.+?):(?:\d+:)?(?:\(\.[\w.$]+\+0x[0-9a-f]+\))?:? ?(undefined reference to .*|multiple definition of .*)$/;

/**
 * Parse compiler output into structured diagnostics. Paths are made relative to the
 * sandbox work directory so they match project file paths in the editor.
 */
export function parseDiagnostics(output: string, workDir = "/work"): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const rel = (p: string) => {
    let s = p.replace(/\\/g, "/");
    const wd = workDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (s.startsWith(wd + "/")) s = s.slice(wd.length + 1);
    if (s.startsWith("./")) s = s.slice(2);
    return s;
  };
  const push = (d: Diagnostic) => {
    const key = `${d.file}:${d.line}:${d.column}:${d.severity}:${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    const ex = explainDiagnostic(d.message);
    if (ex && d.severity !== "note") Object.assign(d, ex);
    out.push(d);
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/\x1b\[[0-9;]*[mK]/g, "");
    let m = line.match(GNU_RE);
    if (m && !/^\s/.test(line) && !m[1]!.includes(" In function")) {
      push({
        file: rel(m[1]!),
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : 1,
        severity: (m[4] === "fatal error" ? "error" : m[4]) as Severity,
        message: m[5]!.trim(),
      });
      continue;
    }
    m = line.match(MSVC_RE);
    if (m) {
      push({
        file: rel(m[1]!),
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : 1,
        severity: (m[4] === "fatal error" ? "error" : m[4]) as Severity,
        message: (m[5] ? `${m[5]}: ` : "") + m[6]!.trim(),
      });
      continue;
    }
    m = line.match(LD_REF_RE);
    if (m) {
      // Object files and system CRT sources are not project files: attribute to the linker.
      const file = rel(m[1]!);
      const projectFile = !file.startsWith("/") && !file.startsWith(".mcs/") && /\.(c|cc|cpp|cxx)$/.test(file);
      push({ file: projectFile ? file : "linker", line: 0, column: 0, severity: "error", message: m[2]!.trim() });
      continue;
    }
    m = line.match(LD_RE);
    if (m && !/ld returned \d+ exit status|in function [`'‘]/.test(m[1]!)) {
      push({ file: "linker", line: 0, column: 0, severity: "error", message: m[1]!.trim() });
    }
  }
  return out;
}

export function countBySeverity(diags: Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
  }
  return { errors, warnings };
}
