import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scripts, scriptEpisodes, promptItems } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { extractItems, type Workspace } from "@/lib/prompt-studio/run";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        workspace: z.enum(["资产", "静帧", "视频"]),
        scriptId: z.string().uuid(),
        episodeNo: z.number().int().positive().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, workspace, scriptId, episodeNo } = parsed.data;

    const { user, projectRole } = await requireProjectMember(projectId);
    assertWorkspaceAccess(projectRole, workspace as Workspace);

    const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
    if (!script || script.projectId !== projectId) throw new AuthError("剧本不存在", 404);

    // 取剧本文本：资产=全剧；静帧/视频=单集
    let scriptText: string;
    let episodeLabel: string | undefined;
    if (workspace === "资产") {
      const eps = await db
        .select()
        .from(scriptEpisodes)
        .where(eq(scriptEpisodes.scriptId, scriptId))
        .orderBy(asc(scriptEpisodes.episodeNo));
      scriptText = eps.map((e) => `=== 第 ${e.episodeNo} 集 ===\n${e.content}`).join("\n\n");
    } else {
      if (!episodeNo) return Response.json({ error: "请选择集" }, { status: 400 });
      const ep = await db.query.scriptEpisodes.findFirst({
        where: and(eq(scriptEpisodes.scriptId, scriptId), eq(scriptEpisodes.episodeNo, episodeNo)),
      });
      if (!ep) throw new AuthError("该集不存在", 404);
      scriptText = ep.content;
      episodeLabel = `第 ${episodeNo} 集`;
    }
    if (!scriptText.trim()) return Response.json({ error: "剧本内容为空" }, { status: 400 });

    const { items: extracted } = await extractItems({
      userId: user.id,
      workspace: workspace as Workspace,
      scriptText,
      episodeLabel,
    });
    if (extracted.length === 0) {
      return Response.json({ error: "未能从剧本提取到条目，请检查剧本内容" }, { status: 422 });
    }

    // 非破坏式：同范围已存在的 name 跳过插入（保留已生成的卡），但补写出现集数标注
    const scopeWhere = [
      eq(promptItems.projectId, projectId),
      eq(promptItems.workspace, workspace as Workspace),
    ];
    if (episodeNo) scopeWhere.push(eq(promptItems.episodeNo, episodeNo));
    const existing = await db
      .select({ id: promptItems.id, name: promptItems.name, episodes: promptItems.episodes })
      .from(promptItems)
      .where(and(...scopeWhere));
    const existingByName = new Map(existing.map((e) => [e.name, e]));

    const toInsert = extracted
      .filter((x) => !existingByName.has(x.name))
      .map((x, i) => ({
        projectId,
        workspace: workspace as Workspace,
        kind: x.kind,
        name: x.name,
        brief: x.brief,
        episodes: x.episodes.length ? x.episodes : null,
        episodeNo: episodeNo ?? null,
        scriptId,
        sortIndex: existing.length + i,
        createdBy: user.id,
      }));
    if (toInsert.length > 0) await db.insert(promptItems).values(toInsert);

    // 已存在条目：把新集数并入旧集数（去重排序），不覆盖——避免单集重提取丢失累积标注
    for (const x of extracted) {
      const row = existingByName.get(x.name);
      if (row && x.episodes.length) {
        const old = Array.isArray(row.episodes) ? (row.episodes as number[]) : [];
        const merged = [...new Set([...old, ...x.episodes])].sort((a, b) => a - b);
        if (merged.length !== old.length) {
          await db.update(promptItems).set({ episodes: merged }).where(eq(promptItems.id, row.id));
        }
      }
    }

    const rows = await listScopeItems(projectId, workspace as Workspace, episodeNo);
    return Response.json({ items: rows, added: toInsert.length });
  } catch (e) {
    return toErrorResponse(e);
  }
}

async function listScopeItems(projectId: string, workspace: Workspace, episodeNo?: number) {
  const where = [eq(promptItems.projectId, projectId), eq(promptItems.workspace, workspace)];
  if (episodeNo) where.push(eq(promptItems.episodeNo, episodeNo));
  return db
    .select()
    .from(promptItems)
    .where(and(...where))
    .orderBy(asc(promptItems.sortIndex), asc(promptItems.createdAt));
}
