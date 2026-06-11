// 验收 §14-P0-2：并发扣费无超扣（事务+行锁）。50 并发各扣 10 积分，初始 500，期望恰好扣到 0。
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, wallets, creditLedger } from "../src/lib/db/schema";
import { applyCredits } from "../src/lib/billing/charge";

async function main() {
  const email = "concurrency@test.local";
  let user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ name: "并发测试", email, passwordHash: "x", emailVerifiedAt: new Date() })
      .returning();
  }
  await db.delete(creditLedger).where(eq(creditLedger.userId, user.id));
  await db.insert(wallets).values({ userId: user.id }).onConflictDoNothing();
  await db.update(wallets).set({ balanceCredits: 500 }).where(eq(wallets.userId, user.id));

  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) =>
      applyCredits({ userId: user.id, delta: -10, reason: "llm", ref: { note: `并发#${i}` } })
    )
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;

  const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, user.id) });
  const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
  const balances = ledger.map((l) => l.balanceAfter).sort((a, b) => a - b);
  const uniqueBalances = new Set(balances).size;

  console.log(`成功扣费 ${ok}/50；最终余额 ${wallet?.balanceCredits}（期望 0）`);
  console.log(`流水 ${ledger.length} 条；balance_after 去重 ${uniqueBalances}（期望 50，证明无丢失更新）`);
  console.log(
    wallet?.balanceCredits === 0 && ledger.length === 50 && uniqueBalances === 50
      ? "✅ 并发扣费正确"
      : "❌ 并发扣费异常"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
