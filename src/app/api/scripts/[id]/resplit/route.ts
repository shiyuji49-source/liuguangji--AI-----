import { asc, eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, scriptEpisodes, shots, videoSegments, promptItems } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadScript } from "@/lib/scripts/access";
import { splitScript } from "@/lib/scripts/split";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * 重新分集（分集器升级后修复旧数据，无需重新上传）：
 * 从已存集正文无损重建原文 → v2 重切 → 替换集；
 * 该剧本的分镜表/视频片段/集级提示词条目随之作废清空（资产条目保留）。
 */
export async function POST(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const script = await loadScript(id, { requireDirector: true });

    const eps = await db
      .select()
      .from(scriptEpisodes)
      .where(eq(scriptEpisodes.scriptId, id))
      .orderBy(asc(scriptEpisodes.episodeNo));
    if (eps.length === 0) return Response.json({ error: "该剧本没有集数据" }, { status: 400 });

    // 集按文档顺序存储（编号单调），拼接即原文
    const fullText = eps.map((e) => e.content).join("\n");
    const { episodes, warnings } = splitScript(fullText);
    if (episodes.length === 0) {
      return Response.json({ error: "重新分集失败，请检查剧本内容" }, { status: 422 });
    }

    await db.transaction(async (tx) => {
      await tx.delete(shots).where(eq(shots.scriptId, id));
      await tx.delete(videoSegments).where(eq(videoSegments.scriptId, id));
      await tx
        .delete(promptItems)
        .where(and(eq(promptItems.scriptId, id), isNotNull(promptItems.episodeNo)));
      await tx.delete(scriptEpisodes).where(eq(scriptEpisodes.scriptId, id));
      await tx.insert(scriptEpisodes).values(
        episodes.map((e) => ({
          scriptId: id,
          episodeNo: e.episodeNo,
          title: e.title,
          content: e.content,
          chars: e.chars,
        }))
      );
      await tx
        .update(scripts)
        .set({
          episodeCount: episodes.filter((e) => e.episodeNo > 0).length,
          totalChars: episodes.reduce((s, e) => s + e.chars, 0),
          warnings: warnings.length ? warnings : null,
        })
        .where(eq(scripts.id, script.id));
    });

    return Response.json({
      ok: true,
      episodeCount: episodes.filter((e) => e.episodeNo > 0).length,
      hasPreamble: episodes.some((e) => e.episodeNo === 0),
      warnings,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
