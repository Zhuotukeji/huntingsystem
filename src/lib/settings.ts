import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, now } from "@/lib/db";
import type { AiProviderSettings } from "@/lib/types";

type SettingRow = { setting_key: string; setting_value: string; is_secret: number; updated_at: string };

const defaultBaseUrl = process.env.SUB2API_BASE_URL || process.env.OPENAI_BASE_URL || "";
const defaultModel = process.env.SUB2API_MODEL || process.env.OPENAI_MODEL || "gpt-5.6";

function getMasterKey() {
  if (process.env.SETTINGS_ENCRYPTION_KEY) {
    return createHash("sha256").update(process.env.SETTINGS_ENCRYPTION_KEY).digest();
  }
  const keyPath = join(process.cwd(), ".data", "settings.key");
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
