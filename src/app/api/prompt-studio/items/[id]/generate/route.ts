import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { promptItems, projects, scriptEpisodes } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { generateItemPrompt, type Workspace } from "@/lib/prompt-studio/run";
import { assertWorkspaceAccess, assertKindAccess } from "@/lib/prompt-studio/access";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const refine = z.object({ refine: z.string().max(2000).optional() }).safeParse(body);
    const refineText = refine.success ? refine.data.refine : undefined;

    const item = await db.query.promptItems.findFirst({ where: eq(promptItems.id, id) });
    if (!item) throw new AuthError("条目不存在", 404);
    const { user, project, projectRole } = await requireProjectMember(item.projectId);
    assertWorkspaceAccess(projectRole, item.workspace as Workspace);
    if (item.workspace === "资产") assertKindAccess(projectRole, item.kind);

    // 静帧/视频：带上来源集正文作背景
    let episodeContent: string | undefined;
    if (item.episodeNo && item.scriptId) {
      const ep = await db.query.scriptEpisodes.findFirst({
        where: and(
          eq(scriptEpisodes.scriptId, item.scriptId),
          eq(scriptEpisodes.episodeNo, item.episodeNo)
        ),
      });
      episodeContent = ep?.content;
    }

    const spec = await db.query.projects.findFirst({ where: eq(projects.id, item.projectId) });

    // 并发守卫：已在生成中则拒绝（允许 done/failed → 重新生成）
    const claimed = await db
      .update(promptItems)
      .set({ state: "generating", updatedAt: new Date() })
      .where(and(eq(promptItems.id, id), ne(promptItems.state, "generating")))
      .returning({ id: promptItems.id });
    if (claimed.length === 0) {
      return Response.json({ error: "该条正在生成中，请勿重复点击" }, { status: 409 });
    }

    try {
      const { promptText, credits, usage } = await generateItemPrompt({
        userId: user.id,
        kind: item.kind,
        name: item.name,
        brief: item.brief,
        episodeContent,
        refine: refineText,
        spec: {
          tier: project.tier,
          aspect: spec?.aspect ?? "9:16",
          productionType: spec?.productionType ?? "真人",
          styleGenre: spec?.styleGenre ?? null,
        },
      });
      await db
        .update(promptItems)
        .set({
          promptText,
          state: "done",
          error: null,
          params: { credits, usage, model: "main" },
          updatedAt: new Date(),
        })
        .where(eq(promptItems.id, id));
      return Response.json({ ok: true, promptText, credits });
    } catch (genErr) {
      const message = genErr instanceof Error ? genErr.message : "生成失败";
      await db
        .update(promptItems)
        .set({ state: "failed", error: message, updatedAt: new Date() })
        .where(eq(promptItems.id, id));
      // 积分不足等业务错误透传状态码
      const status = genErr instanceof Error && typeof (genErr as { status?: number }).status === "number"
        ? (genErr as unknown as { status: number }).status
        : 500;
      return Response.json({ error: message }, { status });
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
