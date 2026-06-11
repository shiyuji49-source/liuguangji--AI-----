import { z } from "zod";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { consumeToken } from "@/lib/tokens";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = z
    .object({ token: z.string().min(1), password: z.string().min(8, "密码至少 8 位").max(72) })
    .safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const email = await consumeToken(parsed.data.token, "password_reset");
  if (!email) return Response.json({ error: "链接无效或已过期，请重新申请" }, { status: 400 });

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.password, 10) })
    .where(eq(users.email, email));
  return Response.json({ ok: true, message: "密码已重置，请用新密码登录" });
}
