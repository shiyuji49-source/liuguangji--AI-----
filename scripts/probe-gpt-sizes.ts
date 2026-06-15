/**
 * 临时探针：定位图像生成"服务器错误"。读 .env 真 key，按文档矩阵打 DMXAPI。
 * 跑：npx tsx scripts/probe-gpt-sizes.ts  → 看 _probe.txt
 */
import { readFileSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const get = (k: string) =>
  (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const KEY = get("DMXAPI_API_KEY");
const BASE = (get("DMXAPI_BASE_URL") || "https://www.dmxapi.cn").replace(/\/+$/, "");

const PROMPT = "赛博朋克城市雨夜，霓虹招牌特写，电影画幅";
const cases: { tag: string; model: string; size: string; quality: string }[] = [
  { tag: "A 现状 plain/1024", model: "gpt-image-2", size: "1024x1024", quality: "high" },
  { tag: "B ssvip/1024", model: "gpt-image-2-ssvip", size: "1024x1024", quality: "high" },
  { tag: "C ssvip/2K方 2048x2048", model: "gpt-image-2-ssvip", size: "2048x2048", quality: "medium" },
  { tag: "D ssvip/2K横 2048x1152", model: "gpt-image-2-ssvip", size: "2048x1152", quality: "medium" },
  { tag: "E ssvip/2K竖 1152x2048", model: "gpt-image-2-ssvip", size: "1152x2048", quality: "medium" },
  { tag: "F ssvip/4K横 3840x2160", model: "gpt-image-2-ssvip", size: "3840x2160", quality: "medium" },
  { tag: "G ssvip/4K竖 2160x3840", model: "gpt-image-2-ssvip", size: "2160x3840", quality: "medium" },
  { tag: "H ssvip/4K方 2880x2880", model: "gpt-image-2-ssvip", size: "2880x2880", quality: "medium" },
];

const out: string[] = [`BASE=${BASE}  KEY=${KEY ? KEY.slice(0, 6) + "…(" + KEY.length + ")" : "缺失"}`];

async function one(c: (typeof cases)[number]) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: c.model,
        prompt: PROMPT,
        n: 1,
        size: c.size,
        quality: c.quality,
        output_format: "png",
        moderation: "low",
      }),
    });
    const txt = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(txt);
    } catch {
      /* non-json */
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const p = parsed as { data?: { b64_json?: string }[]; error?: { message?: string }; usage?: unknown } | null;
    if (res.ok && p?.data?.[0]?.b64_json) {
      out.push(`✅ ${c.tag} | ${res.status} ${sec}s | b64=${p.data[0].b64_json.length} | usage=${JSON.stringify(p.usage ?? {})}`);
    } else {
      const msg = p?.error?.message ?? txt.slice(0, 300);
      out.push(`❌ ${c.tag} | ${res.status} ${sec}s | ${msg}`);
    }
  } catch (e) {
    out.push(`💥 ${c.tag} | EXC | ${e instanceof Error ? e.message : String(e)}`);
  }
  writeFileSync(new URL("../_probe.txt", import.meta.url), out.join("\n"));
}

(async () => {
  for (const c of cases) await one(c);
  out.push("done");
  writeFileSync(new URL("../_probe.txt", import.meta.url), out.join("\n"));
})();

export {};
