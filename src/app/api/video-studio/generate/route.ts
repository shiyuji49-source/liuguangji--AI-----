import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { genTasks, videoSegments, assets } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { appsVisibleFor } from "@/apps/registry";
import { createVideoTask, type VideoResolution, type VideoRef } from "@/lib/ai/video";
import { getBuffer } from "@/lib/storage";
import { precheck, estimateVideoMaxCredits } from "@/lib/billing/charge";

export const maxDuration = 60; // 仅创建任务（异步），不等出片

// 提交视频生成任务（异步）：建 Seedance 任务 + gen_task，立即返回 taskId，由轮询端点推进。
export async function POST(req: Request) {
  try {
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        segmentId: z.string().uuid(),
        resolution: z.enum(["480p", "720p", "1080p"]),
        generateAudio: z.boolean().optional(),
        refAssetIds: z.array(z.string().uuid()).max(9).optional(), // 参考图(锁角色,Seedance2.0 ≤9张)
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { projectId, segmentId, resolution, generateAudio, refAssetIds } = parsed.data;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    if (!appsVisibleFor(projectRole).some((a) => a.key === "video-studio")) {
      throw new AuthError("无视频生成器权限", 403);
    }

    const seg = await db.query.videoSegments.findFirst({ where: eq(videoSegments.id, segmentId) });
    if (!seg || seg.projectId !== projectId) throw new AuthError("片段不存在", 404);
    if (!seg.prompt?.trim()) return Response.json({ error: "该片段还没有视频提示词" }, { status: 400 });

    // 并发守卫：已有运行中任务则不重复提交
    const segParams = (seg.params as { videoState?: string; videoTaskId?: string } | null) ?? {};
    if (segParams.videoState === "running" && segParams.videoTaskId) {
      return Response.json({ taskId: segParams.videoTaskId, already: true });
    }

    const duration = Math.min(15, Math.max(4, seg.durationSec ?? 5));
    await precheck(user.id, await estimateVideoMaxCredits(resolution as VideoResolution, duration));

    // 参考图（从资产墙选，锁角色一致性）→ 载入为 base64，role=reference_image（2.0 多模态参考）
    const refImages: VideoRef[] = [];
    for (const id of refAssetIds ?? []) {
      const a = await db.query.assets.findFirst({ where: eq(assets.id, id) });
      if (!a || a.projectId !== projectId || a.kind === "视频") continue;
      const buf = await getBuffer(a.filePath);
      if (buf) refImages.push({ base64: buf.buffer.toString("base64"), mime: buf.contentType, role: "reference_image" });
    }

    const providerTaskId = await createVideoTask({
      prompt: seg.prompt,
      resolution: resolution as VideoResolution,
      durationSec: duration,
      ratio: project.aspect || "adaptive",
      generateAudio,
      refImages: refImages.length ? refImages : undefined,
    });

    const [task] = await db
      .insert(genTasks)
      .values({
        projectId,
        appKey: "video",
        status: "running",
        input: { segmentId, resolution, duration, episodeNo: seg.episodeNo, label: seg.label },
        providerTaskId,
        createdBy: user.id,
      })
      .returning();

    await db
      .update(videoSegments)
      .set({ params: { ...segParams, videoState: "running", videoTaskId: task.id } })
      .where(eq(videoSegments.id, segmentId));

    return Response.json({ taskId: task.id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
