import { z } from "zod";
import { db } from "@/lib/db";
import { pricingConfig } from "@/lib/db/schema";
import { requireAdmin, toErrorResponse } from "@/lib/auth-helpers";
import { invalidatePricingCache } from "@/lib/billing/pricing";
import { DEFAULT_PRICING } from "@/lib/billing/defaults";

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({ key: z.string().min(1).max(64), value: z.number().min(0) })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    if (!(parsed.data.key in DEFAULT_PRICING)) {
      return Response.json({ error: "未知的定价项" }, { status: 400 });
    }

    await db
      .insert(pricingConfig)
      .values({ key: parsed.data.key, value: parsed.data.value, updatedBy: admin.id })
      .onConflictDoUpdate({
        target: pricingConfig.key,
        set: { value: parsed.data.value, updatedBy: admin.id, updatedAt: new Date() },
      });
    invalidatePricingCache();
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
