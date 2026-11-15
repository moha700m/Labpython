import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { ZipRejectedError, createZip, extractZipSafe } from "../../packages/shared/src/index.ts";

describe("extractZipSafe", () => {
  it("extracts allowed files and strips a single top folder", () => {
    const zip = zipSync({ "proj/main.cpp": strToU8("int main(){}"), "proj/include/a.hpp": strToU8("#pragma once"), "proj/build/x.o": strToU8("x") });
    const r = extractZipSafe(zip);
    expect(r.files.map((f) => f.path)).toEqual(["include/a.hpp", "main.cpp"]);
    expect(r.skipped.some((s) => s.path.includes("build"))).toBe(true);
  });
  it("skips disallowed file types", () => {
    const r = extractZipSafe(zipSync({ "main.cpp": strToU8("x"), "evil.exe": strToU8("MZ"), "x.sh": strToU8("rm") }));
    expect(r.files.map((f) => f.path)).toEqual(["main.cpp"]);
    expect(r.skipped).toHaveLength(2);
  });
  it("rejects non-zip input", () => {
    expect(() => extractZipSafe(strToU8("hello"))).toThrow(ZipRejectedError);
  });
  it("round-trips through createZip", () => {
    const z = createZip([{ path: "a/b.cpp", content: "x", encoding: "utf8" }, { path: "c.cpp", content: "y", encoding: "utf8" }]);
    expect(extractZipSafe(z).files).toHaveLength(2);
  });
});
