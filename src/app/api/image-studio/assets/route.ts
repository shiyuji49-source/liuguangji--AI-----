import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { appsVisibleFor } from "@/apps/registry";
import { put } from "@/lib/storage";

// 资产墙列表（图像生成器右栏）：按项目，可按 kind 过滤
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const kind = url.searchParams.get("kind");
    if (!projectId) return Response.json({ error: "缺少 projectId" }, { status: 400 });
    await requireProjectMember(projectId);

    const where = [eq(assets.projectId, projectId)];
    if (kind && kind !== "全部") where.push(eq(assets.kind, kind as never));
    const rows = await db
      .select()
      .from(assets)
      .where(and(...where))
      .orderBy(desc(assets.createdAt))
      .limit(300);
    return Response.json({ assets: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 上传新参考图（鎏光flow ➕上传新参考）：存图 → 入库 kind=参考（不计费、不入"已生成"网格）。
// 之后可像其他资产一样作 refAssetIds 喂给生成。
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const projectId = form.get("projectId");
    const file = form.get("file");
    const atNameRaw = form.get("atName");
    if (typeof projectId !== "string" || !(file instanceof File)) {
      return Response.json({ error: "缺少文件或 projectId" }, { status: 400 });
    }
    const { user, projectRole } = await requireProjectMember(projectId);
    if (!appsVisibleFor(projectRole).some((a) => a.key === "liuguang-flow")) {
      throw new AuthError("无图像生成器权限", 403);
    }
    const contentType = file.type || "image/png";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "仅支持图片文件" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) {
      return Response.json({ error: "图片过大（≤15MB）" }, { status: 400 });
    }
    const stored = await put({ buffer, contentType, projectId, prefix: "ref" });
    const atName =
      (typeof atNameRaw === "string" && atNameRaw.trim()) ||
      file.name.replace(/\.[^.]+$/, "").slice(0, 40) ||
      "参考图";
    const [row] = await db
      .insert(assets)
      .values({
        projectId,
        kind: "参考",
        atName,
        filePath: stored.key,
        thumbPath: stored.key,
        meta: { uploaded: true },
        createdBy: user.id,
      })
      .returning();
    return Response.json({ asset: row });
  } catch (e) {
    return toErrorResponse(e);
  }
}
