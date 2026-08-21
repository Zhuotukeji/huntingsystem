import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { db, now } from "@/lib/db";
import { initializeAccessControl, type PermissionCode, verifyPassword } from "@/lib/access-control";

export const SESSION_COOKIE = "hunting_session";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  roles: { id: string; name: string; code: string }[];
  permissions: PermissionCode[];
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  status: string;
  must_change_password: number;
};

initializeAccessControl();

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function userContext(row: UserRow): CurrentUser {
  const roleRows = db.prepare(`SELECT r.id, r.name, r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? ORDER BY r.is_system DESC, r.name ASC`).all(row.id) as { id: string; name: string; code: string }[];
  const roles = roleRows.map((role) => ({
    id: String(role.id),
    name: String(role.name),
    code: String(role.code),
  }));
  const permissions = db.prepare(`SELECT DISTINCT rp.permission_code AS code
    FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = ? ORDER BY rp.permission_code`).all(row.id) as { code: PermissionCode }[];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    mustChangePassword: Boolean(row.must_change_password),
    roles,
    permissions: permissions.map((permission) => permission.code),
  };
}

export function authenticateUser(email: string, password: string) {
  const row = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email.trim()) as UserRow | undefined;
  if (!row || row.status !== "ACTIVE" || !verifyPassword(password, row.password_hash)) return null;
  db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  return userContext(row);
}

export function createWebSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const stamp = now();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  db.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").run(stamp);
  db.prepare(`INSERT INTO web_sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), userId, tokenHash(token), expiresAt, stamp, stamp);
  return token;
}

export function revokeWebSession(token: string) {
  db.prepare("DELETE FROM web_sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function getUserBySessionToken(token: string): CurrentUser | null {
  const row = db.prepare(`SELECT u.* FROM web_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`)
    .get(tokenHash(token), now()) as UserRow | undefined;
  return row ? userContext(row) : null;
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getUserBySessionToken(token) : null;
}

export function hasPermission(user: CurrentUser, permission: PermissionCode) {
  return user.permissions.includes(permission);
}

export async function requirePagePermission(permission: PermissionCode) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account?required=1");
  if (!hasPermission(user, permission)) redirect("/forbidden");
  return user;
}

export async function requireAuthenticatedPage(options: { allowPasswordChange?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect("/account?required=1");
  return user;
}

export async function authorizeApi(permission?: PermissionCode) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const;
  if (user.mustChangePassword) return { response: NextResponse.json({ error: "请先修改初始密码", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 }) } as const;
  if (permission && !hasPermission(user, permission)) return { response: NextResponse.json({ error: "无权限执行此操作" }, { status: 403 }) } as const;
  return { user } as const;
}

export function sessionCookieOptions() {
  const secure = process.env.AUTH_COOKIE_SECURE
    ? process.env.AUTH_COOKIE_SECURE !== "false"
    : process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE,
    path: "/",
  };
}
