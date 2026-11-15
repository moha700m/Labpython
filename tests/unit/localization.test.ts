import { describe, expect, it } from "vitest";
import { explainDiagnostic, explainRuntimeExit } from "../../packages/localization/src/index.ts";

describe("Arabic explanations", () => {
  it("explains common compiler errors", () => {
    expect(explainDiagnostic("expected ';' before 'return'")?.explanationAr).toContain("فاصلة منقوطة");
    expect(explainDiagnostic("undefined reference to `WinMain'")?.suggestionAr).toContain("Console");
    expect(explainDiagnostic("fatal error: foo.h: No such file or directory")?.explanationAr).toContain("foo.h");
    expect(explainDiagnostic("something totally unknown")).toBeUndefined();
    // GCC uses typographic quotes under a UTF-8 locale.
    expect(explainDiagnostic("unrecognized command-line option ‘-std=c++2c’")?.explanationAr).toContain("C++26");
    expect(explainDiagnostic("‘cout’ was not declared in this scope")?.suggestionAr).toContain("<iostream>");
  });
  it("explains crashes", () => {
    expect(explainRuntimeExit(139, null)).toContain("Segmentation fault");
    expect(explainRuntimeExit(null, "SIGFPE")).toContain("قسمة");
    expect(explainRuntimeExit(0, null)).toBeUndefined();
  });
});
