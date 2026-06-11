import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, scriptEpisodes } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadScript } from "@/lib/scripts/access";

type Params = { params: Promise<{ id: string }> };

// 剧本详情：集列表（不含正文，正文按集取）。读=项目成员
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const script = await loadScript(id);
    const episodes = await db
      .select({
        episodeNo: scriptEpisodes.episodeNo,
        title: scriptEpisodes.title,
        chars: scriptEpisodes.chars,
      })
      .from(scriptEpisodes)
      .where(eq(scriptEpisodes.scriptId, id))
      .orderBy(asc(scriptEpisodes.episodeNo));
    return Response.json({ script, episodes });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await loadScript(id, { requireDirector: true });
    await db.delete(scriptEpisodes).where(eq(scriptEpisodes.scriptId, id));
    await db.delete(scripts).where(eq(scripts.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
