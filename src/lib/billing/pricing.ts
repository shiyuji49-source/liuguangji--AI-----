import { db } from "../db";
import { pricingConfig } from "../db/schema";
import { DEFAULT_PRICING } from "./defaults";

// 单价全部存 pricing_config（admin 可改），进程内 30s 缓存；DB 缺项时回退 seed 默认值
let cache: { at: number; map: Record<string, number> } | null = null;

export async function getPricing(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.map;
  const rows = await db.select().from(pricingConfig);
  const map: Record<string, number> = { ...DEFAULT_PRICING };
  for (const r of rows) {
    const n = Number(r.value);
    if (Number.isFinite(n)) map[r.key] = n;
  }
  cache = { at: Date.now(), map };
  return map;
}

export function invalidatePricingCache() {
  cache = null;
}
