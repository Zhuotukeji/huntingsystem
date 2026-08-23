import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { createResearchTask, listResearchTasks } from "@/lib/autonomy";

export async function GET(request: Request) {
  const auth = await authorizeApi("intelligence.view");
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ data: listResearchTasks({ campaignId: params.get("campaignId") || undefined, status: params.get("status") || undefined }) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi("intelligence.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const data = createResearchTask({ campaignId: input.campaignId ? String(input.campaignId) : null, organizationId: String(input.organizationId || ""), topic: String(input.topic || "核实当前业务、公开项目与组织变化"), triggerType: "MANUAL", createdBy: auth.user.email });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建研究任务失败" }, { status: 400 });
  }
}
