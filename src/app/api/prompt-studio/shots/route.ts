import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";

// 某集的分镜表
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const scriptId = url.searchParams.get("scriptId");
    const episodeNo = url.searchParams.get("episodeNo");
    if (!projectId || !scriptId || !episodeNo) {
      return Response.json({ error: "缺少参数" }, { status: 400 });
    }
    const { projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, "静帧");

    const rows = await db
      .select()
      .from(shots)
      .where(
        and(
          eq(shots.projectId, projectId),
          eq(shots.scriptId, scriptId),
          eq(shots.episodeNo, Number(episodeNo))
        )
      )
      .orderBy(asc(shots.shotNo));
    return Response.json({ shots: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 手动加一镜（追加到末尾）
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        scriptId: z.string().uuid(),
        episodeNo: z.number().int().positive(),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, scriptId, episodeNo } = parsed.data;
    const { user, projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, "静帧");

    const last = await db
      .select({ shotNo: shots.shotNo })
      .from(shots)
      .where(and(eq(shots.projectId, projectId), eq(shots.scriptId, scriptId), eq(shots.episodeNo, episodeNo)))
      .orderBy(desc(shots.shotNo))
      .limit(1);
    const [row] = await db
      .insert(shots)
      .values({
        projectId,
        scriptId,
        episodeNo,
        shotNo: (last[0]?.shotNo ?? 0) + 1,
        summary: "（新镜，点编辑填写）",
        createdBy: user.id,
      })
      .returning();
    return Response.json({ shot: row });
  } catch (e) {
    return toErrorResponse(e);
  }
}
