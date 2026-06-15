// 探 M3 图片适配器：gpt + nano 各出一张 1k，落本地存储。
// 用法：npx tsx --env-file=.env scripts/probe-image.ts
import { generateImage } from "../src/lib/ai/image";
import { putBase64 } from "../src/lib/storage";

async function one(engine: "gpt" | "nano") {
  const t0 = Date.now();
  try {
    const r = await generateImage({
      engine,
      prompt: "a single red apple on a white table, studio light",
      tier: "1k",
      aspectRatio: "1:1",
    });
    const img = r.images[0];
    const put = await putBase64({
      data: img.base64,
      contentType: img.contentType,
      projectId: "probe",
      prefix: engine,
    });
    console.log(
      `[${engine}] ✓ ${Date.now() - t0}ms model=${r.model} → ${put.key} (${Math.round(put.bytes / 1024)}KB) usage=${JSON.stringify(r.usage).slice(0, 160)}`
    );
  } catch (e) {
    console.log(`[${engine}] ✗ ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  await one("gpt");
  await one("nano");
  process.exit(0);
}
void main();
