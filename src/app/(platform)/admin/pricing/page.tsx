import { db } from "@/lib/db";
import { pricingConfig } from "@/lib/db/schema";
import { DEFAULT_PRICING } from "@/lib/billing/defaults";
import { PricingTable } from "./pricing-table";

export default async function AdminPricingPage() {
  const rows = await db.select().from(pricingConfig);
  const dbMap = new Map(rows.map((r) => [r.key, r]));
  // 以默认定价表的键为准展示（DB 值优先），保证新键也能出现
  const items = Object.keys(DEFAULT_PRICING).map((key) => ({
    key,
    value: Number(dbMap.get(key)?.value ?? DEFAULT_PRICING[key]),
    updatedAt: dbMap.get(key)?.updatedAt?.toLocaleString("zh-CN") ?? "（默认值）",
  }));

  return <PricingTable items={items} />;
}
