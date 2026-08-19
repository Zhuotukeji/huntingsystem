import { NextResponse } from "next/server";
import { createCampaign, listCampaigns } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ data: listCampaigns() });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    if (!String(input.name || "").trim()) return NextResponse.json({ error: "请输入战役名称" }, { status: 400 });
    return NextResponse.json({ data: createCampaign(input) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "创建战役失败" }, { status: 400 });
  }
}
