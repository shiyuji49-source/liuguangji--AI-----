// 打印某会话最后一条 assistant 回复全文。用法：npx tsx --env-file=.env scripts/show-msg.ts <conversationId>
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool
  .query(
    "select content from messages where conversation_id=$1 and role='assistant' order by created_at desc limit 1",
    [process.argv[2]]
  )
  .then((r) => {
    process.stdout.write(r.rows[0]?.content ?? "(无回复)");
    return pool.end();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
