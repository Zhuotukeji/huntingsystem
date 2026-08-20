import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getAiRuntimeConfig } from "@/lib/settings";
import type { Campaign } from "@/lib/types";

const researchPlanSchema = z.object({
  steps: z.array(z.string().min(4).max(160)).min(4).max(7),
});

const greetingDraftSchema = z.object({
  draft: z.string().min(20).max(360),
  references: z.array(z.string().max(100)).max(4),
});

export const resumeAnalysisSchema = z.object({
  person: z.object({
    name: z.string().min(1).max(80),
    headline: z.string().max(180),
    location: z.string().max(80),
    summary: z.string().max(600),
  }),
  employments: z.array(z.object({
    company: z.string().min(1).max(160),
    aliases: z.array(z.string().max(120)).max(8),
    title: z.string().min(1).max(160),
    normalizedRole: z.string().min(1).max(100),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    isCurrent: z.boolean(),
    summary: z.string().max(800),
    location: z.string().max(100),
    industry: z.string().max(100),
    businessTags: z.array(z.string().max(60)).max(15),
    markets: z.array(z.string().max(60)).max(12),
    channels: z.array(z.string().max(60)).max(12),
    confidence: z.number().min(0).max(1),
  })).max(30),
  skills: z.array(z.object({
    name: z.string().min(1).max(80),
    category: z.enum(["CHANNEL", "PLATFORM", "BUSINESS", "LEADERSHIP", "LANGUAGE", "OTHER"]),
    evidence: z.string().max(240),
    confidence: z.number().min(0).max(1),
  })).max(50),
  match: z.object({
    score: z.number().min(0).max(100),
    strengths: z.array(z.string().max(180)).max(8),
    gaps: z.array(z.string().max(180)).max(8),
    rationale: z.string().max(600),
  }),
});

export const screenshotAnalysisSchema = z.object({
  candidates: z.array(z.object({
    alias: z.string().min(1).max(40),
    currentTitle: z.string().max(120),
    currentCompany: z.string().max(120),
    location: z.string().max(60),
    experience: z.string().max(80),
    skills: z.array(z.string().max(60)).max(15),
    score: z.number().min(0).max(100),
    verdict: z.enum(["PRIORITY", "VERIFY", "LOW_MATCH"]),
    evidence: z.array(z.string().max(160)).max(6),
    unknowns: z.array(z.string().max(120)).max(6),
  })).max(20),
  note: z.string().max(300),
});

export const resumeCaptureSegmentSchema = z.object({
  isResumeDetail: z.boolean(),
  candidateName: z.string().max(80),
  headline: z.string().max(180),
  visibleSection: z.string().max(100),
  text: z.string().max(20_000),
  hasMoreBelow: z.boolean(),
  warnings: z.array(z.string().max(160)).max(8),
});

export type ResumeAnalysis = z.infer<typeof resumeAnalysisSchema>;
export type ScreenshotAnalysis = z.infer<typeof screenshotAnalysisSchema>;
export type ResumeCaptureSegmentAnalysis = z.infer<typeof resumeCaptureSegmentSchema>;

function createClient() {
  const config = getAiRuntimeConfig();
  if (!config.enabled || !config.apiKey || !config.baseUrl) return null;
  return {
    config,
    client: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: 60_000, maxRetries: 1 }),
  };
}

function jsonFromText(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON 对象");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

async function runStructured<T>(schema: z.ZodType<T>, schemaName: string, system: string, input: string): Promise<T | null> {
  const runtime = createClient();
  if (!runtime) return null;
  const { client, config } = runtime;
  if (config.apiStyle === "responses") {
    const response = await client.responses.parse({
      model: config.model,
      input: [{ role: "system", content: system }, { role: "user", content: input }],
      text: { format: zodTextFormat(schema, schemaName) },
    });
    return response.output_parsed || null;
  }
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [{ role: "system", content: `${system}\n必须只返回一个符合要求的 JSON 对象，不要使用 Markdown。` }, { role: "user", content: input }],
    response_format: { type: "json_object" },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("模型返回内容为空");
  return schema.parse(jsonFromText(content));
}

export async function testAiConnection() {
  const runtime = createClient();
  if (!runtime) throw new Error("Sub2API 尚未启用或配置不完整");
  const startedAt = Date.now();
  if (runtime.config.apiStyle === "responses") {
    const response = await runtime.client.responses.create({ model: runtime.config.model, input: "Reply with exactly READY" });
    return { ok: response.output_text.trim().includes("READY"), latencyMs: Date.now() - startedAt, model: runtime.config.model };
  }
  const response = await runtime.client.chat.completions.create({
    model: runtime.config.model,
    messages: [{ role: "user", content: "Reply with exactly READY" }],
  });
  return { ok: response.choices[0]?.message?.content?.includes("READY") || false, latencyMs: Date.now() - startedAt, model: runtime.config.model };
}

export async function analyzeResumeWithAi(campaign: Campaign, resumeText: string) {
  return runStructured(
    resumeAnalysisSchema,
    "resume_analysis",
    "你是企业内部人才情报分析器。只能提取简历明确包含的事实；未知内容保持空值或加入 gaps；不得根据性别、年龄、婚育等敏感信息评分。每个技能和任职关系都要引用简历中的事实。",
    JSON.stringify({
      talentProfile: {
        role: campaign.roleName,
        businessGoal: campaign.businessGoal,
        locations: campaign.locations,
        markets: campaign.markets,
        channels: campaign.channels,
        mustHaves: campaign.mustHaves,
        niceToHaves: campaign.niceToHaves,
        exclusions: campaign.exclusions,
      },
      resume: resumeText.slice(0, 60_000),
    }),
  );
}

export async function analyzeScreenshotWithAi(campaign: Campaign, imageDataUrl: string) {
  const runtime = createClient();
  if (!runtime) throw new Error("Sub2API 尚未启用或配置不完整");
  if (!runtime.config.screenAnalysisEnabled) throw new Error("管理员尚未启用截图分析");
  const system = "你是招聘页面截图辅助判断器。只识别当前可见候选人卡片，不猜测被遮挡信息，不提取或返回姓名、头像、电话、微信、邮箱等身份字段。按出现顺序使用候选人A、候选人B作为代号。输出 JSON。";
  const prompt = JSON.stringify({ role: campaign.roleName, mustHaves: campaign.mustHaves, niceToHaves: campaign.niceToHaves, exclusions: campaign.exclusions });
  if (runtime.config.apiStyle === "responses") {
    const response = await runtime.client.responses.parse({
      model: runtime.config.model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: `${system}\n人才画像：${prompt}` },
          { type: "input_image", image_url: imageDataUrl, detail: "high" },
        ],
      }],
      text: { format: zodTextFormat(screenshotAnalysisSchema, "screenshot_analysis") },
    });
    if (!response.output_parsed) throw new Error("模型未返回截图分析结果");
    return response.output_parsed;
  }
  const response = await runtime.client.chat.completions.create({
    model: runtime.config.model,
    messages: [{ role: "system", content: system }, {
      role: "user",
      content: [{ type: "text", text: `人才画像：${prompt}` }, { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } }],
    }],
    response_format: { type: "json_object" },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("模型未返回截图分析结果");
  return screenshotAnalysisSchema.parse(jsonFromText(content));
}

export async function extractResumeScreenshotSegmentWithAi(imageDataUrl: string) {
  const runtime = createClient();
  if (!runtime) throw new Error("Sub2API 尚未启用或配置不完整");
  if (!runtime.config.screenAnalysisEnabled) throw new Error("管理员尚未启用截图分析");
  const system = [
    "你是招聘简历截图转录器。输入是同一位候选人简历详情页的一张当前可见视口截图。",
    "只按阅读顺序逐行转录截图中明确可见的招聘履历事实，尽量一项事实一行；不要推断、补全、总结或评价。",
    "保留姓名（仅在画面明确出现时）、职位、公司、任职日期、项目、业绩、技能和教育经历。",
    "不得返回电话、邮箱、微信、身份证号、年龄、性别、婚育、照片描述等非必要个人信息。",
    "如果不是单个候选人的简历详情页，将 isResumeDetail 设为 false。hasMoreBelow 只根据截图底部是否明显还有未展示内容判断。",
    "输出符合指定结构的 JSON。",
  ].join("\n");
  if (runtime.config.apiStyle === "responses") {
    const response = await runtime.client.responses.parse({
      model: runtime.config.model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: system },
          { type: "input_image", image_url: imageDataUrl, detail: "high" },
        ],
      }],
      text: { format: zodTextFormat(resumeCaptureSegmentSchema, "resume_capture_segment") },
    });
    if (!response.output_parsed) throw new Error("模型未返回简历截图识别结果");
    return response.output_parsed;
  }
  const response = await runtime.client.chat.completions.create({
    model: runtime.config.model,
    messages: [{ role: "system", content: system }, {
      role: "user",
      content: [{ type: "text", text: "请转录当前可见的简历内容。" }, { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } }],
    }],
    response_format: { type: "json_object" },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("模型未返回简历截图识别结果");
  return resumeCaptureSegmentSchema.parse(jsonFromText(content));
}

export async function generateResearchSteps(campaign: Campaign, fallback: string[]) {
  try {
    const result = await runStructured(
      researchPlanSchema,
      "research_plan",
      "你是合规人才研究助理。只生成供 HR 手工执行的检索步骤。不得建议自动登录、绕过限制、抓取个人信息或编造 URL。",
      JSON.stringify({ role: campaign.roleName, businessGoal: campaign.businessGoal, markets: campaign.markets, channels: campaign.channels, mustHaves: campaign.mustHaves }),
    );
    return result?.steps?.length ? result.steps : fallback;
  } catch {
    return fallback;
  }
}

export async function generateGreetingDraft(campaign: Campaign, candidate: { alias?: string; currentTitle?: string; currentCompany?: string; evidence?: string[] }) {
  const fallback = `你好，留意到你在${candidate.currentCompany || "海外业务"}有${candidate.currentTitle || "相关负责人"}经历，我们正在广州搭建海外业务，岗位有较完整的业务决策与团队搭建空间。你的经历与方向比较接近，方便了解一下你近期的职业考虑吗？`;
  try {
    const result = await runStructured(
      greetingDraftSchema,
      "greeting_draft",
      "你是招聘沟通助理。基于给出的可见履历事实生成一条简洁、克制、个性化的中文开场白。不得编造经历，不得提及敏感个人信息，不夸大职位承诺，不施压。只生成草稿，由 HR 人工审核和发送。",
      JSON.stringify({ role: campaign.roleName, valueProposition: campaign.valueProposition, candidate }),
    );
    return result || { draft: fallback, references: candidate.evidence?.slice(0, 3) || [] };
  } catch {
    return { draft: fallback, references: candidate.evidence?.slice(0, 3) || [] };
  }
}
