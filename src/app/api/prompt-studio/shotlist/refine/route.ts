import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, videoSegments, projects } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";
import { refineShotlist } from "@/lib/prompt-studio/run";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";

export const maxDuration = 300;

// 底部对话工具：按用户修改建议修订本集分镜表。
// 未变动的镜（画面/景别/运镜/台词一致）保留已生成的静帧/视频提示词；变动的镜清空重来。
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        scriptId: z.string().uuid(),
        episodeNo: z.number().int().min(0),
        suggestion: z.string().min(2).max(2000).optional(),
        // 场级风格模式：只重设计该场，其他场原样
        sceneLabel: z.string().max(60).optional(),
        style: z.string().max(20).optional(),
      })
      .refine((v) => v.suggestion || (v.sceneLabel && v.style), { message: "缺少建议或场级风格参数" })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, scriptId, episodeNo, sceneLabel, style } = parsed.data;
    const suggestion =
      parsed.data.suggestion ??
      `只把场「${sceneLabel}」的全部镜头按导演风格预设「${style}」重新设计：运镜/景别/构图/节奏/光色全部按该预设执行，summary 写明每镜的风格执行点；该场镜头数量可按预设需要增减；其他场的镜一字不改、原样保留。`;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, "静帧");

    const scope = and(
      eq(shots.projectId, projectId),
      eq(shots.scriptId, scriptId),
      eq(shots.episodeNo, episodeNo)
    );
    const current = await db.select().from(shots).where(scope).orderBy(asc(shots.shotNo));
    if (current.length === 0) {
      return Response.json({ error: "本集还没有分镜表，先构建再提修改建议" }, { status: 400 });
    }

    const spec = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    const directorStyle = (current[0].params as { directorStyle?: string } | null)?.directorStyle;
    // 场→风格映射：沿用各场已有风格；场级模式下目标场覆盖为新风格
    const sceneStyleMap = new Map<string, string | undefined>();
    for (const c of current) {
      if (!sceneStyleMap.has(c.sceneLabel)) {
        sceneStyleMap.set(c.sceneLabel, (c.params as { directorStyle?: string } | null)?.directorStyle);
      }
    }
    if (sceneLabel && style) sceneStyleMap.set(sceneLabel, style === "标准" ? undefined : style);
    const { shots: revised, credits } = await refineShotlist({
      userId: user.id,
      suggestion,
      episodeNo,
      directorStyle,
      currentShots: current.map((s) => ({
        shotNo: s.shotNo,
        sceneLabel: s.sceneLabel,
        shotFunction: s.shotFunction,
        summary: s.summary,
        shotType: s.shotType,
        cameraMove: s.cameraMove,
        dialogue: s.dialogue,
        durationSec: s.durationSec,
        assetRefs: (s.assetRefs as string[] | null) ?? [],
        needStill: s.needStill,
      })),
      spec: {
        tier: project.tier,
        aspect: spec?.aspect ?? "9:16",
        productionType: spec?.productionType ?? "真人",
        styleGenre: spec?.styleGenre ?? null,
      },
    });
    if (revised.length === 0) {
      return Response.json({ error: "修订失败，请换个说法重试" }, { status: 422 });
    }

    // 内容指纹：完全一致的镜保留已生成的静帧/视频提示词
    const fingerprint = (x: {
      summary: string;
      shotType: string;
      cameraMove: string;
      dialogue: string;
    }) => `${x.summary}|${x.shotType}|${x.cameraMove}|${x.dialogue}`;
    const oldByFp = new Map(current.map((s) => [fingerprint(s), s]));

    const seen = new Set<number>();
    const rows2insert = revised.map((s, i) => {
      let no = s.shotNo || i + 1;
      while (seen.has(no)) no += 1;
      seen.add(no);
      const old = oldByFp.get(fingerprint(s));
      return {
        projectId,
        scriptId,
        episodeNo,
        shotNo: no,
        sceneLabel: s.sceneLabel,
        shotFunction: s.shotFunction,
        summary: s.summary,
        shotType: s.shotType,
        cameraMove: s.cameraMove,
        dialogue: s.dialogue,
        durationSec: s.durationSec,
        assetRefs: s.assetRefs,
        needStill: s.needStill,
        // 未变动的镜：迁移已生成的提示词与状态
        stillPrompt: old?.stillPrompt ?? null,
        stillState: old?.stillPrompt ? old.stillState : ("empty" as const),
        videoPrompt: old?.videoPrompt ?? null,
        videoState: old?.videoPrompt ? old.videoState : ("empty" as const),
        params: (() => {
          const st = sceneStyleMap.has(s.sceneLabel)
            ? sceneStyleMap.get(s.sceneLabel)
            : directorStyle;
          return st ? { directorStyle: st } : null;
        })(),
        createdBy: user.id,
      };
    });

    await db.transaction(async (tx) => {
      // 分镜变了 → 旧片段划分作废
      await tx
        .delete(videoSegments)
        .where(
          and(
            eq(videoSegments.projectId, projectId),
            eq(videoSegments.scriptId, scriptId),
            eq(videoSegments.episodeNo, episodeNo)
          )
        );
      await tx.delete(shots).where(scope);
      await tx.insert(shots).values(rows2insert);
    });

    const rows = await db.select().from(shots).where(scope).orderBy(asc(shots.shotNo));
    const kept = rows2insert.filter((r) => r.stillPrompt || r.videoPrompt).length;
    return Response.json({ shots: rows, credits, kept });
  } catch (e) {
    return toErrorResponse(e);
  }
}
