import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createToken, recentlyIssued } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "邮箱格式不正确" }, { status: 400 });
  const { email } = parsed.data;

  // 不泄露账号是否存在：无论如何都返回成功
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (user && !(await recentlyIssued(email, "password_reset", 60_000))) {
    const token = await createToken(email, "password_reset", 3600_000);
    await sendPasswordResetEmail(email, token);
  }
  return Response.json({ ok: true, message: "若该邮箱已注册，重置链接已发送" });
}
