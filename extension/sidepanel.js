const DEFAULT_BACKENDS = ["http://localhost:3000"];
const OPEN_STATUSES = "NEW,CLAIMED,IN_PROGRESS,DEFERRED";
const LEGACY_CAPTURE_SESSION_KEY = "resumeCaptureDraftV1";
const SCAN_MAX_DURATION_MS = 60_000;
const MAX_BUFFERED_FRAMES = 30;
const MAX_UPLOAD_FRAMES = 10;
const { selectKeyframes } = globalThis.HuntingScanUtils;
const reviewFixtures = globalThis.HuntingReviewMode;
const REVIEW_CAPTURE_BASIS = "Chrome Web Store 审核演示，仅处理插件内置合成候选人数据";
const emptyScanner = () => ({ scanId: "", status: "idle", mode: "", tabId: null, windowId: null, pageUrl: "", synthetic: false, campaignId: "", legalBasis: "", startedAt: 0, frames: [], processingFrames: [], setupPreview: null, selectedFrameId: "", previewPinned: false, lastFingerprint: null, currentSample: null, capturePending: false, uiTimer: null, stopTimer: null, stream: null, video: null, processed: 0, processingTotal: 0, failure: "" });
const state = { backend: DEFAULT_BACKENDS[0], token: "", email: "", reviewMode: false, health: null, tasks: [], campaigns: [], activeTask: null, candidates: [], feedbackTaskId: "", scanner: emptyScanner() };
const byId = (id) => document.getElementById(id);

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function normalizeBackend(value) { return String(value || "").trim().replace(/\/$/, ""); }
function normalizedPageUrl(value) { const url = new URL(value); url.hash = ""; return url.toString().replace(/\/$/, ""); }
function normalizedCandidateName(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/^(姓名|候选人)/, "").replace(/[\s·•,，。:：()（）_-]/g, ""); }
function showToast(value, type = "success") { const toast = byId("toast"); toast.textContent = value; toast.className = type === "error" ? "error" : ""; toast.style.display = "block"; window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { toast.style.display = "none"; }, 4200); }
function setButtonLoading(button, loading, label) { if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent; button.disabled = loading; button.textContent = loading ? label : button.dataset.defaultLabel; }
function setConnection(status, label) { const badge = byId("connection-badge"); badge.className = `connection ${status}`; badge.querySelector("span").textContent = label; }
function delay(milliseconds) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

function diagnosticSummary(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object") return "";
  const width = Number.isInteger(diagnostic.frameWidth) ? diagnostic.frameWidth : "?";
  const height = Number.isInteger(diagnostic.frameHeight) ? diagnostic.frameHeight : "?";
  const detail = diagnostic.isResumeDetail ? "详情" : "非详情";
  const name = diagnostic.hasCandidateName ? "有姓名" : "无姓名";
  const headline = diagnostic.hasHeadline ? "有职位" : "无职位";
  const length = Number.isInteger(diagnostic.extractedTextLength) ? diagnostic.extractedTextLength : 0;
  const section = String(diagnostic.visibleSection || "未识别");
  return `截屏 ${diagnostic.captureMode || "unknown"} ${width}×${height}；模型 ${detail}、${name}、${headline}、正文 ${length} 字、区段 ${section}`;
}

async function fetchWithTimeout(url, options = {}, timeout = 2500) {
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { window.clearTimeout(timer); }
}

async function probeBackend(candidate) {
  const backend = normalizeBackend(candidate); if (!backend) return null;
  try { const response = await fetchWithTimeout(`${backend}/api/plugin/health`, { cache: "no-store" }); const result = await response.json(); return response.ok && result.data?.ready && result.data.version === chrome.runtime.getManifest().version ? { backend, health: result.data } : null; } catch { return null; }
}

async function discoverBackend() {
  if (state.reviewMode) return false;
  setConnection("checking", "检测中"); byId("probe-title").textContent = "正在寻找本地服务"; byId("probe-detail").textContent = "正在检测 localhost:3000";
  for (const candidate of DEFAULT_BACKENDS) {
    const result = await probeBackend(candidate); if (!result) continue;
    if (state.reviewMode) return false;
    state.backend = result.backend; state.health = result.health; byId("backend").value = state.backend; byId("manual-backend").value = state.backend;
    byId("probe-title").textContent = "后台已连接"; byId("probe-detail").textContent = `${state.backend} · 接口 v${result.health.version}`; setConnection("online", "已连接");
    await chrome.storage.local.set({ backend: state.backend }); renderHealth(); return true;
  }
  if (state.reviewMode) return false;
  state.health = null; byId("probe-title").textContent = "未找到本地服务"; byId("probe-detail").textContent = "请启动后台，或检查下方地址后重新检测"; setConnection("offline", "离线"); renderHealth(); return false;
}

async function api(path, options = {}) {
  if (state.reviewMode) throw new Error("商店审核模式不会连接后台");
  const headers = { Authorization: `Bearer ${state.token}`, ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  let response; try { response = await fetch(`${state.backend}${path}`, { ...options, headers }); } catch { throw new Error("后台无法连接，请在设置中重新检测"); }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) { await signOut(false); throw new Error(result.error || "插件登录已失效，请重新登录"); }
  if (!response.ok) {
    const diagnostic = diagnosticSummary(result.diagnostic);
    throw new Error(`${result.error || `请求失败 (${response.status})`}${diagnostic ? `（${diagnostic}）` : ""}`);
  }
  return result.data;
}

function configureModeUi() {
  byId("review-banner").hidden = !state.reviewMode;
  byId("backend-settings").hidden = state.reviewMode;
  byId("logout").textContent = state.reviewMode ? "退出商店审核演示" : "退出内部登录";
  byId("open-synthetic").textContent = state.reviewMode ? "打开审核演示页" : "打开合成验收页";
  byId("footer-boundary").textContent = state.reviewMode ? "合成数据 · 仅本地演示 · 不连接后台" : "人工操作 · 可追溯反馈 · 不自动发送";
  byId("capture-subtitle").textContent = state.reviewMode ? "开始后点击“截取当前帧”逐帧采集，完成时生成合成结果" : "开始后点击“截取当前帧”逐帧采集，完成时自动识别入库";
  byId("capture-authorization-label").textContent = state.reviewMode ? "我确认当前仅为合成审核演示；关键帧只在插件内存中处理，不上传或保存。" : "我已确认当前招聘处理依据；扫描关键帧将在完成后发送至 Sub2API，图片不会保存。";
  if (state.reviewMode) {
    byId("capture-legal-basis").value = REVIEW_CAPTURE_BASIS;
    byId("capture-authorization").checked = true;
  } else if (byId("capture-legal-basis").value === REVIEW_CAPTURE_BASIS) {
    byId("capture-legal-basis").value = "";
    byId("capture-authorization").checked = false;
  }
}

function showWorkspace(signedIn) { byId("onboarding-view").hidden = signedIn; byId("workspace-view").hidden = !signedIn; configureModeUi(); }

async function enterReviewMode(persist = true) {
  stopScanRuntime(); state.reviewMode = true; state.token = ""; state.email = "reviewer@synthetic.invalid"; state.health = null; state.scanner = emptyScanner(); state.activeTask = null; state.candidates = [];
  if (persist) await chrome.storage.local.set({ reviewMode: true });
  await chrome.storage.local.remove("token");
  setConnection("review", "审核演示"); showWorkspace(true); switchView("tasks"); await loadWorkspace();
  if (persist) showToast("已进入商店审核模式，所有数据均为合成数据");
}

async function login() {
  const button = byId("login"); setButtonLoading(button, true, "正在登录…");
  try {
    if (!await discoverBackend()) throw new Error("后台未连接");
    const email = byId("email").value.trim(); const accessCode = byId("access-code").value; if (!email || !accessCode) throw new Error("请填写工作邮箱和插件访问码");
    const response = await fetch(`${state.backend}/api/plugin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, accessCode }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "登录失败");
    state.reviewMode = false; state.token = result.data.token; state.email = email; byId("access-code").value = ""; await chrome.storage.local.set({ backend: state.backend, token: state.token, email, reviewMode: false }); showWorkspace(true); await loadWorkspace();
  } catch (error) { showToast(error.message, "error"); } finally { setButtonLoading(button, false); }
}

async function signOut(notify = true) { const wasReviewMode = state.reviewMode; stopScanRuntime(); state.reviewMode = false; state.token = ""; state.tasks = []; state.campaigns = []; state.activeTask = null; state.candidates = []; state.scanner = emptyScanner(); await Promise.all([chrome.storage.local.remove(["token", "reviewMode"]), chrome.storage.session.remove(LEGACY_CAPTURE_SESSION_KEY)]); setConnection(state.health ? "online" : "offline", state.health ? "已连接" : "离线"); showWorkspace(false); if (notify) showToast(wasReviewMode ? "已退出商店审核演示" : "已退出内部登录"); }
async function loadWorkspace() { await Promise.all([loadTasks(), loadCampaigns()]); await chrome.storage.session.remove(LEGACY_CAPTURE_SESSION_KEY); renderScanner(); renderHealth(); }

async function loadCampaigns() {
  try {
    state.campaigns = state.reviewMode ? reviewFixtures.createCampaigns() : await api("/api/plugin/campaigns");
    byId("capture-campaign").innerHTML = state.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)} · ${escapeHtml(campaign.roleName)}</option>`).join("");
    configureModeUi();
  } catch (error) { showToast(error.message, "error"); }
}

const statusLabels = { NEW: "新任务", CLAIMED: "已领取", IN_PROGRESS: "执行中", DEFERRED: "已延期" };
function searchPhrase(task) { return [task.companyName, ...(task.query?.keywords || []).slice(0, 2), ...(task.query?.locations || []).slice(0, 1)].filter(Boolean).join(" "); }
function renderTasks() {
  byId("task-count").textContent = state.reviewMode ? `共 ${state.tasks.length} 个合成任务` : `共 ${state.tasks.length} 个开放任务`;
  if (!state.tasks.length) { byId("tasks").innerHTML = state.reviewMode ? '<div class="empty-state"><strong>审核演示已完成</strong><p>点击右上角刷新可重置合成任务，所有反馈只保留在当前会话。</p></div>' : '<div class="empty-state"><strong>暂无开放任务</strong><p>采集 BOSS 简历并等待增量学习生成下一轮搜索任务。</p></div>'; return; }
  byId("tasks").innerHTML = state.tasks.map((task) => {
    const tags = [...(task.query?.keywords || []), ...(task.query?.locations || [])].slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
    const initial = task.status === "NEW" || task.status === "DEFERRED";
    const openLabel = state.reviewMode ? "打开演示页" : "打开 BOSS";
    const analyzeLabel = state.reviewMode ? "分析当前演示页" : "分析当前可见结果";
    const actions = initial ? `<button class="button primary wide" data-action="claim" data-id="${task.id}">领取任务</button>` : `<button class="button" data-action="copy" data-id="${task.id}">复制搜索词</button><button class="button" data-action="open" data-id="${task.id}">${openLabel}</button><button class="button wide" data-action="analyze" data-id="${task.id}">${analyzeLabel}</button><button class="button" data-action="feedback" data-id="${task.id}">提交反馈</button><button class="button" data-action="defer" data-id="${task.id}">稍后处理</button>`;
    return `<article class="task"><div class="task-top"><div class="priority-box">${task.priority}</div><div class="task-main"><div class="task-title"><h3>${escapeHtml(task.title)}</h3><span class="status ${task.status.toLowerCase().replaceAll("_", "-")}">${statusLabels[task.status] || escapeHtml(task.status)}</span></div><p class="reason">${escapeHtml(task.reason?.summary || "")}</p></div></div><div class="task-query">${escapeHtml(searchPhrase(task))}</div><div class="tags">${tags}</div><div class="actions">${actions}</div></article>`;
  }).join("");
}

async function loadTasks() { byId("task-count").textContent = "正在载入…"; byId("tasks").innerHTML = '<div class="empty-state"><strong>正在同步任务</strong><p>请稍候</p></div>'; try { state.tasks = state.reviewMode ? reviewFixtures.createTasks() : await api(`/api/plugin/tasks?status=${OPEN_STATUSES}`); renderTasks(); } catch (error) { byId("task-count").textContent = "载入失败"; showToast(error.message, "error"); } }
function taskById(id) { return state.tasks.find((task) => task.id === id); }
async function transitionTask(task, status) { const updated = state.reviewMode ? { ...task, status } : await api(`/api/plugin/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); Object.assign(task, updated); renderTasks(); return task; }
async function ensureStarted(task) { if (task.status === "NEW" || task.status === "DEFERRED") await transitionTask(task, "CLAIMED"); if (task.status === "CLAIMED") await transitionTask(task, "IN_PROGRESS"); return task; }
async function claimTask(task) { await transitionTask(task, "CLAIMED"); showToast("任务已领取，可开始搜索"); }
async function copyTask(task) { await ensureStarted(task); await navigator.clipboard.writeText(searchPhrase(task)); showToast("搜索词已复制"); }
async function openBoss(task) { await ensureStarted(task); await chrome.tabs.create({ url: state.reviewMode ? chrome.runtime.getURL("synthetic.html") : "https://www.zhipin.com/web/geek/job" }); }

function currentScreenshotTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.url) throw new Error("无法读取当前标签页地址");
    const synthetic = normalizedPageUrl(tab.url) === normalizedPageUrl(chrome.runtime.getURL("synthetic.html")); let hostname = ""; try { hostname = new URL(tab.url).hostname; } catch {}
    const boss = tab.url.startsWith("https:") && (hostname === "zhipin.com" || hostname.endsWith(".zhipin.com"));
    if (!boss && !synthetic) throw new Error("请切换到当前可见的 BOSS 页面或合成验收页");
    if (state.reviewMode && !synthetic) throw new Error("商店审核模式只允许使用插件内置的合成演示页");
    return { tab, synthetic, boss };
  });
}

async function analyze(task) {
  await ensureStarted(task); const { tab, synthetic } = await currentScreenshotTab();
  const purpose = state.reviewMode ? "将截取当前可见的合成演示页，并在插件内存中生成固定审核结果；截图不会上传或保存。" : synthetic ? "合成页面将发送至 Sub2API 验证识别链路。" : "当前可见 BOSS 页面截图将发送至已配置的 Sub2API，用于本任务候选人匹配判断。";
  if (!window.confirm(`${purpose}\n\n截图不会由后台落盘，是否继续？`)) return;
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  const result = state.reviewMode ? reviewFixtures.analyzeVisibleScreenshot(imageDataUrl) : await api("/api/plugin/screen-analyze", { method: "POST", body: JSON.stringify({ campaignId: task.campaignId, imageDataUrl, pageUrl: tab.url, synthetic }) }); state.activeTask = task; state.candidates = result.candidates || []; renderAnalysis(result);
}

function listFacts(items, empty) { const values = Array.isArray(items) && items.length ? items : [empty]; return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`; }
function renderAnalysis(result) {
  byId("analysis-note").textContent = result.note || "仅依据当前可见内容";
  byId("analysis-content").innerHTML = state.candidates.map((candidate, index) => `<article class="candidate"><div class="candidate-head"><strong>${escapeHtml(candidate.alias)} · ${escapeHtml(candidate.currentTitle || "职位待核实")}</strong><span class="candidate-score ${candidate.verdict.toLowerCase().replaceAll("_", "-")}">${candidate.score} · ${escapeHtml(candidate.verdict)}</span></div><p class="candidate-meta">${escapeHtml(candidate.currentCompany || "公司待核实")} · ${escapeHtml(candidate.location || "地区待核实")} · ${escapeHtml(candidate.experience || "经验待核实")}</p><div class="fact-group"><b>可见证据</b>${listFacts(candidate.evidence, "当前截图没有足够证据")}</div><div class="fact-group"><b>未知项</b>${listFacts(candidate.unknowns, "无")}</div><button class="button" data-action="greeting" data-index="${index}">生成招呼语草稿</button><div class="draft" id="draft-${index}" hidden></div></article>`).join("") || '<div class="empty-state"><strong>未识别到候选人卡片</strong><p>可调整 BOSS 页面位置后再次主动分析。</p></div>';
  byId("analysis").hidden = false; byId("analysis").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function generateGreeting(index, button) {
  if (!state.activeTask) return; setButtonLoading(button, true, "正在生成…");
  try { const result = state.reviewMode ? { draft: reviewFixtures.greetingDraft() } : await api("/api/plugin/greeting", { method: "POST", body: JSON.stringify({ campaignId: state.activeTask.campaignId, candidate: state.candidates[index] }) }); const draft = byId(`draft-${index}`); draft.innerHTML = `<p>${escapeHtml(result.draft)}</p><button class="button" data-action="copy-draft" data-index="${index}">复制草稿</button>`; draft.dataset.value = result.draft; draft.hidden = false; button.hidden = true; } finally { setButtonLoading(button, false); }
}

function openFeedback(task) { state.feedbackTaskId = task.id; byId("feedback-task-title").textContent = task.title; byId("result-count").value = "0"; byId("qualified-count").value = "0"; byId("conversation-count").value = "0"; byId("feedback-note").value = ""; byId("feedback-dialog").showModal(); }
async function submitFeedback(event) {
  event.preventDefault(); const resultCount = Number(byId("result-count").value || 0); const qualifiedCount = Number(byId("qualified-count").value || 0); const effectiveConversations = Number(byId("conversation-count").value || 0);
  if (qualifiedCount > resultCount || effectiveConversations > qualifiedCount) return showToast("人数需满足：有效沟通 ≤ 符合画像 ≤ 结果人数", "error");
  const button = byId("submit-feedback"); setButtonLoading(button, true, "正在提交…");
  try {
    if (state.reviewMode) { state.tasks = state.tasks.filter((task) => task.id !== state.feedbackTaskId); renderTasks(); }
    else await api(`/api/plugin/tasks/${state.feedbackTaskId}/feedback`, { method: "POST", body: JSON.stringify({ resultCount, qualifiedCount, effectiveConversations, note: byId("feedback-note").value }) });
    byId("feedback-dialog").close(); showToast(state.reviewMode ? "合成反馈已记录，本次会话结束后自动清除" : "反馈已记录，学习权重已更新"); if (!state.reviewMode) await loadTasks();
  } catch (error) { showToast(error.message, "error"); } finally { setButtonLoading(button, false); }
}

async function dataUrlHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateCaptureBasis() {
  const campaignId = byId("capture-campaign").value;
  const legalBasis = byId("capture-legal-basis").value.trim();
  if (!campaignId) throw new Error("暂无可用人才画像");
  if (!legalBasis || !byId("capture-authorization").checked) throw new Error("请填写并确认当前招聘处理依据");
  return { campaignId, legalBasis };
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function scannerPreviewFrames(scanner) {
  return scanner.processingFrames.length ? scanner.processingFrames : scanner.frames;
}

function renderScannerPreview(scanner) {
  const figure = byId("scan-preview");
  const image = byId("scan-preview-image");
  const thumbnails = byId("scan-preview-thumbnails");
  const frames = scannerPreviewFrames(scanner);
  const setupPreview = frames.length ? null : scanner.setupPreview;
  let selectedIndex = frames.findIndex((frame) => frame.frameId === scanner.selectedFrameId);
  if (selectedIndex < 0 && frames.length) {
    selectedIndex = frames.length - 1;
    scanner.selectedFrameId = frames[selectedIndex].frameId;
    scanner.previewPinned = false;
  }
  const selectedFrame = frames[selectedIndex] || setupPreview;
  figure.hidden = !selectedFrame;
  if (!selectedFrame) {
    image.removeAttribute("src"); thumbnails.replaceChildren(); thumbnails.dataset.signature = ""; return;
  }
  if (image.src !== selectedFrame.imageDataUrl) image.src = selectedFrame.imageDataUrl;
  byId("scan-preview-label").textContent = setupPreview ? "取景预览 · 尚未计入帧" : `第 ${selectedIndex + 1} / ${frames.length} 帧${selectedIndex === frames.length - 1 ? " · 最新" : ""}`;
  byId("scan-preview-size").textContent = `${selectedFrame.width} × ${selectedFrame.height}`;
  if (setupPreview) {
    thumbnails.replaceChildren(); thumbnails.dataset.signature = ""; return;
  }
  const signature = frames.map((frame) => frame.frameId).join("|");
  if (thumbnails.dataset.signature !== signature) {
    thumbnails.innerHTML = frames.map((frame, index) => `<button class="scan-preview-thumbnail" type="button" data-frame-id="${frame.frameId}" aria-label="查看第 ${index + 1} 帧"><img src="${frame.imageDataUrl}" alt="第 ${index + 1} 帧缩略图"><span>${index + 1}</span></button>`).join("");
    thumbnails.dataset.signature = signature;
    if (!scanner.previewPinned) thumbnails.scrollLeft = thumbnails.scrollWidth;
  }
  thumbnails.querySelectorAll("[data-frame-id]").forEach((button, index) => {
    const selected = index === selectedIndex;
    button.classList.toggle("selected", selected);
    button.classList.toggle("processed", scanner.status === "processing" && index < scanner.processed);
    button.classList.toggle("processing", scanner.status === "processing" && index === scanner.processed);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function selectScannerPreview(frameId) {
  const scanner = state.scanner;
  const frames = scannerPreviewFrames(scanner);
  const selectedIndex = frames.findIndex((frame) => frame.frameId === frameId);
  if (selectedIndex < 0) return;
  scanner.selectedFrameId = frameId;
  scanner.previewPinned = selectedIndex !== frames.length - 1;
  renderScanner();
}

function renderScanner() {
  const scanner = state.scanner;
  const guide = byId("capture-guide");
  const elapsed = scanner.startedAt ? Math.min(Date.now() - scanner.startedAt, SCAN_MAX_DURATION_MS) : 0;
  const states = state.reviewMode ? {
    idle: ["等待开始", "打开审核演示页并回到顶部", "点击开始后，每移动到一个位置点击一次“截取当前帧”。"],
    starting: ["正在准备取景", "正在读取当前可见标签页", "若 Chrome 要求选择，请只选择当前合成演示标签页。"],
    scanning: [scanner.capturePending ? "正在截图" : "等待截取", scanner.capturePending ? "正在截取当前画面" : "滚动到目标位置后点击截取", scanner.capturePending ? "截图完成前请保持当前页面不变。" : "每点击一次“截取当前帧”保存一帧，到达底部后完成识别。"],
    processing: [`本地演示 ${scanner.processed}/${scanner.processingTotal}`, "正在生成合成结构化结果", "不会连接后台、Sub2API 或写入简历库。"],
    failed: ["需要处理", "本次演示未完成", scanner.failure || "可重新识别内存中的关键帧，或取消后重新扫描。"],
  } : {
    idle: ["等待开始", "先回到简历顶部", "点击开始后，每移动到一个位置点击一次“截取当前帧”。"],
    starting: ["正在准备取景", "正在读取当前可见标签页", "若 Chrome 要求选择，请只选择当前 BOSS 候选人详情标签页。"],
    scanning: [scanner.capturePending ? "正在截图" : "等待截取", scanner.capturePending ? "正在截取当前画面" : "滚动到目标位置后点击截取", scanner.capturePending ? "截图完成前请保持当前页面不变。" : "每点击一次“截取当前帧”保存一帧，到达底部后完成识别。"],
    processing: [`正在识别 ${scanner.processed}/${scanner.processingTotal}`, "正在提取履历事实", "请保持侧边栏打开，完成后会自动合并并永久入库。"],
    failed: ["需要处理", "本次识别未完成", scanner.failure || "可重新识别内存中的关键帧，或取消后重新扫描。"],
  };
  const [statusLabel, title, detail] = states[scanner.status] || states.idle;
  byId("scan-status").textContent = statusLabel;
  byId("scan-frame-count").textContent = scanner.status === "processing" ? `${scanner.processingTotal} 帧` : `${scanner.frames.length} 临时帧`;
  byId("scan-timer").textContent = formatElapsed(elapsed);
  guide.className = `capture-guide${scanner.status === "scanning" ? " recording" : scanner.status === "processing" ? " processing" : ""}`;
  guide.querySelector("strong").textContent = title;
  guide.querySelector("span").textContent = detail;
  const progress = scanner.status === "processing" ? (scanner.processingTotal ? scanner.processed / scanner.processingTotal : 0) : elapsed / SCAN_MAX_DURATION_MS;
  byId("scan-track-fill").style.width = `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`;
  const displayedFrames = scanner.status === "processing" ? scanner.processingTotal : Math.min(scanner.frames.length, MAX_UPLOAD_FRAMES);
  byId("scan-frame-strip").innerHTML = Array.from({ length: MAX_UPLOAD_FRAMES }, (_, index) => `<span class="${index < displayedFrames ? (scanner.status === "processing" && index >= scanner.processed ? "processing" : "captured") : ""}"></span>`).join("");
  renderScannerPreview(scanner);
  const locked = ["starting", "scanning", "processing", "failed"].includes(scanner.status);
  byId("capture-campaign").disabled = locked;
  byId("capture-legal-basis").disabled = locked;
  byId("capture-authorization").disabled = locked;
  byId("scan-start").hidden = scanner.status !== "idle";
  byId("scan-controls").hidden = scanner.status !== "scanning";
  byId("scan-capture").disabled = scanner.capturePending;
  byId("scan-capture").textContent = scanner.capturePending ? "正在截图…" : "截取当前帧";
  byId("scan-stop").disabled = scanner.frames.length === 0 || scanner.capturePending;
  byId("scan-retry").hidden = scanner.status !== "failed" || scanner.frames.length === 0;
  byId("scan-cancel").hidden = !["starting", "scanning", "failed"].includes(scanner.status);
}

function stopScanRuntime() {
  const scanner = state.scanner;
  if (scanner.uiTimer) window.clearInterval(scanner.uiTimer);
  if (scanner.stopTimer) window.clearTimeout(scanner.stopTimer);
  if (scanner.stream) scanner.stream.getTracks().forEach((track) => track.stop());
  if (scanner.video) scanner.video.srcObject = null;
  scanner.capturePending = false; scanner.uiTimer = null; scanner.stopTimer = null; scanner.stream = null; scanner.video = null;
}

function frameFromSource(source, sourceWidth, sourceHeight) {
  if (!sourceWidth || !sourceHeight) throw new Error("当前页面画面不可用");
  const scale = Math.min(1, 1920 / sourceWidth, 1600 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false }); context.drawImage(source, 0, 0, width, height);
  const thumbnail = document.createElement("canvas"); thumbnail.width = 64; thumbnail.height = 36;
  const thumbnailContext = thumbnail.getContext("2d", { alpha: false, willReadFrequently: true }); thumbnailContext.drawImage(canvas, 0, 0, 64, 36);
  const pixels = thumbnailContext.getImageData(0, 0, 64, 36).data;
  const fingerprint = new Uint8Array(64 * 36);
  for (let index = 0; index < fingerprint.length; index += 1) {
    const offset = index * 4; fingerprint[index] = Math.round((pixels[offset] * 3 + pixels[offset + 1] * 6 + pixels[offset + 2]) / 10);
  }
  return { imageDataUrl: canvas.toDataURL("image/jpeg", 0.82), fingerprint, width, height };
}

function getTargetTabStreamId(tabId) {
  if (!chrome.tabCapture?.getMediaStreamId) return Promise.reject(new Error("当前 Chrome 不支持定向标签页捕获"));
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) return reject(new Error(runtimeError.message));
      if (!streamId) return reject(new Error("Chrome 未返回标签页媒体流"));
      resolve(streamId);
    });
  });
}

async function waitForVideoFrame(video) {
  const deadline = Date.now() + 5000;
  await video.play();
  while ((!video.videoWidth || !video.videoHeight) && Date.now() < deadline) await delay(50);
  if (!video.videoWidth || !video.videoHeight) throw new Error("目标标签页画面未就绪");
}

async function startTargetTabCapture(scanner) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前 Chrome 不支持标签页媒体流");
  let stream;
  try {
    const streamId = await getTargetTabStreamId(scanner.tabId);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("没有取得目标标签页画面");
    const video = document.createElement("video");
    video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = stream;
    await waitForVideoFrame(video);
    scanner.stream = stream; scanner.video = video; scanner.mode = "target-tab";
    track.addEventListener("ended", () => {
      if (state.scanner.scanId === scanner.scanId && ["starting", "scanning"].includes(state.scanner.status)) failScan(new Error("目标标签页捕获已停止，请重新扫描"));
    }, { once: true });
    return frameFromSource(video, video.videoWidth, video.videoHeight);
  } catch (error) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

async function currentScanFrame(scanner) {
  if (scanner.mode !== "target-tab") throw new Error("目标标签页捕获尚未就绪，请重新扫描");
  const track = scanner.stream?.getVideoTracks()[0];
  if (!track || track.readyState !== "live" || !scanner.video) throw new Error("目标标签页捕获已停止，请重新扫描");
  return frameFromSource(scanner.video, scanner.video.videoWidth, scanner.video.videoHeight);
}

function compactFrameBuffer(scanner) {
  const frames = scanner.frames;
  if (frames.length < MAX_BUFFERED_FRAMES) return;
  scanner.frames = frames.filter((_, index) => index === 0 || index === frames.length - 1 || index % 2 === 0);
}

function storeScanFrame(scanner, frame) {
  compactFrameBuffer(scanner);
  const storedFrame = { ...frame, frameId: crypto.randomUUID(), capturedAt: Date.now() };
  scanner.frames.push(storedFrame); scanner.lastFingerprint = frame.fingerprint; scanner.setupPreview = null;
  if (!scanner.previewPinned) scanner.selectedFrameId = storedFrame.frameId;
  renderScanner();
}

async function captureScanFrame() {
  const scanner = state.scanner;
  if (scanner.status !== "scanning") return;
  if (scanner.currentSample) return scanner.currentSample;
  scanner.capturePending = true; renderScanner();
  scanner.currentSample = (async () => {
    const { tab } = await currentScreenshotTab();
    if (tab.id !== scanner.tabId || normalizedPageUrl(tab.url) !== normalizedPageUrl(scanner.pageUrl)) throw new Error("扫描期间切换了标签页或候选人，请取消后重新开始");
    const frame = await currentScanFrame(scanner);
    if (state.scanner.scanId !== scanner.scanId || scanner.status !== "scanning") return;
    storeScanFrame(scanner, frame);
  })();
  try { await scanner.currentSample; } finally { scanner.currentSample = null; scanner.capturePending = false; if (state.scanner.scanId === scanner.scanId) renderScanner(); }
}

async function captureCurrentFrame() {
  const scanner = state.scanner;
  if (scanner.status !== "scanning" || scanner.capturePending) return;
  const scanId = scanner.scanId;
  try {
    await captureScanFrame();
    if (state.scanner.scanId === scanId && state.scanner.status === "scanning") showToast(`已截取第 ${state.scanner.frames.length} 帧`);
  } catch (error) {
    if (state.scanner.scanId === scanId) failScan(error);
  }
}

function failScan(error) {
  stopScanRuntime(); state.scanner.status = "failed"; state.scanner.failure = error instanceof Error ? error.message : "扫描未完成"; renderScanner(); showToast(state.scanner.failure, "error");
}

async function startResumeScan() {
  if (state.scanner.status !== "idle") return;
  const button = byId("scan-start"); button.disabled = true;
  let scanId = "";
  try {
    const basis = validateCaptureBasis(); const { tab, synthetic, boss } = await currentScreenshotTab();
    if (boss && !window.confirm("插件将在本次扫描中临时捕获当前可见的 BOSS 简历画面。你完成滚动后，最多 10 张关键帧会发送至已配置的 Sub2API，用于提取履历并永久入库；图片不会落盘。是否开始？")) return;
    byId("capture-result").hidden = true;
    scanId = crypto.randomUUID();
    state.scanner = { ...emptyScanner(), scanId, status: "starting", tabId: tab.id, windowId: tab.windowId, pageUrl: tab.url, synthetic, campaignId: basis.campaignId, legalBasis: basis.legalBasis };
    renderScanner();
    let firstFrame;
    try {
      firstFrame = await startTargetTabCapture(state.scanner);
    } catch (error) {
      throw new Error(`无法捕获当前候选人标签页：${error?.message || "Chrome 未授予标签页捕获权限"}。请保持候选人详情页为当前活动标签页，重新打开插件后再试`);
    }
    if (state.scanner.scanId !== scanId) return;
    state.scanner.status = "scanning"; state.scanner.startedAt = Date.now(); state.scanner.setupPreview = firstFrame; renderScanner();
    if (state.scanner.scanId !== scanId) return;
    state.scanner.uiTimer = window.setInterval(renderScanner, 500);
    state.scanner.stopTimer = window.setTimeout(() => finishResumeScan(true), SCAN_MAX_DURATION_MS);
    showToast(state.reviewMode ? "审核演示扫描已开始，滚动页面后点击“截取当前帧”" : "当前 BOSS 标签页扫描已开始，请滚动页面并点击“截取当前帧”");
  } catch (error) {
    if (scanId && state.scanner.scanId !== scanId) return;
    if (state.scanner.status === "idle") showToast(error.message, "error"); else failScan(error);
  } finally { button.disabled = false; }
}

async function processReviewScanFrames(scanner, frames) {
  scanner.status = "processing"; scanner.processed = 0; scanner.processingTotal = frames.length; scanner.processingFrames = frames; scanner.selectedFrameId = frames[0]?.frameId || ""; scanner.previewPinned = true; scanner.failure = ""; renderScanner();
  for (let index = 0; index < frames.length; index += 1) {
    scanner.selectedFrameId = frames[index].frameId; renderScanner();
    await dataUrlHash(frames[index].imageDataUrl);
    await delay(120);
    scanner.processed = index + 1; renderScanner();
  }
  const result = reviewFixtures.scanResult(frames.length);
  byId("capture-result").textContent = `${result.candidateName} 已完成合成识别：${result.employments} 段任职、${result.skills} 项技能、${result.organizations} 家公司，共使用 ${result.frameCount} 个关键帧。结果未入库，截图未上传且已从内存清除。`;
  byId("capture-result").hidden = false;
  state.scanner = emptyScanner(); renderScanner(); configureModeUi(); showToast("商店审核模式的简历扫描演示已完成");
}

async function processScanFrames() {
  const scanner = state.scanner; const frames = selectKeyframes(scanner.frames, MAX_UPLOAD_FRAMES);
  if (!frames.length) throw new Error("没有采集到有效关键帧，请重新扫描");
  if (state.reviewMode) return processReviewScanFrames(scanner, frames);
  scanner.status = "processing"; scanner.processed = 0; scanner.processingTotal = frames.length; scanner.processingFrames = frames; scanner.selectedFrameId = frames[0]?.frameId || ""; scanner.previewPinned = true; scanner.failure = ""; renderScanner();
  const segments = []; const skipped = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    scanner.selectedFrameId = frame.frameId; renderScanner();
    try {
      const screenshotHash = await dataUrlHash(frame.imageDataUrl);
      const expectedCandidateName = segments.map((item) => item.candidateName).find(Boolean) || "";
      const segment = await api("/api/plugin/resume-capture/segment", { method: "POST", body: JSON.stringify({ campaignId: scanner.campaignId, authorizationConfirmed: true, pageUrl: scanner.pageUrl, synthetic: scanner.synthetic, captureMode: scanner.mode, frameWidth: frame.width, frameHeight: frame.height, sequence: segments.length + 1, expectedCandidateName, imageDataUrl: frame.imageDataUrl }) });
      if (segment.screenshotHash !== screenshotHash) throw new Error("截图校验失败");
      const knownName = segments.map((item) => item.candidateName).find(Boolean);
      if (knownName && segment.candidateName && normalizedCandidateName(knownName) !== normalizedCandidateName(segment.candidateName)) throw new Error(`识别到不同候选人：${segment.candidateName}`);
      segments.push(segment);
    } catch (error) {
      skipped.push(`第 ${index + 1} 帧：${error.message}`);
    }
    scanner.processed = index + 1; renderScanner();
  }
  if (!segments.length) {
    const reason = skipped[0]?.replace(/^第 \d+ 帧：/, "") || "未识别到有效履历内容";
    throw new Error(`所有关键帧均未识别为候选人简历详情：${reason}。请核对首帧预览确实是当前 BOSS 候选人详情页，并从简历顶部重新扫描`);
  }
  if (segments.length < Math.max(1, Math.ceil(frames.length / 2))) throw new Error("超过一半关键帧识别失败，请检查页面位置后重新扫描");
  const result = await api("/api/plugin/resume-capture/finalize", { method: "POST", body: JSON.stringify({ campaignId: scanner.campaignId, legalBasis: scanner.legalBasis, authorizationConfirmed: true, segments }) });
  const learning = result.duplicate ? "简历库中已有相同内容，未重复创建。" : `已加入增量学习队列 ${result.aiRun.id.slice(0, 8)}。`;
  const warning = skipped.length ? `有 ${skipped.length} 帧未采用，可在简历库核对结果。` : "";
  byId("capture-result").textContent = `${result.resume.fileName} 已永久入库，共合并 ${result.merged.screenCount} 个关键帧。${learning}${warning}`; byId("capture-result").hidden = false;
  state.scanner = emptyScanner(); renderScanner(); showToast("简历扫描识别已完成");
}

async function finishResumeScan(automatic = false) {
  if (state.scanner.status !== "scanning") return;
  const scanner = state.scanner; const scanId = scanner.scanId; const pendingCapture = scanner.currentSample;
  if (pendingCapture) try { await pendingCapture; } catch { /* Existing keyframes can still be processed. */ }
  if (state.scanner.scanId !== scanId || state.scanner.status !== "scanning") return;
  stopScanRuntime();
  if (!state.scanner.frames.length) return failScan(new Error("没有采集到有效关键帧，请重新扫描"));
  if (automatic) showToast("扫描已达 60 秒，正在自动识别");
  try { await processScanFrames(); } catch (error) { failScan(error); }
}

async function retryScanRecognition() {
  if (state.scanner.status !== "failed" || !state.scanner.frames.length) return;
  try { await processScanFrames(); } catch (error) { failScan(error); }
}

function cancelResumeScan() {
  if (state.scanner.status === "scanning" && !window.confirm("确定取消本次扫描吗？临时关键帧会立即清除。")) return;
  stopScanRuntime(); state.scanner = emptyScanner(); byId("capture-result").hidden = true; renderScanner(); showToast("本次扫描已取消");
}

function renderHealth() {
  byId("extension-version").textContent = `版本 v${chrome.runtime.getManifest().version}`;
  byId("settings-mode-status").textContent = state.reviewMode ? "商店审核演示" : "正式模式";
  byId("settings-backend-status").textContent = state.reviewMode ? "无需后台" : state.health ? `${state.backend} · 正常` : "未连接";
  byId("settings-ai-status").textContent = state.reviewMode ? "本地合成结果" : state.health?.ai.enabled && state.health?.ai.hasApiKey ? `${state.health.ai.model} · 已启用` : "未配置或未启用";
  byId("settings-screen-status").textContent = state.reviewMode ? "仅限内置演示页" : state.health?.ai.screenAnalysisEnabled ? "已启用" : "未启用";
}
function switchView(view) { if (["starting", "scanning", "processing"].includes(state.scanner.status) && view !== "capture") return showToast("请先完成或取消当前简历扫描", "error"); document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view)); document.querySelectorAll(".view").forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; }); }
async function saveBackend() { if (!await discoverBackend()) return showToast("localhost:3000 没有可用的觅才后台", "error"); byId("backend").value = state.backend; showToast("后台连接正常"); }
async function restore() { const saved = await chrome.storage.local.get(["token", "email", "reviewMode"]); if (saved.reviewMode) return enterReviewMode(false); state.token = saved.token || ""; state.email = saved.email || ""; byId("email").value = state.email; const connected = await discoverBackend(); if (state.reviewMode) return; if (!state.token || !connected) return showWorkspace(false); showWorkspace(true); await loadWorkspace(); }

byId("probe").addEventListener("click", discoverBackend); byId("login").addEventListener("click", login); byId("review-login").addEventListener("click", () => enterReviewMode(true)); byId("logout").addEventListener("click", () => signOut()); byId("refresh").addEventListener("click", loadTasks); byId("close-analysis").addEventListener("click", () => { byId("analysis").hidden = true; }); byId("save-backend").addEventListener("click", saveBackend); byId("open-synthetic").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("synthetic.html") })); byId("scan-start").addEventListener("click", startResumeScan); byId("scan-capture").addEventListener("click", captureCurrentFrame); byId("scan-stop").addEventListener("click", () => finishResumeScan(false)); byId("scan-retry").addEventListener("click", retryScanRecognition); byId("scan-cancel").addEventListener("click", cancelResumeScan); byId("feedback-form").addEventListener("submit", submitFeedback);
byId("scan-preview-thumbnails").addEventListener("click", (event) => { const button = event.target.closest("[data-frame-id]"); if (button) selectScannerPreview(button.dataset.frameId); });
document.querySelectorAll("[data-close-feedback]").forEach((button) => button.addEventListener("click", () => byId("feedback-dialog").close()));
document.querySelector(".tabs").addEventListener("click", (event) => { const tab = event.target.closest("[data-view]"); if (tab) switchView(tab.dataset.view); });
byId("tasks").addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const task = taskById(button.dataset.id); if (!task) return; button.disabled = true; try { if (button.dataset.action === "claim") await claimTask(task); if (button.dataset.action === "copy") await copyTask(task); if (button.dataset.action === "open") await openBoss(task); if (button.dataset.action === "analyze") await analyze(task); if (button.dataset.action === "feedback") openFeedback(task); if (button.dataset.action === "defer") { await transitionTask(task, "DEFERRED"); showToast("任务已延期"); } } catch (error) { showToast(error.message, "error"); } finally { button.disabled = false; } });
byId("analysis-content").addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; try { if (button.dataset.action === "greeting") await generateGreeting(Number(button.dataset.index), button); if (button.dataset.action === "copy-draft") { await navigator.clipboard.writeText(byId(`draft-${button.dataset.index}`).dataset.value); showToast("草稿已复制，请人工审核后发送"); } } catch (error) { showToast(error.message, "error"); } });
window.addEventListener("unload", stopScanRuntime);

restore();
