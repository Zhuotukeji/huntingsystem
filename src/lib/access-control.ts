import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db, now } from "@/lib/db";

export const PERMISSION_DEFINITIONS = [
  { code: "dashboard.view", name: "查看工作台", group: "工作台", description: "查看指标、待办和寻访进度", sortOrder: 10 },
  { code: "campaigns.view", name: "查看寻访战役", group: "寻访战役", description: "查看战役、画像和进度", sortOrder: 20 },
  { code: "campaigns.manage", name: "管理寻访战役", group: "寻访战役", description: "创建战役并调整战役状态", sortOrder: 21 },
  { code: "resumes.view", name: "查看简历库", group: "简历库", description: "查看候选人简历和解析结果", sortOrder: 30 },
  { code: "resumes.manage", name: "管理简历库", group: "简历库", description: "导入简历并触发处理", sortOrder: 31 },
  { code: "graph.view", name: "查看人才图谱", group: "人才图谱", description: "查看公司、人员和技能关系", sortOrder: 40 },
  { code: "search_tasks.view", name: "查看搜索任务", group: "BOSS 搜索任务", description: "查看搜索任务和执行建议", sortOrder: 50 },
  { code: "search_tasks.manage", name: "执行搜索任务", group: "BOSS 搜索任务", description: "领取任务、更新状态并提交反馈", sortOrder: 51 },
  { code: "learning.view", name: "查看 AI 学习", group: "AI 学习中心", description: "查看学习运行、指标和建议", sortOrder: 60 },
  { code: "learning.manage", name: "运行 AI 学习", group: "AI 学习中心", description: "发起增量学习、重建和重试", sortOrder: 61 },
  { code: "organizations.view", name: "查看公司发现", group: "公司发现", description: "查看公司画像和简历证据", sortOrder: 70 },
  { code: "organizations.manage", name: "审核公司", group: "公司发现", description: "批准、观察或排除公司", sortOrder: 71 },
  { code: "people.view", name: "查看人员发现", group: "人员发现", description: "查看候选人画像和证据", sortOrder: 80 },
  { code: "people.manage", name: "审核人员", group: "人员发现", description: "更新候选人审核和触达状态", sortOrder: 81 },
  { code: "settings.view", name: "查看系统设置", group: "系统设置", description: "查看数据源和连接状态", sortOrder: 90 },
  { code: "settings.manage", name: "管理系统设置", group: "系统设置", description: "修改 AI、插件和分发配置", sortOrder: 91 },
  { code: "access.view", name: "查看人员与权限", group: "人员与权限", description: "查看人员账号、角色和权限", sortOrder: 100 },
  { code: "access.manage", name: "管理人员与权限", group: "人员与权限", description: "创建账号、配置角色并重置密码", sortOrder: 101 },
] as const;

export type PermissionCode = (typeof PERMISSION_DEFINITIONS)[number]["code"];

export interface AccessUser {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roleIds: string[];
  roles: { id: string; name: string; code: string }[];
}

export interface AccessRole {
  id: string;
  name: string;
  code: string;
  description: string;
  isSystem: boolean;
  permissionCodes: PermissionCode[];
  userCount: number;
}

type Row = Record<string, string | number | null>;

const SUPER_ADMIN_ROLE_ID = "role-system-admin";
const RECRUITER_ROLE_ID = "role-recruiter";
const VIEWER_ROLE_ID = "role-viewer";
const DEFAULT_ADMIN_EMAIL = "admin@hunting.local";
const DEFAULT_ADMIN_PASSWORD = "ChangeMe123!";
const permissionCodes = new Set<string>(PERMISSION_DEFINITIONS.map((permission) => permission.code));

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, digest] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validatePassword(password: string) {
  if (password.length < 10) throw new Error("密码至少需要 10 位");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error("密码必须同时包含字母和数字");
}

function normalizedEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("请输入有效邮箱");
  return value;
}

function validPermissionCodes(codes: string[]) {
  return [...new Set(codes)].filter((code): code is PermissionCode => permissionCodes.has(code));
}

function replaceUserRoles(userId: string, roleIds: string[]) {
  const validRoleIds = [...new Set(roleIds)].filter((id) => db.prepare("SELECT 1 FROM roles WHERE id = ?").get(id));
  if (!validRoleIds.length) throw new Error("请至少分配一个有效角色");
  db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
  const insert = db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)");
  validRoleIds.forEach((roleId) => insert.run(userId, roleId));
}

function replaceRolePermissions(roleId: string, codes: string[]) {
  const validCodes = validPermissionCodes(codes);
  if (!validCodes.length) throw new Error("请至少分配一项有效权限");
  db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
  const insert = db.prepare("INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)");
  validCodes.forEach((code) => insert.run(roleId, code));
}

function activeSuperAdminCount(excludedUserId?: string) {
  const row = db.prepare(`SELECT COUNT(DISTINCT u.id) AS count
    FROM users u JOIN user_roles ur ON ur.user_id = u.id
    WHERE u.status = 'ACTIVE' AND ur.role_id = ? AND (? IS NULL OR u.id <> ?)`)
    .get(SUPER_ADMIN_ROLE_ID, excludedUserId || null, excludedUserId || null) as Row;
  return Number(row.count);
}

export function initializeAccessControl() {
  const stamp = now();
  const insertPermission = db.prepare(`INSERT INTO permissions (code, name, group_name, description, sort_order)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, group_name = excluded.group_name,
      description = excluded.description, sort_order = excluded.sort_order`);
  PERMISSION_DEFINITIONS.forEach((permission) => insertPermission.run(permission.code, permission.name, permission.group, permission.description, permission.sortOrder));

  const insertRole = db.prepare(`INSERT OR IGNORE INTO roles (id, name, code, description, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertRole.run(SUPER_ADMIN_ROLE_ID, "系统管理员", "SYSTEM_ADMIN", "拥有全部系统权限，不可删除", 1, stamp, stamp);
  insertRole.run(RECRUITER_ROLE_ID, "招聘负责人", "RECRUITER", "负责寻访战役、简历、审核和搜索任务", 1, stamp, stamp);
  insertRole.run(VIEWER_ROLE_ID, "只读成员", "VIEWER", "可查看业务数据，不可执行变更", 1, stamp, stamp);

  const addPermission = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)");
  PERMISSION_DEFINITIONS.forEach((permission) => addPermission.run(SUPER_ADMIN_ROLE_ID, permission.code));
  const recruiterPermissions: PermissionCode[] = [
    "dashboard.view", "campaigns.view", "campaigns.manage", "resumes.view", "resumes.manage", "graph.view",
    "search_tasks.view", "search_tasks.manage", "learning.view", "learning.manage", "organizations.view",
    "organizations.manage", "people.view", "people.manage",
  ];
  const permissionCount = (roleId: string) => Number((db.prepare("SELECT COUNT(*) AS count FROM role_permissions WHERE role_id = ?").get(roleId) as Row).count);
  if (!permissionCount(RECRUITER_ROLE_ID)) recruiterPermissions.forEach((code) => addPermission.run(RECRUITER_ROLE_ID, code));
  if (!permissionCount(VIEWER_ROLE_ID)) {
    PERMISSION_DEFINITIONS.filter((permission) => permission.code.endsWith(".view") && permission.code !== "access.view" && permission.code !== "settings.view")
      .forEach((permission) => addPermission.run(VIEWER_ROLE_ID, permission.code));
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const userCount = Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as Row).count);
    if (!userCount) {
      const email = normalizedEmail(process.env.INITIAL_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);
      const password = process.env.INITIAL_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
      validatePassword(password);
      const userId = randomUUID();
      db.prepare(`INSERT INTO users (id, name, email, password_hash, status, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`)
        .run(userId, process.env.INITIAL_ADMIN_NAME || "系统管理员", email, hashPassword(password), stamp, stamp);
      db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run(userId, SUPER_ADMIN_ROLE_ID);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listAccessRoles(): AccessRole[] {
  const roles = db.prepare(`SELECT r.*, COUNT(DISTINCT ur.user_id) AS user_count
    FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
    GROUP BY r.id ORDER BY r.is_system DESC, r.created_at ASC`).all() as Row[];
  const rolePermissions = db.prepare("SELECT permission_code FROM role_permissions WHERE role_id = ? ORDER BY permission_code");
  return roles.map((role) => ({
    id: String(role.id), name: String(role.name), code: String(role.code), description: String(role.description),
    isSystem: Boolean(role.is_system), userCount: Number(role.user_count),
    permissionCodes: (rolePermissions.all(role.id) as Row[]).map((item) => String(item.permission_code) as PermissionCode),
  }));
}

export function listAccessUsers(): AccessUser[] {
  const users = db.prepare("SELECT * FROM users ORDER BY status ASC, created_at ASC").all() as Row[];
  const roles = db.prepare(`SELECT r.id, r.name, r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? ORDER BY r.is_system DESC, r.name ASC`);
  return users.map((user) => {
    const assigned = roles.all(user.id) as Row[];
    return {
      id: String(user.id), name: String(user.name), email: String(user.email), status: String(user.status) as AccessUser["status"],
      mustChangePassword: Boolean(user.must_change_password), lastLoginAt: user.last_login_at ? String(user.last_login_at) : null,
      createdAt: String(user.created_at), roleIds: assigned.map((role) => String(role.id)),
      roles: assigned.map((role) => ({ id: String(role.id), name: String(role.name), code: String(role.code) })),
    };
  });
}

export function getAccessOverview() {
  return {
    users: listAccessUsers(),
    roles: listAccessRoles(),
    permissions: PERMISSION_DEFINITIONS,
    initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
  };
}

export function createAccessUser(input: { name: string; email: string; password: string; roleIds: string[] }) {
  const name = input.name.trim();
  const email = normalizedEmail(input.email);
  if (!name) throw new Error("请输入姓名");
  validatePassword(input.password);
  if (!input.roleIds.length) throw new Error("请至少分配一个角色");
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new Error("该邮箱已存在");
  const userId = randomUUID();
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO users (id, name, email, password_hash, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`)
      .run(userId, name, email, hashPassword(input.password), stamp, stamp);
    replaceUserRoles(userId, input.roleIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listAccessUsers().find((user) => user.id === userId)!;
}

export function updateAccessUser(userId: string, input: { name: string; email: string; status: "ACTIVE" | "DISABLED"; roleIds: string[] }) {
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!existing) throw new Error("人员账号不存在");
  const name = input.name.trim();
  const email = normalizedEmail(input.email);
  if (!name) throw new Error("请输入姓名");
  if (!input.roleIds.length) throw new Error("请至少分配一个角色");
  const removesSuperAdmin = input.status !== "ACTIVE" || !input.roleIds.includes(SUPER_ADMIN_ROLE_ID);
  if (removesSuperAdmin && db.prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?").get(userId, SUPER_ADMIN_ROLE_ID) && activeSuperAdminCount(userId) === 0) {
    throw new Error("必须保留至少一名启用中的系统管理员");
  }
  const duplicate = db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(email, userId);
  if (duplicate) throw new Error("该邮箱已存在");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET name = ?, email = ?, status = ?, updated_at = ? WHERE id = ?").run(name, email, input.status, now(), userId);
    replaceUserRoles(userId, input.roleIds);
    db.prepare("DELETE FROM web_sessions WHERE user_id = ?").run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listAccessUsers().find((user) => user.id === userId)!;
}

export function resetAccessUserPassword(userId: string, password: string) {
  validatePassword(password);
  const result = db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?`)
    .run(hashPassword(password), now(), userId);
  if (!result.changes) throw new Error("人员账号不存在");
  db.prepare("DELETE FROM web_sessions WHERE user_id = ?").run(userId);
}

export function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ? AND status = 'ACTIVE'").get(userId) as { password_hash: string } | undefined;
  if (!user || !verifyPassword(currentPassword, user.password_hash)) throw new Error("当前密码不正确");
  validatePassword(newPassword);
  if (verifyPassword(newPassword, user.password_hash)) throw new Error("新密码不能与当前密码相同");
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`)
    .run(hashPassword(newPassword), now(), userId);
  db.prepare("DELETE FROM web_sessions WHERE user_id = ?").run(userId);
}

export function createAccessRole(input: { name: string; description?: string; permissionCodes: string[] }) {
  const name = input.name.trim();
  if (!name) throw new Error("请输入角色名称");
  if (!input.permissionCodes.length) throw new Error("请至少分配一项权限");
  const roleId = randomUUID();
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO roles (id, name, code, description, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)`)
      .run(roleId, name, `CUSTOM_${roleId.replaceAll("-", "").slice(0, 12).toUpperCase()}`, input.description?.trim() || "", stamp, stamp);
    replaceRolePermissions(roleId, input.permissionCodes);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listAccessRoles().find((role) => role.id === roleId)!;
}

export function updateAccessRole(roleId: string, input: { name: string; description?: string; permissionCodes: string[] }) {
  const role = db.prepare("SELECT is_system FROM roles WHERE id = ?").get(roleId) as Row | undefined;
  if (!role) throw new Error("角色不存在");
  if (roleId === SUPER_ADMIN_ROLE_ID) throw new Error("系统管理员权限不可修改");
  const name = input.name.trim();
  if (!name) throw new Error("请输入角色名称");
  if (!input.permissionCodes.length) throw new Error("请至少分配一项权限");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, input.description?.trim() || "", now(), roleId);
    replaceRolePermissions(roleId, input.permissionCodes);
    db.prepare("DELETE FROM web_sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_id = ?)").run(roleId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listAccessRoles().find((item) => item.id === roleId)!;
}

export function deleteAccessRole(roleId: string) {
  const role = db.prepare("SELECT is_system FROM roles WHERE id = ?").get(roleId) as Row | undefined;
  if (!role) throw new Error("角色不存在");
  if (role.is_system) throw new Error("系统预置角色不可删除");
  const assigned = Number((db.prepare("SELECT COUNT(*) AS count FROM user_roles WHERE role_id = ?").get(roleId) as Row).count);
  if (assigned) throw new Error("该角色仍有人员使用，请先调整人员角色");
  db.prepare("DELETE FROM roles WHERE id = ?").run(roleId);
}

initializeAccessControl();
