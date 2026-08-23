import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { updateExperimentStatus } from "@/lib/autonomy";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("strategies.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    if (!["DRAFT", "RUNNING", "COMPLETED", "CANCELLED"].includes(input.status)) throw new Error("实验状态无效");
    return NextResponse.json({ data: updateExperimentStatus((await params).id, input.status) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "实验更新失败" }, { status: 400 });
  }
}
