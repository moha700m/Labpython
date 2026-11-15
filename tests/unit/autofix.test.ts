import { describe, expect, it } from "vitest";
import { autoFix, parseDiagnostics } from "../../packages/compiler/src/index.ts";

const file = (content: string, path = "main.cpp") => ({ path, content, encoding: "utf8" as const });

describe("autoFix", () => {
  it("adds a missing header for std:: names", () => {
    const r = autoFix([file('int main() {\n    std::cout << "hi";\n}\n')], parseDiagnostics("main.cpp:2:10: error: 'cout' is not a member of 'std'"));
    expect(r.files[0]!.content.startsWith("#include <iostream>\n")).toBe(true);
    expect(r.fixes).toHaveLength(1);
  });

  it("adds header + using namespace std for bare names", () => {
    const r = autoFix([file('#include <cstdio>\nint main() {\n    cout << "hi";\n}\n')], parseDiagnostics("main.cpp:3:5: error: 'cout' was not declared in this scope"));
    const c = r.files[0]!.content;
    expect(c).toContain("#include <cstdio>\n#include <iostream>\nusing namespace std;");
  });

  it("appends a missing semicolon to the previous statement (GCC typographic quotes)", () => {
    const src = "#include <iostream>\nint main() {\n    int x = 1\n\n    return x;\n}\n";
    const r = autoFix([file(src)], parseDiagnostics("main.cpp:5:5: error: expected ‘;’ before ‘return’"));
    expect(r.files[0]!.content).toContain("    int x = 1;\n");
  });

  it("handles GCC 13 pointing at the end of the line that misses ';'", () => {
    const src = "int main() {\n    int x = 1\n    return x;\n}\n";
    const r = autoFix([file(src)], parseDiagnostics("main.cpp:2:14: error: expected ‘;’ before ‘return’"));
    expect(r.files[0]!.content).toBe("int main() {\n    int x = 1;\n    return x;\n}\n");
  });

  it("fixes void main and GUI/console mismatch", () => {
    const r = autoFix([file("void main() {}\n")], parseDiagnostics("main.cpp:1:1: error: '::main' must return 'int'"));
    expect(r.files[0]!.content).toBe("int main() {}\n");
    const r2 = autoFix([file("int main(){}")], parseDiagnostics("/usr/src/crt/crtexewin.c:70:(.text.startup+0xc3): undefined reference to `WinMain'"));
    expect(r2.config).toEqual({ windowsSubsystem: "console" });
  });

  it("fixed code actually compiles (round trip)", () => {
    const r = autoFix([file('int main() {\n    std::vector<int> v{1};\n    std::cout << v.size()\n    return 0;\n}\n')], [
      ...parseDiagnostics("main.cpp:2:10: error: 'vector' is not a member of 'std'"),
      ...parseDiagnostics("main.cpp:3:10: error: 'cout' is not a member of 'std'"),
      ...parseDiagnostics("main.cpp:4:5: error: expected ';' before 'return'"),
    ]);
    const c = r.files[0]!.content;
    expect(c).toContain("#include <vector>");
    expect(c).toContain("#include <iostream>");
    expect(c).toContain("std::cout << v.size();");
  });

  it("does nothing for unknown errors", () => {
    expect(autoFix([file("x")], parseDiagnostics("main.cpp:1:1: error: something exotic")).files).toEqual([]);
  });
});
