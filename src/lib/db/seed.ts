// 种子数据：平台管理员 + 默认定价表。幂等：已存在则跳过（定价不覆盖 admin 修改）。
// 运行：npm run db:seed（需 .env 提供 DATABASE_URL / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD）
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, wallets, pricingConfig } from "./schema";
import { DEFAULT_PRICING } from "../billing/defaults";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("缺少 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD 环境变量");
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  let adminId: string;
  if (existing) {
    adminId = existing.id;
    console.log(`管理员已存在：${email}`);
  } else {
    const [admin] = await db
      .insert(users)
      .values({
        name: "平台管理员",
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: "admin",
        status: "active",
        emailVerifiedAt: new Date(),
      })
      .returning();
    adminId = admin.id;
    console.log(`已创建管理员：${email}`);
  }

  await db.insert(wallets).values({ userId: adminId, balanceCredits: 0 }).onConflictDoNothing();

  for (const [key, value] of Object.entries(DEFAULT_PRICING)) {
    await db.insert(pricingConfig).values({ key, value }).onConflictDoNothing();
  }
  console.log(`定价表就绪（${Object.keys(DEFAULT_PRICING).length} 项，已存在的不覆盖）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
