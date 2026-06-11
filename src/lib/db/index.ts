import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// 连接池 max≈20（规划书 §2）；dev HMR 下复用全局实例避免连接泄漏
const globalForDb = globalThis as unknown as { __lgjPool?: Pool };

const pool =
  globalForDb.__lgjPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__lgjPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
