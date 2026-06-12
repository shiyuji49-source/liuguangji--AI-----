import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, scriptEpisodes, shots, promptItems, projects } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { buildShotlist } from "@/lib/prompt-studio/run";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";

export const maxDuration = 300;

// 阶段②：构建分镜表（shotlist）。replace=true 时清空该集已有镜重建（客户端需确认）。
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        scriptId: z.string().uuid(),
        episodeNo: z.number().int().positive(),
        replace: z.boolean().default(false),
        directorStyle: z.string().max(20).optional(),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, scriptId, episodeNo, replace, directorStyle } = parsed.data;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, "静帧"); // 分镜表属于分镜师/导演的工作区

    const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
    if (!script || script.projectId !== projectId) throw new AuthError("剧本不存在", 404);
    const ep = await db.query.scriptEpisodes.findFirst({
      where: and(eq(scriptEpisodes.scriptId, scriptId), eq(scriptEpisodes.episodeNo, episodeNo)),
    });
    if (!ep) throw new AuthError("该集不存在", 404);

    const scope = and(
      eq(shots.projectId, projectId),
      eq(shots.scriptId, scriptId),
      eq(shots.episodeNo, episodeNo)
    );
    const existing = await db.select({ id: shots.id }).from(shots).where(scope);
    if (existing.length > 0 && !replace) {
      return Response.json(
        { error: "该集已有分镜表。重新构建会清空本集所有镜（含已生成的提示词），请确认后重试。", needConfirm: true },
        { status: 409 }
      );
    }

    // 阶段①资产名供 assetRefs 对齐
    const assets = await db
      .select({ name: promptItems.name })
      .from(promptItems)
      .where(and(eq(promptItems.projectId, projectId), eq(promptItems.workspace, "资产")));

    const spec = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    const { shots: extracted, credits } = await buildShotlist({
      userId: user.id,
      episodeContent: ep.content,
      episodeNo,
      knownAssets: assets.map((a) => a.name),
      directorStyle,
      spec: {
        tier: project.tier,
        aspect: spec?.aspect ?? "9:16",
        productionType: spec?.productionType ?? "真人",
        styleGenre: spec?.styleGenre ?? null,
      },
    });
    if (extracted.length === 0) {
      return Response.json({ error: "未能构建出分镜表，请检查该集内容或重试" }, { status: 422 });
    }

    // 镜号去重防御（LLM 偶发重复编号会撞唯一索引）：按出现顺序顺延
    const seen = new Set<number>();
    const rows2insert = extracted.map((s, i) => {
      let no = s.shotNo || i + 1;
      while (seen.has(no)) no += 1;
      seen.add(no);
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
        params: directorStyle && directorStyle !== "标准" ? { directorStyle } : null,
        createdBy: user.id,
      };
    });
    // 事务：删旧+插新原子完成（并发重建不留半成品）
    await db.transaction(async (tx) => {
      if (existing.length > 0) await tx.delete(shots).where(scope);
      await tx.insert(shots).values(rows2insert);
    });

    const rows = await db.select().from(shots).where(scope).orderBy(asc(shots.shotNo));
    return Response.json({ shots: rows, credits });
  } catch (e) {
    return toErrorResponse(e);
  }
}
