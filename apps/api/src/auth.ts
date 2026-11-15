import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "./db.ts";
import { now } from "./db.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = "mcs_session";
const SESSION_DAYS = 14;

export interface User {
  id: string;
  email: string;
  name: string;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length, SCRYPT);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export class Auth {
  constructor(private db: DB) {}

  async register(email: string, name: string, password: string): Promise<User> {
    const id = randomUUID();
    const normalized = email.trim().toLowerCase();
    const exists = this.db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalized);
    if (exists) throw new AuthError("email_taken", "هذا البريد مسجّل مسبقاً");
    this.db
      .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, normalized, name.trim(), await hashPassword(password), now());
    return { id, email: normalized, name: name.trim() };
  }

  async login(email: string, password: string): Promise<User | null> {
    const row = this.db.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
      | (User & { password_hash: string })
      | undefined;
    if (!row) {
      // Spend comparable time to avoid account enumeration via timing.
      await hashPassword(password);
      return null;
    }
    if (!(await verifyPassword(password, row.password_hash))) return null;
    return { id: row.id, email: row.email, name: row.name };
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, now(), expires);
    return token;
  }

  userForToken(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db
      .prepare("SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
      .get(hashToken(token)) as (User & { expires_at: string }) | undefined;
    if (!row) return null;
    if (row.expires_at < now()) {
      this.destroySession(token);
      return null;
    }
    return { id: row.id, email: row.email, name: row.name };
  }

  destroySession(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
}

export class AuthError extends Error {
  constructor(public code: string, public messageAr: string) {
    super(code);
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): User | null {
  if (!req.user) {
    void reply.code(401).send({ error: "unauthorized", messageAr: "يجب تسجيل الدخول" });
    return null;
  }
  return req.user;
}
