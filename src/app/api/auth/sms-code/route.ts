import { z } from "zod";
import { randomInt } from "node:crypto";
import { createToken, recentlyIssued } from "@/lib/tokens";
import { smsEnabled, sendSmsCode } from "@/lib/sms";

export async function POST(req: Request) {
  if (!smsEnabled()) return Response.json({ error: "手机号注册未开放" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ phone: z.string().regex(/^1\d{10}$/) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "手机号格式不正确" }, { status: 400 });
  const { phone } = parsed.data;

  if (await recentlyIssued(phone, "sms_code", 60_000)) {
    return Response.json({ error: "发送过于频繁，请 60 秒后再试" }, { status: 429 });
  }

  const code = String(randomInt(100000, 1000000));
  await createToken(phone, "sms_code", 10 * 60_000, `${phone}:${code}`);
  await sendSmsCode(phone, code);
  return Response.json({ ok: true, message: "验证码已发送" });
}
