import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { promptItems } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

async function loadItem(id: string) {
  const item = await db.query.promptItems.findFirst({ where: eq(promptItems.id, id) });
  if (!item) throw new AuthError("条目不存在", 404);
  await requireProjectMember(item.projectId);
  return item;
}

// 手动编辑提示词文本
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await loadItem(id);
    const body = await req.json().catch(() => null);
    const parsed = z.object({ promptText: z.string().max(20000) }).safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    await db
      .update(promptItems)
      .set({ promptText: parsed.data.promptText, state: "done", updatedAt: new Date() })
      .where(eq(promptItems.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const item = await loadItem(id);
    await db
      .delete(promptItems)
      .where(and(eq(promptItems.id, id), eq(promptItems.projectId, item.projectId)));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
