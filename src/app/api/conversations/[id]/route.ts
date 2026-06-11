import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { requireUser, AuthError, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

async function ownConversation(id: string, userId: string) {
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!conv) throw new AuthError("会话不存在", 404);
  if (conv.createdBy !== userId) throw new AuthError("无权访问该会话", 403);
  return conv;
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await ownConversation(id, user.id);
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.createdBy, user.id)));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    await ownConversation(id, user.id);
    const body = await req.json().catch(() => null);
    const parsed = z.object({ title: z.string().trim().min(1).max(40) }).safeParse(body);
    if (!parsed.success) return Response.json({ error: "标题不正确" }, { status: 400 });
    await db.update(conversations).set({ title: parsed.data.title }).where(eq(conversations.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
