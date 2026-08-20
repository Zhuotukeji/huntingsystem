const DEFAULT_BACKENDS = ["http://localhost:3010", "http://localhost:3000"];
const OPEN_STATUSES = "NEW,CLAIMED,IN_PROGRESS,DEFERRED";
const state = { backend: DEFAULT_BACKENDS[0], token: "", email: "", health: null, tasks: [], campaigns: [], activeTask: null, candidates: [], feedbackTaskId: "", importMode: "file" };
const byId = (id) => document.getElementById(id);

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function normalizeBackend(value) { return String(value || "").trim().replace(/\/$/, ""); }
function showToast(value, type = "success") { const toast = byId("toast"); toast.textContent = value; toast.className = type === "error" ? "error" : ""; toast.style.display = "block"; window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { toast.style.display = "none"; }, 4200); }
function setButtonLoading(button, loading, label) { if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent; button.disabled = loading; button.textContent = loading ? label : button.dataset.defaultLabel; }
function setConnection(status, label) { const badge = byId("connection-badge"); badge.className = `connection ${status}`; badge.querySelector("span").textContent = label; }

async function fetchWithTimeout(url, options = {}, timeout = 2500) {
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { window.clearTimeout(timer); }
}

async function probeBackend(candidate) {
  const backend = normalizeBackend(candidate); if (!backend) return null;
  try { const response = await fetchWithTimeout(`${backend}/api/plugin/health`, { cache: "no-store" }); const result = await response.json(); return response.ok && result.data?.ready ? { backend, health: result.data } : null; } catch { return null; }
}

async function discoverBackend(preferred) {
  setConnection("checking", "检测中"); byId("probe-title").textContent = "正在寻找本地服务"; byId("probe-detail").textContent = "优先检测 3010，再检测 3000";
  for (const candidate of [...new Set([normalizeBackend(preferred), ...DEFAULT_BACKENDS].filter(Boolean))]) {
    const result = await probeBackend(candidate); if (!result) continue;
    state.backend = result.backend; state.health = result.health; byId("backend").value = state.backend; byId("manual-backend").value = state.backend;
    byId("probe-title").textContent = "后台已连接"; byId("probe-detail").textContent = `${state.backend} · 接口 v${result.health.version}`; setConnection("online", "已连接");
    await chrome.storage.local.set({ backend: state.backend }); renderHealth(); return true;
  }
  state.health = null; byId("probe-title").textContent = "未找到本地服务"; byId("probe-detail").textContent = "请启动后台，或检查下方地址后重新检测"; setConnection("offline", "离线"); renderHealth(); return false;
}

async function api(path, options = {}) {
  const headers = { Authorization: `Bearer ${state.token}`, ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  let response; try { response = await fetch(`${state.backend}${path}`, { ...options, headers }); } catch { throw new Error("后台无法连接，请在设置中重新检测"); }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) { await signOut(false); throw new Error(result.error || "插件登录已失效，请重新登录"); }
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`); return result.data;
}

function showWorkspace(signedIn) { byId("onboarding-view").hidden = signedIn; byId("workspace-view").hidden = !signedIn; }

async function login() {
  const button = byId("login"); setButtonLoading(button, true, "正在登录…");
  try {
    if (!await discoverBackend(byId("backend").value)) throw new Error("后台未连接");
    const email = byId("email").value.trim(); const accessCode = byId("access-code").value; if (!email || !accessCode) throw new Error("请填写工作邮箱和插件访问码");
    const response = await fetch(`${state.backend}/api/plugin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, accessCode }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "登录失败");
    state.token = result.data.token; state.email = email; byId("access-code").value = ""; await chrome.storage.local.set({ backend: state.backend, token: state.token, email }); showWorkspace(true); await loadWorkspace();
  } catch (error) { showToast(error.message, "error"); } finally { setButtonLoading(button, false); }
}

async function signOut(notify = true) { state.token = ""; state.tasks = []; await chrome.storage.local.remove("token"); showWorkspace(false); if (notify) showToast("已退出内部登录"); }
async function loadWorkspace() { await Promise.all([loadTasks(), loadCampaigns()]); renderHealth(); }

async function loadCampaigns() {
  try { state.campaigns = await api("/api/plugin/campaigns"); byId("campaign").innerHTML = state.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)} · ${escapeHtml(campaign.roleName)}</option>`).join(""); } catch (error) { showToast(error.message, "error"); }
}

const statusLabels = { NEW: "新任务", CLAIMED: "已领取", IN_PROGRESS: "执行中", DEFERRED: "已延期" };
function searchPhrase(task) { return [task.companyName, ...(task.query?.keywords || []).slice(0, 2), ...(task.query?.locations || []).slice(0, 1)].filter(Boolean).join(" "); }
function renderTasks() {
  byId("task-count").textContent = `共 ${state.tasks.length} 个开放任务`;
  if (!state.tasks.length) { byId("tasks").innerHTML = '<div class="empty-state"><strong>暂无开放任务</strong><p>导入授权简历并等待增量学习生成下一轮搜索任务。</p></div>'; return; }
  byId("tasks").innerHTML = state.tasks.map((task) => {
    const tags = [...(task.query?.keywords || []), ...(task.query?.locations || [])].slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
    const initial = task.status === "NEW" || task.status === "DEFERRED";
    const actions = initial ? `<button class="button primary wide" data-action="claim" data-id="${task.id}">领取任务</button>` : `<button class="button" data-action="copy" data-id="${task.id}">复制搜索词</button><button class="button" data-action="open" data-id="${task.id}">打开 BOSS</button><button class="button wide" data-action="analyze" data-id="${task.id}">分析当前可见结果</button><button class="button" data-action="feedback" data-id="${task.id}">提交反馈</button><button class="button" data-action="defer" data-id="${task.id}">稍后处理</button>`;
    return `<article class="task"><div class="task-top"><div class="priority-box">${task.priority}</div><div class="task-main"><div class="task-title"><h3>${escapeHtml(task.title)}</h3><span class="status ${task.status.toLowerCase().replaceAll("_", "-")}">${statusLabels[task.status] || escapeHtml(task.status)}</span></div><p class="reason">${escapeHtml(task.reason?.summary || "")}</p></div></div><div class="task-query">${escapeHtml(searchPhrase(task))}</div><div class="tags">${tags}</div><div class="actions">${actions}</div></article>`;
  }).join("");
}

async function loadTasks() { byId("task-count").textContent = "正在载入…"; byId("tasks").innerHTML = '<div class="empty-state"><strong>正在同步任务</strong><p>请稍候</p></div>'; try { state.tasks = await api(`/api/plugin/tasks?status=${OPEN_STATUSES}`); renderTasks(); } catch (error) { byId("task-count").textContent = "载入失败"; showToast(error.message, "error"); } }
function taskById(id) { return state.tasks.find((task) => task.id === id); }
async function transitionTask(task, status) { const updated = await api(`/api/plugin/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); Object.assign(task, updated); renderTasks(); return task; }
async function ensureStarted(task) { if (task.status === "NEW" || task.status === "DEFERRED") await transitionTask(task, "CLAIMED"); if (task.status === "CLAIMED") await transitionTask(task, "IN_PROGRESS"); return task; }
async function claimTask(task) { await transitionTask(task, "CLAIMED"); showToast("任务已领取，可开始搜索"); }
async function copyTask(task) { await ensureStarted(task); await navigator.clipboard.writeText(searchPhrase(task)); showToast("搜索词已复制"); }
async function openBoss(task) { await ensureStarted(task); await chrome.tabs.create({ url: "https://www.zhipin.com/web/geek/job" }); }

async function analyze(task) {
  await ensureStarted(task); const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.url) throw new Error("无法读取当前标签页地址");
  const syntheticUrl = chrome.runtime.getURL("synthetic.html"); const synthetic = tab.url === syntheticUrl; let hostname = ""; try { hostname = new URL(tab.url).hostname; } catch {}
  const isBoss = tab.url.startsWith("https:") && (hostname === "zhipin.com" || hostname.endsWith(".zhipin.com")); if (!isBoss && !synthetic) throw new Error("请切换到当前可见的 BOSS 页面或合成验收页");
  const purpose = synthetic ? "合成页面将发送至 Sub2API 验证识别链路。" : "当前可见 BOSS 页面截图将发送至已配置的 Sub2API，用于本任务候选人匹配判断。";
  if (!window.confirm(`${purpose}\n\n截图不会由后台落盘，是否继续？`)) return;
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  const result = await api("/api/plugin/screen-analyze", { method: "POST", body: JSON.stringify({ campaignId: task.campaignId, imageDataUrl, pageUrl: tab.url, synthetic }) }); state.activeTask = task; state.candidates = result.candidates || []; renderAnalysis(result);
}

function listFacts(items, empty) { const values = Array.isArray(items) && items.length ? items : [empty]; return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`; }
function renderAnalysis(result) {
  byId("analysis-note").textContent = result.note || "仅依据当前可见内容";
  byId("analysis-content").innerHTML = state.candidates.map((candidate, index) => `<article class="candidate"><div class="candidate-head"><strong>${escapeHtml(candidate.alias)} · ${escapeHtml(candidate.currentTitle || "职位待核实")}</strong><span class="candidate-score ${candidate.verdict.toLowerCase().replaceAll("_", "-")}">${candidate.score} · ${escapeHtml(candidate.verdict)}</span></div><p class="candidate-meta">${escapeHtml(candidate.currentCompany || "公司待核实")} · ${escapeHtml(candidate.location || "地区待核实")} · ${escapeHtml(candidate.experience || "经验待核实")}</p><div class="fact-group"><b>可见证据</b>${listFacts(candidate.evidence, "当前截图没有足够证据")}</div><div class="fact-group"><b>未知项</b>${listFacts(candidate.unknowns, "无")}</div><button class="button" data-action="greeting" data-index="${index}">生成招呼语草稿</button><div class="draft" id="draft-${index}" hidden></div></article>`).join("") || '<div class="empty-state"><strong>未识别到候选人卡片</strong><p>可调整 BOSS 页面位置后再次主动分析。</p></div>';
  byId("analysis").hidden = false; byId("analysis").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function generateGreeting(index, button) {
  if (!state.activeTask) return; setButtonLoading(button, true, "正在生成…");
  try { const result = await api("/api/plugin/greeting", { method: "POST", body: JSON.stringify({ campaignId: state.activeTask.campaignId, candidate: state.candidates[index] }) }); const draft = byId(`draft-${index}`); draft.innerHTML = `<p>${escapeHtml(result.draft)}</p><button class="button" data-action="copy-draft" data-index="${index}">复制草稿</button>`; draft.dataset.value = result.draft; draft.hidden = false; button.hidden = true; } finally { setButtonLoading(button, false); }
}

function openFeedback(task) { state.feedbackTaskId = task.id; byId("feedback-task-title").textContent = task.title; byId("result-count").value = "0"; byId("qualified-count").value = "0"; byId("conversation-count").value = "0"; byId("feedback-note").value = ""; byId("feedback-dialog").showModal(); }
async function submitFeedback(event) {
  event.preventDefault(); const resultCount = Number(byId("result-count").value || 0); const qualifiedCount = Number(byId("qualified-count").value || 0); const effectiveConversations = Number(byId("conversation-count").value || 0);
  if (qualifiedCount > resultCount || effectiveConversations > qualifiedCount) return showToast("人数需满足：有效沟通 ≤ 符合画像 ≤ 结果人数", "error");
  const button = byId("submit-feedback"); setButtonLoading(button, true, "正在提交…");
  try { await api(`/api/plugin/tasks/${state.feedbackTaskId}/feedback`, { method: "POST", body: JSON.stringify({ resultCount, qualifiedCount, effectiveConversations, note: byId("feedback-note").value }) }); byId("feedback-dialog").close(); showToast("反馈已记录，学习权重已更新"); await loadTasks(); } catch (error) { showToast(error.message, "error"); } finally { setButtonLoading(button, false); }
}

function setImportMode(mode) { state.importMode = mode; document.querySelectorAll("[data-import-mode]").forEach((button) => button.classList.toggle("active", button.dataset.importMode === mode)); byId("file-input-wrap").hidden = mode !== "file"; byId("text-input-wrap").hidden = mode !== "text"; }
async function uploadResume() {
  const button = byId("upload-resume"); if (!byId("campaign").value) return showToast("暂无可用人才画像", "error"); if (!byId("authorization-confirmed").checked || !byId("legal-basis").value.trim()) return showToast("请填写并确认来源及处理依据", "error"); setButtonLoading(button, true, "正在导入…");
  try {
    let options;
    if (state.importMode === "file") { const file = byId("resume-file").files[0]; if (!file) throw new Error("请选择 PDF、DOCX 或 TXT 简历"); if (file.size > 10 * 1024 * 1024) throw new Error("简历文件不能超过 10MB"); const form = new FormData(); form.set("file", file); form.set("campaignId", byId("campaign").value); form.set("sourceType", byId("source-type").value); form.set("legalBasis", byId("legal-basis").value.trim()); form.set("authorizationConfirmed", "true"); options = { method: "POST", body: form }; }
    else { const rawText = byId("resume-text").value.trim(); if (rawText.length < 20) throw new Error("粘贴的简历正文至少需要 20 个字符"); options = { method: "POST", body: JSON.stringify({ campaignId: byId("campaign").value, sourceType: byId("source-type").value, legalBasis: byId("legal-basis").value.trim(), authorizationConfirmed: true, rawText, fileName: "插件粘贴简历.txt" }) }; }
    const result = await api("/api/plugin/resumes", options); const detail = result.duplicate ? "该画像下已存在相同简历，未重复入队。" : `已创建增量学习任务 ${result.aiRun.id.slice(0, 8)}。`; byId("import-result").textContent = `${result.resume.fileName} 导入完成。${detail}`; byId("import-result").hidden = false; if (!result.duplicate) { byId("resume-file").value = ""; byId("resume-text").value = ""; }
  } catch (error) { showToast(error.message, "error"); } finally { setButtonLoading(button, false); }
}

function renderHealth() { byId("extension-version").textContent = `版本 v${chrome.runtime.getManifest().version}`; byId("settings-backend-status").textContent = state.health ? `${state.backend} · 正常` : "未连接"; byId("settings-ai-status").textContent = state.health?.ai.enabled && state.health?.ai.hasApiKey ? `${state.health.ai.model} · 已启用` : "未配置或未启用"; byId("settings-screen-status").textContent = state.health?.ai.screenAnalysisEnabled ? "已启用" : "未启用"; }
function switchView(view) { document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view)); document.querySelectorAll(".view").forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; }); }
async function saveBackend() { if (!await discoverBackend(byId("manual-backend").value)) return showToast("该地址没有可用的觅才后台", "error"); byId("backend").value = state.backend; showToast("后台地址已保存"); }
async function restore() { const saved = await chrome.storage.local.get(["backend", "token", "email"]); state.token = saved.token || ""; state.email = saved.email || ""; byId("email").value = state.email; const connected = await discoverBackend(saved.backend || DEFAULT_BACKENDS[0]); if (!state.token || !connected) return showWorkspace(false); showWorkspace(true); await loadWorkspace(); }

byId("probe").addEventListener("click", () => discoverBackend(byId("backend").value)); byId("login").addEventListener("click", login); byId("logout").addEventListener("click", () => signOut()); byId("refresh").addEventListener("click", loadTasks); byId("close-analysis").addEventListener("click", () => { byId("analysis").hidden = true; }); byId("save-backend").addEventListener("click", saveBackend); byId("open-synthetic").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("synthetic.html") })); byId("upload-resume").addEventListener("click", uploadResume); byId("feedback-form").addEventListener("submit", submitFeedback);
document.querySelectorAll("[data-close-feedback]").forEach((button) => button.addEventListener("click", () => byId("feedback-dialog").close()));
document.querySelector(".tabs").addEventListener("click", (event) => { const tab = event.target.closest("[data-view]"); if (tab) switchView(tab.dataset.view); }); document.querySelector(".segmented").addEventListener("click", (event) => { const button = event.target.closest("[data-import-mode]"); if (button) setImportMode(button.dataset.importMode); });
byId("tasks").addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const task = taskById(button.dataset.id); if (!task) return; button.disabled = true; try { if (button.dataset.action === "claim") await claimTask(task); if (button.dataset.action === "copy") await copyTask(task); if (button.dataset.action === "open") await openBoss(task); if (button.dataset.action === "analyze") await analyze(task); if (button.dataset.action === "feedback") openFeedback(task); if (button.dataset.action === "defer") { await transitionTask(task, "DEFERRED"); showToast("任务已延期"); } } catch (error) { showToast(error.message, "error"); } finally { button.disabled = false; } });
byId("analysis-content").addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; try { if (button.dataset.action === "greeting") await generateGreeting(Number(button.dataset.index), button); if (button.dataset.action === "copy-draft") { await navigator.clipboard.writeText(byId(`draft-${button.dataset.index}`).dataset.value); showToast("草稿已复制，请人工审核后发送"); } } catch (error) { showToast(error.message, "error"); } });

restore();
