import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { genTasks, assets } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { appsVisibleFor } from "@/apps/registry";
import { generateImage, type ImageEngine, type ImageTier } from "@/lib/ai/image";
import { putBase64, getBuffer } from "@/lib/storage";
import { precheck, chargeImage, estimateImageMaxCredits } from "@/lib/billing/charge";

export const maxDuration = 300; // 出图同步 20-40s，留足

export async function POST(req: Request) {
  try {
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        engine: z.enum(["gpt", "nano"]),
        prompt: z.string().min(1).max(32000),
        tier: z.enum(["1k", "2k", "4k"]),
        kind: z.enum(["人物", "服装", "道具", "场景", "群演", "静帧", "视频"]),
        atName: z.string().trim().max(80).optional(),
        aspectRatio: z.string().max(10).optional(),
        quality: z.enum(["low", "medium", "high"]).optional(),
        n: z.number().int().min(1).max(4).optional(),
        refAssetIds: z.array(z.string().uuid()).max(8).optional(),
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { projectId, engine, prompt, tier, kind, atName, n, refAssetIds } = parsed.data;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    if (!appsVisibleFor(projectRole).some((a) => a.key === "liuguang-flow")) {
      throw new AuthError("无图像生成器权限", 403);
    }

    const model = engine === "nano" ? "gemini-3-pro-image" : "gpt-image-2";
    const count = n ?? 1;
    const aspectRatio = parsed.data.aspectRatio || project.aspect || "1:1";

    // 预检（确定单价，估=实扣）
    await precheck(user.id, await estimateImageMaxCredits(model, tier as ImageTier, count));

    // 落任务
    const [task] = await db
      .insert(genTasks)
      .values({
        projectId,
        appKey: "image",
        status: "running",
        input: { engine, prompt, tier, kind, aspectRatio, n: count, refAssetIds: refAssetIds ?? [] },
        createdBy: user.id,
      })
      .returning();

    try {
      // 取参考图（从资产墙已有图作角色/构图锚）
      const refImages: { base64: string; mime: string }[] = [];
      for (const id of refAssetIds ?? []) {
        const a = await db.query.assets.findFirst({ where: eq(assets.id, id) });
        if (!a || a.projectId !== projectId) continue;
        const buf = await getBuffer(a.filePath);
        if (buf) refImages.push({ base64: buf.buffer.toString("base64"), mime: buf.contentType });
      }

      const result = await generateImage({
        engine: engine as ImageEngine,
        prompt,
        tier: tier as ImageTier,
        aspectRatio,
        quality: parsed.data.quality,
        refImages: refImages.length ? refImages : undefined,
        n: count,
      });

      // 落存储 + 入资产墙
      const created: string[] = [];
      const rows: typeof assets.$inferSelect[] = [];
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        const put = await putBase64({
          data: img.base64,
          contentType: img.contentType,
          projectId,
          prefix: engine,
        });
        const name =
          (atName?.trim() || prompt.slice(0, 20)) + (result.images.length > 1 ? `-${i + 1}` : "");
        const [row] = await db
          .insert(assets)
          .values({
            projectId,
            kind,
            atName: name,
            filePath: put.key,
            thumbPath: put.key, // MVP：缩略图暂用原图
            meta: { prompt, engine, tier, model: result.model, taskId: task.id, usage: result.usage },
            createdBy: user.id,
          })
          .returning();
        created.push(row.id);
        rows.push(row);
      }

      const { credits } = await chargeImage({
        userId: user.id,
        model,
        tier: tier as ImageTier,
        n: result.images.length,
        ref: { taskId: task.id, projectId },
      });

      await db
        .update(genTasks)
        .set({ status: "succeeded", resultAssetIds: created, costCredits: credits, updatedAt: new Date() })
        .where(eq(genTasks.id, task.id));

      return Response.json({ assets: rows, credits, taskId: task.id });
    } catch (e) {
      await db
        .update(genTasks)
        .set({ status: "failed", error: e instanceof Error ? e.message : String(e), updatedAt: new Date() })
        .where(eq(genTasks.id, task.id));
      throw e; // 失败不扣费（charge 在成功后）
    }
  } catch (e) {
    return toErrorResponse(e);
  }
}
