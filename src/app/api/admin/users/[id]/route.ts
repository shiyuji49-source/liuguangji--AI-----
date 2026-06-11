import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        role: z.enum(["member", "director", "storyboard", "artist", "post", "admin"]).optional(),
        status: z.enum(["active", "banned"]).optional(),
      })
      .safeParse(body);
    if (!parsed.success || (!parsed.data.role && !parsed.data.status)) {
      return Response.json({ error: "参数不正确" }, { status: 400 });
    }
    if (id === admin.id && parsed.data.status === "banned") {
      return Response.json({ error: "不能封禁自己" }, { status: 400 });
    }

    await db
      .update(users)
      .set({
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      })
      .where(eq(users.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
