import { z } from "zod";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireUser, toErrorResponse } from "@/lib/auth-helpers";

// 修改自己的登录密码：校验旧密码 → 写新密码哈希
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const parsed = z
      .object({
        currentPassword: z.string().min(1, "请输入当前密码"),
        newPassword: z.string().min(8, "新密码至少 8 位").max(72),
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { currentPassword, newPassword } = parsed.data;

    const row = await db.query.users.findFirst({ where: eq(users.id, me.id) });
    if (!row) return Response.json({ error: "用户不存在" }, { status: 404 });
    if (!(await bcrypt.compare(currentPassword, row.passwordHash))) {
      return Response.json({ error: "当前密码不正确" }, { status: 400 });
    }
    if (await bcrypt.compare(newPassword, row.passwordHash)) {
      return Response.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
    }
    await db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(newPassword, 10) })
      .where(eq(users.id, me.id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
