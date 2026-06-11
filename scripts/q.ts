// 开发辅助：执行 SQL 并打印 JSON。用法：npx tsx --env-file=.env scripts/q.ts "select ..."
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

pool
  .query(process.argv[2])
  .then((r) => {
    console.log(JSON.stringify(r.rows, null, 1));
    return pool.end();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
