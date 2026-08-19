import { NextResponse } from "next/server";
import { createInsightTrackerTask, discoverOrganizations, discoverPeople } from "@/lib/agents";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    if (!input.campaignId) return NextResponse.json({ error: "缺少战役" }, { status: 400 });
    const task = input.type === "organizations" ? discoverOrganizations(input.campaignId) : input.type === "people" ? discoverPeople(input.campaignId) : input.type === "insighttracker" ? await createInsightTrackerTask(input.campaignId) : null;
    return task ? NextResponse.json({ data: task }, { status: 202 }) : NextResponse.json({ error: "任务类型无效" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "任务执行失败" }, { status: 400 });
  }
}
