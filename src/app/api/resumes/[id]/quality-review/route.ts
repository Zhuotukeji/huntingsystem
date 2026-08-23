import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { reviewResumeQuality } from "@/lib/resumes";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi("resumes.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await context.params;
    const input = await request.json();
    const decision = input.decision === "RESTORED" ? "RESTORED" : input.decision === "CONFIRMED" ? "CONFIRMED" : null;
    if (!decision) return NextResponse.json({ error: "复核结论无效" }, { status: 400 });
    return NextResponse.json({ data: reviewResumeQuality({
      resumeId: id,
      decision,
      note: String(input.note || ""),
      actorId: auth.user.email,
    }) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "质量复核失败" }, { status: 400 });
  }
}
