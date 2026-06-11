import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scriptEpisodes, scripts, shots, videoSegments } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";

// 分集总览：每集的镜数/静帧进度/片段进度（②③④集列表侧栏）
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const scriptId = url.searchParams.get("scriptId");
    if (!projectId || !scriptId) return Response.json({ error: "缺少参数" }, { status: 400 });
    await requireProjectMember(projectId);
    const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
    if (!script || script.projectId !== projectId) throw new AuthError("剧本不存在", 404);

    const [episodes, shotAgg, segAgg] = await Promise.all([
      db
        .select({
          episodeNo: scriptEpisodes.episodeNo,
          title: scriptEpisodes.title,
          chars: scriptEpisodes.chars,
        })
        .from(scriptEpisodes)
        .where(eq(scriptEpisodes.scriptId, scriptId))
        .orderBy(asc(scriptEpisodes.episodeNo)),
      db
        .select({
          episodeNo: shots.episodeNo,
          shotCount: sql<number>`count(*)::int`,
          needStill: sql<number>`count(*) filter (where ${shots.needStill})::int`,
          stillDone: sql<number>`count(*) filter (where ${shots.stillState} = 'done')::int`,
        })
        .from(shots)
        .where(and(eq(shots.projectId, projectId), eq(shots.scriptId, scriptId)))
        .groupBy(shots.episodeNo),
      db
        .select({
          episodeNo: videoSegments.episodeNo,
          segCount: sql<number>`count(*)::int`,
          segDone: sql<number>`count(*) filter (where ${videoSegments.state} = 'done')::int`,
        })
        .from(videoSegments)
        .where(and(eq(videoSegments.projectId, projectId), eq(videoSegments.scriptId, scriptId)))
        .groupBy(videoSegments.episodeNo),
    ]);

    const shotMap = new Map(shotAgg.map((r) => [r.episodeNo, r]));
    const segMap = new Map(segAgg.map((r) => [r.episodeNo, r]));
    return Response.json({
      episodes: episodes.map((e) => ({
        ...e,
        shotCount: shotMap.get(e.episodeNo)?.shotCount ?? 0,
        needStill: shotMap.get(e.episodeNo)?.needStill ?? 0,
        stillDone: shotMap.get(e.episodeNo)?.stillDone ?? 0,
        segCount: segMap.get(e.episodeNo)?.segCount ?? 0,
        segDone: segMap.get(e.episodeNo)?.segDone ?? 0,
      })),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
