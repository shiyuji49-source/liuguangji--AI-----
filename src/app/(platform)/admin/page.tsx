import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, wallets } from "@/lib/db/schema";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      balance: wallets.balanceCredits,
    })
    .from(users)
    .leftJoin(wallets, eq(wallets.userId, users.id))
    .orderBy(desc(users.createdAt))
    .limit(500);

  return (
    <UsersTable
      users={rows.map((r) => ({
        ...r,
        balance: r.balance ?? 0,
        emailVerified: !!r.emailVerifiedAt,
        createdAt: r.createdAt.toLocaleDateString("zh-CN"),
      }))}
    />
  );
}
