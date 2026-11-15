import type { BuildConfig, CompilerId, CppStandard, BuildTarget, ProjectKind } from "@mcs/shared";
import { SOURCE_EXTENSIONS, extname, basename } from "@mcs/shared";
import { sanitizeFlags } from "./flags.ts";

export interface Toolchain {
  id: CompilerId;
  labelAr: string;
  target: BuildTarget;
  cxx: string;
  cc: string;
  ar: string;
  windres?: string;
  /** Worker platform able to run this toolchain. */
  platform: "linux" | "windows";
  /** CMake toolchain file contents (cross compilers). */
  cmakeToolchain?: string;
}

export const TOOLCHAINS: Record<CompilerId, Toolchain> = {
  gcc: { id: "gcc", labelAr: "GCC (Linux)", target: "linux-elf", cxx: "g++", cc: "gcc", ar: "ar", platform: "linux" },
  clang: { id: "clang", labelAr: "Clang (Linux)", target: "linux-elf", cxx: "clang++", cc: "clang", ar: "ar", platform: "linux" },
  "mingw-gcc": {
    id: "mingw-gcc",
    labelAr: "MinGW-w64 GCC → Windows EXE",
    target: "windows-exe",
    cxx: "x86_64-w64-mingw32-g++-posix",
    cc: "x86_64-w64-mingw32-gcc-posix",
    ar: "x86_64-w64-mingw32-ar",
    windres: "x86_64-w64-mingw32-windres",
    platform: "linux",
    cmakeToolchain: [
      "set(CMAKE_SYSTEM_NAME Windows)",
      "set(CMAKE_SYSTEM_PROCESSOR x86_64)",
      "set(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc-posix)",
      "set(CMAKE_CXX_COMPILER x86_64-w64-mingw32-g++-posix)",
      "set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)",
      "set(CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)",
      "set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)",
      "set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)",
      "set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)",
      'set(CMAKE_EXE_LINKER_FLAGS_INIT "-static")',
      "",
    ].join("\n"),
  },
  msvc: { id: "msvc", labelAr: "MSVC (Windows Worker)", target: "windows-exe", cxx: "cl.exe", cc: "cl.exe", ar: "lib.exe", platform: "windows" },
};

export function stdFlag(std: CppStandard, compiler: CompilerId): string {
  if (compiler === "msvc") {
    return { "c++17": "/std:c++17", "c++20": "/std:c++20", "c++23": "/std:c++latest", "c++26": "/std:c++latest" }[std];
  }
  return { "c++17": "-std=c++17", "c++20": "-std=c++20", "c++23": "-std=c++23", "c++26": "-std=c++2c" }[std];
}

export interface BuildStep {
  label: string;
  phase: "configuring" | "compiling" | "linking" | "packaging";
  argv: string[];
  /** Relative to the work dir. */
  cwd: string;
  /** Source file this step compiles — used to attribute diagnostics. */
  source?: string;
}

export interface BuildPlan {
  kind: Exclude<ProjectKind, "auto">;
  toolchain: Toolchain;
  steps: BuildStep[];
  /** Expected artifact path relative to the work dir; for cmake/make it is discovered after the build. */
  artifactPath: string | null;
  artifactName: string;
  /** Files the worker must write before running the plan (relative path -> content). */
  generatedFiles: Record<string, string>;
}

export class PlanError extends Error {
  constructor(message: string, public readonly messageAr: string) {
    super(message);
    this.name = "PlanError";
  }
}

export function detectKind(paths: string[]): Exclude<ProjectKind, "auto"> {
  if (paths.includes("CMakeLists.txt")) return "cmake";
  if (paths.some((p) => /^(GNU)?[Mm]akefile$/.test(p))) return "make";
  const sources = paths.filter(isSource);
  return sources.length <= 1 ? "single" : "multi";
}

export function isSource(path: string): boolean {
  return (SOURCE_EXTENSIONS as readonly string[]).includes(extname(path));
}

function safeOutputName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^\.+/, "").slice(0, 64);
  return s || "app";
}

export function artifactFileName(config: BuildConfig): string {
  const name = safeOutputName(config.outputName);
  const win = TOOLCHAINS[config.compiler].target === "windows-exe";
  switch (config.output) {
    case "static-lib":
      return config.compiler === "msvc" ? `${name}.lib` : `lib${name}.a`;
    case "shared-lib":
      return win ? `${name}.dll` : `lib${name}.so`;
    default:
      return win ? `${name}.exe` : name;
  }
}

/**
 * Turn a project file list + build config into a concrete, deterministic list of argv
 * steps. No shell is ever involved: every step is executed with execve semantics.
 */
/**
 * On a Windows host the MinGW-w64 toolchain is native: plain g++/gcc/ar/windres and no cross-compile
 * CMake toolchain file. Used by the desktop app.
 */
export const NATIVE_WINDOWS_MINGW: Toolchain = {
  id: "mingw-gcc",
  labelAr: "MinGW-w64 GCC (Windows)",
  target: "windows-exe",
  cxx: "g++",
  cc: "gcc",
  ar: "ar",
  windres: "windres",
  platform: "windows",
};

export function planBuild(paths: string[], config: BuildConfig, opts: { jobs?: number; native?: boolean } = {}): BuildPlan {
  const toolchain = opts.native && config.compiler === "mingw-gcc" ? NATIVE_WINDOWS_MINGW : TOOLCHAINS[config.compiler];
  if (!toolchain) throw new PlanError(`Unknown compiler ${config.compiler}`, "مترجم غير معروف");
  if (toolchain.target !== config.target) {
    throw new PlanError(
      `Compiler ${config.compiler} cannot produce ${config.target}`,
      config.target === "windows-exe"
        ? "لإنتاج ملف EXE لويندوز اختر MinGW-w64 أو MSVC. مترجمات GCC/Clang هنا تنتج ملفات Linux فقط."
        : "هذا المترجم ينتج ملفات Windows فقط.",
    );
  }
  const extra = sanitizeFlags(config.extraFlags);
  const link = sanitizeFlags(config.linkFlags);
  const kind = config.kind === "auto" ? detectKind(paths) : config.kind;
  const jobs = String(Math.max(1, Math.min(opts.jobs ?? 4, 16)));
  const artifactName = artifactFileName(config);
  const isWin = toolchain.target === "windows-exe";
  const debug = config.mode === "debug";

  if (toolchain.id === "msvc") return planMsvc(paths, config, kind, extra, link, artifactName);

  if (kind === "cmake") {
    const generated: Record<string, string> = {};
    const configure = [
      "cmake", "-S", ".", "-B", "build", "-G", opts.native ? "MinGW Makefiles" : "Unix Makefiles",
      `-DCMAKE_BUILD_TYPE=${debug ? "Debug" : "Release"}`,
      `-DCMAKE_CXX_STANDARD=${config.standard.replace("c++", "")}`,
      "-DCMAKE_CXX_STANDARD_REQUIRED=ON",
      "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
    ];
    if (toolchain.cmakeToolchain) {
      generated[".mcs/toolchain.cmake"] = toolchain.cmakeToolchain;
      configure.push("-DCMAKE_TOOLCHAIN_FILE=.mcs/toolchain.cmake");
    } else {
      configure.push(`-DCMAKE_CXX_COMPILER=${toolchain.cxx}`, `-DCMAKE_C_COMPILER=${toolchain.cc}`);
      if (opts.native) configure.push("-DCMAKE_MAKE_PROGRAM=make", '-DCMAKE_EXE_LINKER_FLAGS_INIT=-static');
    }
    if (extra.length) configure.push(`-DCMAKE_CXX_FLAGS=${extra.join(" ")}`);
    if (link.length) configure.push(`-DCMAKE_EXE_LINKER_FLAGS=${link.join(" ")}`);
    return {
      kind,
      toolchain,
      generatedFiles: generated,
      artifactPath: null,
      artifactName,
      steps: [
        { label: "cmake configure", phase: "configuring", argv: configure, cwd: "." },
        { label: "cmake build", phase: "compiling", argv: ["cmake", "--build", "build", "-j", jobs], cwd: "." },
      ],
    };
  }

  if (kind === "make") {
    const mk = paths.find((p) => /^(GNU)?[Mm]akefile$/.test(p))!;
    return {
      kind,
      toolchain,
      generatedFiles: {},
      artifactPath: null,
      artifactName,
      steps: [
        {
          label: "make",
          phase: "compiling",
          argv: ["make", "-f", mk, "-j", jobs, `CXX=${toolchain.cxx}`, `CC=${toolchain.cc}`, `AR=${toolchain.ar}`],
          cwd: ".",
        },
      ],
    };
  }

  // single / multi file
  const sources = paths.filter(isSource).sort();
  if (sources.length === 0) throw new PlanError("No source files", "لا توجد ملفات مصدرية (.cpp أو .c) في المشروع.");
  const includeDirs = [...new Set(paths.filter((p) => /\.(h|hh|hpp|hxx|inl)$/i.test(p)).map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".")))];
  const common = ["-Wall", "-Wextra", "-fdiagnostics-color=never", "-fmax-errors=50", ...(debug ? ["-g", "-O0"] : ["-O2", "-DNDEBUG"])];
  if (config.output === "shared-lib" && !isWin) common.push("-fPIC");
  const incFlags = includeDirs.filter((d) => d !== ".").map((d) => `-I${d}`);

  const steps: BuildStep[] = [];
  const objects: string[] = [];
  for (const src of sources) {
    const obj = `.mcs/obj/${src.replace(/[/.]/g, "_")}.o`;
    objects.push(obj);
    const isC = extname(src) === ".c";
    steps.push({
      label: `compile ${src}`,
      phase: "compiling",
      source: src,
      cwd: ".",
      argv: [isC ? toolchain.cc : toolchain.cxx, ...(isC ? ["-std=c17"] : [stdFlag(config.standard, config.compiler)]), ...common, ...incFlags, ...extra, "-c", src, "-o", obj],
    });
  }
  // Windows resources (.rc)
  if (isWin && toolchain.windres) {
    for (const rc of paths.filter((p) => extname(p) === ".rc")) {
      const obj = `.mcs/obj/${rc.replace(/[/.]/g, "_")}.res.o`;
      objects.push(obj);
      steps.push({ label: `windres ${rc}`, phase: "compiling", source: rc, cwd: ".", argv: [toolchain.windres, "-O", "coff", "-i", rc, "-o", obj] });
    }
  }

  const out = `.mcs/out/${artifactName}`;
  if (config.output === "static-lib") {
    steps.push({ label: "archive", phase: "linking", cwd: ".", argv: [toolchain.ar, "rcs", out, ...objects] });
  } else {
    const linkArgv = [toolchain.cxx, ...objects, "-o", out];
    if (config.output === "shared-lib") linkArgv.push("-shared");
    if (isWin) {
      linkArgv.push("-static");
      linkArgv.push(config.windowsSubsystem === "windows" ? "-mwindows" : "-mconsole");
      if (!debug) linkArgv.push("-s");
      // Common Win32 libraries for GUI programs.
      if (config.windowsSubsystem === "windows") linkArgv.push("-lgdi32", "-luser32", "-lcomctl32");
    } else {
      linkArgv.push("-pthread");
    }
    linkArgv.push(...link);
    steps.push({ label: "link", phase: "linking", cwd: ".", argv: linkArgv });
  }
  return { kind, toolchain, steps, artifactPath: out, artifactName, generatedFiles: {} };
}

function planMsvc(paths: string[], config: BuildConfig, kind: Exclude<ProjectKind, "auto">, extra: string[], link: string[], artifactName: string): BuildPlan {
  const toolchain = TOOLCHAINS.msvc;
  const debug = config.mode === "debug";
  if (kind === "cmake") {
    return {
      kind, toolchain, artifactName, artifactPath: null, generatedFiles: {},
      steps: [
        { label: "cmake configure", phase: "configuring", cwd: ".", argv: ["cmake", "-S", ".", "-B", "build", "-G", "NMake Makefiles", `-DCMAKE_BUILD_TYPE=${debug ? "Debug" : "Release"}`, `-DCMAKE_CXX_STANDARD=${config.standard.replace("c++", "")}`] },
        { label: "cmake build", phase: "compiling", cwd: ".", argv: ["cmake", "--build", "build"] },
      ],
    };
  }
  const sources = paths.filter(isSource);
  const out = `.mcs/out/${artifactName}`;
  return {
    kind, toolchain, artifactName, artifactPath: out, generatedFiles: {},
    steps: [
      {
        label: "cl",
        phase: "compiling",
        cwd: ".",
        argv: ["cl.exe", "/nologo", "/EHsc", "/utf-8", stdFlag(config.standard, "msvc"), debug ? "/Zi" : "/O2", "/W4", ...extra, ...sources, `/Fe:${out}`, "/Fo:.mcs\\obj\\", "/link", config.windowsSubsystem === "windows" ? "/SUBSYSTEM:WINDOWS" : "/SUBSYSTEM:CONSOLE", ...link],
      },
    ],
  };
}

/** Pick the most likely artifact out of files produced by a cmake/make build. */
export function pickArtifact(candidates: { path: string; size: number; mtimeMs: number; format: string }[], config: BuildConfig): string | null {
  const wantWin = TOOLCHAINS[config.compiler].target === "windows-exe";
  const wanted = (f: { path: string; format: string }) => {
    if (config.output === "static-lib") return f.format === "archive";
    if (wantWin) return f.format === "pe32+" || f.format === "pe32";
    return f.format === "elf64" || f.format === "elf32";
  };
  const pool = candidates.filter((c) => wanted(c) && !/CMakeFiles\/|CompilerId|\.o$|\.obj$/.test(c.path));
  if (pool.length === 0) return null;
  const byName = pool.find((c) => basename(c.path).replace(/\.(exe|dll|a|so|lib)$/, "").replace(/^lib/, "") === config.outputName);
  if (byName) return byName.path;
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  return pool[0]!.path;
}
