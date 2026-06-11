import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scriptEpisodes } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadScriptForDirector } from "@/lib/scripts/access";

type Params = { params: Promise<{ id: string; no: string }> };

// 单集正文（集列表预览用）
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id, no } = await params;
    await loadScriptForDirector(id);
    const episode = await db.query.scriptEpisodes.findFirst({
      where: and(eq(scriptEpisodes.scriptId, id), eq(scriptEpisodes.episodeNo, Number(no))),
    });
    if (!episode) return Response.json({ error: "该集不存在" }, { status: 404 });
    return Response.json({ episode });
  } catch (e) {
    return toErrorResponse(e);
  }
}
