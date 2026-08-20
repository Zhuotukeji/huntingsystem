import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "hunting-system-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.db");
process.env.DEMO_MODE = "true";
process.env.SETTINGS_ENCRYPTION_KEY = "test-only-settings-key-with-32-bytes-minimum";

let agents: typeof import("../src/lib/agents");
let repository: typeof import("../src/lib/repository");
let database: typeof import("../src/lib/db");
let resumes: typeof import("../src/lib/resumes");
let learning: typeof import("../src/lib/learning");
let settings: typeof import("../src/lib/settings");
let pluginAuth: typeof import("../src/lib/plugin-auth");

before(async () => {
  agents = await import("../src/lib/agents");
  repository = await import("../src/lib/repository");
  database = await import("../src/lib/db");
  resumes = await import("../src/lib/resumes");
  learning = await import("../src/lib/learning");
  settings = await import("../src/lib/settings");
  pluginAuth = await import("../src/lib/plugin-auth");
});

test("initial workspace has a profile but no invented companies or people", () => {
  assert.equal(repository.listCampaigns().length, 1);
  assert.equal(repository.listOrganizations().length, 0);
  assert.equal(repository.listPeople().length, 0);
  assert.equal(repository.getDashboard().metrics.pendingCompanies, 0);
});

test("CSV parser handles quoted commas and Chinese headers", () => {
  const records = agents.parseCsv('公司,官网,地区,证据\n"测试公司",test.example,广州,"覆盖 Google, Meta"');
  assert.equal(records.length, 1);
  assert.equal(records[0].公司, "测试公司");
  assert.equal(records[0].证据, "覆盖 Google, Meta");
});

test("manual company import is idempotent and evidence-backed", () => {
  const input = { campaignId: "campaign-overseas-gm", provider: "InsightTracker", title: "测试导入", text: "company,website,location,product,market,channel,monetization,evidence\n测试星河,test-galaxy.example,广州,Galaxy,东南亚,TikTok,广告,授权调研摘录" };
  const first = agents.processImport(input);
  const second = agents.processImport(input);
  assert.equal(first.imported, 1);
  assert.equal(second.duplicate, true);
  assert.equal(repository.listOrganizations().some((item) => item.name === "测试星河" && item.evidence.length === 1), true);
});

test("resume learning builds people, companies, graph and search tasks idempotently", async () => {
  const rawText = [
    "姓名：张三",
    "职位：海外业务负责人",
    "所在地：广州",
    "技能：Google、Meta、TikTok、广告变现、P&L",
    "2022-至今 | 广州星河网络有限公司 | 海外业务负责人 | 负责 Google、Meta 海外获客与广告变现，带领 12 人跨职能团队",
    "2019-2022 | 深圳远航科技有限公司 | 海外增长总监 | 负责东南亚市场从 0 到 1",
  ].join("\n");
  const first = await resumes.importResume({ campaignId: "campaign-overseas-gm", fileName: "张三.txt", mimeType: "text/plain", sourceType: "CANDIDATE_SHARED", legalBasis: "候选人授权用于当前招聘", createdBy: "测试", rawText });
  const duplicate = await resumes.importResume({ campaignId: "campaign-overseas-gm", fileName: "重复.txt", mimeType: "text/plain", sourceType: "CANDIDATE_SHARED", legalBasis: "候选人授权用于当前招聘", createdBy: "测试", rawText });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  const run = learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [first.resume.id] });
  const completed = await learning.executeAiRun(run.id);
  assert.equal(completed.status, "SUCCEEDED");
  assert.ok(repository.listPeople().some((person) => person.name === "张三"));
  assert.ok(repository.listOrganizations().some((organization) => organization.name === "广州星河网络有限公司"));
  assert.ok(learning.getGraphData().metrics.evidenceBackedEdges >= 2);
  assert.ok(learning.listSearchTasks().length >= 1);

  const edgeCount = Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(first.resume.id) as { count: number }).count);
  const rebuild = learning.createAiRun({ campaignId: "campaign-overseas-gm", runType: "REBUILD" });
  await learning.executeAiRun(rebuild.id);
  const rebuiltEdgeCount = Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(first.resume.id) as { count: number }).count);
  assert.equal(rebuiltEdgeCount, edgeCount);
});

test("search feedback updates a bounded learning weight", () => {
  const task = learning.listSearchTasks()[0];
  const result = learning.submitSearchTaskFeedback({ taskId: task.id, resultCount: 20, qualifiedCount: 5, effectiveConversations: 2, createdBy: "测试" });
  assert.equal(result.learning.sampleCount, 1);
  assert.ok(result.learning.weight >= 0.65 && result.learning.weight <= 1.35);
});

test("Sub2API key is encrypted and never returned", () => {
  const publicSettings = settings.saveAiSettings({ baseUrl: "https://sub2api.example/v1", model: "gpt-5.6", apiStyle: "chat_completions", apiKey: "sk-secret-value", enabled: true, screenAnalysisEnabled: false });
  const row = database.db.prepare("SELECT setting_value FROM ai_settings WHERE setting_key = 'api_key'").get() as { setting_value: string };
  assert.equal(row.setting_value.includes("sk-secret-value"), false);
  assert.equal(publicSettings.hasApiKey, true);
  assert.equal("apiKey" in publicSettings, false);
});

test("Chrome plugin uses an expiring hashed internal session", () => {
  settings.setPluginAccessCode("test-plugin-access-code");
  assert.throws(() => pluginAuth.createPluginSession("hr@example.com", "wrong-access-code"), /访问码错误/);
  const session = pluginAuth.createPluginSession("hr@example.com", "test-plugin-access-code");
  const actor = pluginAuth.requirePluginSession(new Request("http://localhost/api/plugin/tasks", { headers: { Authorization: `Bearer ${session.token}` } }));
  assert.equal(actor.email, "hr@example.com");
  const stored = database.db.prepare("SELECT token_hash FROM plugin_sessions WHERE email = ?").get("hr@example.com") as { token_hash: string };
  assert.equal(stored.token_hash.includes(session.token), false);
});

after(() => {
  database?.db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});
