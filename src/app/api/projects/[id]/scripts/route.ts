import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, scriptEpisodes } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";
import { extractTextFromFile } from "@/lib/scripts/extract";
import { splitScript } from "@/lib/scripts/split";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

// 项目剧本列表（剧本医生=导演专用，与应用可见性一致）
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireProjectMember(id, ["director"]);
    const rows = await db
      .select()
      .from(scripts)
      .where(eq(scripts.projectId, id))
      .orderBy(desc(scripts.createdAt));
    return Response.json({ scripts: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 上传剧本：抽文本 → 分集 → 入库（剧本住在项目里，上传一次贯穿全程）
export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { user } = await requireProjectMember(id, ["director"]);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "缺少文件" }, { status: 400 });

    const { name, text, truncated } = await extractTextFromFile(file);
    const { episodes, warnings } = splitScript(text);
    if (truncated) warnings.unshift("文件过长，已截断到 80 万字。");

    const title = name.replace(/\.(docx|pdf|txt|md)$/i, "").slice(0, 60) || "未命名剧本";
    const [script] = await db
      .insert(scripts)
      .values({
        projectId: id,
        title,
        filename: name,
        episodeCount: episodes.length,
        totalChars: episodes.reduce((s, e) => s + e.chars, 0),
        warnings: warnings.length ? warnings : null,
        createdBy: user.id,
      })
      .returning();
    await db.insert(scriptEpisodes).values(
      episodes.map((e) => ({
        scriptId: script.id,
        episodeNo: e.episodeNo,
        title: e.title,
        content: e.content,
        chars: e.chars,
      }))
    );

    return Response.json({
      script,
      episodes: episodes.map(({ episodeNo, title: t, chars }) => ({ episodeNo, title: t, chars })),
      warnings,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
