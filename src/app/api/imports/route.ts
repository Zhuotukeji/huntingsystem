import { NextResponse } from "next/server";
import { processImport } from "@/lib/agents";
import { listSources } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ data: listSources() });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    if (!input.campaignId || !String(input.text || "").trim()) return NextResponse.json({ error: "请选择战役并提供资料" }, { status: 400 });
    return NextResponse.json({ data: processImport({ campaignId: input.campaignId, provider: String(input.provider || "手工导入"), title: String(input.title || "未命名资料"), sourceUrl: input.sourceUrl ? String(input.sourceUrl) : undefined, text: String(input.text) }) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 });
  }
}
