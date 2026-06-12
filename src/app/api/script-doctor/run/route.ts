import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, scriptEpisodes, projects } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { runScriptDoctor } from "@/lib/script-doctor/run";

export const maxDuration = 300;

// 剧本医生：对某集做诊断 / 影视化改写。仅导演（分镜前置是导演职责）。
export async function POST(req: Request) {
  try {
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        scriptId: z.string().uuid(),
        episodeNo: z.number().int().min(0),
        mode: z.enum(["diagnose", "revise"]),
        refine: z.string().max(2000).optional(),
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, scriptId, episodeNo, mode, refine } = parsed.data;

    const { user, project, projectRole } = await requireProjectMember(projectId);
    if (projectRole !== "director") throw new AuthError("仅导演可使用剧本医生", 403);

    const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
    if (!script || script.projectId !== projectId) throw new AuthError("剧本不存在", 404);
    const ep = await db.query.scriptEpisodes.findFirst({
      where: and(eq(scriptEpisodes.scriptId, scriptId), eq(scriptEpisodes.episodeNo, episodeNo)),
    });
    if (!ep) throw new AuthError("该集不存在", 404);

    const spec = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    const { text, credits } = await runScriptDoctor({
      userId: user.id,
      mode,
      episodeNo,
      episodeContent: ep.content,
      refine,
      spec: {
        tier: project.tier,
        aspect: spec?.aspect ?? "9:16",
        productionType: spec?.productionType ?? "真人",
        styleGenre: spec?.styleGenre ?? null,
      },
    });
    return Response.json({ text, credits });
  } catch (e) {
    return toErrorResponse(e);
  }
}
