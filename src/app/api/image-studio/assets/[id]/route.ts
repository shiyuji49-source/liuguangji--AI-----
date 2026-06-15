import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

// 改资产（重命名 / 改 kind / 导演标记）
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const a = await db.query.assets.findFirst({ where: eq(assets.id, id) });
    if (!a) throw new AuthError("资产不存在", 404);
    await requireProjectMember(a.projectId);
    const patch = z
      .object({
        atName: z.string().trim().min(1).max(80).optional(),
        kind: z.enum(["人物", "服装", "道具", "场景", "群演", "静帧", "视频"]).optional(),
        directorApproved: z.boolean().optional(),
      })
      .parse(await req.json());
    await db.update(assets).set(patch).where(eq(assets.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 删资产（仅删库行；文件留存无妨，逻辑 key 不再被引用）
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const a = await db.query.assets.findFirst({ where: eq(assets.id, id) });
    if (!a) return Response.json({ ok: true });
    await requireProjectMember(a.projectId);
    await db.delete(assets).where(eq(assets.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
