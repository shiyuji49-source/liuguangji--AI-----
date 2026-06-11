import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { promptItems } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";
import type { Workspace } from "@/lib/prompt-studio/run";

// 列出某工作区/某集的卡片条目
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const workspace = url.searchParams.get("workspace") as Workspace | null;
    const episodeNoRaw = url.searchParams.get("episodeNo");
    if (!projectId || !workspace) return Response.json({ error: "缺少参数" }, { status: 400 });

    const { projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, workspace);

    const where = [eq(promptItems.projectId, projectId), eq(promptItems.workspace, workspace)];
    if (episodeNoRaw) where.push(eq(promptItems.episodeNo, Number(episodeNoRaw)));
    const rows = await db
      .select()
      .from(promptItems)
      .where(and(...where))
      .orderBy(asc(promptItems.sortIndex), asc(promptItems.createdAt));
    return Response.json({ items: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}
