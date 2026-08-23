import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { listReviewRuns, runReview } from "@/lib/autonomy";

export async function GET(request: Request) {
  const auth = await authorizeApi("reviews.view");
  if ("response" in auth) return auth.response;
  const campaignId = new URL(request.url).searchParams.get("campaignId") || undefined;
  return NextResponse.json({ data: listReviewRuns(campaignId) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi("reviews.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const reviewType = input.reviewType === "DAILY" || input.reviewType === "WEEKLY" ? input.reviewType : "MANUAL";
    return NextResponse.json({ data: runReview({ campaignId: String(input.campaignId || ""), reviewType, triggeredBy: auth.user.email }) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "复盘失败" }, { status: 400 });
  }
}
