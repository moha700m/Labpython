import { describe, expect, it } from "vitest";
import { detectBinaryFormat, peSubsystem } from "../../packages/shared/src/index.ts";

function fakePe(magic: number, subsystem: number) {
  const b = new Uint8Array(512);
  b[0] = 0x4d; b[1] = 0x5a; // MZ
  b[0x3c] = 0x80;
  b.set([0x50, 0x45, 0, 0], 0x80); // PE\0\0
  b[0x80 + 24] = magic & 0xff; b[0x80 + 25] = magic >> 8;
  b[0x80 + 24 + 68] = subsystem;
  return b;
}

describe("detectBinaryFormat", () => {
  it("identifies PE32+ and its subsystem", () => {
    expect(detectBinaryFormat(fakePe(0x20b, 3))).toBe("pe32+");
    expect(peSubsystem(fakePe(0x20b, 3))).toBe("console");
    expect(peSubsystem(fakePe(0x20b, 2))).toBe("gui");
    expect(detectBinaryFormat(fakePe(0x10b, 3))).toBe("pe32");
  });
  it("never calls an ELF an EXE", () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, ...new Array(56).fill(0)]);
    expect(detectBinaryFormat(elf)).toBe("elf64");
  });
  it("rejects MZ without PE signature", () => {
    const b = new Uint8Array(256);
    b[0] = 0x4d; b[1] = 0x5a;
    expect(detectBinaryFormat(b)).toBe("unknown");
  });
  it("detects ar archives", () => {
    expect(detectBinaryFormat(new TextEncoder().encode("!<arch>\nxxxxxxxx"))).toBe("archive");
  });
});
