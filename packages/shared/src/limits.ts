/** Hard limits enforced by the API and workers. Override via env in deployments. */
export const LIMITS = {
  maxFilesPerProject: 500,
  maxFileBytes: 1024 * 1024, // 1 MiB per source file
  maxProjectBytes: 20 * 1024 * 1024, // 20 MiB total
  maxZipBytes: 25 * 1024 * 1024, // compressed upload
  maxZipEntries: 1000,
  maxZipRatio: 200, // per-entry compression ratio (zip bomb guard)
  maxPathLength: 240,
  maxPathDepth: 16,
  buildTimeoutMs: 120_000,
  buildMemoryBytes: 2 * 1024 * 1024 * 1024,
  buildCpuSeconds: 120,
  buildMaxProcesses: 128,
  buildMaxOutputFileBytes: 256 * 1024 * 1024,
  runTimeoutMs: 5 * 60_000,
  runMemoryBytes: 512 * 1024 * 1024,
  runCpuSeconds: 60,
  runMaxProcesses: 64,
  runMaxOutputBytes: 2 * 1024 * 1024,
  logMaxBytes: 2 * 1024 * 1024,
} as const;

export const ALLOWED_EXTENSIONS = [
  ".cpp", ".cc", ".cxx", ".c++", ".c", ".hpp", ".hh", ".hxx", ".h", ".inl", ".ipp", ".tpp",
  ".cmake", ".txt", ".md", ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg",
  ".rc", ".ico", ".png", ".bmp", ".manifest", ".def", ".mk", ".in", ".gitignore", ".clang-format",
] as const;

export const ALLOWED_BASENAMES = ["Makefile", "makefile", "GNUmakefile", "CMakeLists.txt", "CMakePresets.json", "LICENSE", "README"] as const;

export const BINARY_EXTENSIONS = [".ico", ".png", ".bmp"] as const;

export const SOURCE_EXTENSIONS = [".cpp", ".cc", ".cxx", ".c++", ".c"] as const;
