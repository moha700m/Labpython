import { describe, expect, it } from "vitest";
import { inferConfig } from "../../apps/api/src/projects.ts";

const f = (path: string, content: string) => ({ path, content, encoding: "utf8" as const });

describe("inferConfig", () => {
  it("console programs keep the console subsystem", () => {
    expect(inferConfig([f("main.cpp", "int main(){}")])).toEqual({});
  });
  it("WinMain means a Win32 GUI program", () => {
    expect(inferConfig([f("app.cpp", "int WINAPI WinMain(HINSTANCE a, HINSTANCE b, LPSTR c, int d){}")])).toEqual({ windowsSubsystem: "windows" });
  });
  it("wWinMain adds -municode", () => {
    expect(inferConfig([f("app.cpp", "int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int){}")])).toEqual({ windowsSubsystem: "windows", linkFlags: ["-municode"] });
  });
  it("ignores headers and text files", () => {
    expect(inferConfig([f("notes.txt", "WinMain("), f("main.cpp", "int main(){}")])).toEqual({});
  });
});
