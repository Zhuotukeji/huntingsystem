import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "hunting-system-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.db");
process.env.DEMO_MODE = "true";
process.env.SETTINGS_ENCRYPTION_KEY = "test-only-settings-key-with-32-bytes-minimum";
process.env.INITIAL_ADMIN_EMAIL = "admin@test.local";
process.env.INITIAL_ADMIN_PASSWORD = "TestAdmin123!";

let repository: typeof import("../src/lib/repository");
let database: typeof import("../src/lib/db");
let resumes: typeof import("../src/lib/resumes");
let resumeQuality: typeof import("../src/lib/resume-quality");
let learning: typeof import("../src/lib/learning");
let settings: typeof import("../src/lib/settings");
let pluginAuth: typeof import("../src/lib/plugin-auth");
let resumeCapture: typeof import("../src/lib/resume-capture");
let headerData: typeof import("../src/lib/header-data");
let seed: typeof import("../src/lib/seed");
let extensionDelivery: typeof import("../src/lib/extension-delivery");
let accessControl: typeof import("../src/lib/access-control");
let auth: typeof import("../src/lib/auth");
let runtimePaths: typeof import("../src/lib/runtime-paths");
let autonomy: typeof import("../src/lib/autonomy");
let analytics: typeof import("../src/lib/analytics");

function createTextPdf(text: string) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

before(async () => {
  repository = await import("../src/lib/repository");
  database = await import("../src/lib/db");
  resumes = await import("../src/lib/resumes");
  resumeQuality = await import("../src/lib/resume-quality");
  learning = await import("../src/lib/learning");
  settings = await import("../src/lib/settings");
  pluginAuth = await import("../src/lib/plugin-auth");
  resumeCapture = await import("../src/lib/resume-capture");
  headerData = await import("../src/lib/header-data");
  seed = await import("../src/lib/seed");
  extensionDelivery = await import("../src/lib/extension-delivery");
  accessControl = await import("../src/lib/access-control");
  auth = await import("../src/lib/auth");
  runtimePaths = await import("../src/lib/runtime-paths");
  autonomy = await import("../src/lib/autonomy");
  analytics = await import("../src/lib/analytics");
});

test("standalone runtime paths resolve back to the persistent application root", () => {
  const applicationRoot = join(temporaryDirectory, "workspace");
  assert.equal(runtimePaths.resolveApplicationRoot(join(applicationRoot, ".next", "standalone")), applicationRoot);
  assert.equal(runtimePaths.resolveApplicationRoot(applicationRoot), applicationRoot);
});

test("initial administrator has every permission and must change the bootstrap password", () => {
  const overview = accessControl.getAccessOverview();
  const administrator = auth.authenticateUser("admin@test.local", "TestAdmin123!");
  assert.ok(administrator);
  assert.equal(administrator.mustChangePassword, true);
  assert.equal(administrator.permissions.length, accessControl.PERMISSION_DEFINITIONS.length);
  assert.ok(administrator.roles.length > 0);
  assert.equal(Object.getPrototypeOf(administrator.roles[0]), Object.prototype);
  assert.equal(overview.users.length, 1);
  assert.ok(overview.roles.some((role) => role.code === "SYSTEM_ADMIN"));
  assert.equal(auth.authenticateUser("admin@test.local", "wrong-password"), null);
});

test("custom roles grant permissions and permission changes revoke existing sessions", () => {
  const role = accessControl.createAccessRole({
    name: "战役观察员",
    description: "只查看战役",
    permissionCodes: ["campaigns.view"],
  });
  const user = accessControl.createAccessUser({
    name: "测试观察员",
    email: "viewer@test.local",
    password: "ViewerPass123",
    roleIds: [role.id],
  });
  const signedIn = auth.authenticateUser(user.email, "ViewerPass123");
  assert.deepEqual(signedIn?.permissions, ["campaigns.view"]);
  const token = auth.createWebSession(user.id);
  assert.equal(auth.getUserBySessionToken(token)?.id, user.id);

  accessControl.updateAccessRole(role.id, {
    name: role.name,
    description: role.description,
    permissionCodes: ["campaigns.view", "dashboard.view"],
  });
  assert.equal(auth.getUserBySessionToken(token), null);
  assert.deepEqual(auth.authenticateUser(user.email, "ViewerPass123")?.permissions.sort(), ["campaigns.view", "dashboard.view"]);
});

test("password changes and last-administrator protection are enforced", () => {
  const administrator = accessControl.listAccessUsers().find((user) => user.email === "admin@test.local");
  assert.ok(administrator);
  assert.throws(() => accessControl.updateAccessUser(administrator.id, { ...administrator, status: "DISABLED", roleIds: administrator.roleIds }), /至少一名/);
  accessControl.changeOwnPassword(administrator.id, "TestAdmin123!", "NewAdminPass456");
  assert.equal(auth.authenticateUser(administrator.email, "TestAdmin123!"), null);
  assert.equal(auth.authenticateUser(administrator.email, "NewAdminPass456")?.mustChangePassword, false);
});

test("initial workspace has a profile but no invented companies or people", () => {
  assert.equal(repository.listCampaigns().length, 1);
  assert.equal(repository.listOrganizations().length, 0);
  assert.equal(repository.listPeople().length, 0);
  assert.equal(repository.getDashboard().metrics.learnedCompanies, 0);
});

test("company discovery hides legacy companies without authorized resume evidence", () => {
  const timestamp = new Date().toISOString();
  database.db.prepare("INSERT INTO organizations VALUES (?, ?, ?, '', '广州', '待确认', '', 0.5, ?)")
    .run("legacy-company", "历史调研公司", "历史调研公司", timestamp);
  database.db.prepare(`INSERT INTO campaign_organizations
    (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json, fit_score, evidence_coverage, confidence, recommendation_reason, unknowns_json, owner_name, updated_at)
    VALUES (?, ?, ?, '历史调研', 'PENDING_REVIEW', '[]', '[]', '[]', '[]', 80, 70, 70, '旧数据', '[]', '测试', ?)`)
    .run("legacy-campaign-company", "campaign-overseas-gm", "legacy-company", timestamp);
  assert.equal(repository.listOrganizations().some((organization) => organization.organizationId === "legacy-company"), false);
  assert.equal(learning.getGraphData().nodes.some((node) => node.id === "legacy-company"), false);
});

test("legacy fixed demo people and companies are removed during migration", () => {
  const timestamp = new Date().toISOString();
  database.db.prepare("INSERT INTO organizations VALUES (?, ?, ?, '', '广州', '待确认', '', 0.5, ?)")
    .run("org-northstar", "北辰互动", "北辰互动", timestamp);
  database.db.prepare("INSERT INTO people VALUES (?, ?, ?, '', '广州', 0.5, ?)")
    .run("person-lin", "林哲", "林哲", timestamp);
  seed.removeLegacyDiscoverySamples();
  const count = (table: "organizations" | "people", id: string) => Number((database.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`).get(id) as { count: number }).count);
  assert.equal(count("organizations", "org-northstar"), 0);
  assert.equal(count("people", "person-lin"), 0);
  assert.equal(count("organizations", "legacy-company"), 1);
});

test("PDF resume text is parsed by the bundled Node worker", async () => {
  const text = await resumes.extractResumeText("authorized-resume.pdf", "application/pdf", createTextPdf("Authorized resume PDF import works"));
  assert.match(text, /Authorized resume PDF import works/);
});

test("low-density recruitment text is quarantined before it can contaminate the graph", async () => {
  const imported = await resumes.importResume({
    campaignId: "campaign-overseas-gm",
    fileName: "无效招聘文本.txt",
    mimeType: "text/plain",
    sourceType: "AUTHORIZED_TEXT",
    legalBasis: "测试质量闸门",
    createdBy: "测试",
    rawText: "岗位职责：负责完成工作。\n任职要求：服从安排。\n招聘人数：若干。\n投递简历即可加入。",
  });
  assert.equal(imported.resume.status, "QUARANTINED");
  assert.equal(imported.resume.graphEligible, false);
  assert.equal(resumes.getPendingResumeIds("campaign-overseas-gm").includes(imported.resume.id), false);

  const run = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [imported.resume.id] }).id);
  const item = database.db.prepare("SELECT status, result_json FROM ai_run_items WHERE run_id = ? AND entity_id = ?").get(run.id, imported.resume.id) as { status: string; result_json: string };
  assert.equal(item.status, "SKIPPED");
  assert.equal(JSON.parse(item.result_json).reason, "RESUME_QUARANTINED");
  assert.equal(run.metrics.quarantined, 1);
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(imported.resume.id) as { count: number }).count), 0);
});

test("AI claims without an exact source quote are removed before graph admission", () => {
  const text = "姓名：证据测试\n职位：海外增长负责人\n2022-至今在真实公司负责海外增长。";
  const analysis = {
    person: { name: "证据测试", headline: "海外增长负责人", location: "", summary: "" },
    employments: [{
      company: "不存在公司", aliases: [], title: "虚构总监", normalizedRole: "虚构总监", startDate: "2022", endDate: null, isCurrent: true,
      summary: "负责不存在的业务", evidenceQuote: "这段文字不在原始简历里", location: "", industry: "", businessTags: ["不存在业务"], markets: [], channels: [], monetization: [], businessHistory: [], currentBusiness: [], businessStatus: "UNKNOWN" as const, businessStatusSummary: "", businessSignals: [], businessStatusConfidence: 0, confidence: 0.99,
    }],
    skills: [{ name: "虚构技能", category: "OTHER" as const, evidence: "原文没有这项技能", confidence: 0.99 }],
    match: { score: 99, strengths: [], gaps: [], rationale: "" },
  };
  const evaluated = resumeQuality.evaluateResumeQuality(text, analysis, settings.DEFAULT_RESUME_QUALITY_POLICY);
  assert.equal(evaluated.analysis.employments.length, 0);
  assert.equal(evaluated.analysis.skills.length, 0);
  assert.equal(evaluated.assessment.graphEligible, false);
  assert.ok(Number(evaluated.assessment.metrics.droppedUnsupportedClaims) >= 2);
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
  assert.equal(first.resume.retentionUntil, null);
  const run = learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [first.resume.id] });
  const completed = await learning.executeAiRun(run.id);
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.stage, "COMPLETED");
  assert.equal(completed.metrics.inputResumes, 1);
  assert.equal(completed.metrics.processed, 1);
  assert.ok(repository.listPeople().some((person) => person.name === "张三"));
  const currentOrganization = repository.listOrganizations().find((organization) => organization.name === "广州星河网络有限公司");
  const historicalOrganization = repository.listOrganizations().find((organization) => organization.name === "深圳远航科技有限公司");
  assert.equal(currentOrganization?.status, "AI_LEARNED");
  assert.ok(currentOrganization?.currentBusiness.some((item) => item.includes("Google")));
  assert.equal(currentOrganization?.businessStatus, "UNKNOWN");
  assert.match(currentOrganization?.businessStatusSummary || "", /暂不判断/);
  assert.ok(historicalOrganization?.businessHistory.some((item) => item.includes("东南亚市场")));
  assert.ok(learning.getGraphData().metrics.evidenceBackedEdges >= 2);
  assert.ok(learning.listSearchTasks().length >= 1);
  const profile = resumes.listResumeProfiles().find((item) => item.id === first.resume.id);
  assert.ok((profile?.qualityScore || 0) >= settings.DEFAULT_RESUME_QUALITY_POLICY.graphMinimumScore);
  assert.equal(profile?.graphEligible, true);
  assert.equal(profile?.searchEligible, true);
  assert.equal(profile?.personHeadline, "海外业务负责人");
  assert.equal(profile?.employments.length, 2);
  assert.ok(profile?.skills.some((skill) => skill.name === "Google"));
  assert.equal(currentOrganization?.evidenceSourceCount, 1);
  assert.ok((currentOrganization?.sourceQualityScore || 0) >= settings.DEFAULT_RESUME_QUALITY_POLICY.graphMinimumScore);

  const edgeCount = Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(first.resume.id) as { count: number }).count);
  const openTaskCount = learning.listSearchTasks().filter((task) => ["NEW", "CLAIMED", "IN_PROGRESS", "DEFERRED"].includes(task.status)).length;
  const rebuild = learning.createAiRun({ campaignId: "campaign-overseas-gm", runType: "REBUILD" });
  await learning.executeAiRun(rebuild.id);
  const rebuiltEdgeCount = Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(first.resume.id) as { count: number }).count);
  assert.equal(rebuiltEdgeCount, edgeCount);
  assert.equal(learning.listSearchTasks().filter((task) => ["NEW", "CLAIMED", "IN_PROGRESS", "DEFERRED"].includes(task.status)).length, openTaskCount);
});

test("BOSS search keywords stay broad and compact", () => {
  assert.deepEqual(
    learning.compactBossSearchKeywords(["海外广告变现投放优化师", "商业化负责人", "海外项目负责人 / General Manager"]),
    ["广告变现", "海外投放", "商业化"],
  );
  assert.deepEqual(learning.compactBossSearchKeywords(["Senior Java 后端开发工程师"]), ["后端开发", "Java开发"]);
  assert.ok(learning.compactBossSearchKeywords(["新能源汽车渠道拓展负责人"]).every((keyword) => [...keyword].length <= 8));
});

test("a failed rebuild preserves an existing successful resume and graph", async () => {
  const imported = await resumes.importResume({
    campaignId: "campaign-overseas-gm",
    fileName: "重建失败状态保护.txt",
    mimeType: "text/plain",
    sourceType: "CANDIDATE_SHARED",
    legalBasis: "候选人授权用于当前招聘",
    createdBy: "测试",
    rawText: [
      "姓名：重建保护候选人",
      "职位：海外增长负责人",
      "所在地：广州",
      "技能：Google、Meta、海外增长",
      "2021-至今 | 广州重建保护有限公司 | 海外增长负责人 | 负责海外增长和团队管理",
    ].join("\n"),
  });
  const firstRun = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [imported.resume.id] }).id);
  assert.equal(firstRun.status, "SUCCEEDED");

  const sentinelUpdatedAt = "2020-01-01T00:00:00.000Z";
  database.db.prepare("UPDATE resume_documents SET extracted_text = ?, updated_at = ? WHERE id = ?")
    .run("无法解析的重建内容", sentinelUpdatedAt, imported.resume.id);
  const before = database.db.prepare("SELECT status, person_id, analyzed_at FROM resume_documents WHERE id = ?").get(imported.resume.id) as { status: string; person_id: string; analyzed_at: string };
  const edgeCount = Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(imported.resume.id) as { count: number }).count);

  const rebuild = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", runType: "REBUILD", resumeIds: [imported.resume.id] }).id);
  const after = database.db.prepare("SELECT status, person_id, error_message, updated_at, analyzed_at FROM resume_documents WHERE id = ?").get(imported.resume.id) as { status: string; person_id: string; error_message: string; updated_at: string; analyzed_at: string };
  const rebuildItem = database.db.prepare("SELECT status, error_message FROM ai_run_items WHERE run_id = ? AND entity_id = ?").get(rebuild.id, imported.resume.id) as { status: string; error_message: string };

  assert.equal(rebuild.status, "FAILED");
  assert.equal(rebuildItem.status, "FAILED");
  assert.match(rebuildItem.error_message, /姓名/);
  assert.deepEqual({ ...after }, { status: "READY", person_id: before.person_id, error_message: "", updated_at: sentinelUpdatedAt, analyzed_at: before.analyzed_at });
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(imported.resume.id) as { count: number }).count), edgeCount);
});

test("masked BOSS resumes merge into an existing candidate only with strong career evidence", async () => {
  const fullResume = [
    "姓名：赵明",
    "职位：海外投放负责人",
    "所在地：广州",
    "技能：Google Ads、Meta Ads、TikTok Ads",
    "2021-至今 | 广州拓海网络有限公司 | 海外投放负责人 | 负责欧美市场广告投放与团队管理",
    "2018-2021 | 深圳聚量科技有限公司 | 广告优化经理 | 负责 Google 与 Meta 广告优化",
  ].join("\n");
  const maskedResume = [
    "姓名：赵*",
    "职位：海外投放负责人",
    "所在地：广州",
    "技能：Google Ads、Meta Ads、TikTok Ads、AppsFlyer",
    "2021.01-至今 | 广州拓海网络有限公司 | 海外投放负责人 | 管理海外投放团队并负责欧美市场",
    "2018.03-2021.01 | 深圳聚量科技有限公司 | 广告优化经理 | 负责 Google 与 Meta 投放优化",
  ].join("\n");
  const full = await resumes.importResume({ campaignId: "campaign-overseas-gm", fileName: "赵明-完整.txt", mimeType: "text/plain", sourceType: "BOSS_VISIBLE_SCREENSHOT", legalBasis: "招聘人员主动扫描 BOSS 当前可见简历", createdBy: "测试", rawText: fullResume });
  await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [full.resume.id] }).id);
  const fullPersonId = resumes.getResume(full.resume.id)?.personId;
  assert.ok(fullPersonId);

  const masked = await resumes.importResume({ campaignId: "campaign-overseas-gm", fileName: "赵星号-BOSS扫描.txt", mimeType: "text/plain", sourceType: "BOSS_VISIBLE_SCREENSHOT", legalBasis: "招聘人员主动扫描 BOSS 当前可见简历", createdBy: "测试", rawText: maskedResume });
  const completed = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [masked.resume.id] }).id);
  const maskedProfile = resumes.listResumeProfiles().find((resume) => resume.id === masked.resume.id);

  assert.equal(resumes.getResume(masked.resume.id)?.personId, fullPersonId);
  assert.equal(maskedProfile?.identityDecision, "AUTO_MERGED");
  assert.equal(maskedProfile?.identityMatchedPersonId, fullPersonId);
  assert.ok(maskedProfile?.identityReasons.some((reason) => reason.includes("2 段")));
  assert.equal((database.db.prepare("SELECT name FROM people WHERE id = ?").get(fullPersonId) as { name: string }).name, "赵明");
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM resume_documents WHERE person_id = ?").get(fullPersonId) as { count: number }).count), 2);
  assert.equal(completed.metrics.identityMerged, 1);
});

test("an ambiguous masked resume stays separate and is marked for review", async () => {
  const existingPerson = database.db.prepare("SELECT id FROM people WHERE name = '赵明'").get() as { id: string };
  const ambiguousResume = [
    "姓名：赵*",
    "职位：海外投放负责人",
    "所在地：广州",
    "技能：Google Ads、Meta Ads、TikTok Ads",
    "2021-至今 | 广州拓海网络有限公司 | 海外投放负责人 | 负责欧美市场广告投放与团队管理，补充新的项目描述",
  ].join("\n");
  const imported = await resumes.importResume({ campaignId: "campaign-overseas-gm", fileName: "赵星号-单段履历.txt", mimeType: "text/plain", sourceType: "BOSS_VISIBLE_SCREENSHOT", legalBasis: "招聘人员主动扫描 BOSS 当前可见简历", createdBy: "测试", rawText: ambiguousResume });
  const completed = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [imported.resume.id] }).id);
  const profile = resumes.listResumeProfiles().find((resume) => resume.id === imported.resume.id);

  assert.notEqual(resumes.getResume(imported.resume.id)?.personId, existingPerson.id);
  assert.equal(profile?.identityDecision, "REVIEW_REQUIRED");
  assert.equal(profile?.identityMatchedPersonId, existingPerson.id);
  assert.equal(profile?.identityMatchedPersonName, "赵明");
  assert.match(profile?.identityReasons[0] || "", /证据或分差不足未自动合并/);
  assert.equal(completed.metrics.identityReviewRequired, 1);
});

test("candidate automation rules reject invalid or overlapping score ranges", () => {
  assert.throws(() => settings.saveCandidateAutomationSettings({ rules: [], searchTaskMinimumScore: 101 }), /搜索任务最低分/);
  assert.throws(() => settings.saveCandidateAutomationSettings({ rules: [], resumeQualityPolicy: { ...settings.DEFAULT_RESUME_QUALITY_POLICY, quarantineBelow: 80, graphMinimumScore: 70 } }), /质量阈值必须满足/);
  assert.throws(() => settings.saveCandidateAutomationSettings({ rules: [], resumeQualityPolicy: { ...settings.DEFAULT_RESUME_QUALITY_POLICY, organizationSearchMinimumSources: 0 } }), /独立来源数/);
  assert.throws(() => settings.saveCandidateAutomationSettings({ rules: [
    { id: "invalid-target", minimum: 80, maximum: 100, targetStatus: "INTERVIEWING", enabled: true },
  ] }), /目标阶段无效/);
  assert.throws(() => settings.saveCandidateAutomationSettings({ rules: [
    { id: "lower", minimum: 0, maximum: 70, targetStatus: "NEEDS_RESEARCH", enabled: true },
    { id: "overlap", minimum: 70, maximum: 100, targetStatus: "READY_TO_CONTACT", enabled: true },
  ] }), /评分区间不能重叠/);
  const saved = settings.saveCandidateAutomationSettings({ rules: [
    { id: "high-score", minimum: 80, maximum: 100, targetStatus: "READY_TO_CONTACT", enabled: true },
    { id: "low-score", minimum: 0, maximum: 79, targetStatus: "NEEDS_RESEARCH", enabled: false },
  ], searchTaskMinimumScore: 82 });
  assert.deepEqual(saved.rules.map((rule) => rule.id), ["low-score", "high-score"]);
  assert.equal(saved.searchTaskMinimumScore, 82);
  assert.equal(settings.matchCandidateAutoProgressRule(88)?.id, "high-score");
  const outcomeRules = settings.saveCandidateAutomationSettings({ rules: [
    { id: "closed", minimum: 0, maximum: 20, targetStatus: "CLOSED", enabled: true },
    { id: "talent-pool", minimum: 21, maximum: 40, targetStatus: "TALENT_POOL", enabled: true },
    { id: "do-not-contact", minimum: 41, maximum: 60, targetStatus: "DO_NOT_CONTACT", enabled: true },
  ], searchTaskMinimumScore: 0 });
  assert.deepEqual(outcomeRules.rules.map((rule) => rule.targetStatus), ["CLOSED", "TALENT_POOL", "DO_NOT_CONTACT"]);
  settings.saveCandidateAutomationSettings({ rules: [], searchTaskMinimumScore: 0 });
});

test("AI score rules can automatically assign review outcome statuses", async () => {
  const outcomes = [
    { status: "CLOSED", name: "自动淘汰候选人", company: "自动淘汰测试公司" },
    { status: "TALENT_POOL", name: "自动入库候选人", company: "自动入库测试公司" },
    { status: "DO_NOT_CONTACT", name: "自动勿扰候选人", company: "自动勿扰测试公司" },
  ] as const;

  for (const outcome of outcomes) {
    settings.saveCandidateAutomationSettings({ rules: [
      { id: `all-${outcome.status.toLowerCase()}`, minimum: 0, maximum: 100, targetStatus: outcome.status, enabled: true },
    ], searchTaskMinimumScore: 0 });
    const imported = await resumes.importResume({
      campaignId: "campaign-overseas-gm",
      fileName: `${outcome.name}.txt`,
      mimeType: "text/plain",
      sourceType: "CANDIDATE_SHARED",
      legalBasis: "候选人授权用于当前招聘",
      createdBy: "测试",
      rawText: [
        `姓名：${outcome.name}`,
        "职位：海外运营负责人",
        "所在地：广州",
        "技能：海外运营、团队管理",
        `2021-至今 | ${outcome.company} | 海外运营负责人 | 负责海外运营与团队管理`,
      ].join("\n"),
    });
    const run = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [imported.resume.id] }).id);
    const candidate = repository.listPeople().find((person) => person.name === outcome.name);
    assert.equal(candidate?.status, outcome.status);
    assert.equal(candidate?.stageHistory[0]?.status, outcome.status);
    assert.equal(candidate?.stageHistory[0]?.operatorName, "系统自动推进");
    assert.match(candidate?.stageHistory[0]?.reason || "", /命中自动推进区间 0-100/);
    assert.equal(run.metrics.autoProgressed, 1);
  }

  settings.saveCandidateAutomationSettings({ rules: [], searchTaskMinimumScore: 0 });
});

test("search task generation honors the configured minimum organization score", async () => {
  const organization = repository.listOrganizations("campaign-overseas-gm").find((item) => item.name === "广州星河网络有限公司");
  assert.ok(organization);
  database.db.prepare("DELETE FROM search_tasks WHERE campaign_id = ? AND company_name = ?").run("campaign-overseas-gm", organization.name);
  database.db.prepare("UPDATE campaign_organizations SET fit_score = 95, confidence = 90, evidence_source_count = 1, source_quality_score = 95 WHERE id = ?").run(organization.id);

  settings.saveCandidateAutomationSettings({ rules: [], searchTaskMinimumScore: 96 });
  const blockedRun = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm" }).id);
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM search_tasks WHERE run_id = ? AND company_name = ?").get(blockedRun.id, organization.name) as { count: number }).count), 0);

  settings.saveCandidateAutomationSettings({ rules: [], searchTaskMinimumScore: 95 });
  const allowedRun = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm" }).id);
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM search_tasks WHERE run_id = ? AND company_name = ?").get(allowedRun.id, organization.name) as { count: number }).count), 1);

  settings.saveCandidateAutomationSettings({ rules: [], searchTaskMinimumScore: 0 });
});

test("score rules auto-progress candidates and advanced candidates are skipped by later learning", async () => {
  settings.saveCandidateAutomationSettings({ rules: [
    { id: "all-ready", minimum: 0, maximum: 100, targetStatus: "READY_TO_CONTACT", enabled: true },
  ] });
  const automaticResume = await resumes.importResume({
    campaignId: "campaign-overseas-gm",
    fileName: "自动推进候选人.txt",
    mimeType: "text/plain",
    sourceType: "CANDIDATE_SHARED",
    legalBasis: "候选人授权用于当前招聘",
    createdBy: "测试",
    rawText: [
      "姓名：自动推进候选人",
      "职位：海外增长负责人",
      "所在地：上海",
      "技能：Google、Meta、海外增长",
      "2021-至今 | 上海自动化测试有限公司 | 海外增长负责人 | 负责海外增长与团队管理",
    ].join("\n"),
  });
  const firstRun = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [automaticResume.resume.id] }).id);
  const automaticCandidate = repository.listPeople().find((person) => person.name === "自动推进候选人");
  assert.ok(automaticCandidate);
  assert.equal(automaticCandidate.status, "READY_TO_CONTACT");
  assert.equal(firstRun.metrics.autoProgressed, 1);
  assert.equal(automaticCandidate.stageHistory[0]?.status, "READY_TO_CONTACT");
  assert.equal(automaticCandidate.stageHistory[0]?.operatorName, "系统自动推进");
  const audit = database.db.prepare("SELECT reason_code, action, operator_name FROM feedback WHERE campaign_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1").get("campaign-overseas-gm", automaticCandidate.personId) as { reason_code: string; action: string; operator_name: string };
  assert.deepEqual({ ...audit }, { reason_code: "AUTO_SCORE_THRESHOLD", action: "READY_TO_CONTACT", operator_name: "系统自动推进" });
  const graphEdgeCount = Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(automaticResume.resume.id) as { count: number }).count);

  settings.saveCandidateAutomationSettings({ rules: [] });
  database.db.prepare("UPDATE resume_documents SET updated_at = ? WHERE id = ?").run(new Date(Date.now() + 1_000).toISOString(), automaticResume.resume.id);
  assert.equal(resumes.getPendingResumeIds("campaign-overseas-gm").includes(automaticResume.resume.id), false);
  const skippedRun = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [automaticResume.resume.id] }).id);
  assert.equal(skippedRun.metrics.inputResumes, 1);
  assert.equal(skippedRun.metrics.processed, 1);
  assert.equal(skippedRun.metrics.analyzed, 0);
  assert.equal(skippedRun.metrics.skippedAdvanced, 1);
  assert.match(skippedRun.summary, /跳过已推进候选人 1 份/);
  const skippedItem = database.db.prepare("SELECT status, result_json FROM ai_run_items WHERE run_id = ? AND entity_id = ?").get(skippedRun.id, automaticResume.resume.id) as { status: string; result_json: string };
  assert.equal(skippedItem.status, "SKIPPED");
  assert.equal(JSON.parse(skippedItem.result_json).reason, "CANDIDATE_ALREADY_ADVANCED");
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM graph_edges WHERE source_resume_id = ?").get(automaticResume.resume.id) as { count: number }).count), graphEdgeCount);

  const manualResume = await resumes.importResume({
    campaignId: "campaign-overseas-gm",
    fileName: "手动推进候选人.txt",
    mimeType: "text/plain",
    sourceType: "CANDIDATE_SHARED",
    legalBasis: "候选人授权用于当前招聘",
    createdBy: "测试",
    rawText: [
      "姓名：手动推进候选人",
      "职位：海外商业化负责人",
      "所在地：深圳",
      "技能：广告变现、P&L、海外市场",
      "2020-至今 | 深圳手动测试有限公司 | 海外商业化负责人 | 负责海外商业化与团队管理",
    ].join("\n"),
  });
  await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [manualResume.resume.id] }).id);
  const manualCandidate = repository.listPeople().find((person) => person.name === "手动推进候选人");
  assert.ok(manualCandidate);
  assert.equal(manualCandidate.status, "PENDING_REVIEW");
  repository.reviewPeople([manualCandidate.id], "READY_TO_CONTACT", "人工确认进入联系阶段", "测试 HR");
  const manualSkippedRun = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", resumeIds: [manualResume.resume.id] }).id);
  assert.equal(manualSkippedRun.metrics.skippedAdvanced, 1);
  assert.equal(manualSkippedRun.metrics.analyzed, 0);

  const rebuild = await learning.executeAiRun(learning.createAiRun({ campaignId: "campaign-overseas-gm", runType: "REBUILD" }).id);
  assert.ok(rebuild.metrics.skippedAdvanced >= 2);
  for (const resumeId of [automaticResume.resume.id, manualResume.resume.id]) {
    const item = database.db.prepare("SELECT status FROM ai_run_items WHERE run_id = ? AND entity_id = ?").get(rebuild.id, resumeId) as { status: string };
    assert.equal(item.status, "SKIPPED");
  }
  assert.equal(repository.listPeople().find((person) => person.id === automaticCandidate.id)?.status, "READY_TO_CONTACT");
  assert.equal(repository.listPeople().find((person) => person.id === manualCandidate.id)?.status, "READY_TO_CONTACT");
});

test("candidate workflow enforces ordered stages and preserves an audit timeline", () => {
  const candidate = repository.listPeople().find((person) => person.name === "张三");
  assert.ok(candidate);
  assert.equal(candidate.status, "PENDING_REVIEW");
  assert.throws(() => repository.reviewPeople([candidate.id], "INTERVIEWING", "直接安排面试", "测试 HR"), /不能从/);

  const transitions = [
    ["READY_TO_CONTACT", "画像审核通过"],
    ["CONTACTED", "已通过 BOSS 发送招呼"],
    ["ENGAGED", "候选人已回应并完成有效沟通"],
    ["SCREENING", "进入意愿和条件初筛"],
    ["INTERVIEWING", "用人经理面试已安排"],
    ["OFFERED", "Offer 已发出"],
    ["HIRED", "候选人已入职"],
  ] as const;
  for (const [status, reason] of transitions) repository.reviewPeople([candidate.id], status, reason, "测试 HR");

  const updated = repository.listPeople().find((person) => person.id === candidate.id);
  assert.equal(updated?.status, "HIRED");
  assert.ok(updated?.lastInteractionAt);
  assert.equal(updated?.stageHistory.length, transitions.length);
  assert.equal(updated?.stageHistory[0].status, "HIRED");
  assert.equal(updated?.stageHistory[0].reason, "候选人已入职");
  assert.equal(updated?.stageHistory[0].operatorName, "测试 HR");
  assert.equal(repository.getDashboard().funnel.find((stage) => stage.label === "已入职")?.value, 1);
});

test("talent-pool transitions require a reason, can be reactivated, and contacted candidates can withdraw", () => {
  const candidate = repository.listPeople().find((person) => person.name === "赵*");
  assert.ok(candidate);
  assert.throws(() => repository.reviewPeople([candidate.id], "TALENT_POOL", "", "测试 HR"), /必须填写原因/);
  repository.reviewPeople([candidate.id], "TALENT_POOL", "当前岗位级别不匹配，保留后续机会", "测试 HR");
  assert.equal(repository.listPeople().find((person) => person.id === candidate.id)?.status, "TALENT_POOL");
  repository.reviewPeople([candidate.id], "READY_TO_CONTACT", "新战役岗位匹配，重新激活", "测试 HR");
  const reactivated = repository.listPeople().find((person) => person.id === candidate.id);
  assert.equal(reactivated?.status, "READY_TO_CONTACT");
  assert.equal(reactivated?.stageHistory[0].reason, "新战役岗位匹配，重新激活");
  repository.reviewPeople([candidate.id], "CONTACTED", "已发送首次招呼", "测试 HR");
  assert.throws(() => repository.reviewPeople([candidate.id], "WITHDRAWN", "", "测试 HR"), /必须填写原因/);
  repository.reviewPeople([candidate.id], "WITHDRAWN", "候选人明确表示暂不考虑机会", "测试 HR");
  const withdrawn = repository.listPeople().find((person) => person.id === candidate.id);
  assert.equal(withdrawn?.status, "WITHDRAWN");
  assert.equal(withdrawn?.stageHistory[0].reason, "候选人明确表示暂不考虑机会");
});

test("header search and notifications are backed by current workspace data", () => {
  const people = headerData.searchHeaderData("张三");
  assert.ok(people.some((item) => item.kind === "person" && item.title === "张三"));
  assert.ok(people.some((item) => item.kind === "resume" && item.href.includes("%E5%BC%A0%E4%B8%89")));

  const organizations = headerData.searchHeaderData("星河");
  assert.ok(organizations.some((item) => item.kind === "organization" && item.title === "广州星河网络有限公司"));
  assert.ok(organizations.every((item) => item.href.startsWith("/")));
  assert.deepEqual(headerData.searchHeaderData("   "), []);

  const notifications = headerData.getHeaderNotifications();
  assert.equal(notifications.count, notifications.items.reduce((total, item) => total + item.count, 0));
  assert.equal(notifications.items.some((item) => item.kind === "organization"), false);
  assert.ok(notifications.items.some((item) => item.kind === "person" && item.count > 0));
});

test("plugin task transitions are explicit and actor-bound", () => {
  const task = learning.listSearchTasks({ status: ["NEW", "DEFERRED"] })[0];
  const claimed = learning.transitionSearchTask(task.id, "CLAIMED", "hr@example.com");
  assert.equal(claimed?.status, "CLAIMED");
  assert.equal(claimed?.claimedBy, "hr@example.com");
  const started = learning.transitionSearchTask(task.id, "IN_PROGRESS", "hr@example.com");
  assert.equal(started?.status, "IN_PROGRESS");
  assert.throws(() => learning.transitionSearchTask(task.id, "CLAIMED", "hr@example.com"), /不能从 IN_PROGRESS 变更/);
});

test("search feedback updates a bounded learning weight", () => {
  const task = learning.listSearchTasks({ status: "IN_PROGRESS" })[0];
  const result = learning.submitSearchTaskFeedback({ taskId: task.id, resultCount: 20, qualifiedCount: 5, effectiveConversations: 2, createdBy: "测试" });
  assert.equal(result.learning.sampleCount, 1);
  assert.ok(result.learning.weight >= 0.65 && result.learning.weight <= 1.35);
  assert.throws(() => learning.submitSearchTaskFeedback({ taskId: task.id, resultCount: 20, qualifiedCount: 5, effectiveConversations: 2 }), /已提交反馈/);
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
  database.db.prepare("UPDATE plugin_sessions SET expires_at = ? WHERE token_hash = ?").run("2000-01-01T00:00:00.000Z", stored.token_hash);
  assert.throws(() => pluginAuth.requirePluginSession(new Request("http://localhost/api/plugin/tasks", { headers: { Authorization: `Bearer ${session.token}` } })), /登录已失效/);
});

test("Chrome Web Store distribution only accepts an official extension URL", () => {
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const saved = settings.saveChromeDistributionSettings(`https://chromewebstore.google.com/detail/hunting-helper/${extensionId}?hl=zh-CN`);
  assert.equal(saved.extensionId, extensionId);
  assert.equal(saved.webStoreUrl, `https://chromewebstore.google.com/detail/hunting-helper/${extensionId}`);
  const status = extensionDelivery.getExtensionDeliveryStatus();
  assert.equal(status.deliveryMode, "WEB_STORE");
  assert.equal(status.extensionId, extensionId);
  assert.throws(() => settings.saveChromeDistributionSettings(`https://example.com/detail/${extensionId}`), /仅支持/);
  assert.throws(() => settings.saveChromeDistributionSettings("https://chromewebstore.google.com/detail/no-extension-id"), /有效插件 ID/);
});

test("screenshot source only accepts BOSS or the bundled synthetic page", () => {
  assert.equal(pluginAuth.screenshotSource("https://www.zhipin.com/web/geek/job"), "BOSS");
  assert.equal(pluginAuth.screenshotSource("chrome-extension://extension-id/synthetic.html", true), "SYNTHETIC");
  assert.throws(() => pluginAuth.screenshotSource("https://example.com/candidate"), /只允许分析/);
  assert.throws(() => pluginAuth.screenshotSource("chrome-extension://extension-id/synthetic.html", false), /只允许分析/);
});

test("resume capture accepts embedded BOSS details and identified continuation screens", () => {
  assert.equal(resumeCapture.hasUsableResumeDetailEvidence({
    isResumeDetail: false,
    sequence: 1,
    candidateName: "李**",
    expectedCandidateName: "",
    headline: "高级广告优化师",
    text: "工作经历\n塔思科技（广州）\n负责海外广告投放与项目团队管理",
  }), true);
  assert.equal(resumeCapture.hasUsableResumeDetailEvidence({
    isResumeDetail: false,
    sequence: 2,
    candidateName: "",
    expectedCandidateName: "李**",
    headline: "",
    text: "工作经历\n负责 Facebook、Google 和 TikTok 海外投放，持续分析广告效果并优化项目策略。",
  }), true);
  assert.equal(resumeCapture.hasUsableResumeDetailEvidence({
    isResumeDetail: false,
    sequence: 1,
    candidateName: "",
    expectedCandidateName: "",
    headline: "",
    text: "候选人搜索列表",
  }), false);
});

test("multi-screen resume capture removes overlap and sensitive contact fields", () => {
  const first = {
    sequence: 1, screenshotHash: "a".repeat(64), pageUrl: "https://www.zhipin.com/web/geek/detail/123", synthetic: false,
    candidateName: "张三", headline: "海外业务负责人", visibleSection: "基本信息与第一段经历", hasMoreBelow: true, warnings: [],
    text: ["姓名：张三", "电话：13800138000", "邮箱：zhangsan@example.com", "男 | 32岁 | 已婚", "广州星河网络有限公司", "海外业务负责人", "2022.03 - 至今", "负责 Google 与 Meta 海外增长"].join("\n"),
  };
  const second = {
    sequence: 2, screenshotHash: "b".repeat(64), pageUrl: first.pageUrl, synthetic: false,
    candidateName: "张三", headline: "", visibleSection: "工作经历", hasMoreBelow: false, warnings: [],
    text: ["海外业务负责人", "2022.03 - 至今", "负责 Google 与 Meta 海外增长", "深圳远航科技有限公司", "海外增长总监", "负责东南亚市场从 0 到 1"].join("\n"),
  };
  const merged = resumeCapture.mergeResumeCaptureSegments([second, first]);
  assert.equal(merged.screenCount, 2);
  assert.equal((merged.text.match(/2022\.03 - 至今/g) || []).length, 1);
  assert.match(merged.text, /广州星河网络有限公司/);
  assert.match(merged.text, /深圳远航科技有限公司/);
  assert.doesNotMatch(merged.text, /13800138000|zhangsan@example\.com/);
  assert.doesNotMatch(merged.text, /32岁|已婚/);
});

test("multi-screen resume capture rejects duplicate screens and mixed candidates", () => {
  const segment = {
    sequence: 1, screenshotHash: "c".repeat(64), pageUrl: "https://www.zhipin.com/web/geek/detail/456", synthetic: false,
    candidateName: "李四", headline: "增长负责人", visibleSection: "工作经历", hasMoreBelow: true, warnings: [],
    text: "姓名：李四\n增长负责人\n广州增长科技有限公司\n负责海外渠道与团队管理",
  };
  assert.throws(() => resumeCapture.mergeResumeCaptureSegments([segment, { ...segment, sequence: 2 }]), /重复截图/);
  assert.throws(() => resumeCapture.mergeResumeCaptureSegments([segment, { ...segment, sequence: 2, screenshotHash: "d".repeat(64), candidateName: "王五", text: "姓名：王五\n深圳远航网络有限公司\n海外业务负责人" }]), /姓名不一致/);
  assert.throws(() => resumeCapture.mergeResumeCaptureSegments([{ ...segment, sequence: 2 }]), /序号必须从 1 开始/);
  assert.throws(() => resumeCapture.mergeResumeCaptureSegments([{ ...segment, candidateName: "" }]), /第一屏缺少候选人姓名/);
});

test("activity events and candidate origins are idempotent and traceable", () => {
  const timestamp = new Date().toISOString();
  database.db.prepare("INSERT OR IGNORE INTO people (id, name, normalized_name, headline, location, identity_confidence, created_at) VALUES (?, ?, ?, '', '', 1, ?)")
    .run("autonomy-origin-person", "Origin Test", "origin test", timestamp);
  const firstEvent = autonomy.recordActivityEvent({ campaignId: "campaign-overseas-gm", personId: "autonomy-origin-person", eventType: "CANDIDATE_CREATED", reasonCode: "TEST_ORIGIN", actorType: "SYSTEM", actorId: "test", idempotencyKey: "test-origin-event" });
  const secondEvent = autonomy.recordActivityEvent({ campaignId: "campaign-overseas-gm", personId: "autonomy-origin-person", eventType: "CANDIDATE_CREATED", reasonCode: "TEST_ORIGIN", actorType: "SYSTEM", actorId: "test", idempotencyKey: "test-origin-event" });
  assert.equal(firstEvent.id, secondEvent.id);

  const firstOrigin = autonomy.attachCandidateOrigin({ campaignId: "campaign-overseas-gm", personId: "autonomy-origin-person", sourceType: "MANUAL", keywords: ["growth"] });
  const secondOrigin = autonomy.attachCandidateOrigin({ campaignId: "campaign-overseas-gm", personId: "autonomy-origin-person", sourceType: "MANUAL", keywords: ["growth"] });
  assert.equal(firstOrigin.id, secondOrigin.id);
  assert.equal(autonomy.listCandidateOrigins("autonomy-origin-person", "campaign-overseas-gm").length, 1);
  assert.equal(autonomy.listActivityEvents({ personId: "autonomy-origin-person" }).length, 1);
});

test("public evidence promotion, conflicts, and project search generation honor governance thresholds", () => {
  const organization = database.db.prepare(`SELECT o.id FROM organizations o
    JOIN campaign_organizations co ON co.organization_id = o.id
    WHERE co.campaign_id = ? ORDER BY co.fit_score DESC LIMIT 1`).get("campaign-overseas-gm") as { id: string } | undefined;
  assert.ok(organization);
  const topic = `governance-test-${Date.now()}`;
  const task = autonomy.createResearchTask({ campaignId: "campaign-overseas-gm", organizationId: organization.id, topic, triggerType: "TEST", createdBy: "test" });
  const officialUrl = `https://example.com/official-${Date.now()}`;
  const weakUrl = `https://example.net/weak-${Date.now()}`;
  const projectName = `Verified Project ${Date.now()}`;
  autonomy.persistResearchResult({
    taskId: task.id,
    summary: "Evidence governance test",
    sources: [
      { sourceType: "OFFICIAL_WEBSITE", trustTier: "OFFICIAL", title: "Official source", url: officialUrl, publisher: "Example", quote: "Officially confirmed current business and project delivery." },
      { sourceType: "SOCIAL", trustTier: "WEAK", title: "Weak source", url: weakUrl, publisher: "Community", quote: "Unverified community statement." },
    ],
    claims: [
      { claimType: "current_business", classification: "FACT", statement: "Official promoted fact", confidence: 90, sourceUrls: [officialUrl] },
      { claimType: "weak_business", classification: "FACT", statement: "Weak candidate fact", confidence: 95, sourceUrls: [weakUrl] },
      { claimType: "future_business", classification: "PREDICTION", statement: "Prediction stays candidate", confidence: 99, sourceUrls: [officialUrl] },
    ],
    businessUnits: [{ name: "Verified Unit", unitType: "BUSINESS_UNIT", description: "Official business unit", status: "ACTIVE", confidence: 90, sourceUrls: [officialUrl] }],
    projects: [{ name: projectName, businessUnitName: "Verified Unit", projectType: "CLIENT_DELIVERY", status: "ACTIVE", region: "Shanghai", products: ["Platform"], skills: ["Project Manager"], summary: `${projectName} official delivery`, confidence: 90, talentDemandConfidence: 80, sourceUrls: [officialUrl] }],
    events: [{ eventType: "BUSINESS_EXPANSION", title: "Verified expansion", summary: "Official regional expansion", classification: "FACT", confidence: 90, sourceUrls: [officialUrl] }],
  });
  const claims = autonomy.listEvidenceClaims(organization.id);
  assert.equal(claims.find((claim) => claim.statement === "Official promoted fact")?.status, "PROMOTED");
  assert.equal(claims.find((claim) => claim.statement === "Weak candidate fact")?.status, "CANDIDATE");
  assert.equal(claims.find((claim) => claim.statement === "Prediction stays candidate")?.status, "CANDIDATE");
  const project = autonomy.listProjects(organization.id).find((item) => item.name === projectName);
  assert.ok(project);
  assert.ok(project.claims.some((claim) => claim.status === "PROMOTED"));
  assert.equal(Number((database.db.prepare("SELECT COUNT(*) AS count FROM search_tasks WHERE task_type = 'PROJECT_INTELLIGENCE_SEARCH' AND title LIKE ?").get(`%${projectName}%`) as { count: number }).count), 1);

  const conflictTask = autonomy.createResearchTask({ campaignId: "campaign-overseas-gm", organizationId: organization.id, topic: `${topic}-conflict`, triggerType: "TEST", createdBy: "test" });
  autonomy.persistResearchResult({
    taskId: conflictTask.id,
    summary: "Conflict test",
    sources: [{ sourceType: "OFFICIAL_WEBSITE", trustTier: "OFFICIAL", title: "Official source", url: officialUrl, publisher: "Example", quote: "Officially confirmed current business and project delivery." }],
    claims: [{ claimType: "current_business", classification: "DISPUTED", statement: "Conflicting current business", confidence: 85, sourceUrls: [officialUrl] }],
    businessUnits: [], projects: [], events: [],
  });
  const disputed = autonomy.listEvidenceClaims(organization.id).filter((claim) => claim.claimType === "current_business");
  assert.ok(disputed.length >= 2);
  assert.ok(disputed.every((claim) => claim.status === "DISPUTED"));
  assert.ok(autonomy.listResearchTasks({ status: "QUEUED" }).some((item) => item.triggerType === "EVIDENCE_CONFLICT"));
});

test("weekly reviews require minimum samples and keep weight changes bounded", () => {
  const original = settings.getAutonomySettings();
  try {
    settings.saveAutonomySettings({ ...original, reviewMinimumTasks: 50, reviewMinimumResults: 1000 });
    const insufficient = autonomy.runReview({ campaignId: "campaign-overseas-gm", reviewType: "WEEKLY", triggeredBy: "test" });
    assert.equal(insufficient.appliedChanges.length, 0);

    settings.saveAutonomySettings({ ...original, reviewMinimumTasks: 1, reviewMinimumResults: 1, maximumWeightDelta: 0.08 });
    const timestamp = new Date().toISOString();
    const taskId = `bounded-review-task-${Date.now()}`;
    database.db.prepare(`INSERT INTO search_tasks
      (id, campaign_id, run_id, task_type, title, company_name, query_json, reason_json, priority, dedupe_key, status, claimed_by, expires_at, created_at, completed_at, strategy_version_id, experiment_assignment_id)
      VALUES (?, ?, NULL, 'MANUAL', 'Bounded review task', 'Bounded Review Company', ?, '{}', 50, ?, 'COMPLETED', 'test', ?, ?, ?, NULL, NULL)`)
      .run(taskId, "campaign-overseas-gm", JSON.stringify({ keywords: ["Growth"] }), `${taskId}-dedupe`, new Date(Date.now() + 86_400_000).toISOString(), timestamp, timestamp);
    database.db.prepare(`INSERT INTO search_task_feedback (id, task_id, result_count, qualified_count, effective_conversations, note, created_by, created_at)
      VALUES (?, ?, 100, 100, 100, '', 'test', ?)`)
      .run(`${taskId}-feedback`, taskId, timestamp);
    const review = autonomy.runReview({ campaignId: "campaign-overseas-gm", reviewType: "WEEKLY", triggeredBy: "test" });
    assert.ok(review.appliedChanges.some((change) => change.signalKey === "Bounded Review Company"));
    const weight = database.db.prepare("SELECT weight FROM learning_weights WHERE campaign_id = ? AND signal_type = 'COMPANY' AND signal_key = ?")
      .get("campaign-overseas-gm", "Bounded Review Company") as { weight: number };
    assert.ok(Math.abs(Number(weight.weight) - 1) <= 0.080001);
    assert.ok(Number(weight.weight) >= 0.65 && Number(weight.weight) <= 1.35);
  } finally {
    settings.saveAutonomySettings(original);
  }
});

test("operating analytics uses explicit denominators and stores daily snapshots idempotently", () => {
  const campaign = repository.createCampaign({ name: "Analytics Test", roleName: "Analytics Role", ownerName: "test" });
  const timestamp = new Date().toISOString();
  const taskId = `analytics-task-${Date.now()}`;
  database.db.prepare(`INSERT INTO search_tasks
    (id, campaign_id, run_id, task_type, title, company_name, query_json, reason_json, priority, dedupe_key, status, claimed_by, expires_at, created_at, completed_at, strategy_version_id, experiment_assignment_id)
    VALUES (?, ?, NULL, 'MANUAL', 'Analytics task', 'Analytics Company', ?, '{}', 50, ?, 'COMPLETED', 'test', ?, ?, ?, NULL, NULL)`)
    .run(taskId, campaign.id, JSON.stringify({ keywords: ["增长负责人"] }), `${taskId}-dedupe`, new Date(Date.now() + 86_400_000).toISOString(), timestamp, timestamp);
  database.db.prepare(`INSERT INTO search_task_feedback
    (id, task_id, result_count, qualified_count, effective_conversations, note, created_by, created_at)
    VALUES (?, ?, 40, 8, 4, '', 'test', ?)`)
    .run(`${taskId}-feedback`, taskId, timestamp);

  const report = analytics.computeAnalyticsReport(campaign.id, 28);
  assert.equal(report.search.qualifiedPer100, 20);
  assert.equal(report.search.highQualityToConversation.percent, 50);
  assert.equal(report.strategy.gainPercent, null);
  assert.equal(report.strategy.sampleReady, false);
  assert.equal(report.dimensions.companies[0]?.key, "Analytics Company");
  assert.equal(report.dimensions.keywords[0]?.key, "增长负责人");

  const first = analytics.createAnalyticsSnapshot(campaign.id, 28);
  const second = analytics.createAnalyticsSnapshot(campaign.id, 28);
  assert.equal(first.id, second.id);
  assert.equal(analytics.listAnalyticsSnapshots(campaign.id, 28).length, 1);

  const emptyCampaign = repository.createCampaign({ name: "Empty Analytics Test", roleName: "Empty Role", ownerName: "test" });
  const empty = analytics.computeAnalyticsReport(emptyCampaign.id, 7);
  assert.equal(empty.search.qualifiedPer100, null);
  assert.equal(empty.search.highQualityToConversation.percent, null);
  assert.equal(empty.dataQuality.score, null);
});

test("human quarantine reviews produce a real false-kill denominator", async () => {
  const quarantined = resumes.listResumes("campaign-overseas-gm").find((resume) => resume.status === "QUARANTINED");
  assert.ok(quarantined);
  resumes.reviewResumeQuality({ resumeId: quarantined.id, decision: "CONFIRMED", actorId: "reviewer@test.local" });
  const restoredImport = await resumes.importResume({
    campaignId: "campaign-overseas-gm",
    fileName: "误拦截复核.txt",
    mimeType: "text/plain",
    sourceType: "AUTHORIZED_TEXT",
    legalBasis: "测试人工质量复核",
    createdBy: "测试",
    rawText: "岗位职责：协助处理事项。\n任职要求：服从安排。\n招聘若干人。\n请投递资料。",
  });
  assert.equal(restoredImport.resume.status, "QUARANTINED");
  const review = resumes.reviewResumeQuality({ resumeId: restoredImport.resume.id, decision: "RESTORED", actorId: "reviewer@test.local" });
  assert.equal(review.status, "PENDING");
  assert.equal(resumes.isResumeQualityRestored(restoredImport.resume.id), true);
  const report = analytics.computeAnalyticsReport("campaign-overseas-gm", 28);
  assert.ok(report.resumeQuality.reviewed >= 2);
  assert.ok(report.resumeQuality.restored >= 1);
  assert.notEqual(report.resumeQuality.falseKillRate.percent, null);
});

after(() => {
  database?.db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});
