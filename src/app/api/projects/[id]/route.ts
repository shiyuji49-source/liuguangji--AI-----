import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

// 编辑项目规格（仅项目导演）
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireProjectMember(id, ["director"]);
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        tier: z.enum(["B", "A", "S"]).optional(),
        aspect: z.string().max(20).optional(),
        productionType: z.enum(["真人", "3D", "2D"]).optional(),
        styleGenre: z.string().trim().max(40).nullable().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });

    const patch = parsed.data;
    if (Object.keys(patch).length === 0) return Response.json({ error: "无可更新字段" }, { status: 400 });
    await db
      .update(projects)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
        ...(patch.aspect !== undefined ? { aspect: patch.aspect } : {}),
        ...(patch.productionType !== undefined ? { productionType: patch.productionType } : {}),
        ...(patch.styleGenre !== undefined ? { styleGenre: patch.styleGenre || null } : {}),
      })
      .where(eq(projects.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
