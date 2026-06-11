import { eq } from "drizzle-orm";
import { db } from "../db";
import { wallets, creditLedger, type LedgerReason } from "../db/schema";
import { getPricing } from "./pricing";
import { llmPriceTier } from "./defaults";

/**
 * 积分计费统一入口（规划书 §6）。
 * 所有 provider 调用必经此处：预检余额 → 执行 → 按实际用量结算入账。
 * 禁止绕过本模块直调 provider。
 */

export class InsufficientCreditsError extends Error {
  status = 402;
  constructor(message = "积分余额不足，请充值") {
    super(message);
  }
}

export async function getBalance(userId: string): Promise<number> {
  const row = await db.query.wallets.findFirst({ where: eq(wallets.userId, userId) });
  if (!row) {
    await db.insert(wallets).values({ userId }).onConflictDoNothing();
    return 0;
  }
  return row.balanceCredits;
}

/** 1. 预检：估算消耗不超过余额，不足则拒绝并提示充值 */
export async function precheck(userId: string, estimatedCredits: number) {
  const balance = await getBalance(userId);
  if (balance < estimatedCredits) {
    throw new InsufficientCreditsError(
      `积分余额不足（本次预估最高约 ${estimatedCredits} 积分，当前余额 ${balance}），请先充值`
    );
  }
  return balance;
}

export type LedgerRef = Record<string, unknown>;

/**
 * 3/4. 唯一记账入口：DB 事务 + 行锁（SELECT … FOR UPDATE）保证并发正确。
 * delta 为负=扣费，为正=充值/退款/调整。
 */
export async function applyCredits(opts: {
  userId: string;
  delta: number;
  reason: LedgerReason;
  ref?: LedgerRef;
}): Promise<{ balanceAfter: number }> {
  const delta = Math.trunc(opts.delta);
  return db.transaction(async (tx) => {
    await tx.insert(wallets).values({ userId: opts.userId }).onConflictDoNothing();
    const [w] = await tx
      .select({ balance: wallets.balanceCredits })
      .from(wallets)
      .where(eq(wallets.userId, opts.userId))
      .for("update");
    const balanceAfter = w.balance + delta;
    await tx.update(wallets).set({ balanceCredits: balanceAfter }).where(eq(wallets.userId, opts.userId));
    await tx.insert(creditLedger).values({
      userId: opts.userId,
      deltaCredits: delta,
      balanceAfter,
      reason: opts.reason,
      ref: opts.ref,
    });
    return { balanceAfter };
  });
}

// ===== LLM 计费 =====

export type LlmUsage = {
  inputTokens: number; // 非缓存输入（Anthropic input_tokens）
  outputTokens: number;
  cacheReadTokens?: number; // 缓存命中（按 cached_in_ratio 计价）
  cacheWriteTokens?: number; // 缓存写入（按输入价计）
};

export async function calcLlmCostCredits(model: string, usage: LlmUsage) {
  const p = await getPricing();
  const tier = llmPriceTier(model);
  const inRate = p[`llm.${tier}.in_per_1m`];
  const outRate = p[`llm.${tier}.out_per_1m`];
  const fresh = usage.inputTokens || 0;
  const cacheRead = usage.cacheReadTokens || 0;
  const cacheWrite = usage.cacheWriteTokens || 0;
  const output = usage.outputTokens || 0;

  // 内部按小数累计，最终向上取整为整数积分（§6）
  const raw =
    ((fresh + cacheWrite) * inRate + cacheRead * inRate * p["llm.cached_in_ratio"] + output * outRate) /
    1_000_000;
  const credits = Math.max(Math.ceil(raw), Math.ceil(p["llm.min_per_call"]));
  return { credits, tier, inRate, outRate };
}

/** 按实际 usage 扣 LLM 费用并写流水，返回本次消耗与余额 */
export async function chargeLlm(opts: { userId: string; model: string; usage: LlmUsage; ref?: LedgerRef }) {
  const { credits } = await calcLlmCostCredits(opts.model, opts.usage);
  const { balanceAfter } = await applyCredits({
    userId: opts.userId,
    delta: -credits,
    reason: "llm",
    ref: { model: opts.model, usage: opts.usage, ...opts.ref },
  });
  return { credits, balanceAfter };
}

/** LLM 预检上限估算：输入按字符近似 token，输出按 maxOutputTokens 全量计 */
export async function estimateLlmMaxCredits(model: string, inputChars: number, maxOutputTokens: number) {
  const { credits } = await calcLlmCostCredits(model, {
    // 中文≈1 token/字，预留 20% 余量
    inputTokens: Math.ceil(inputChars * 1.2),
    outputTokens: maxOutputTokens,
  });
  return credits;
}
