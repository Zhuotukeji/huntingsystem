import { NextResponse } from "next/server";
import { getCampaign, updateCampaignStatus } from "@/lib/repository";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("campaigns.view");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const campaign = getCampaign(id);
  return campaign ? NextResponse.json({ data: campaign }) : NextResponse.json({ error: "战役不存在" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("campaigns.manage");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const input = await request.json();
  if (!['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'].includes(input.status)) return NextResponse.json({ error: "状态无效" }, { status: 400 });
  const campaign = updateCampaignStatus(id, input.status);
  return campaign ? NextResponse.json({ data: campaign }) : NextResponse.json({ error: "战役不存在" }, { status: 404 });
}
