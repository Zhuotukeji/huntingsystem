import { NextResponse } from "next/server";
import { executeAiRun, getAiRun } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getAiRun(id);
  if (!run) return NextResponse.json({ error: "学习任务不存在" }, { status: 404 });
  return NextResponse.json({ data: run });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getAiRun(id)) return NextResponse.json({ error: "学习任务不存在" }, { status: 404 });
    const run = await executeAiRun(id);
    return NextResponse.json({ data: run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 学习失败" }, { status: 400 });
  }
}
