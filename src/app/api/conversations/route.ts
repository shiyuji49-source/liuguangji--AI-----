import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { requireUser, requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { getApp, isAppLive, appsVisibleFor, promptModesFor, type PromptMode } from "@/apps/registry";

// 会话列表（仅自己的：会话隔离）
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const appKey = url.searchParams.get("appKey");
    const mode = url.searchParams.get("mode");
    if (!projectId || !appKey) return Response.json({ error: "缺少参数" }, { status: 400 });

    const where = [
      eq(conversations.createdBy, user.id),
      eq(conversations.projectId, projectId),
      eq(conversations.appKey, appKey),
    ];
    if (mode) where.push(eq(conversations.mode, mode));
    else if (appKey === "script-doctor") where.push(isNull(conversations.mode));

    const rows = await db
      .select()
      .from(conversations)
      .where(and(...where))
      .orderBy(desc(conversations.createdAt))
      .limit(100);
    return Response.json({ conversations: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        appKey: z.string(),
        mode: z.string().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { projectId, appKey, mode } = parsed.data;

    const app = getApp(appKey);
    if (!app || !isAppLive(app)) throw new AuthError("应用不存在或未开放", 404);
    const { projectRole } = await requireProjectMember(projectId);
    if (!appsVisibleFor(projectRole).some((a) => a.key === app.key)) {
      throw new AuthError("当前角色无权使用该应用", 403);
    }
    if (app.key === "prompt-studio") {
      if (!mode || !promptModesFor(projectRole).includes(mode as PromptMode)) {
        throw new AuthError("当前角色无权使用该工作区", 403);
      }
    }

    const [conv] = await db
      .insert(conversations)
      .values({ projectId, appKey, mode: mode ?? null, createdBy: user.id })
      .returning();
    return Response.json({ conversation: conv });
  } catch (e) {
    return toErrorResponse(e);
  }
}
