import type { ArtifactInfo } from "./types.ts";

/**
 * Detect the real format of a binary from its header bytes. This is the single
 * source of truth for what we call an artifact: a Linux ELF is never labelled EXE.
 */
export function detectBinaryFormat(bytes: Uint8Array): ArtifactInfo["format"] {
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return bytes[4] === 2 ? "elf64" : "elf32";
  }
  if (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === "!<arch>\n") return "archive";
  if (bytes.length >= 0x40 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const peOffset = bytes[0x3c]! | (bytes[0x3d]! << 8) | (bytes[0x3e]! << 16) | (bytes[0x3f]! << 24);
    if (peOffset > 0 && peOffset + 26 <= bytes.length) {
      const sig = bytes[peOffset] === 0x50 && bytes[peOffset + 1] === 0x45 && bytes[peOffset + 2] === 0 && bytes[peOffset + 3] === 0;
      if (sig) {
        const magic = bytes[peOffset + 24]! | (bytes[peOffset + 25]! << 8);
        if (magic === 0x20b) return "pe32+";
        if (magic === 0x10b) return "pe32";
      }
    }
  }
  return "unknown";
}

/** PE subsystem: 2 = Windows GUI, 3 = console. */
export function peSubsystem(bytes: Uint8Array): "gui" | "console" | "other" | null {
  const fmt = detectBinaryFormat(bytes);
  if (fmt !== "pe32+" && fmt !== "pe32") return null;
  const peOffset = bytes[0x3c]! | (bytes[0x3d]! << 8) | (bytes[0x3e]! << 16) | (bytes[0x3f]! << 24);
  const opt = peOffset + 24;
  const sub = bytes[opt + 68]! | (bytes[opt + 69]! << 8);
  return sub === 2 ? "gui" : sub === 3 ? "console" : "other";
}

export function describeFormatAr(format: ArtifactInfo["format"]): string {
  switch (format) {
    case "pe32+": return "ملف Windows تنفيذي أصلي (PE32+ x86-64)";
    case "pe32": return "ملف Windows تنفيذي أصلي (PE32 x86)";
    case "elf64": return "ملف Linux تنفيذي (ELF 64-bit) — ليس EXE";
    case "elf32": return "ملف Linux تنفيذي (ELF 32-bit) — ليس EXE";
    case "archive": return "مكتبة ساكنة (ar archive)";
    default: return "ملف ثنائي غير معروف";
  }
}
