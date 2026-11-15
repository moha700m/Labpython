import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Shared secret workers present as `Authorization: Bearer <token>`. */
  workerToken: string;
  cookieSecure: boolean;
  /** Static web export to serve (single-origin production mode). */
  webDir: string | null;
  ai: {
    provider: "anthropic" | "none";
    model: string;
    apiKey: string | null;
  };
  allowRegistration: boolean;
  logLevel: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = resolve(overrides.dataDir ?? process.env.MCS_DATA_DIR ?? join(process.cwd(), ".data"));
  mkdirSync(dataDir, { recursive: true });
  let workerToken = overrides.workerToken ?? process.env.MCS_WORKER_TOKEN ?? "";
  if (!workerToken) {
    // Development convenience: generate a token once and store it next to the data
    // so a local worker can read it. Production must set MCS_WORKER_TOKEN.
    const file = join(dataDir, "worker-token");
    if (existsSync(file)) workerToken = readFileSync(file, "utf8").trim();
    else {
      workerToken = randomBytes(32).toString("hex");
      writeFileSync(file, workerToken, { mode: 0o600 });
    }
  }
  const webDir = overrides.webDir !== undefined ? overrides.webDir : process.env.MCS_WEB_DIR ? resolve(process.env.MCS_WEB_DIR) : null;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const provider = (process.env.MCS_AI_PROVIDER as AppConfig["ai"]["provider"] | undefined) ?? (apiKey ? "anthropic" : "none");
  return {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
    cookieSecure: process.env.MCS_COOKIE_SECURE === "1",
    allowRegistration: process.env.MCS_ALLOW_REGISTRATION !== "0",
    logLevel: process.env.LOG_LEVEL ?? "info",
    ...overrides,
    dataDir,
    workerToken,
    webDir,
    ai: overrides.ai ?? { provider, model: process.env.MCS_AI_MODEL ?? "claude-opus-5-5", apiKey },
  };
}
