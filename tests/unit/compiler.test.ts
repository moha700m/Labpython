import { describe, expect, it } from "vitest";
import { DEFAULT_BUILD_CONFIG } from "../../packages/shared/src/index.ts";
import { FlagRejectedError, PlanError, detectKind, parseDiagnostics, planBuild, sanitizeFlags, stdFlag } from "../../packages/compiler/src/index.ts";

const cfg = { ...DEFAULT_BUILD_CONFIG };

describe("sanitizeFlags", () => {
  it("allows common safe flags", () => {
    expect(sanitizeFlags(["-Wall", "-O2", "-DDEBUG=1", "-Iinclude", "-lws2_32", "-fno-exceptions", "-municode", "-march=native"])).toHaveLength(8);
  });
  it.each(["-fplugin=/tmp/x.so", "@/etc/passwd", "-wrapper", "-B/tmp", "-specs=x", "-o/tmp/x", "-I/etc", "-I../..", "--sysroot=/", "-Wl,--wrap=main", "-std=c++98", "$(rm -rf /)"])(
    "rejects %s",
    (f) => expect(() => sanitizeFlags([f])).toThrow(FlagRejectedError),
  );
});

describe("planBuild", () => {
  it("detects project kinds", () => {
    expect(detectKind(["main.cpp"])).toBe("single");
    expect(detectKind(["a.cpp", "b.cpp"])).toBe("multi");
    expect(detectKind(["CMakeLists.txt", "a.cpp"])).toBe("cmake");
    expect(detectKind(["Makefile", "a.cpp"])).toBe("make");
  });
  it("plans a MinGW multi-file EXE build with per-file compile and static link", () => {
    const plan = planBuild(["src/main.cpp", "src/calc.cpp", "include/calc.hpp"], cfg);
    expect(plan.steps.filter((s) => s.phase === "compiling")).toHaveLength(2);
    const link = plan.steps.at(-1)!;
    expect(link.argv[0]).toBe("x86_64-w64-mingw32-g++-posix");
    expect(link.argv).toContain("-static");
    expect(plan.artifactName).toBe("app.exe");
    expect(plan.steps[0]!.argv).toContain("-Iinclude");
  });
  it("uses -mwindows for GUI subsystem and names libraries correctly", () => {
    expect(planBuild(["main.cpp"], { ...cfg, windowsSubsystem: "windows" }).steps.at(-1)!.argv).toContain("-mwindows");
    expect(planBuild(["a.cpp"], { ...cfg, output: "static-lib", outputName: "m" }).artifactName).toBe("libm.a");
    expect(planBuild(["a.cpp"], { ...cfg, output: "shared-lib", outputName: "m" }).artifactName).toBe("m.dll");
    expect(planBuild(["a.cpp"], { ...cfg, compiler: "gcc", target: "linux-elf", output: "shared-lib", outputName: "m" }).artifactName).toBe("libm.so");
  });
  it("refuses to produce an EXE with a Linux compiler", () => {
    expect(() => planBuild(["main.cpp"], { ...cfg, compiler: "gcc", target: "windows-exe" })).toThrow(PlanError);
  });
  it("generates a CMake toolchain file for cross builds", () => {
    const plan = planBuild(["CMakeLists.txt", "main.cpp"], cfg);
    expect(plan.generatedFiles[".mcs/toolchain.cmake"]).toContain("CMAKE_SYSTEM_NAME Windows");
    expect(plan.steps[0]!.argv).toContain("-DCMAKE_TOOLCHAIN_FILE=.mcs/toolchain.cmake");
  });
  it("uses the native MinGW toolchain on Windows (desktop app)", () => {
    const plan = planBuild(["main.cpp"], cfg, { native: true });
    expect(plan.steps[0]!.argv[0]).toBe("g++");
    expect(plan.steps.at(-1)!.argv).toContain("-static");
    const cm = planBuild(["CMakeLists.txt", "main.cpp"], cfg, { native: true });
    expect(cm.generatedFiles).toEqual({});
    expect(cm.steps[0]!.argv).toContain("MinGW Makefiles");
  });

  it("maps C++ standards", () => {
    expect(stdFlag("c++26", "gcc")).toBe("-std=c++2c");
    expect(stdFlag("c++20", "msvc")).toBe("/std:c++20");
  });
  it("fails without sources", () => {
    expect(() => planBuild(["README.md"], cfg)).toThrow(PlanError);
  });
});

describe("parseDiagnostics", () => {
  it("parses GCC errors with Arabic explanations and strips the sandbox prefix", () => {
    const d = parseDiagnostics("/work/src/main.cpp:5:10: error: 'cout' is not a member of 'std'\n/work/src/main.cpp:7:3: warning: unused variable 'x' [-Wunused-variable]");
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ file: "src/main.cpp", line: 5, column: 10, severity: "error" });
    expect(d[0]!.suggestionAr).toContain("#include <iostream>");
    expect(d[1]!.severity).toBe("warning");
  });
  it("parses clang and MSVC formats", () => {
    expect(parseDiagnostics("main.cpp:3:5: error: use of undeclared identifier 'foo'")[0]!.explanationAr).toBeTruthy();
    expect(parseDiagnostics("C:\\p\\main.cpp(12,7): error C2065: 'x': undeclared identifier")[0]).toMatchObject({ line: 12, column: 7, severity: "error" });
  });
  it("parses linker errors", () => {
    const d = parseDiagnostics("/usr/bin/ld: .mcs/obj/main_cpp.o: in function `main':\nmain.cpp:(.text+0x1e): undefined reference to `helper()'\ncollect2: error: ld returned 1 exit status");
    expect(d.some((x) => x.message.includes("undefined reference") && x.explanationAr)).toBe(true);
  });
});
