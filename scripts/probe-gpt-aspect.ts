/** 探针：确认 gpt-image-2 新画幅尺寸 + size=auto 被 DMXAPI 接受。跑：npx tsx scripts/probe-gpt-aspect.ts → 看 _aspect.txt */
import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const KEY = get("DMXAPI_API_KEY");
const BASE = (get("DMXAPI_BASE_URL") || "https://www.dmxapi.cn").replace(/\/+$/, "");
const sizes = ["auto", "768x1024", "720x1280", "1024x768", "1280x720", "2400x3200", "3200x2400"];
const out: string[] = [`BASE=${BASE} KEY=${KEY ? KEY.slice(0, 6) + "…" : "缺失"}`];
async function one(size: string) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: "gpt-image-2", prompt: "一只锈剑特写，电影质感", n: 1, size, quality: "medium", output_format: "png" }),
    });
    const txt = await res.text();
    let p: { data?: { b64_json?: string }[]; error?: { message?: string } } | null = null;
    try { p = JSON.parse(txt); } catch { /* */ }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.ok && p?.data?.[0]?.b64_json) out.push(`✅ ${size} | ${res.status} ${sec}s | b64=${p.data[0].b64_json.length}`);
    else out.push(`❌ ${size} | ${res.status} ${sec}s | ${p?.error?.message ?? txt.slice(0, 200)}`);
  } catch (e) {
    out.push(`💥 ${size} | ${e instanceof Error ? e.message : String(e)}`);
  }
  writeFileSync(new URL("../_aspect.txt", import.meta.url), out.join("\n"));
}
(async () => {
  for (const s of sizes) await one(s);
  out.push("done");
  writeFileSync(new URL("../_aspect.txt", import.meta.url), out.join("\n"));
})();
export {};
