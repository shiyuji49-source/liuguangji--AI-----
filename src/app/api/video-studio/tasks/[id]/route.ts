import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { genTasks, assets, videoSegments } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { getVideoTask, type VideoResolution } from "@/lib/ai/video";
import { putFromUrl } from "@/lib/storage";
import { chargeVideo } from "@/lib/billing/charge";

export const maxDuration = 120; // 含转存视频文件

type Params = { params: Promise<{ id: string }> };

/**
 * 轮询并推进视频任务（前端每几秒打一次）：查方舟 → 成功则转存视频(防签名URL过期)→
 * 入资产墙(kind=视频)→按实际 usage 扣费 → 回写片段。幂等：已结束直接返回缓存。
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const task = await db.query.genTasks.findFirst({ where: eq(genTasks.id, id) });
    if (!task) throw new AuthError("任务不存在", 404);
    await requireProjectMember(task.projectId);

    // 已结束 → 返回缓存
    if (task.status === "succeeded") {
      const assetId = (task.resultAssetIds as string[] | null)?.[0];
      const asset = assetId ? await db.query.assets.findFirst({ where: eq(assets.id, assetId) }) : null;
      return Response.json({ status: "succeeded", asset, credits: task.costCredits });
    }
    if (task.status === "failed") return Response.json({ status: "failed", error: task.error });
    if (!task.providerTaskId) return Response.json({ status: task.status });

    const input = task.input as { segmentId?: string; resolution?: string; label?: string };
    const v = await getVideoTask(task.providerTaskId);

    if (v.status === "running" || v.status === "queued") {
      return Response.json({ status: "running" });
    }

    const segId = input.segmentId;
    const segParams = segId
      ? ((await db.query.videoSegments.findFirst({ where: eq(videoSegments.id, segId) }))?.params as
          | Record<string, unknown>
          | null) ?? {}
      : {};

    if (v.status === "succeeded" && v.videoUrl) {
      // 转存（签名 URL ~24h 过期）→ 入资产墙
      const put = await putFromUrl({ url: v.videoUrl, projectId: task.projectId, prefix: "video" });
      const [asset] = await db
        .insert(assets)
        .values({
          projectId: task.projectId,
          kind: "视频",
          atName: input.label?.slice(0, 60) || `片段视频`,
          filePath: put.key,
          meta: { taskId: task.id, providerTaskId: task.providerTaskId, resolution: input.resolution, usageTokens: v.usageTokens },
          createdBy: task.createdBy,
        })
        .returning();

      const { credits } = await chargeVideo({
        userId: task.createdBy,
        resolution: (input.resolution as VideoResolution) ?? "720p",
        usageTokens: v.usageTokens ?? 0,
        ref: { taskId: task.id, projectId: task.projectId },
      });

      await db
        .update(genTasks)
        .set({ status: "succeeded", resultAssetIds: [asset.id], costCredits: credits, updatedAt: new Date() })
        .where(eq(genTasks.id, task.id));
      if (segId)
        await db
          .update(videoSegments)
          .set({
            params: { ...segParams, videoState: "done", videoTaskId: task.id, videoAssetId: asset.id, videoKey: put.key },
          })
          .where(eq(videoSegments.id, segId));

      return Response.json({ status: "succeeded", asset, credits });
    }

    // failed / cancelled / expired
    await db
      .update(genTasks)
      .set({ status: "failed", error: v.error ?? v.status, updatedAt: new Date() })
      .where(eq(genTasks.id, task.id));
    if (segId)
      await db
        .update(videoSegments)
        .set({ params: { ...segParams, videoState: "failed", videoTaskId: task.id } })
        .where(eq(videoSegments.id, segId));
    return Response.json({ status: "failed", error: v.error ?? v.status });
  } catch (e) {
    return toErrorResponse(e);
  }
}
