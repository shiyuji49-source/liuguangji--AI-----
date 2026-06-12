// 一次性校正存量分镜的台词镜时长（口播 3-4 字/秒 + 2 秒表演拍，宁长勿短）
// 用法：npx tsx --env-file=.env scripts/fix-dialogue-durations.ts <scriptId> <episodeNo>
import { db } from "../src/lib/db";
import { shots } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

function minDur(dialogue: string): number | null {
  const d = dialogue.trim();
  if (!d) return null;
  if (/^(环境音|音效|声音|画外音?[:：]?\s*$|SFX|BGM|无台词|无对白)/.test(d)) return null;
  const m = d.match(/[:：]\s*([\s\S]+)$/);
  const body = m ? m[1] : /[「『"“]/.test(d) ? d : null;
  if (!body) return null;
  const chars = body.replace(/[「」『』""''…—\s.。，,!！?？]/g, "").length;
  if (chars < 2) return null;
  return Math.min(15, Math.ceil(chars / 3.5) + 2);
}

async function main() {
  const scriptId = process.argv[2];
  const episodeNo = Number(process.argv[3]);
  if (!scriptId || !Number.isFinite(episodeNo)) {
    console.error("用法：fix-dialogue-durations.ts <scriptId> <episodeNo>");
    process.exit(1);
  }

  const rows = await db
    .select()
    .from(shots)
    .where(and(eq(shots.scriptId, scriptId), eq(shots.episodeNo, episodeNo)));
  let fixed = 0;
  for (const s of rows) {
    const md = minDur(s.dialogue ?? "");
    if (md !== null && (s.durationSec ?? 0) < md) {
      await db.update(shots).set({ durationSec: md }).where(eq(shots.id, s.id));
      console.log(`镜${s.shotNo}: ${s.durationSec}s → ${md}s`);
      fixed++;
    }
  }
  console.log(`校正完成: ${fixed}/${rows.length} 镜`);
  process.exit(0);
}

void main();
