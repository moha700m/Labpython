/**
 * Compiler / linker flag allow-list. Builds run in a sandbox anyway, but flags that
 * load code into the compiler (-fplugin, -wrapper, -B, -specs), read response files
 * (@file), redirect output (-o) or point outside the project (absolute -I / -L) are
 * refused so a build cannot escape its intended shape.
 */
export class FlagRejectedError extends Error {
  constructor(public readonly flag: string, reason: string) {
    super(`Flag "${flag}" rejected: ${reason}`);
    this.name = "FlagRejectedError";
  }
}

const DENY: [RegExp, string][] = [
  [/^@/, "response files are not allowed"],
  [/^-wrapper/, "compiler wrappers are not allowed"],
  [/^-fplugin/, "compiler plugins are not allowed"],
  [/^-B/, "changing compiler search path is not allowed"],
  [/^-?-specs/, "spec files are not allowed"],
  [/^-o$|^-o\S/, "output path is controlled by the build system"],
  [/^--?sysroot/, "sysroot is controlled by the build system"],
  [/^-iprefix|^-iwithprefix|^-isysroot|^-imultilib/, "include prefix flags are not allowed"],
  [/^-Xlinker$|^-Wl,.*(--plugin|-plugin|--wrap=|-rpath)/, "linker passthrough of this kind is not allowed"],
  [/^-save-temps/, "not allowed"],
  [/^-fdump/, "not allowed"],
  [/^-std=/, "set the C++ standard from build settings"],
  [/^-x$/, "language override is not allowed"],
];

const ALLOW: RegExp[] = [
  /^-W[a-zA-Z0-9=+_-]*$/, // warnings (-Wall, -Wno-unused, -Werror=...)
  /^-w$/,
  /^-pedantic(-errors)?$/,
  /^-O[0-3sgz]?$/,
  /^-Ofast$/,
  /^-g[0-3]?$/,
  /^-ggdb[0-3]?$/,
  /^-D[A-Za-z_][A-Za-z0-9_]*(=[^\s]*)?$/,
  /^-U[A-Za-z_][A-Za-z0-9_]*$/,
  /^-I[^/\s][^\s]*$/, // relative include paths
  /^-L[^/\s][^\s]*$/, // relative library paths
  /^-l[A-Za-z0-9_+.-]+$/,
  /^-f(no-)?(exceptions|rtti|inline|strict-aliasing|omit-frame-pointer|PIC|pic|PIE|pie|lto|openmp|permissive|char8_t|coroutines|modules-ts|concepts|stack-protector(-strong|-all)?|sanitize=(address|undefined|leak|thread)|trapv|wrapv|diagnostics-show-option|visibility=hidden|visibility=default|unroll-loops|fast-math|signed-char|unsigned-char|elide-constructors|threadsafe-statics|implicit-templates|operator-names)$/,
  /^-f(max-errors|template-depth|constexpr-depth|constexpr-steps)=\d+$/,
  /^-m(windows|console|unicode|threads|sse[0-9.]*|avx2?|fma|tune=[a-z0-9-]+|arch=[a-z0-9-]+|64)$/,
  /^-march=[a-z0-9-]+$/,
  /^-mtune=[a-z0-9-]+$/,
  /^-municode$/,
  /^-static(-libgcc|-libstdc\+\+)?$/,
  /^-shared$/,
  /^-pthread$/,
  /^-s$/,
  /^-rdynamic$/,
  /^-Wl,(--subsystem,(console|windows)|-s|--gc-sections|--as-needed|--no-as-needed|-O[0-3]|--stack,\d+)$/,
  /^-DNDEBUG$/,
  // MSVC style
  /^\/(W[0-4]|WX|EHsc|O[12dx]|Zi|MD|MT|MDd|MTd|permissive-|utf-8|D[A-Za-z_][A-Za-z0-9_=]*)$/,
];

export function sanitizeFlags(flags: string[]): string[] {
  if (flags.length > 64) throw new FlagRejectedError(flags.length + " flags", "too many flags");
  const out: string[] = [];
  for (const raw of flags) {
    const f = raw.trim();
    if (!f) continue;
    if (f.length > 200) throw new FlagRejectedError(f.slice(0, 40), "too long");
    if (f.includes("..")) throw new FlagRejectedError(f, "parent directory references are not allowed");
    for (const [re, reason] of DENY) if (re.test(f)) throw new FlagRejectedError(f, reason);
    if (!ALLOW.some((re) => re.test(f))) throw new FlagRejectedError(f, "not in the allowed flag list");
    out.push(f);
  }
  return out;
}

/** Split a user-typed flag string into tokens (whitespace separated, quotes not supported on purpose). */
export function splitFlags(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}
