import { z } from "zod";
import { eq, and, isNull, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, wallets, verificationTokens } from "@/lib/db/schema";
import { createToken } from "@/lib/tokens";
import { sendVerificationEmail, emailConfigured } from "@/lib/email";
import { smsEnabled } from "@/lib/sms";

const emailSchema = z.object({
  kind: z.literal("email"),
  name: z.string().trim().min(1, "请填写姓名").max(50),
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位").max(72),
  agree: z.literal(true, { message: "请先同意用户协议与隐私政策" }),
});

const phoneSchema = z.object({
  kind: z.literal("phone"),
  name: z.string().trim().min(1, "请填写姓名").max(50),
  phone: z.string().regex(/^1\d{10}$/, "手机号格式不正确"),
  code: z.string().length(6, "验证码为 6 位"),
  password: z.string().min(8, "密码至少 8 位").max(72),
  agree: z.literal(true, { message: "请先同意用户协议与隐私政策" }),
});

export async function POST(req: Request) {
  // 内测开关：ALLOW_REGISTRATION=false 时关闭公开注册（由 admin 后台建号）
  if (process.env.ALLOW_REGISTRATION === "false") {
    return Response.json({ error: "内测期间未开放注册，请联系管理员开通账号" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = z.discriminatedUnion("kind", [emailSchema, phoneSchema]).safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const input = parsed.data;

  if (input.kind === "email") {
    const exists = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (exists) return Response.json({ error: "该邮箱已注册" }, { status: 409 });

    // 未配置 SMTP（内测/无邮件基建）时自动免验证——否则收不到验证邮件就永远登不进
    const autoVerify = !emailConfigured();
    const [user] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 10),
        emailVerifiedAt: autoVerify ? new Date() : null,
      })
      .returning();
    await db.insert(wallets).values({ userId: user.id }).onConflictDoNothing();

    if (autoVerify) {
      return Response.json({ ok: true, message: "注册成功，可直接登录" });
    }
    const token = await createToken(input.email, "email_verify", 24 * 3600_000);
    await sendVerificationEmail(input.email, token);
    return Response.json({ ok: true, message: "注册成功，请查收验证邮件后登录" });
  }

  // 手机号注册（可插拔模块）
  if (!smsEnabled()) return Response.json({ error: "手机号注册未开放" }, { status: 400 });

  const codeRow = await db.query.verificationTokens.findFirst({
    where: and(
      eq(verificationTokens.token, `${input.phone}:${input.code}`),
      eq(verificationTokens.type, "sms_code"),
      isNull(verificationTokens.usedAt),
      gt(verificationTokens.expiresAt, new Date())
    ),
  });
  if (!codeRow) return Response.json({ error: "验证码错误或已过期" }, { status: 400 });

  const exists = await db.query.users.findFirst({ where: eq(users.phone, input.phone) });
  if (exists) return Response.json({ error: "该手机号已注册" }, { status: 409 });

  await db
    .update(verificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(verificationTokens.id, codeRow.id));
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, 10),
    })
    .returning();
  await db.insert(wallets).values({ userId: user.id }).onConflictDoNothing();

  return Response.json({ ok: true, message: "注册成功，请登录" });
}
