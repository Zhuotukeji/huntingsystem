import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Campaign } from "@/lib/types";

const researchPlanSchema = z.object({
  steps: z.array(z.string().min(4).max(160)).min(4).max(7),
});

export async function generateResearchSteps(campaign: Campaign, fallback: string[]) {
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
    const response = await client.responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-5.6",
      input: [
        { role: "system", content: "你是合规人才研究助理。只生成供 HR 在 InsightTracker 手工执行的检索步骤。不得建议自动登录、绕过限制、抓取个人信息或编造 URL。" },
        { role: "user", content: JSON.stringify({ role: campaign.roleName, businessGoal: campaign.businessGoal, markets: campaign.markets, channels: campaign.channels, mustHaves: campaign.mustHaves }) },
      ],
      text: { format: zodTextFormat(researchPlanSchema, "research_plan") },
    });
    return response.output_parsed?.steps?.length ? response.output_parsed.steps : fallback;
  } catch {
    return fallback;
  }
}
