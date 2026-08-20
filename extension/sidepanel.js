const DEFAULT_BACKENDS = ["http://localhost:3010", "http://localhost:3000"];
const OPEN_STATUSES = "NEW,CLAIMED,IN_PROGRESS,DEFERRED";
const LEGACY_CAPTURE_SESSION_KEY = "resumeCaptureDraftV1";
const SCAN_INTERVAL_MS = 1500;
const SCAN_MAX_DURATION_MS = 60_000;
const MAX_BUFFERED_FRAMES = 30;
const MAX_UPLOAD_FRAMES = 10;
const { fingerprintDifference, selectKeyframes } = globalThis.HuntingScanUtils;
const emptyScanner = () => ({ scanId: "", status: "idle", mode: "", tabId: null, windowId: null, pageUrl: "", synthetic: false, campaignId: "", legalBasis: "", startedAt: 0, frames: [], lastFingerprint: null, currentSample: null, sampleTimer: null, uiTimer: null, stopTimer: null, stream: null, processed: 0, processingTotal: 0, failure: "" });
const state = { backend: DEFAULT_BACKENDS[0], token: "", email: "", health: null, tasks: [], campaigns: [], activeTask: null, candidates: [], feedbackTaskId: "", scanner: emptyScanner() };
const byId = (id) => document.getElementById(id);

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function normalizeBackend(value) { return String(value || "").trim().replace(/\/$/, ""); }
function normalizedPageUrl(value) { const url = new URL(value); url.hash = ""; return url.toString().replace(/\/$/, ""); }
function normalizedCandidateName(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/^(姓名|候选人)/, "").replace(/[\s·•,，。:：()（）_-]/g, ""); }
function showToast(value, type = "success") { const toast = byId("toast"); toast.textContent = value; toast.className = type === "error" ? "error" : ""; toast.style.display = "block"; window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { toast.style.display = "none"; }, 4200); }
function setButtonLoading(button, loading, label) { if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent; button.disabled = loading; button.textContent = loading ? label : button.dataset.defaultLabel; }
function setConnection(status, label) { const badge = byId("connection-badge"); badge.className = `connection ${status}`; badge.querySelector("span").textContent = label; }

async function fetchWithTimeout(url, options = {}, timeout = 2500) {
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { window.clearTimeout(timer); }
}

async function probeBackend(candidate) {
  const backend = normalizeBackend(candidate); if (!backend) return null;
  try { const response = await fetchWithTimeout(`${backend}/api/plugin/health`, { cache: "no-store" }); const result = await response.json(); return response.ok && result.data?.ready && result.data.version === chrome.runtime.getManifest().version ? { backend, health: result.data } : null; } catch { return null; }
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
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
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

async function signOut(notify = true) { stopScanRuntime(); state.token = ""; state.tasks = []; state.scanner = emptyScanner(); await Promise.all([chrome.storage.local.remove("token"), chrome.storage.session.remove(LEGACY_CAPTURE_SESSION_KEY)]); showWorkspace(false); if (notify) showToast("已退出内部登录"); }
async function loadWorkspace() { await Promise.all([loadTasks(), loadCampaigns()]); await chrome.storage.session.remove(LEGACY_CAPTURE_SESSION_KEY); renderScanner(); renderHealth(); }

async function loadCampaigns() {
  try {
    state.campaigns = await api("/api/plugin/campaigns");
    byId("capture-campaign").innerHTML = state.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)} · ${escapeHtml(campaign.roleName)}</option>`).join("");
  } catch (error) { showToast(error.message, "error"); }
}

const statusLabels = { NEW: "新任务", CLAIMED: "已领取", IN_PROGRESS: "执行中", DEFERRED: "已延期" };
function searchPhrase(task) { return [task.companyName, ...(task.query?.keywords || []).slice(0, 2), ...(task.query?.locations || []).slice(0, 1)].filter(Boolean).join(" "); }
function renderTasks() {
  byId("task-count").textContent = `共 ${state.tasks.length} 个开放任务`;
  if (!state.tasks.length) { byId("tasks").innerHTML = '<div class="empty-state"><strong>暂无开放任务</strong><p>采集 BOSS 简历并等待增量学习生成下一轮搜索任务。</p></div>'; return; }
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

function currentScreenshotTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.url) throw new Error("无法读取当前标签页地址");
    const synthetic = tab.url === chrome.runtime.getURL("synthetic.html"); let hostname = ""; try { hostname = new URL(tab.url).hostname; } catch {}
    const boss = tab.url.startsWith("https:") && (hostname === "zhipin.com" || hostname.endsWith(".zhipin.com"));
    if (!boss && !synthetic) throw new Error("请切换到当前可见的 BOSS 页面或合成验收页");
    return { tab, synthetic, boss };
  });
}

async function analyze(task) {
  await ensureStarted(task); const { tab, synthetic } = await currentScreenshotTab();
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

function renderScanner() {
  const scanner = state.scanner;
  const guide = byId("capture-guide");
  const elapsed = scanner.startedAt ? Math.min(Date.now() - scanner.startedAt, SCAN_MAX_DURATION_MS) : 0;
  const states = {
    idle: ["等待开始", "先回到简历顶部", "点击开始后，用 20-40 秒匀速滚动到底部。"],
    starting: ["正在启动", "正在建立临时画面流", "请保持当前 BOSS 简历页面可见。"],
    scanning: ["扫描中", "请匀速向下滚动", "到达简历底部后，点击“完成扫描并识别”。"],
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
  const locked = ["starting", "scanning", "processing", "failed"].includes(scanner.status);
  byId("capture-campaign").disabled = locked;
  byId("capture-legal-basis").disabled = locked;
  byId("capture-authorization").disabled = locked;
  byId("scan-start").hidden = scanner.status !== "idle";
  byId("scan-stop").hidden = scanner.status !== "scanning";
  byId("scan-stop").disabled = scanner.frames.length === 0;
  byId("scan-retry").hidden = scanner.status !== "failed" || scanner.frames.length === 0;
  byId("scan-cancel").hidden = !["starting", "scanning", "failed"].includes(scanner.status);
}

function captureTabStream() {
  return new Promise((resolve, reject) => {
    if (!chrome.tabCapture?.capture) return reject(new Error("当前 Chrome 不支持标签页画面流"));
    chrome.tabCapture.capture({ audio: false, video: true }, (stream) => {
      const message = chrome.runtime.lastError?.message;
      if (message || !stream) reject(new Error(message || "无法启动标签页画面流")); else resolve(stream);
    });
  });
}

async function attachScanStream(stream) {
  const video = byId("scan-video");
  video.srcObject = stream;
  await video.play();
  if (video.videoWidth && video.videoHeight) return;
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("标签页画面流未就绪")), 3500);
    video.addEventListener("loadedmetadata", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
  });
}

function stopScanRuntime() {
  const scanner = state.scanner;
  if (scanner.sampleTimer) window.clearInterval(scanner.sampleTimer);
  if (scanner.uiTimer) window.clearInterval(scanner.uiTimer);
  if (scanner.stopTimer) window.clearTimeout(scanner.stopTimer);
  if (scanner.stream) scanner.stream.getTracks().forEach((track) => track.stop());
  const video = byId("scan-video");
  if (video) video.srcObject = null;
  scanner.sampleTimer = null; scanner.uiTimer = null; scanner.stopTimer = null; scanner.stream = null;
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
  return { imageDataUrl: canvas.toDataURL("image/jpeg", 0.82), fingerprint };
}

function loadFrameImage(imageDataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("无法读取当前页面截图")); image.src = imageDataUrl;
  });
}

async function currentScanFrame(scanner) {
  if (scanner.mode === "tab-stream") {
    const video = byId("scan-video"); return frameFromSource(video, video.videoWidth, video.videoHeight);
  }
  const imageDataUrl = await chrome.tabs.captureVisibleTab(scanner.windowId, { format: "jpeg", quality: 82 });
  const image = await loadFrameImage(imageDataUrl);
  return frameFromSource(image, image.naturalWidth, image.naturalHeight);
}

function compactFrameBuffer(scanner) {
  const frames = scanner.frames;
  if (frames.length < MAX_BUFFERED_FRAMES) return;
  scanner.frames = frames.filter((_, index) => index === 0 || index === frames.length - 1 || index % 2 === 0);
}

async function sampleScanFrame() {
  const scanner = state.scanner;
  if (scanner.status !== "scanning") return;
  if (scanner.currentSample) return scanner.currentSample;
  scanner.currentSample = (async () => {
    const { tab } = await currentScreenshotTab();
    if (tab.id !== scanner.tabId || normalizedPageUrl(tab.url) !== normalizedPageUrl(scanner.pageUrl)) throw new Error("扫描期间切换了标签页或候选人，请取消后重新开始");
    const frame = await currentScanFrame(scanner);
    const difference = fingerprintDifference(scanner.lastFingerprint, frame.fingerprint);
    const exactDuplicate = scanner.frames.some((item) => item.imageDataUrl === frame.imageDataUrl);
    if (!exactDuplicate && (scanner.frames.length === 0 || difference >= 2.2)) {
      compactFrameBuffer(scanner); scanner.frames.push({ ...frame, capturedAt: Date.now() }); scanner.lastFingerprint = frame.fingerprint; renderScanner();
    }
  })();
  try { await scanner.currentSample; } finally { scanner.currentSample = null; }
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
    let stream = null;
    try {
      stream = await captureTabStream();
      if (state.scanner.scanId !== scanId) { stream.getTracks().forEach((track) => track.stop()); return; }
      state.scanner.stream = stream; await attachScanStream(stream);
      if (state.scanner.scanId !== scanId) { stream.getTracks().forEach((track) => track.stop()); return; }
      state.scanner.mode = "tab-stream";
    } catch {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (state.scanner.scanId !== scanId) return;
      state.scanner.stream = null; byId("scan-video").srcObject = null; state.scanner.mode = "viewport-sampling";
    }
    if (state.scanner.scanId !== scanId) return;
    state.scanner.status = "scanning"; state.scanner.startedAt = Date.now(); renderScanner();
    await sampleScanFrame();
    if (state.scanner.scanId !== scanId) return;
    state.scanner.sampleTimer = window.setInterval(() => sampleScanFrame().catch((error) => { if (state.scanner.scanId === scanId) failScan(error); }), SCAN_INTERVAL_MS);
    state.scanner.uiTimer = window.setInterval(renderScanner, 500);
    state.scanner.stopTimer = window.setTimeout(() => finishResumeScan(true), SCAN_MAX_DURATION_MS);
    showToast(state.scanner.mode === "tab-stream" ? "扫描已开始，请匀速滚动简历" : "已使用兼容扫描模式，请保持当前标签页可见");
  } catch (error) {
    if (scanId && state.scanner.scanId !== scanId) return;
    if (state.scanner.status === "idle") showToast(error.message, "error"); else failScan(error);
  } finally { button.disabled = false; }
}

async function processScanFrames() {
  const scanner = state.scanner; const frames = selectKeyframes(scanner.frames, MAX_UPLOAD_FRAMES);
  if (!frames.length) throw new Error("没有采集到有效关键帧，请重新扫描");
  scanner.status = "processing"; scanner.processed = 0; scanner.processingTotal = frames.length; scanner.failure = ""; renderScanner();
  const segments = []; const skipped = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    try {
      const screenshotHash = await dataUrlHash(frame.imageDataUrl);
      const segment = await api("/api/plugin/resume-capture/segment", { method: "POST", body: JSON.stringify({ campaignId: scanner.campaignId, authorizationConfirmed: true, pageUrl: scanner.pageUrl, synthetic: scanner.synthetic, sequence: segments.length + 1, imageDataUrl: frame.imageDataUrl }) });
      if (segment.screenshotHash !== screenshotHash) throw new Error("截图校验失败");
      const knownName = segments.map((item) => item.candidateName).find(Boolean);
      if (knownName && segment.candidateName && normalizedCandidateName(knownName) !== normalizedCandidateName(segment.candidateName)) throw new Error(`识别到不同候选人：${segment.candidateName}`);
      segments.push(segment);
    } catch (error) {
      if (!segments.length) throw new Error(`首帧识别失败：${error.message}`);
      skipped.push(`第 ${index + 1} 帧：${error.message}`);
    }
    scanner.processed = index + 1; renderScanner();
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
  const scanId = state.scanner.scanId;
  try { await sampleScanFrame(); } catch { /* Existing keyframes can still be processed. */ }
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

function renderHealth() { byId("extension-version").textContent = `版本 v${chrome.runtime.getManifest().version}`; byId("settings-backend-status").textContent = state.health ? `${state.backend} · 正常` : "未连接"; byId("settings-ai-status").textContent = state.health?.ai.enabled && state.health?.ai.hasApiKey ? `${state.health.ai.model} · 已启用` : "未配置或未启用"; byId("settings-screen-status").textContent = state.health?.ai.screenAnalysisEnabled ? "已启用" : "未启用"; }
function switchView(view) { if (["starting", "scanning", "processing"].includes(state.scanner.status) && view !== "capture") return showToast("请先完成或取消当前简历扫描", "error"); document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view)); document.querySelectorAll(".view").forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; }); }
async function saveBackend() { if (!await discoverBackend(byId("manual-backend").value)) return showToast("该地址没有可用的觅才后台", "error"); byId("backend").value = state.backend; showToast("后台地址已保存"); }
async function restore() { const saved = await chrome.storage.local.get(["backend", "token", "email"]); state.token = saved.token || ""; state.email = saved.email || ""; byId("email").value = state.email; const connected = await discoverBackend(saved.backend || DEFAULT_BACKENDS[0]); if (!state.token || !connected) return showWorkspace(false); showWorkspace(true); await loadWorkspace(); }

byId("probe").addEventListener("click", () => discoverBackend(byId("backend").value)); byId("login").addEventListener("click", login); byId("logout").addEventListener("click", () => signOut()); byId("refresh").addEventListener("click", loadTasks); byId("close-analysis").addEventListener("click", () => { byId("analysis").hidden = true; }); byId("save-backend").addEventListener("click", saveBackend); byId("open-synthetic").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("synthetic.html") })); byId("scan-start").addEventListener("click", startResumeScan); byId("scan-stop").addEventListener("click", () => finishResumeScan(false)); byId("scan-retry").addEventListener("click", retryScanRecognition); byId("scan-cancel").addEventListener("click", cancelResumeScan); byId("feedback-form").addEventListener("submit", submitFeedback);
document.querySelectorAll("[data-close-feedback]").forEach((button) => button.addEventListener("click", () => byId("feedback-dialog").close()));
document.querySelector(".tabs").addEventListener("click", (event) => { const tab = event.target.closest("[data-view]"); if (tab) switchView(tab.dataset.view); });
byId("tasks").addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const task = taskById(button.dataset.id); if (!task) return; button.disabled = true; try { if (button.dataset.action === "claim") await claimTask(task); if (button.dataset.action === "copy") await copyTask(task); if (button.dataset.action === "open") await openBoss(task); if (button.dataset.action === "analyze") await analyze(task); if (button.dataset.action === "feedback") openFeedback(task); if (button.dataset.action === "defer") { await transitionTask(task, "DEFERRED"); showToast("任务已延期"); } } catch (error) { showToast(error.message, "error"); } finally { button.disabled = false; } });
byId("analysis-content").addEventListener("click", async (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; try { if (button.dataset.action === "greeting") await generateGreeting(Number(button.dataset.index), button); if (button.dataset.action === "copy-draft") { await navigator.clipboard.writeText(byId(`draft-${button.dataset.index}`).dataset.value); showToast("草稿已复制，请人工审核后发送"); } } catch (error) { showToast(error.message, "error"); } });
window.addEventListener("unload", stopScanRuntime);

restore();
