"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, KeyRound, LoaderCircle, LockKeyhole, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserRoundPlus, Users, X } from "lucide-react";
import type { AccessRole, AccessUser, PermissionCode } from "@/lib/access-control";

interface PermissionDefinition {
  code: PermissionCode;
  name: string;
  group: string;
  description: string;
  sortOrder: number;
}

interface Overview {
  users: AccessUser[];
  roles: AccessRole[];
  permissions: readonly PermissionDefinition[];
  initialAdminEmail: string;
}

type UserDraft = { name: string; email: string; password: string; status: "ACTIVE" | "DISABLED"; roleIds: string[] };
type RoleDraft = { name: string; description: string; permissionCodes: PermissionCode[] };

const emptyUser: UserDraft = { name: "", email: "", password: "", status: "ACTIVE", roleIds: [] };
const emptyRole: RoleDraft = { name: "", description: "", permissionCodes: [] };

export function AccessManager({ initial, canManage, currentUserId }: { initial: Overview; canManage: boolean; currentUserId: string }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<AccessUser | "new" | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft>(emptyUser);
  const [editingRole, setEditingRole] = useState<AccessRole | "new" | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(emptyRole);
  const [resetUser, setResetUser] = useState<AccessUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    data.permissions.forEach((permission) => groups.set(permission.group, [...(groups.get(permission.group) || []), permission]));
    return [...groups.entries()];
  }, [data.permissions]);

  async function refresh() {
    const response = await fetch("/api/access/overview", { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    const result = await response.json();
    if (response.ok) setData(result.data);
  }

  function notify(text: string) {
    setMessage(text); window.setTimeout(() => setMessage(""), 3200);
  }

  function openUser(user?: AccessUser) {
    setError("");
    setEditingUser(user || "new");
    setUserDraft(user ? { name: user.name, email: user.email, password: "", status: user.status, roleIds: user.roleIds } : { ...emptyUser, roleIds: data.roles[0] ? [data.roles[0].id] : [] });
  }

  function openRole(role?: AccessRole) {
    setError("");
    setEditingRole(role || "new");
    setRoleDraft(role ? { name: role.name, description: role.description, permissionCodes: role.permissionCodes } : emptyRole);
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const creating = editingUser === "new";
    const response = await fetch(creating ? "/api/access/users" : `/api/access/users/${(editingUser as AccessUser).id}`, {
      method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(userDraft),
    });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error || "保存失败");
    setEditingUser(null); await refresh(); notify(creating ? "人员账号已创建" : "人员账号已更新");
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const creating = editingRole === "new";
    const response = await fetch(creating ? "/api/access/roles" : `/api/access/roles/${(editingRole as AccessRole).id}`, {
      method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roleDraft),
    });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error || "保存失败");
    setEditingRole(null); await refresh(); notify(creating ? "角色已创建" : "角色权限已更新");
  }

  async function deleteRole(role: AccessRole) {
    if (!window.confirm(`确认删除角色“${role.name}”？`)) return;
    setLoading(true);
    const response = await fetch(`/api/access/roles/${role.id}`, { method: "DELETE" });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return notify(result.error || "删除失败");
    await refresh(); notify("角色已删除");
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetUser) return;
    setLoading(true); setError("");
    const response = await fetch(`/api/access/users/${resetUser.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: temporaryPassword }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error || "重置失败");
    setResetUser(null); setTemporaryPassword(""); await refresh(); notify("临时密码已设置，该账号需要重新登录");
  }

  function toggleUserRole(roleId: string) {
    setUserDraft((current) => ({ ...current, roleIds: current.roleIds.includes(roleId) ? current.roleIds.filter((id) => id !== roleId) : [...current.roleIds, roleId] }));
  }

  function togglePermission(code: PermissionCode) {
    setRoleDraft((current) => ({ ...current, permissionCodes: current.permissionCodes.includes(code) ? current.permissionCodes.filter((item) => item !== code) : [...current.permissionCodes, code] }));
  }

  return <>
    <div className="access-tabs" role="tablist" aria-label="权限管理视图">
      <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={16} />人员账号 <span>{data.users.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === "roles"} className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")}><ShieldCheck size={16} />角色权限 <span>{data.roles.length}</span></button>
    </div>

    {tab === "users" ? <section className="section access-section">
      <div className="section-head"><div><h3>人员账号</h3><p>每个人员可以拥有多个角色，最终权限取并集</p></div>{canManage ? <button className="button primary" type="button" onClick={() => openUser()}><UserRoundPlus size={16} />新增人员</button> : null}</div>
      <div className="table-scroll"><table className="entity-table access-table"><thead><tr><th>人员</th><th>角色</th><th>登录状态</th><th>最近登录</th>{canManage ? <th>操作</th> : null}</tr></thead><tbody>
        {data.users.map((user) => <tr key={user.id}><td className="cell-title"><strong>{user.name}{user.id === currentUserId ? <span className="self-mark">当前账号</span> : null}</strong><span>{user.email}</span></td><td><div className="role-tags">{user.roles.map((role) => <span key={role.id}>{role.name}</span>)}</div></td><td><span className={`account-status ${user.status === "ACTIVE" ? "active" : "disabled"}`}><i />{user.status === "ACTIVE" ? (user.mustChangePassword ? "待修改密码" : "已启用") : "已停用"}</span></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "从未登录"}</td>{canManage ? <td><div className="row-actions"><button className="icon-button compact" type="button" title="编辑人员" aria-label={`编辑 ${user.name}`} onClick={() => openUser(user)}><Pencil size={15} /></button><button className="icon-button compact" type="button" title="重置密码" aria-label={`重置 ${user.name} 的密码`} onClick={() => { setError(""); setResetUser(user); setTemporaryPassword(""); }}><KeyRound size={15} /></button></div></td> : null}</tr>)}
      </tbody></table></div>
    </section> : <section className="section access-section">
      <div className="section-head"><div><h3>角色权限</h3><p>按业务模块组合查看和管理权限</p></div>{canManage ? <button className="button primary" type="button" onClick={() => openRole()}><Plus size={16} />新增角色</button> : null}</div>
      <div className="role-grid">{data.roles.map((role) => <article className="role-card" key={role.id}>
        <div className="role-card-head"><div className="role-symbol"><ShieldCheck size={18} /></div><div><h4>{role.name}</h4><span>{role.isSystem ? "系统预置" : "自定义角色"} · {role.userCount} 人</span></div></div>
        <p>{role.description || "暂无角色说明"}</p>
        <div className="role-permission-summary"><strong>{role.permissionCodes.length}</strong><span>项权限</span><div>{permissionGroups.filter(([, items]) => items.some((item) => role.permissionCodes.includes(item.code))).map(([group]) => <span key={group}>{group}</span>)}</div></div>
        {canManage ? <div className="role-card-actions"><button className="button small" type="button" disabled={role.code === "SYSTEM_ADMIN"} onClick={() => openRole(role)}><Pencil size={14} />配置权限</button>{!role.isSystem ? <button className="icon-button compact danger-icon" type="button" title="删除角色" aria-label={`删除 ${role.name}`} onClick={() => deleteRole(role)}><Trash2 size={15} /></button> : null}</div> : null}
      </article>)}</div>
    </section>}

    {editingUser ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingUser(null); }}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title" onSubmit={saveUser}>
      <div className="modal-head"><div><h2 id="user-modal-title">{editingUser === "new" ? "新增人员账号" : "编辑人员账号"}</h2><p>配置登录信息和所属角色</p></div><button className="icon-button compact" type="button" title="关闭" aria-label="关闭" onClick={() => setEditingUser(null)}><X size={17} /></button></div>
      <div className="modal-body">{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="form-grid"><div className="field"><label>姓名</label><input value={userDraft.name} onChange={(event) => setUserDraft({ ...userDraft, name: event.target.value })} required /></div><div className="field"><label>邮箱</label><input type="email" value={userDraft.email} onChange={(event) => setUserDraft({ ...userDraft, email: event.target.value })} required /></div>{editingUser === "new" ? <div className="field full"><label>初始密码</label><input type="password" minLength={10} value={userDraft.password} onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })} required /><small>至少 10 位，同时包含字母和数字；首次登录后需要修改</small></div> : <div className="field full"><label>账号状态</label><select value={userDraft.status} onChange={(event) => setUserDraft({ ...userDraft, status: event.target.value as UserDraft["status"] })}><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></div>}</div>
        <div className="assignment-block"><div><strong>分配角色</strong><span>可多选</span></div><div className="choice-list">{data.roles.map((role) => <label key={role.id} className={userDraft.roleIds.includes(role.id) ? "checked" : ""}><input type="checkbox" checked={userDraft.roleIds.includes(role.id)} onChange={() => toggleUserRole(role.id)} /><span><strong>{role.name}</strong><small>{role.description}</small></span>{userDraft.roleIds.includes(role.id) ? <Check size={15} /> : null}</label>)}</div></div>
      </div><div className="modal-foot"><button className="button" type="button" onClick={() => setEditingUser(null)}>取消</button><button className="button primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存</button></div>
    </form></div> : null}

    {editingRole ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingRole(null); }}><form className="modal role-modal" role="dialog" aria-modal="true" aria-labelledby="role-modal-title" onSubmit={saveRole}>
      <div className="modal-head"><div><h2 id="role-modal-title">{editingRole === "new" ? "新增角色" : `配置 ${editingRole.name}`}</h2><p>勾选该角色可以使用的功能</p></div><button className="icon-button compact" type="button" title="关闭" aria-label="关闭" onClick={() => setEditingRole(null)}><X size={17} /></button></div>
      <div className="modal-body">{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="form-grid"><div className="field"><label>角色名称</label><input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} required /></div><div className="field"><label>角色说明</label><input value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} /></div></div>
        <div className="permission-matrix">{permissionGroups.map(([group, permissions]) => <fieldset key={group}><legend>{group}</legend>{permissions.map((permission) => <label key={permission.code} className={roleDraft.permissionCodes.includes(permission.code) ? "checked" : ""}><input type="checkbox" checked={roleDraft.permissionCodes.includes(permission.code)} onChange={() => togglePermission(permission.code)} /><span><strong>{permission.name}</strong><small>{permission.description}</small></span>{roleDraft.permissionCodes.includes(permission.code) ? <Check size={15} /> : null}</label>)}</fieldset>)}</div>
      </div><div className="modal-foot"><button className="button" type="button" onClick={() => setEditingRole(null)}>取消</button><button className="button primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}保存角色</button></div>
    </form></div> : null}

    {resetUser ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetUser(null); }}><form className="modal password-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onSubmit={resetPassword}>
      <div className="modal-head"><div><h2 id="reset-title">重置 {resetUser.name} 的密码</h2><p>{resetUser.email}</p></div><button className="icon-button compact" type="button" title="关闭" aria-label="关闭" onClick={() => setResetUser(null)}><X size={17} /></button></div>
      <div className="modal-body">{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="reset-password-icon"><LockKeyhole size={22} /></div><div className="field"><label>临时密码</label><input type="password" minLength={10} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} autoFocus required /><small>保存后旧会话立即失效，人员下次登录时必须修改密码</small></div></div>
      <div className="modal-foot"><button className="button" type="button" onClick={() => setResetUser(null)}>取消</button><button className="button primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}重置密码</button></div>
    </form></div> : null}

    {message ? <div className="toast"><Check size={17} />{message}</div> : null}
  </>;
}
