import { NextResponse } from "next/server";
import { importResume, listResumes } from "@/lib/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const campaignId = new URL(request.url).searchParams.get("campaignId") || undefined;
  return NextResponse.json({ data: listResumes(campaignId) });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "请选择简历文件" }, { status: 400 });
      const result = await importResume({
        campaignId: String(form.get("campaignId") || ""),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sourceType: String(form.get("sourceType") || "CANDIDATE_SHARED"),
        legalBasis: String(form.get("legalBasis") || ""),
        createdBy: String(form.get("createdBy") || "当前用户"),
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      return NextResponse.json({ data: result }, { status: result.duplicate ? 200 : 201 });
    }
    const input = await request.json();
    const result = await importResume({
      campaignId: String(input.campaignId || ""),
      fileName: String(input.fileName || "粘贴简历.txt"),
      mimeType: "text/plain",
      sourceType: String(input.sourceType || "AUTHORIZED_TEXT"),
      legalBasis: String(input.legalBasis || ""),
      createdBy: String(input.createdBy || "当前用户"),
      rawText: String(input.rawText || ""),
    });
    return NextResponse.json({ data: result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "简历导入失败" }, { status: 400 });
  }
}
