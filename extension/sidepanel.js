const state = { backend: "http://localhost:3000", token: "", tasks: [], activeTask: null, candidates: [] };
const byId = (id) => document.getElementById(id);

function message(value) {
  const element = byId("message");
  element.textContent = value;
  element.style.display = "block";
  window.setTimeout(() => { element.style.display = "none"; }, 3500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(state.backend + path, { ...options, headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.token, ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result.data;
}

async function restore() {
  const saved = await chrome.storage.local.get(["backend", "token"]);
  state.backend = saved.backend || state.backend;
  state.token = saved.token || "";
  byId("backend").value = state.backend;
  showTasks(Boolean(state.token));
  if (state.token) loadTasks();
}

function showTasks(signedIn) {
  byId("login-view").hidden = signedIn;
  byId("tasks-view").hidden = !signedIn;
  byId("logout").style.visibility = signedIn ? "visible" : "hidden";
}

async function login() {
  try {
    state.backend = byId("backend").value.replace(/\/$/, "");
    const response = await fetch(state.backend + "/api/plugin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: byId("email").value, accessCode: byId("access-code").value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "登录失败");
    state.token = result.data.token;
    await chrome.storage.local.set({ backend: state.backend, token: state.token });
    showTasks(true);
    await loadTasks();
  } catch (error) { message(error.message); }
}

async function loadTasks() {
  try {
    state.tasks = await api("/api/plugin/tasks");
    byId("task-count").textContent = "共 " + state.tasks.length + " 个待执行任务";
    byId("tasks").innerHTML = state.tasks.map((task) => {
      const keywords = task.query.keywords.map((item) => '<span class="tag">' + escapeHtml(item) + "</span>").join("");
      const locations = task.query.locations.slice(0, 2).map((item) => '<span class="tag">' + escapeHtml(item) + "</span>").join("");
      return '<article class="task"><div class="task-top"><div class="score">' + task.priority + '</div><div><h3>' + escapeHtml(task.title) + '</h3><p class="reason">' + escapeHtml(task.reason.summary) + '</p></div></div><div class="tags">' + keywords + locations + '</div><div class="actions"><button data-copy="' + task.id + '">复制搜索词</button><button data-open="' + task.id + '">打开 BOSS</button><button class="analyze" data-analyze="' + task.id + '">分析当前可见结果</button></div></article>';
    }).join("") || '<div class="task"><h3>暂无待执行任务</h3><p class="reason">回到后台导入简历并运行 AI 学习。</p></div>';
  } catch (error) {
    if (/失效|登录/.test(error.message)) { state.token = ""; await chrome.storage.local.remove("token"); showTasks(false); }
    message(error.message);
  }
}

function taskById(id) { return state.tasks.find((task) => task.id === id); }

async function copyTask(id) {
  const task = taskById(id);
  await navigator.clipboard.writeText([task.companyName, task.query.keywords[0], task.query.locations[0]].filter(Boolean).join(" "));
  message("搜索词已复制");
}

async function analyze(id) {
  try {
    const task = taskById(id);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/[^/]*zhipin\.com\//i.test(tab.url || "")) throw new Error("请先切换到 BOSS 直聘结果页");
    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
    const result = await api("/api/plugin/screen-analyze", { method: "POST", body: JSON.stringify({ campaignId: task.campaignId, imageDataUrl }) });
    state.activeTask = task;
    state.candidates = result.candidates;
    byId("analysis-content").innerHTML = result.candidates.map((candidate, index) => '<div class="candidate"><strong>' + escapeHtml(candidate.alias) + " · " + escapeHtml(candidate.currentTitle || "职位待核实") + '</strong><small class="' + candidate.verdict.toLowerCase().replaceAll("_", "-") + '">' + candidate.score + " · " + candidate.verdict + "</small><p>" + escapeHtml(candidate.currentCompany) + " · " + escapeHtml(candidate.evidence.join("；")) + '</p><button data-greeting="' + index + '">生成个性化招呼语</button><div class="draft" id="draft-' + index + '" hidden></div></div>').join("") || "<p>当前截图未识别到候选人卡片。</p>";
    byId("analysis").hidden = false;
  } catch (error) { message(error.message); }
}

byId("login").addEventListener("click", login);
byId("refresh").addEventListener("click", loadTasks);
byId("close-analysis").addEventListener("click", () => { byId("analysis").hidden = true; });
byId("logout").addEventListener("click", async () => { state.token = ""; await chrome.storage.local.remove("token"); showTasks(false); });
byId("tasks").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.copy) await copyTask(button.dataset.copy);
  if (button.dataset.open) await chrome.tabs.create({ url: "https://www.zhipin.com/web/geek/job" });
  if (button.dataset.analyze) await analyze(button.dataset.analyze);
});
byId("analysis-content").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-greeting]");
  if (!button || !state.activeTask) return;
  try {
    const index = Number(button.dataset.greeting);
    button.disabled = true;
    const result = await api("/api/plugin/greeting", { method: "POST", body: JSON.stringify({ campaignId: state.activeTask.campaignId, candidate: state.candidates[index] }) });
    const draft = byId("draft-" + index);
    draft.textContent = result.draft;
    draft.hidden = false;
    button.textContent = "复制招呼语";
    button.disabled = false;
    delete button.dataset.greeting;
    button.onclick = async () => { await navigator.clipboard.writeText(result.draft); message("招呼语已复制，请人工审核后发送"); };
  } catch (error) { button.disabled = false; message(error.message); }
});

restore();
