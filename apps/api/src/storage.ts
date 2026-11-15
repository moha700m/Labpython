import { createReadStream, mkdirSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";

/**
 * Artifact object storage. The local-disk driver stores blobs under
 * <dataDir>/artifacts/<key>. Keys are generated server-side (never from user input).
 * An S3-compatible driver can implement the same interface (see DEPLOYMENT.md).
 */
export interface ArtifactStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Readable;
  size(key: string): number;
  remove(key: string): Promise<void>;
}

export class LocalArtifactStorage implements ArtifactStorage {
  private root: string;
  constructor(dataDir: string) {
    this.root = join(dataDir, "artifacts");
    mkdirSync(this.root, { recursive: true });
  }
  private path(key: string) {
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error("invalid storage key");
    return join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    await writeFile(this.path(key), data, { mode: 0o600 });
  }
  get(key: string) {
    return createReadStream(this.path(key));
  }
  size(key: string) {
    return statSync(this.path(key)).size;
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}
