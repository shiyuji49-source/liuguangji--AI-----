// 压测 DMXAPI 各图片模型变体：稳定性(成功率) + 速度(延迟)。
// 用法：npx tsx --env-file=.env scripts/probe-variants.ts
const BASE = (process.env.DMXAPI_BASE_URL ?? "https://www.dmxapi.cn").replace(/\/+$/, "");
const KEY = process.env.DMXAPI_API_KEY ?? "";
const RUNS = 3;
const PROMPT = "一柄青铜古剑，云纹剑身，白底道具档案图";

async function callGpt(model: string): Promise<{ ok: boolean; ms: number; note: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: PROMPT, n: 1, size: "1024x1024", quality: "low", output_format: "png" }),
    });
    const j = await res.json().catch(() => null);
    const ok = res.ok && !!j?.data?.[0]?.b64_json;
    return { ok, ms: Date.now() - t0, note: ok ? `${j.usage?.total_tokens ?? "?"}tok` : `HTTP${res.status} ${JSON.stringify(j?.error ?? "").slice(0, 60)}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, note: String(e).slice(0, 60) };
  }
}

async function callGemini(model: string): Promise<{ ok: boolean; ms: number; note: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
      }),
    });
    const j = await res.json().catch(() => null);
    const ok = res.ok && !!j?.candidates?.[0]?.content?.parts?.some((p: { inlineData?: unknown }) => p.inlineData);
    return { ok, ms: Date.now() - t0, note: ok ? `${j.usageMetadata?.totalTokenCount ?? "?"}tok` : `HTTP${res.status} ${JSON.stringify(j?.error ?? "").slice(0, 60)}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, note: String(e).slice(0, 60) };
  }
}

async function bench(label: string, fn: () => Promise<{ ok: boolean; ms: number; note: string }>) {
  const rs: { ok: boolean; ms: number; note: string }[] = [];
  for (let i = 0; i < RUNS; i++) rs.push(await fn());
  const okN = rs.filter((r) => r.ok).length;
  const okMs = rs.filter((r) => r.ok).map((r) => r.ms);
  const avg = okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : 0;
  console.log(`${label.padEnd(28)} 成功 ${okN}/${RUNS}｜均 ${avg}ms｜各次 ${rs.map((r) => (r.ok ? `${Math.round(r.ms / 1000)}s` : `✗${r.note}`)).join(" ")}`);
}

async function main() {
  console.log(`=== DMXAPI 图片变体压测（每个 ${RUNS} 次，1K low）===`);
  await bench("gpt-image-2-03", () => callGpt("gpt-image-2-03"));
  await bench("gpt-image-2", () => callGpt("gpt-image-2"));
  await bench("gpt-image-2-ssvip", () => callGpt("gpt-image-2-ssvip"));
  await bench("gemini-3-pro-image", () => callGemini("gemini-3-pro-image"));
  await bench("gemini-3-pro-image-ssvip", () => callGemini("gemini-3-pro-image-ssvip"));
  process.exit(0);
}
void main();

export {};
