import { NextResponse } from "next/server";
import { createAiRun } from "@/lib/learning";
import { pluginCorsHeaders, pluginErrorStatus, requirePluginSession } from "@/lib/plugin-auth";
import { importResume } from "@/lib/resumes";

export const runtime = "nodejs";
export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

const sourceTypes = new Set(["CANDIDATE_SHARED", "BOSS_AUTHORIZED_DOWNLOAD", "INTERNAL_AUTHORIZED", "AUTHORIZED_TEXT"]);

export async function POST(request: Request) {
  try {
    const actor = requirePluginSession(request);
    const contentType = request.headers.get("content-type") || "";
    let result;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (form.get("authorizationConfirmed") !== "true") throw new Error("请确认简历来源和处理依据已获授权");
      const sourceType = String(form.get("sourceType") || "");
      if (!sourceTypes.has(sourceType)) throw new Error("简历来源类型无效");
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("请选择简历文件");
      result = await importResume({
        campaignId: String(form.get("campaignId") || ""), fileName: file.name, mimeType: file.type || "application/octet-stream",
        sourceType, legalBasis: String(form.get("legalBasis") || ""), createdBy: actor.email, buffer: Buffer.from(await file.arrayBuffer()),
      });
    } else {
      const input = await request.json();
      if (input.authorizationConfirmed !== true) throw new Error("请确认简历来源和处理依据已获授权");
      const sourceType = String(input.sourceType || "AUTHORIZED_TEXT");
      if (!sourceTypes.has(sourceType)) throw new Error("简历来源类型无效");
      result = await importResume({
        campaignId: String(input.campaignId || ""), fileName: String(input.fileName || "粘贴简历.txt"), mimeType: "text/plain",
        sourceType, legalBasis: String(input.legalBasis || ""), createdBy: actor.email, rawText: String(input.rawText || ""),
      });
    }
    const aiRun = result.duplicate ? null : createAiRun({ campaignId: result.resume.campaignId, runType: "UPLOAD", resumeIds: [result.resume.id], triggeredBy: `Chrome 插件 · ${actor.email}` });
    return NextResponse.json({ data: { ...result, aiRun } }, { status: result.duplicate ? 200 : 201, headers: pluginCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "简历导入失败" }, { status: pluginErrorStatus(error), headers: pluginCorsHeaders });
  }
}
