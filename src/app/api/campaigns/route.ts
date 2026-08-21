import { NextResponse } from "next/server";
import { createCampaign, listCampaigns } from "@/lib/repository";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeApi("campaigns.view");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ data: listCampaigns() });
}

export async function POST(request: Request) {
  const auth = await authorizeApi("campaigns.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    if (!String(input.name || "").trim()) return NextResponse.json({ error: "请输入战役名称" }, { status: 400 });
    return NextResponse.json({ data: createCampaign(input) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "创建战役失败" }, { status: 400 });
  }
}
