import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { genTasks, videoSegments, assets } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { appsVisibleFor } from "@/apps/registry";
import { createVideoTask, type VideoResolution, type VideoRef, type FrameRole } from "@/lib/ai/video";
import { getBuffer } from "@/lib/storage";
import { precheck, estimateVideoMaxCredits } from "@/lib/billing/charge";

export const maxDuration = 60; // 仅创建任务（异步），不等出片

/**
 * 提交视频生成任务（异步，Seedance 2.0）。两路：
 *  - 裸提示词（鎏光flow）：prompt + 时长/画幅/参考(带角色 首帧/尾帧/素材)。
 *  - 片段（兼容）：segmentId → 读片段提示词。
 * 建 Seedance 任务 + gen_task，立即返回 taskId，由 tasks/[id] 轮询推进（片段无关，已兼容裸提示词）。
 */
export async function POST(req: Request) {
  try {
    // 总开关（前期关闭防误点烧钱）：服务器设 VIDEO_GEN_ENABLED=true 开启
    if (process.env.VIDEO_GEN_ENABLED !== "true") {
      return Response.json({ error: "视频生成暂未开放（需在服务器 .env 开启 VIDEO_GEN_ENABLED=true）" }, { status: 403 });
    }
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        segmentId: z.string().uuid().optional(),
        prompt: z.string().min(1).max(4000).optional(),
        durationSec: z.number().int().min(4).max(15).optional(),
        ratio: z.string().max(12).optional(),
        resolution: z.enum(["480p", "720p", "1080p"]),
        generateAudio: z.boolean().optional(),
        atName: z.string().trim().max(80).optional(),
        refs: z
          .array(
            z.object({
              assetId: z.string().uuid(),
              role: z.enum(["first_frame", "last_frame", "reference_image"]),
            })
          )
          .max(9)
          .optional(),
        refAssetIds: z.array(z.string().uuid()).max(9).optional(), // 旧：reference_image
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { projectId, segmentId, resolution, generateAudio, ratio, atName } = parsed.data;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    if (!appsVisibleFor(projectRole).some((a) => a.key === "liuguang-flow")) {
      throw new AuthError("无视频生成器权限", 403);
    }

    let prompt = parsed.data.prompt?.trim() ?? "";
    let duration = parsed.data.durationSec ?? 5;
    let label = atName?.trim() || (prompt ? prompt.slice(0, 20) : "视频");
    const refSpec: { assetId: string; role: FrameRole }[] = (parsed.data.refs ?? []).map((r) => ({
      assetId: r.assetId,
      role: r.role,
    }));
    for (const id of parsed.data.refAssetIds ?? []) refSpec.push({ assetId: id, role: "reference_image" });

    let seg: typeof videoSegments.$inferSelect | undefined;
    if (segmentId) {
      seg = await db.query.videoSegments.findFirst({ where: eq(videoSegments.id, segmentId) });
      if (!seg || seg.projectId !== projectId) throw new AuthError("片段不存在", 404);
      if (!seg.prompt?.trim()) return Response.json({ error: "该片段还没有视频提示词" }, { status: 400 });
      prompt = seg.prompt;
      duration = seg.durationSec ?? 5;
      label = seg.label || `片段${seg.segmentNo}`;
      const sp = (seg.params as { videoState?: string; videoTaskId?: string } | null) ?? {};
      if (sp.videoState === "running" && sp.videoTaskId) return Response.json({ taskId: sp.videoTaskId, already: true });
    }
    if (!prompt) return Response.json({ error: "缺少提示词" }, { status: 400 });
    duration = Math.min(15, Math.max(4, duration));

    await precheck(user.id, await estimateVideoMaxCredits(resolution as VideoResolution, duration));

    // 载入参考图（带角色直传）。⚠️Seedance 三场景互斥（首尾帧 / 图生视频 / 多模态参考），前端负责不混用。
    const refImages: VideoRef[] = [];
    for (const r of refSpec) {
      const a = await db.query.assets.findFirst({ where: eq(assets.id, r.assetId) });
      if (!a || a.projectId !== projectId || a.kind === "视频") continue;
      const buf = await getBuffer(a.filePath);
      if (buf) refImages.push({ base64: buf.buffer.toString("base64"), mime: buf.contentType, role: r.role });
    }

    const providerTaskId = await createVideoTask({
      prompt,
      resolution: resolution as VideoResolution,
      durationSec: duration,
      ratio: ratio || project.aspect || "adaptive",
      generateAudio,
      refImages: refImages.length ? refImages : undefined,
    });

    const [task] = await db
      .insert(genTasks)
      .values({
        projectId,
        appKey: "video",
        status: "running",
        input: { segmentId, resolution, duration, label },
        providerTaskId,
        createdBy: user.id,
      })
      .returning();

    if (segmentId && seg) {
      const sp = (seg.params as Record<string, unknown> | null) ?? {};
      await db
        .update(videoSegments)
        .set({ params: { ...sp, videoState: "running", videoTaskId: task.id } })
        .where(eq(videoSegments.id, segmentId));
    }

    return Response.json({ taskId: task.id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
