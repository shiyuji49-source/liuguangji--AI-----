import { z } from "zod";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, videoSegments, scriptEpisodes, promptItems, projects } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadSegmentChecked } from "@/lib/prompt-studio/access";
import { generateSegmentPrompt } from "@/lib/prompt-studio/run";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// 阶段④：为片段生成一条多镜合并的 Seedance 视频提示词
export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const refine = z.object({ refine: z.string().max(2000).optional() }).safeParse(body);
    const refineText = refine.success ? refine.data.refine : undefined;

    const { segment, user, project } = await loadSegmentChecked(id);

    // 并发守卫：生成中拒绝（允许 done/failed 重新生成）
    const claimed = await db
      .update(videoSegments)
      .set({ state: "generating", updatedAt: new Date() })
      .where(and(eq(videoSegments.id, id), ne(videoSegments.state, "generating")))
      .returning({ id: videoSegments.id });
    if (claimed.length === 0) {
      return Response.json({ error: "该片段正在生成中，请勿重复点击" }, { status: 409 });
    }

    try {
      const shotNos = (segment.shotNos as number[]) ?? [];
      const memberShots = await db
        .select()
        .from(shots)
        .where(
          and(
            eq(shots.projectId, segment.projectId),
            eq(shots.scriptId, segment.scriptId),
            eq(shots.episodeNo, segment.episodeNo),
            inArray(shots.shotNo, shotNos)
          )
        )
        .orderBy(asc(shots.shotNo));
      if (memberShots.length === 0) {
        throw Object.assign(new Error("片段内的镜在分镜表中已不存在，请重新划分片段"), { status: 422 });
      }

      const ep = await db.query.scriptEpisodes.findFirst({
        where: and(
          eq(scriptEpisodes.scriptId, segment.scriptId),
          eq(scriptEpisodes.episodeNo, segment.episodeNo)
        ),
      });

      // 成员镜关联资产的并集 → 档案
      const refs = [...new Set(memberShots.flatMap((s) => (s.assetRefs as string[] | null) ?? []))];
      const assetBriefs =
        refs.length > 0
          ? await db
              .select({ name: promptItems.name, brief: promptItems.brief })
              .from(promptItems)
              .where(and(eq(promptItems.projectId, segment.projectId), inArray(promptItems.name, refs)))
          : [];

      const spec = await db.query.projects.findFirst({ where: eq(projects.id, segment.projectId) });
      const { promptText, credits } = await generateSegmentPrompt({
        userId: user.id,
        segment: {
          segmentNo: segment.segmentNo,
          label: segment.label,
          shotNos,
          durationSec: segment.durationSec,
        },
        shots: memberShots.map((s) => ({
          shotNo: s.shotNo,
          sceneLabel: s.sceneLabel,
          summary: s.summary,
          shotType: s.shotType,
          cameraMove: s.cameraMove,
          dialogue: s.dialogue,
          durationSec: s.durationSec,
          assetRefs: (s.assetRefs as string[] | null) ?? [],
          episodeNo: s.episodeNo,
          needStill: s.needStill,
        })),
        stillPrompts: memberShots
          .filter((s) => s.stillPrompt)
          .map((s) => ({ shotNo: s.shotNo, prompt: s.stillPrompt! })),
        episodeContent: ep?.content,
        assetBriefs,
        directorStyle: (memberShots[0]?.params as { directorStyle?: string } | null)?.directorStyle,
        refine: refineText,
        spec: {
          tier: project.tier,
          aspect: spec?.aspect ?? "9:16",
          productionType: spec?.productionType ?? "真人",
          styleGenre: spec?.styleGenre ?? null,
        },
      });

      await db
        .update(videoSegments)
        .set({
          prompt: promptText,
          state: "done",
          error: null,
          params: { credits },
          updatedAt: new Date(),
        })
        .where(eq(videoSegments.id, id));
      return Response.json({ ok: true, promptText, credits });
    } catch (genErr) {
      const message = genErr instanceof Error ? genErr.message : "生成失败";
      await db
        .update(videoSegments)
        .set({ state: "failed", error: message, updatedAt: new Date() })
        .where(eq(videoSegments.id, id));
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
