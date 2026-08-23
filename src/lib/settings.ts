import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { db, now } from "@/lib/db";
import { applicationPath } from "@/lib/runtime-paths";
import type { AiProviderSettings, AutonomySettings, CandidateAutomationSettings, CandidateAutoProgressRule, CandidateAutoProgressStatus, ResumeQualityPolicy } from "@/lib/types";

type SettingRow = { setting_key: string; setting_value: string; is_secret: number; updated_at: string };

const defaultBaseUrl = process.env.SUB2API_BASE_URL || process.env.OPENAI_BASE_URL || "";
const defaultModel = process.env.SUB2API_MODEL || process.env.OPENAI_MODEL || "gpt-5.6";
const chromeWebStoreHosts = new Set(["chromewebstore.google.com", "chrome.google.com"]);
const candidateAutomationKey = "candidate_auto_progress_rules";
const searchTaskMinimumScoreKey = "search_task_minimum_score";
const resumeQualityPolicyKey = "resume_quality_policy";
const autonomySettingsKey = "autonomy_settings";
export const DEFAULT_RESUME_QUALITY_POLICY: ResumeQualityPolicy = {
  quarantineBelow: 40,
  graphMinimumScore: 70,
  highConfidenceMinimumScore: 85,
  organizationSearchMinimumConfidence: 70,
  organizationSearchMinimumSources: 1,
  businessFactMinimumSources: 2,
  maxOrganizationsPerResume: 12,
  maxSkillsPerResume: 30,
};
export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = {
  enabled: true,
  webResearchEnabled: false,
  webSearchCapability: "UNKNOWN",
  researchDailyLimit: 30,
  researchConcurrency: 2,
  researchCooldownDays: 7,
  currentBusinessFreshnessDays: 180,
  hiringSignalFreshnessDays: 60,
  projectFreshnessDays: 90,
  claimPromotionMinimumConfidence: 80,
  projectSearchMinimumConfidence: 80,
  talentDemandMinimumConfidence: 70,
  reviewMinimumTasks: 5,
  reviewMinimumResults: 30,
  explorationPercent: 20,
  maximumWeightDelta: 0.08,
  updatedAt: null,
};
const candidateAutoProgressStatuses = new Set<CandidateAutoProgressStatus>([
  "NEEDS_RESEARCH",
  "READY_TO_CONTACT",
  "TALENT_POOL",
  "CLOSED",
  "DO_NOT_CONTACT",
]);

function getMasterKey() {
  if (process.env.SETTINGS_ENCRYPTION_KEY) {
    return createHash("sha256").update(process.env.SETTINGS_ENCRYPTION_KEY).digest();
  }
  const keyPath = applicationPath(".data", "settings.key");
  mkdirSync(dirname(keyPath), { recursive: true });
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  const value = readFileSync(keyPath);
  if (value.length !== 32) throw new Error("本地设置加密密钥长度无效，请删除 .data/settings.key 后重试");
  return value;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("密钥配置格式无效");
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function getRows() {
  return db.prepare("SELECT * FROM ai_settings").all() as SettingRow[];
}

function valuesByKey() {
  return Object.fromEntries(getRows().map((row) => [row.setting_key, row])) as Record<string, SettingRow>;
}

function plainValue(rows: Record<string, SettingRow>, key: string, fallback = "") {
  return rows[key]?.setting_value ?? fallback;
}

function secretValue(rows: Record<string, SettingRow>, key: string, fallback = "") {
  const stored = rows[key]?.setting_value;
  if (!stored) return fallback;
  return decrypt(stored);
}

function upsert(key: string, value: string, secret = false) {
  db.prepare(`INSERT INTO ai_settings (setting_key, setting_value, is_secret, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`)
    .run(key, secret ? encrypt(value) : value, secret ? 1 : 0, now());
}

export function validateCandidateAutoProgressRules(input: unknown): CandidateAutoProgressRule[] {
  if (!Array.isArray(input)) throw new Error("自动推进规则格式无效");
  if (input.length > 20) throw new Error("自动推进规则最多 20 条");
  const identifiers = new Set<string>();
  const rules = input.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`第 ${index + 1} 条自动推进规则格式无效`);
    const source = value as Record<string, unknown>;
    const minimum = Number(source.minimum);
    const maximum = Number(source.maximum);
    const targetStatus = source.targetStatus;
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum > 100 || minimum > maximum) {
      throw new Error(`第 ${index + 1} 条规则的分数区间必须是 0 至 100 的整数，且最低分不能高于最高分`);
    }
    if (!candidateAutoProgressStatuses.has(targetStatus as CandidateAutoProgressStatus)) {
      throw new Error(`第 ${index + 1} 条规则的目标阶段无效`);
    }
    let id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || identifiers.has(id)) id = randomUUID();
    identifiers.add(id);
    return { id, minimum, maximum, targetStatus: targetStatus as CandidateAutoProgressStatus, enabled: source.enabled === true };
  }).sort((left, right) => left.minimum - right.minimum || left.maximum - right.maximum);
  for (let index = 1; index < rules.length; index += 1) {
    if (rules[index].minimum <= rules[index - 1].maximum) {
      throw new Error(`评分区间不能重叠：${rules[index - 1].minimum}-${rules[index - 1].maximum} 与 ${rules[index].minimum}-${rules[index].maximum}`);
    }
  }
  return rules;
}

export function validateSearchTaskMinimumScore(input: unknown) {
  const score = Number(input);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error("搜索任务最低分必须是 0 至 100 的整数");
  }
  return score;
}

export function validateResumeQualityPolicy(input: unknown): ResumeQualityPolicy {
  if (!input || typeof input !== "object") throw new Error("简历质量策略格式无效");
  const source = input as Record<string, unknown>;
  const score = (key: keyof ResumeQualityPolicy, fallback: number) => source[key] === undefined ? fallback : Number(source[key]);
  const policy: ResumeQualityPolicy = {
    quarantineBelow: score("quarantineBelow", DEFAULT_RESUME_QUALITY_POLICY.quarantineBelow),
    graphMinimumScore: score("graphMinimumScore", DEFAULT_RESUME_QUALITY_POLICY.graphMinimumScore),
    highConfidenceMinimumScore: score("highConfidenceMinimumScore", DEFAULT_RESUME_QUALITY_POLICY.highConfidenceMinimumScore),
    organizationSearchMinimumConfidence: score("organizationSearchMinimumConfidence", DEFAULT_RESUME_QUALITY_POLICY.organizationSearchMinimumConfidence),
    organizationSearchMinimumSources: score("organizationSearchMinimumSources", DEFAULT_RESUME_QUALITY_POLICY.organizationSearchMinimumSources),
    businessFactMinimumSources: score("businessFactMinimumSources", DEFAULT_RESUME_QUALITY_POLICY.businessFactMinimumSources),
    maxOrganizationsPerResume: score("maxOrganizationsPerResume", DEFAULT_RESUME_QUALITY_POLICY.maxOrganizationsPerResume),
    maxSkillsPerResume: score("maxSkillsPerResume", DEFAULT_RESUME_QUALITY_POLICY.maxSkillsPerResume),
  };
  const scoreFields: Array<keyof ResumeQualityPolicy> = ["quarantineBelow", "graphMinimumScore", "highConfidenceMinimumScore", "organizationSearchMinimumConfidence"];
  if (scoreFields.some((key) => !Number.isInteger(policy[key]) || policy[key] < 0 || policy[key] > 100)) {
    throw new Error("质量分和可信度阈值必须是 0 至 100 的整数");
  }
  if (!(policy.quarantineBelow <= policy.graphMinimumScore && policy.graphMinimumScore <= policy.highConfidenceMinimumScore)) {
    throw new Error("质量阈值必须满足：隔离线不高于图谱准入线，图谱准入线不高于高可信线");
  }
  if (!Number.isInteger(policy.organizationSearchMinimumSources) || policy.organizationSearchMinimumSources < 1 || policy.organizationSearchMinimumSources > 10) {
    throw new Error("搜索任务最少独立来源数必须是 1 至 10");
  }
  if (!Number.isInteger(policy.businessFactMinimumSources) || policy.businessFactMinimumSources < 1 || policy.businessFactMinimumSources > 10) {
    throw new Error("公司业务事实最少独立来源数必须是 1 至 10");
  }
  if (!Number.isInteger(policy.maxOrganizationsPerResume) || policy.maxOrganizationsPerResume < 1 || policy.maxOrganizationsPerResume > 30) {
    throw new Error("单份简历公司上限必须是 1 至 30");
  }
  if (!Number.isInteger(policy.maxSkillsPerResume) || policy.maxSkillsPerResume < 1 || policy.maxSkillsPerResume > 50) {
    throw new Error("单份简历技能上限必须是 1 至 50");
  }
  return policy;
}

export function getCandidateAutomationSettings(): CandidateAutomationSettings {
  const rows = valuesByKey();
  const row = rows[candidateAutomationKey];
  let rules: CandidateAutoProgressRule[] = [];
  try {
    if (row) rules = validateCandidateAutoProgressRules(JSON.parse(row.setting_value));
  } catch {
    rules = [];
  }
  let searchTaskMinimumScore = 0;
  try {
    searchTaskMinimumScore = validateSearchTaskMinimumScore(plainValue(rows, searchTaskMinimumScoreKey, "0"));
  } catch {
    searchTaskMinimumScore = 0;
  }
  let resumeQualityPolicy = DEFAULT_RESUME_QUALITY_POLICY;
  try {
    const stored = rows[resumeQualityPolicyKey]?.setting_value;
    if (stored) resumeQualityPolicy = validateResumeQualityPolicy(JSON.parse(stored));
  } catch {
    resumeQualityPolicy = DEFAULT_RESUME_QUALITY_POLICY;
  }
  const updatedAt = [row?.updated_at, rows[searchTaskMinimumScoreKey]?.updated_at, rows[resumeQualityPolicyKey]?.updated_at].filter(Boolean).sort().at(-1) || null;
  return { rules, searchTaskMinimumScore, resumeQualityPolicy, updatedAt };
}

export function saveCandidateAutomationSettings(input: { rules: unknown; searchTaskMinimumScore?: unknown; resumeQualityPolicy?: unknown }) {
  const current = getCandidateAutomationSettings();
  const rules = validateCandidateAutoProgressRules(input.rules);
  const searchTaskMinimumScore = input.searchTaskMinimumScore === undefined
    ? current.searchTaskMinimumScore
    : validateSearchTaskMinimumScore(input.searchTaskMinimumScore);
  const resumeQualityPolicy = input.resumeQualityPolicy === undefined
    ? current.resumeQualityPolicy
    : validateResumeQualityPolicy(input.resumeQualityPolicy);
  db.exec("BEGIN IMMEDIATE");
  try {
    upsert(candidateAutomationKey, JSON.stringify(rules));
    upsert(searchTaskMinimumScoreKey, String(searchTaskMinimumScore));
    upsert(resumeQualityPolicyKey, JSON.stringify(resumeQualityPolicy));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getCandidateAutomationSettings();
}

export function matchCandidateAutoProgressRule(score: number) {
  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  return getCandidateAutomationSettings().rules.find((rule) => rule.enabled && normalizedScore >= rule.minimum && normalizedScore <= rule.maximum) || null;
}

export function validateAutonomySettings(input: unknown): AutonomySettings {
  if (!input || typeof input !== "object") throw new Error("AI 自主设置格式无效");
  const source = input as Record<string, unknown>;
  const integer = (key: keyof AutonomySettings, minimum: number, maximum: number, fallback: number) => {
    const value = source[key] === undefined ? fallback : Number(source[key]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${String(key)} 必须是 ${minimum} 至 ${maximum} 的整数`);
    return value;
  };
  const maximumWeightDelta = source.maximumWeightDelta === undefined ? DEFAULT_AUTONOMY_SETTINGS.maximumWeightDelta : Number(source.maximumWeightDelta);
  if (!Number.isFinite(maximumWeightDelta) || maximumWeightDelta < 0.01 || maximumWeightDelta > 0.08) throw new Error("单次权重调整必须在 0.01 至 0.08 之间");
  const capability = source.webSearchCapability;
  return {
    enabled: source.enabled === undefined ? DEFAULT_AUTONOMY_SETTINGS.enabled : source.enabled === true,
    webResearchEnabled: source.webResearchEnabled === true,
    webSearchCapability: capability === "AVAILABLE" || capability === "UNAVAILABLE" ? capability : "UNKNOWN",
    researchDailyLimit: integer("researchDailyLimit", 1, 200, DEFAULT_AUTONOMY_SETTINGS.researchDailyLimit),
    researchConcurrency: integer("researchConcurrency", 1, 5, DEFAULT_AUTONOMY_SETTINGS.researchConcurrency),
    researchCooldownDays: integer("researchCooldownDays", 1, 30, DEFAULT_AUTONOMY_SETTINGS.researchCooldownDays),
    currentBusinessFreshnessDays: integer("currentBusinessFreshnessDays", 30, 730, DEFAULT_AUTONOMY_SETTINGS.currentBusinessFreshnessDays),
    hiringSignalFreshnessDays: integer("hiringSignalFreshnessDays", 7, 365, DEFAULT_AUTONOMY_SETTINGS.hiringSignalFreshnessDays),
    projectFreshnessDays: integer("projectFreshnessDays", 30, 365, DEFAULT_AUTONOMY_SETTINGS.projectFreshnessDays),
    claimPromotionMinimumConfidence: integer("claimPromotionMinimumConfidence", 60, 100, DEFAULT_AUTONOMY_SETTINGS.claimPromotionMinimumConfidence),
    projectSearchMinimumConfidence: integer("projectSearchMinimumConfidence", 60, 100, DEFAULT_AUTONOMY_SETTINGS.projectSearchMinimumConfidence),
    talentDemandMinimumConfidence: integer("talentDemandMinimumConfidence", 50, 100, DEFAULT_AUTONOMY_SETTINGS.talentDemandMinimumConfidence),
    reviewMinimumTasks: integer("reviewMinimumTasks", 1, 50, DEFAULT_AUTONOMY_SETTINGS.reviewMinimumTasks),
    reviewMinimumResults: integer("reviewMinimumResults", 1, 1000, DEFAULT_AUTONOMY_SETTINGS.reviewMinimumResults),
    explorationPercent: integer("explorationPercent", 0, 50, DEFAULT_AUTONOMY_SETTINGS.explorationPercent),
    maximumWeightDelta,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
  };
}

export function getAutonomySettings(): AutonomySettings {
  const rows = valuesByKey();
  const row = rows[autonomySettingsKey];
  if (!row) return DEFAULT_AUTONOMY_SETTINGS;
  try {
    return { ...validateAutonomySettings(JSON.parse(row.setting_value)), updatedAt: row.updated_at };
  } catch {
    return DEFAULT_AUTONOMY_SETTINGS;
  }
}

export function saveAutonomySettings(input: unknown) {
  const settings = validateAutonomySettings(input);
  const value = { ...settings, updatedAt: undefined };
  upsert(autonomySettingsKey, JSON.stringify(value));
  return getAutonomySettings();
}

export function setWebSearchCapability(capability: AutonomySettings["webSearchCapability"]) {
  const current = getAutonomySettings();
  const value = { ...current, webSearchCapability: capability, updatedAt: undefined };
  upsert(autonomySettingsKey, JSON.stringify(value));
  return getAutonomySettings();
}

export function getAiRuntimeConfig() {
  const rows = valuesByKey();
  const apiKey = secretValue(rows, "api_key", process.env.SUB2API_API_KEY || process.env.OPENAI_API_KEY || "");
  return {
    provider: "sub2api" as const,
    baseUrl: plainValue(rows, "base_url", defaultBaseUrl).replace(/\/$/, ""),
    model: plainValue(rows, "model", defaultModel),
    apiStyle: (plainValue(rows, "api_style", "chat_completions") === "responses" ? "responses" : "chat_completions") as "chat_completions" | "responses",
    apiKey,
    enabled: plainValue(rows, "enabled", apiKey ? "true" : "false") === "true",
    screenAnalysisEnabled: plainValue(rows, "screen_analysis_enabled", "false") === "true",
  };
}

export function getPublicAiSettings(): AiProviderSettings {
  const rows = valuesByKey();
  const runtime = getAiRuntimeConfig();
  const updatedAt = Object.values(rows).map((row) => row.updated_at).sort().at(-1) || null;
  return {
    provider: "sub2api",
    baseUrl: runtime.baseUrl,
    model: runtime.model,
    apiStyle: runtime.apiStyle,
    hasApiKey: Boolean(runtime.apiKey),
    maskedApiKey: runtime.apiKey ? `${runtime.apiKey.slice(0, 3)}••••${runtime.apiKey.slice(-4)}` : "",
    enabled: runtime.enabled,
    screenAnalysisEnabled: runtime.screenAnalysisEnabled,
    updatedAt,
  };
}

export function saveAiSettings(input: {
  baseUrl: string;
  model: string;
  apiStyle: "chat_completions" | "responses";
  apiKey?: string;
  enabled: boolean;
  screenAnalysisEnabled: boolean;
}) {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  if (input.enabled && (!baseUrl || !(input.apiKey?.trim() || getAiRuntimeConfig().apiKey))) {
    throw new Error("启用 Sub2API 前必须配置 Base URL 和 API Key");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    upsert("provider", "sub2api");
    upsert("base_url", baseUrl);
    upsert("model", input.model.trim() || "gpt-5.6");
    upsert("api_style", input.apiStyle);
    upsert("enabled", String(input.enabled));
    upsert("screen_analysis_enabled", String(input.screenAnalysisEnabled));
    if (input.apiKey?.trim()) upsert("api_key", input.apiKey.trim(), true);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getPublicAiSettings();
}

export function getPluginAccessCode() {
  const rows = valuesByKey();
  return secretValue(rows, "plugin_access_code", process.env.PLUGIN_ACCESS_CODE || "");
}

export function setPluginAccessCode(value: string) {
  if (value.trim().length < 10) throw new Error("插件访问码至少需要 10 个字符");
  upsert("plugin_access_code", value.trim(), true);
}

export function hasPluginAccessCode() {
  return Boolean(getPluginAccessCode());
}

export function normalizeChromeWebStoreUrl(value: string) {
  const input = value.trim();
  if (!input) return { webStoreUrl: "", extensionId: "" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入完整的 Chrome Web Store 地址");
  }
  const extensionId = url.pathname.split("/").filter(Boolean).findLast((segment) => /^[a-p]{32}$/.test(segment)) || "";
  if (url.protocol !== "https:" || !chromeWebStoreHosts.has(url.hostname) || !extensionId) {
    throw new Error("仅支持包含有效插件 ID 的 Chrome Web Store 地址");
  }
  url.search = "";
  url.hash = "";
  return { webStoreUrl: url.toString().replace(/\/$/, ""), extensionId };
}

export function getChromeDistributionSettings() {
  const rows = valuesByKey();
  const configured = plainValue(rows, "chrome_web_store_url", process.env.CHROME_WEB_STORE_URL || "");
  let normalized = { webStoreUrl: "", extensionId: "" };
  try {
    normalized = normalizeChromeWebStoreUrl(configured);
  } catch {
    // Ignore an invalid environment default so the settings page remains recoverable.
  }
  return { ...normalized, updatedAt: rows.chrome_web_store_url?.updated_at || null };
}

export function saveChromeDistributionSettings(webStoreUrl: string) {
  const normalized = normalizeChromeWebStoreUrl(webStoreUrl);
  upsert("chrome_web_store_url", normalized.webStoreUrl);
  return getChromeDistributionSettings();
}
