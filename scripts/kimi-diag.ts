// Kimi 任务A 单测：长输出分镜构建，记录 finishReason + 尾部
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { scriptEpisodes } from "../src/lib/db/schema";
import { writeFileSync } from "node:fs";
import { getSkillPrompt } from "../src/lib/ai/skills";

const kimi = createAnthropic({
  baseURL: `${process.env.KIMI_BASE_URL!.replace(/\/+$/, "")}/v1`,
  apiKey: "x",
  fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    h.delete("x-api-key");
    h.set("Authorization", `Bearer ${process.env.KIMI_API_KEY}`);
    return fetch(url, { ...init, headers: h });
  }) as typeof fetch,
});

async function main() {
  const ep2 = await db.query.scriptEpisodes.findFirst({
    where: and(eq(scriptEpisodes.scriptId, "f3082929-9272-4c44-937e-7f032ee03237"), eq(scriptEpisodes.episodeNo, 2)),
  });
  const t0 = Date.now();
  const { text, finishReason, usage } = await generateText({
    model: kimi(process.env.KIMI_MODEL ?? "kimi-k2.6"),
    system: getSkillPrompt("镜头设计"),
    prompt: `【任务】把下面这一集设计成有电影感的分镜表。每镜一条 JSON：{"shotNo":序号,"sceneLabel":"场","shotFunction":"镜头类型","summary":"画面/动作摘要","shotType":"景别","cameraMove":"运镜","dialogue":"台词或声音","durationSec":秒数,"assetRefs":[],"needStill":布尔}。只输出 JSON 数组，不要任何额外文字或代码块标注。\n\n----- 第 2 集剧本 -----\n${ep2!.content}`,
    maxOutputTokens: 20000,
  });
  const u = usage as unknown as { outputTokens?: number };
  console.log(`finishReason: ${finishReason} | 输出tokens: ${u.outputTokens} | 字符: ${text.length} | ${Date.now() - t0}ms`);
  console.log("尾部120字:", JSON.stringify(text.slice(-120)));
  writeFileSync("/tmp/kimi-taskA.txt", text);
  process.exit(0);
}
void main();
