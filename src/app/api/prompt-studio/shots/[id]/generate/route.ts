import { z } from "zod";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, scriptEpisodes, promptItems, projects } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadShotChecked } from "@/lib/prompt-studio/access";
import { generateShotPrompt } from "@/lib/prompt-studio/run";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// 阶段③/④：逐镜生成静帧（分镜大师）或视频（Seedance）提示词
export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = z
      .object({ target: z.enum(["still", "video"]), refine: z.string().max(2000).optional() })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { target, refine } = parsed.data;

    const { shot, user, project } = await loadShotChecked(id);

    const stateCol = target === "still" ? "stillState" : "videoState";
    const promptCol = target === "still" ? "stillPrompt" : "videoPrompt";
    const errorCol = target === "still" ? "stillError" : "videoError";

    // 背景：本集剧本 + 关联资产档案 +（视频）静帧提示词
    const ep = await db.query.scriptEpisodes.findFirst({
      where: and(eq(scriptEpisodes.scriptId, shot.scriptId), eq(scriptEpisodes.episodeNo, shot.episodeNo)),
    });
    const refs = (shot.assetRefs as string[] | null) ?? [];
    const assetBriefs =
      refs.length > 0
        ? await db
            .select({ name: promptItems.name, brief: promptItems.brief })
            .from(promptItems)
            .where(and(eq(promptItems.projectId, shot.projectId), inArray(promptItems.name, refs)))
        : [];

    const spec = await db.query.projects.findFirst({ where: eq(projects.id, shot.projectId) });

    // 并发守卫：同一目标已在生成中则拒绝（允许 done/failed → 重新生成）
    const stateColumn = target === "still" ? shots.stillState : shots.videoState;
    const claimed = await db
      .update(shots)
      .set({ [stateCol]: "generating", updatedAt: new Date() })
      .where(and(eq(shots.id, id), ne(stateColumn, "generating")))
      .returning({ id: shots.id });
    if (claimed.length === 0) {
      return Response.json({ error: "该镜正在生成中，请勿重复点击" }, { status: 409 });
    }

    try {
      const { promptText, credits } = await generateShotPrompt({
        userId: user.id,
        target,
        shot: {
          shotNo: shot.shotNo,
          sceneLabel: shot.sceneLabel,
          summary: shot.summary,
          shotType: shot.shotType,
          cameraMove: shot.cameraMove,
          dialogue: shot.dialogue,
          durationSec: shot.durationSec,
          assetRefs: refs,
          episodeNo: shot.episodeNo,
          needStill: shot.needStill,
        },
        episodeContent: ep?.content,
        assetBriefs,
        stillPrompt: target === "video" ? shot.stillPrompt : undefined,
        directorStyle: (shot.params as { directorStyle?: string } | null)?.directorStyle,
        refine,
        spec: {
          tier: project.tier,
          aspect: spec?.aspect ?? "9:16",
          productionType: spec?.productionType ?? "真人",
          styleGenre: spec?.styleGenre ?? null,
        },
      });
      // params 用 jsonb_set 原子更新（still/video 并发生成互不丢失）
      const creditsKey = `${target}Credits`;
      await db
        .update(shots)
        .set({
          [promptCol]: promptText,
          [stateCol]: "done",
          [errorCol]: null,
          params: sql`jsonb_set(coalesce(${shots.params}, '{}'::jsonb), ${`{${creditsKey}}`}::text[], to_jsonb(${credits}::int))`,
          updatedAt: new Date(),
        })
        .where(eq(shots.id, id));
      return Response.json({ ok: true, promptText, credits });
    } catch (genErr) {
      const message = genErr instanceof Error ? genErr.message : "生成失败";
      await db
        .update(shots)
        .set({ [stateCol]: "failed", [errorCol]: message, updatedAt: new Date() })
        .where(eq(shots.id, id));
      const status =
        genErr instanceof Error && typeof (genErr as { status?: number }).status === "number"
          ? (genErr as unknown as { status: number }).status
          : 500;
      return Response.json({ error: message }, { status });
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
