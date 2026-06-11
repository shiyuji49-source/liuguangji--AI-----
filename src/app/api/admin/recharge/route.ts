import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, rechargeOrders } from "@/lib/db/schema";
import { requireAdmin, toErrorResponse } from "@/lib/auth-helpers";
import { applyCredits } from "@/lib/billing/charge";
import { YUAN_TO_CREDITS } from "@/lib/billing/defaults";

// P0 手动充值：对公转账后由管理员入账，生成 manual 订单 + 流水（§6）
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({ userId: z.string().uuid(), amountYuan: z.number().positive().max(1_000_000) })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { userId, amountYuan } = parsed.data;

    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) return Response.json({ error: "用户不存在" }, { status: 404 });

    const credits = Math.round(amountYuan * YUAN_TO_CREDITS);
    const [order] = await db
      .insert(rechargeOrders)
      .values({
        userId,
        amountYuan: amountYuan.toFixed(2),
        credits,
        channel: "manual",
        status: "paid",
        paidAt: new Date(),
        createdBy: admin.id,
      })
      .returning();

    const { balanceAfter } = await applyCredits({
      userId,
      delta: credits,
      reason: "recharge",
      ref: { orderId: order.id, channel: "manual", amountYuan, operator: admin.id },
    });
    return Response.json({ ok: true, credits, balanceAfter });
  } catch (e) {
    return toErrorResponse(e);
  }
}
