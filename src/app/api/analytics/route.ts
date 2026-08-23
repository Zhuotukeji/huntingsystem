import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import {
  computeAnalyticsReport,
  createAnalyticsSnapshot,
  defaultAnalyticsCampaignId,
  listAnalyticsSnapshots,
  normalizeAnalyticsWindow,
} from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeApi("dashboard.view");
  if ("response" in auth) return auth.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    const campaignId = searchParams.get("campaignId") || defaultAnalyticsCampaignId();
    if (!campaignId) return NextResponse.json({ data: null, history: [] });
    const windowDays = normalizeAnalyticsWindow(searchParams.get("windowDays"));
    return NextResponse.json({
      data: computeAnalyticsReport(campaignId, windowDays),
      history: listAnalyticsSnapshots(campaignId, windowDays),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "经营数据计算失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApi("reviews.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const campaignId = String(input.campaignId || defaultAnalyticsCampaignId() || "");
    if (!campaignId) throw new Error("暂无可生成快照的寻访战役");
    const windowDays = normalizeAnalyticsWindow(input.windowDays);
    return NextResponse.json({ data: createAnalyticsSnapshot(campaignId, windowDays) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "经营快照生成失败" }, { status: 400 });
  }
}
