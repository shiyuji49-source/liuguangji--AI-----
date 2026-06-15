import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";

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
