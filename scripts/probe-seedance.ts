// 探 Seedance 2.0（新参数方式，480p/5s/无声 最便宜）。
// 用法：npx tsx --env-file=.env scripts/probe-seedance.ts
const BASE = (process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
const KEY = process.env.ARK_API_KEY ?? "";
const MODEL = process.env.PROBE_SEEDANCE_MODEL ?? "doubao-seedance-2-0-260128";

async function main() {
  console.log("=== Seedance 2.0 探针（新参数方式 480p/5s/无声）model:", MODEL, "===");
  const createRes = await fetch(`${BASE}/api/v3/contents/generations/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      content: [{ type: "text", text: "一只红苹果在白色桌面上，柔光，缓慢推近" }],
      resolution: "480p",
      ratio: "16:9",
      duration: 5,
      generate_audio: false,
      watermark: false,
    }),
  });
  const created = await createRes.json().catch(() => null);
  console.log("CREATE HTTP", createRes.status, "→", JSON.stringify(created).slice(0, 300));
  const taskId = created?.id;
  if (!taskId) {
    console.log("未拿到 task id（看上面错误）");
    process.exit(0);
  }
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const q = await fetch(`${BASE}/api/v3/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const j = await q.json().catch(() => null);
    console.log(`轮询 ${(i + 1) * 5}s → status=${j?.status}`);
    if (["succeeded", "failed", "cancelled", "expired"].includes(j?.status)) {
      console.log("resolution/ratio/duration:", j?.resolution, j?.ratio, j?.duration);
      console.log("video_url:", String(j?.content?.video_url).slice(0, 90));
      console.log("usage:", JSON.stringify(j?.usage));
      console.log("error:", JSON.stringify(j?.error));
      break;
    }
  }
  process.exit(0);
}
void main();

export {};
