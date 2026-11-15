import { describe, expect, it } from "vitest";
import { UnsafePathError, isAllowedProjectFile, languageForPath, normalizeProjectPath } from "../../packages/shared/src/index.ts";

describe("normalizeProjectPath", () => {
  it("normalizes ordinary relative paths", () => {
    expect(normalizeProjectPath("src/main.cpp")).toBe("src/main.cpp");
    expect(normalizeProjectPath("./src//util.hpp")).toBe("src/util.hpp");
    expect(normalizeProjectPath("src\\win\\a.cpp")).toBe("src/win/a.cpp");
  });
  it.each([
    ["../etc/passwd"],
    ["src/../../x.cpp"],
    ["/etc/passwd"],
    ["C:\\Windows\\system32\\a.cpp"],
    ["c:/x.cpp"],
    ["//server/share/a.cpp"],
    ["a\0b.cpp"],
    ["CON.cpp"],
    ["src/nul"],
    ["a/b:c.cpp"],
    ["trailing. "],
    [""],
    ["a/".repeat(20) + "x.cpp"],
  ])("rejects %j", (p) => {
    expect(() => normalizeProjectPath(p)).toThrow(UnsafePathError);
  });
});

describe("file types", () => {
  it("accepts C++ sources and build files", () => {
    for (const p of ["a.cpp", "b.hpp", "c.h", "d.c", "CMakeLists.txt", "Makefile", "x.cmake", "notes.txt", "res/app.rc", "res/icon.ico"]) expect(isAllowedProjectFile(p)).toBe(true);
  });
  it("rejects executables and scripts", () => {
    for (const p of ["evil.exe", "run.sh", "lib.dll", "x.so", "payload.ps1", "a.bat"]) expect(isAllowedProjectFile(p)).toBe(false);
  });
  it("maps languages for the editor", () => {
    expect(languageForPath("CMakeLists.txt")).toBe("cmake");
    expect(languageForPath("src/a.hpp")).toBe("cpp");
    expect(languageForPath("Makefile")).toBe("makefile");
  });
});
