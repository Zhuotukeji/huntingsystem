import { NextResponse } from "next/server";
import { testAiConnection } from "@/lib/llm";
import { getPublicAiSettings, hasPluginAccessCode, saveAiSettings, setPluginAccessCode } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ data: { ...getPublicAiSettings(), hasPluginAccessCode: hasPluginAccessCode() } });
}

export async function PUT(request: Request) {
  try {
    const input = await request.json();
    const settings = saveAiSettings({
      baseUrl: String(input.baseUrl || ""),
      model: String(input.model || "gpt-5.6"),
      apiStyle: input.apiStyle === "responses" ? "responses" : "chat_completions",
      apiKey: input.apiKey ? String(input.apiKey) : undefined,
      enabled: Boolean(input.enabled),
      screenAnalysisEnabled: Boolean(input.screenAnalysisEnabled),
    });
    if (input.pluginAccessCode) setPluginAccessCode(String(input.pluginAccessCode));
    return NextResponse.json({ data: { ...settings, hasPluginAccessCode: hasPluginAccessCode() } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "设置保存失败" }, { status: 400 });
  }
}

export async function POST() {
  try {
    return NextResponse.json({ data: await testAiConnection() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "连接测试失败" }, { status: 400 });
  }
}
