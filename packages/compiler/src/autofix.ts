import type { BuildConfig, Diagnostic, ProjectFile } from "@mcs/shared";
import { STD_HEADERS } from "@mcs/localization";

export interface AutoFix {
  path: string;
  descriptionAr: string;
}

export interface AutoFixResult {
  /** Only the files that changed, with their full new content. */
  files: ProjectFile[];
  fixes: AutoFix[];
  /** Build setting changes that fix the problem (e.g. GUI vs console entry point). */
  config: Partial<BuildConfig>;
}

/** Wrap a left-to-right code snippet so it keeps its order inside Arabic text (LRI … PDI). */
const ltr = (code: string) => `\u2066${code}\u2069`;

const NAME = /['‘`«]?([A-Za-z_]\w*)['’`»]?/;

/**
 * Deterministic fixes for the most common beginner errors, derived from compiler diagnostics:
 *  - a standard-library name used without its header  → add the #include (and `using namespace std;`
 *    when the name was used without `std::`)
 *  - a missing semicolon                               → append `;` to the previous statement line
 *  - `void main()`                                      → `int main()`
 *  - GUI/console entry point mismatch                   → switch the Windows subsystem
 * Nothing is written here; the caller decides whether to apply the result.
 */
export function autoFix(files: ProjectFile[], diagnostics: Diagnostic[]): AutoFixResult {
  const lines = new Map<string, string[]>();
  const get = (path: string) => {
    if (!lines.has(path)) {
      const f = files.find((x) => x.path === path && x.encoding === "utf8");
      if (!f) return null;
      lines.set(path, f.content.split("\n"));
    }
    return lines.get(path)!;
  };
  const fixes: AutoFix[] = [];
  const config: Partial<BuildConfig> = {};
  const done = new Set<string>();

  // Semicolon fixes shift nothing (we only append), include insertions shift lines — so apply
  // semicolons first, bottom-up, then includes.
  const sorted = [...diagnostics].filter((d) => d.severity === "error").sort((a, b) => b.line - a.line);

  for (const d of sorted) {
    const src = d.file !== "linker" && d.file !== "compiler" ? get(d.file) : null;
    if (src && /expected ['‘]?;['’]? before/.test(d.message) && d.line >= 1) {
      // GCC 13+ points at the end of the line missing ';' (that line, column past its code);
      // older compilers point at the next token — then walk back to the previous code line.
      const here = src[d.line - 1] ?? "";
      const pointsAtEnd = d.column > here.replace(/\s*(\/\/.*)?$/, "").length && !/[;{}]\s*(\/\/.*)?$/.test(here) && here.trim() !== "";
      let i = pointsAtEnd ? d.line - 1 : d.line - 2;
      while (!pointsAtEnd && i >= 0 && (src[i]!.trim() === "" || src[i]!.trim().startsWith("//"))) i--;
      const line = src[i];
      if (line !== undefined && !/[;{}]\s*$/.test(line) && !line.trim().startsWith("#")) {
        const key = `semi:${d.file}:${i}`;
        if (!done.has(key)) {
          done.add(key);
          src[i] = line.replace(/\s*$/, ";");
          fixes.push({ path: d.file, descriptionAr: `أضفنا ${ltr(";")} في نهاية السطر ${i + 1}` });
        }
      }
    }
    if (src && /main' must return 'int'|::main' must return 'int'/.test(d.message)) {
      const i = src.findIndex((l) => /\bvoid\s+main\s*\(/.test(l));
      if (i >= 0 && !done.has(`main:${d.file}`)) {
        done.add(`main:${d.file}`);
        src[i] = src[i]!.replace(/\bvoid(\s+main\s*\()/, "int$1");
        fixes.push({ path: d.file, descriptionAr: `غيّرنا ${ltr("void main")} إلى ${ltr("int main")}` });
      }
    }
    if (/undefined reference to `?WinMain/.test(d.message) && !done.has("subsystem")) {
      done.add("subsystem");
      config.windowsSubsystem = "console";
      fixes.push({ path: "(الإعدادات)", descriptionAr: "البرنامج فيه main: حوّلنا نوعه إلى Console" });
    }
    if (/undefined reference to `?main'?/.test(d.message) && !done.has("subsystem")) {
      const hasWinMain = files.some((f) => /\bWinMain\s*\(/.test(f.content));
      if (hasWinMain) {
        done.add("subsystem");
        config.windowsSubsystem = "windows";
        fixes.push({ path: "(الإعدادات)", descriptionAr: "البرنامج فيه WinMain: حوّلنا نوعه إلى واجهة رسومية" });
      }
    }
  }

  for (const d of sorted) {
    const src = d.file !== "linker" && d.file !== "compiler" ? get(d.file) : null;
    if (!src) continue;
    const member = /is not a member of ['‘`]?std|no member named '\w+' in namespace 'std'/.test(d.message);
    const undeclared = /was not declared in this scope|use of undeclared identifier/.test(d.message);
    if (!member && !undeclared) continue;
    const name = (/no member named '(\w+)'/.exec(d.message)?.[1]) ?? NAME.exec(d.message)?.[1];
    const header = name ? STD_HEADERS[name] : undefined;
    if (!name || !header) continue;
    const text = src.join("\n");
    const lastInclude = src.reduce((acc, l, i) => (/^\s*#\s*include\b/.test(l) ? i : acc), -1);
    if (!new RegExp(`#\\s*include\\s*${header.replace(/[<>.]/g, (c) => "\\" + c)}`).test(text) && !done.has(`inc:${d.file}:${header}`)) {
      done.add(`inc:${d.file}:${header}`);
      src.splice(lastInclude + 1, 0, `#include ${header}`);
      fixes.push({ path: d.file, descriptionAr: `أضفنا ${ltr(`#include ${header}`)} لأن ${ltr(name)} يحتاجه` });
    }
    if (undeclared && !/using\s+namespace\s+std\s*;/.test(src.join("\n")) && !done.has(`using:${d.file}`)) {
      done.add(`using:${d.file}`);
      const li = src.reduce((acc, l, i) => (/^\s*#\s*include\b/.test(l) ? i : acc), -1);
      src.splice(li + 1, 0, "using namespace std;");
      fixes.push({ path: d.file, descriptionAr: `أضفنا ${ltr("using namespace std;")} لأنك كتبت ${ltr(name)} بدون ${ltr("std::")}` });
    }
  }

  const changed: ProjectFile[] = [];
  for (const [path, l] of lines) {
    const original = files.find((f) => f.path === path)!;
    const content = l.join("\n");
    if (content !== original.content) changed.push({ path, content, encoding: "utf8" });
  }
  return { files: changed, fixes, config };
}
