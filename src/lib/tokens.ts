import { randomBytes } from "node:crypto";
import { and, eq, isNull, gt, desc } from "drizzle-orm";
import { db } from "./db";
import { verificationTokens } from "./db/schema";

type TokenType = "email_verify" | "password_reset" | "sms_code";

export async function createToken(identifier: string, type: TokenType, ttlMs: number, raw?: string) {
  const token = raw ?? randomBytes(32).toString("hex");
  await db.insert(verificationTokens).values({
    identifier,
    token,
    type,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

/** 校验并一次性消费令牌；返回 identifier，失败返回 null */
export async function consumeToken(token: string, type: TokenType) {
  const row = await db.query.verificationTokens.findFirst({
    where: and(
      eq(verificationTokens.token, token),
      eq(verificationTokens.type, type),
      isNull(verificationTokens.usedAt),
      gt(verificationTokens.expiresAt, new Date())
    ),
  });
  if (!row) return null;
  await db
    .update(verificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(verificationTokens.id, row.id));
  return row.identifier;
}

/** 同一 identifier 的发送频控（如短信 60 秒一条） */
export async function recentlyIssued(identifier: string, type: TokenType, withinMs: number) {
  const row = await db.query.verificationTokens.findFirst({
    where: and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.type, type)),
    orderBy: desc(verificationTokens.createdAt),
  });
  return Boolean(row && Date.now() - row.createdAt.getTime() < withinMs);
}
