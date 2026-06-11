import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, videoSegments, scripts, projects } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { planSegments } from "@/lib/prompt-studio/run";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";

export const maxDuration = 300;

// 某集的视频片段列表
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
    assertWorkspaceAccess(projectRole, "视频");

    const rows = await db
      .select()
      .from(videoSegments)
      .where(
        and(
          eq(videoSegments.projectId, projectId),
          eq(videoSegments.scriptId, scriptId),
          eq(videoSegments.episodeNo, Number(episodeNo))
        )
      )
      .orderBy(asc(videoSegments.segmentNo));
    return Response.json({ segments: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 划分片段：把整集分镜表按 skill 规则分组（多镜合并 ≤15s）。replace=true 清空重建。
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        scriptId: z.string().uuid(),
        episodeNo: z.number().int().positive(),
        replace: z.boolean().default(false),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, scriptId, episodeNo, replace } = parsed.data;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, "视频");
    const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
    if (!script || script.projectId !== projectId) throw new AuthError("剧本不存在", 404);

    const shotRows = await db
      .select()
      .from(shots)
      .where(and(eq(shots.projectId, projectId), eq(shots.scriptId, scriptId), eq(shots.episodeNo, episodeNo)))
      .orderBy(asc(shots.shotNo));
    if (shotRows.length === 0) {
      return Response.json({ error: "本集还没有分镜表，先到「分镜表」阶段构建" }, { status: 400 });
    }

    const scope = and(
      eq(videoSegments.projectId, projectId),
      eq(videoSegments.scriptId, scriptId),
      eq(videoSegments.episodeNo, episodeNo)
    );
    const existing = await db.select({ id: videoSegments.id }).from(videoSegments).where(scope);
    if (existing.length > 0 && !replace) {
      return Response.json(
        { error: "该集已划分过片段。重新划分会清空本集所有片段（含已生成的提示词），请确认后重试。", needConfirm: true },
        { status: 409 }
      );
    }

    const spec = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    const { segments, credits } = await planSegments({
      userId: user.id,
      episodeNo,
      shots: shotRows.map((s) => ({
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
      spec: {
        tier: project.tier,
        aspect: spec?.aspect ?? "9:16",
        productionType: spec?.productionType ?? "真人",
        styleGenre: spec?.styleGenre ?? null,
      },
    });
    if (segments.length === 0) {
      return Response.json({ error: "未能划分出片段，请重试" }, { status: 422 });
    }

    await db.transaction(async (tx) => {
      if (existing.length > 0) await tx.delete(videoSegments).where(scope);
      await tx.insert(videoSegments).values(
        segments.map((s) => ({
          projectId,
          scriptId,
          episodeNo,
          segmentNo: s.segmentNo,
          label: s.label,
          shotNos: s.shotNos,
          durationSec: s.durationSec,
          createdBy: user.id,
        }))
      );
    });

    const rows = await db.select().from(videoSegments).where(scope).orderBy(asc(videoSegments.segmentNo));
    return Response.json({ segments: rows, credits });
  } catch (e) {
    return toErrorResponse(e);
  }
}
