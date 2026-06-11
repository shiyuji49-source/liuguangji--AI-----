// 本地开发数据库（无 Docker 环境用）：embedded-postgres 起真实 PG 实例
// 运行：npx tsx scripts/dev-db.ts（前台常驻，Ctrl+C 停止）
import EmbeddedPostgres from "embedded-postgres";

const pg = new EmbeddedPostgres({
  databaseDir: "./.devdb",
  user: "postgres",
  password: "devpassword",
  port: 5433,
  persistent: true,
});

async function main() {
  const initialized = await pg
    .initialise()
    .then(() => true)
    .catch(() => false); // 已初始化过则跳过
  await pg.start();
  if (initialized) {
    await pg.createDatabase("liuguangji").catch(() => undefined);
  }
  console.log("dev postgres ready: postgres://postgres:devpassword@localhost:5433/liuguangji");
}

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
