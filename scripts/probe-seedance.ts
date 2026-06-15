// 用可用的 Seedance 1.0-pro 探明整套 API（请求格式/任务生命周期/响应/计费字段）。
// 2.0 同一套 API 只换 model id。用法：npx tsx --env-file=.env scripts/probe-seedance.ts
const BASE = (process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
const KEY = process.env.ARK_API_KEY ?? "";
const MODEL = process.env.PROBE_SEEDANCE_MODEL ?? "doubao-seedance-1-0-pro-250528";

async function main() {
  console.log("=== Seedance API 探针（480p/5s 最便宜）model:", MODEL, "===");
  // 1) 创建任务：Seedance 文本里用 --flag 传参数
  const createRes = await fetch(`${BASE}/api/v3/contents/generations/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      content: [{ type: "text", text: "一只红苹果在白色桌面上，柔光 --resolution 480p --duration 5 --ratio 16:9" }],
    }),
  });
  const created = await createRes.json().catch(() => null);
  console.log("CREATE HTTP", createRes.status, "→", JSON.stringify(created).slice(0, 300));
  const taskId = created?.id;
  if (!taskId) {
    console.log("未拿到 task id，停。");
    process.exit(0);
  }

  // 2) 轮询
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const q = await fetch(`${BASE}/api/v3/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const j = await q.json().catch(() => null);
    const status = j?.status;
    console.log(`轮询 ${(i + 1) * 5}s → status=${status}`);
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      console.log("顶层键:", Object.keys(j ?? {}).join(","));
      console.log("content:", JSON.stringify(j?.content).slice(0, 300));
      console.log("usage:", JSON.stringify(j?.usage));
      console.log("error:", JSON.stringify(j?.error));
      break;
    }
  }
  process.exit(0);
}
void main();

export {};
