import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { db, now } from "@/lib/db";
import { getPluginAccessCode } from "@/lib/settings";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function equal(value: string, expected: string) {
  const left = Buffer.from(hash(value));
  const right = Buffer.from(hash(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createPluginSession(email: string, accessCode: string) {
  const configured = getPluginAccessCode();
  if (!configured) throw new Error("管理员尚未配置插件访问码");
  if (!equal(accessCode, configured)) throw new Error("访问码错误");
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  db.prepare("INSERT INTO plugin_sessions (id, email, token_hash, expires_at, last_seen_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
    .run(randomUUID(), email.trim().toLowerCase() || "hr@local", hash(token), expiresAt, createdAt, createdAt);
  return { token, expiresAt };
}

export function requirePluginSession(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("插件尚未登录");
  const row = db.prepare("SELECT id, email, expires_at, revoked_at FROM plugin_sessions WHERE token_hash = ?").get(hash(token)) as { id: string; email: string; expires_at: string; revoked_at: string | null } | undefined;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) throw new Error("插件登录已失效");
  db.prepare("UPDATE plugin_sessions SET last_seen_at = ? WHERE id = ?").run(now(), row.id);
  return { id: row.id, email: row.email };
}

export const pluginCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};
