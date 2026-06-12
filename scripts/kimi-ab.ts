/**
 * Kimi K2.6 vs 现有主模型（乐奇 sonnet）A/B 实测。
 * 任务 A：第 2 集分镜表构建（镜头设计 skill + 与 run.ts 相同指令）
 * 任务 B：第 1 集片段视频提示词（视频 skill + 11 节结构指令）
 * 直接调用模型（不走平台计费层）：lq 费用走乐奇账户、Kimi 走 moonshot 账户。
 * 用法：npx tsx --env-file=.env scripts/kimi-ab.ts
 */
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { scriptEpisodes, shots } from "../src/lib/db/schema";
import { getSkillPrompt, buildRuntimeNote } from "../src/lib/ai/skills";

const SCRIPT_ID = "f3082929-9272-4c44-937e-7f032ee03237";

function bearerProvider(baseURL: string, apiKey: string) {
  return createAnthropic({
    baseURL,
    apiKey: "placeholder",
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.delete("x-api-key");
      headers.set("Authorization", `Bearer ${apiKey}`);
      return fetch(url, { ...init, headers });
    }) as typeof fetch,
  });
}

// 与 llm.ts 同口径：baseURL 需带 /v1（SDK 在其后拼 /messages）
const lq = bearerProvider(
  `${(process.env.LLM_BASE_URL ?? "https://lqapi.top").replace(/\/+$/, "")}/v1`,
  process.env.LLM_API_KEY!
);
const kimi = bearerProvider(
  `${(process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/anthropic").replace(/\/+$/, "")}/v1`,
  process.env.KIMI_API_KEY!
);
const MODELS = [
  { tag: "sonnet(乐奇)", model: lq(process.env.LLM_MODEL_MAIN ?? "claude-sonnet-4-6") },
  { tag: "kimi-k2.6", model: kimi(process.env.KIMI_MODEL ?? "kimi-k2.6") },
];

const note = buildRuntimeNote({
  tier: "S",
  aspect: "16:9",
  productionType: "真人",
  styleGenre: "古装",
  episode: 2,
});

async function run(tag: string, model: Parameters<typeof generateText>[0]["model"], system: string, user: string, maxOut: number) {
  const t0 = Date.now();
  try {
    const { text, usage } = await generateText({
      model,
      messages: [
        { role: "system", content: system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
        { role: "user", content: user },
      ],
      maxOutputTokens: maxOut,
    });
    return { tag, ok: true, text, ms: Date.now() - t0, usage };
  } catch (e) {
    return { tag, ok: false, text: "", ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

function parseJsonArr(text: string): Record<string, unknown>[] | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("[");
  const e = t.lastIndexOf("]");
  if (s === -1 || e === -1) return null;
  try {
    const arr = JSON.parse(t.slice(s, e + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function main() {
  // ---------- 任务 A：第 2 集分镜表 ----------
  const ep2 = await db.query.scriptEpisodes.findFirst({
    where: and(eq(scriptEpisodes.scriptId, SCRIPT_ID), eq(scriptEpisodes.episodeNo, 2)),
  });
  if (!ep2) throw new Error("第 2 集不存在");
  const shotSkill = getSkillPrompt("镜头设计");
  const shotUser = [
    `【任务】用你 skill 的视听语言/découpage 方法，把下面这一集设计成有电影感的分镜表（不是照剧本平铺、不是台词字幕轨）。你是导演，不是对白记录员。`,
    `【硬要求（务必做到，否则就是 low）】`,
    `1. 每场戏先给一个 master/建立镜交代空间；之后按戏剧节拍 beat 分切，镜头数由 beat 决定，不由台词行数决定。`,
    `2. 对白场景必须有【听者反应镜头】：谁的处境因这句话改变就拍谁——皇上/上位者没说话也要给反应镜头（沉默承载戏）。重磅台词后给反应停留（更长时长），别只拍说话的人。`,
    `3. 运镜要有动机：每个推/拉/摇/移/环绕/手持都为某个情绪或叙事服务；无动机就用固定。但**整场不能全是固定镜头**，情绪高点至少 1 个有动机运镜。`,
    `4. 做视觉二次表达：剧本只写"路人说一句"这种，要扩成"环境→说→听者反应→插入→回应"的小段落（信息不变，只增"怎么拍"）。但禁止改剧情逻辑/人物关系/因果/结局/时代人设。`,
    `5. 善用插入特写、POV 链（看→所见→反应）、纵深调度。相邻镜头景别拉开级差，守 180°轴线与视线匹配。`,
    `每镜一条 JSON：{"shotNo":序号,"sceneLabel":"场","shotFunction":"镜头类型","summary":"画面/动作摘要","shotType":"景别","cameraMove":"运镜","dialogue":"台词或声音","durationSec":预估秒数或null,"assetRefs":["@资产名"],"needStill":布尔}`,
    `shotFunction 用规范镜头类型词：建立/主镜/对话/反应/插入/空镜/POV/转场/动作/蒙太奇。`,
    `shotType 用规范景别词：远景/全景/中景/中近景/近景/特写/大特写/微距。cameraMove 写具体运镜，禁写 zoom。`,
    `durationSec（⚠️宁长勿短）：有台词的镜 = 纯台词字数 ÷ 3.5 + 2 秒，向上取整；闪现建立 1 秒内；反应 5-10；插入 1-2。单镜 ≤15 秒。`,
    `只输出 JSON 数组，不要任何额外文字或代码块标注。`,
    note,
    `----- 第 2 集剧本 -----`,
    ep2.content,
  ].join("\n\n");

  console.log("====== 任务 A：第 2 集分镜表构建 ======");
  for (const m of MODELS) {
    const r = await run(m.tag, m.model, shotSkill, shotUser, 20000);
    if (!r.ok) {
      console.log(`\n【${r.tag}】❌ 调用失败（${r.ms}ms）：${r.error}`);
      continue;
    }
    const arr = parseJsonArr(r.text);
    if (!arr) {
      console.log(`\n【${r.tag}】⚠️ JSON 解析失败（${r.ms}ms，输出 ${r.text.length} 字符）`);
      console.log("  输出头部:", JSON.stringify(r.text.slice(0, 120)));
      continue;
    }
    const fixed = arr.filter((x) => /固定/.test(String(x.cameraMove ?? ""))).length;
    const reactions = arr.filter((x) => String(x.shotFunction ?? "").includes("反应")).length;
    const withFn = arr.filter((x) => String(x.shotFunction ?? "").trim()).length;
    // 台词时长达标率
    let dlgTotal = 0;
    let dlgOk = 0;
    for (const x of arr) {
      const d = String(x.dialogue ?? "").trim();
      const mm = d.match(/[:：]\s*([\s\S]+)$/);
      const body = mm ? mm[1] : /[「『"]/.test(d) ? d : null;
      if (!body) continue;
      const chars = body.replace(/[「」『』""''…—\s.。，,!！?？]/g, "").length;
      if (chars < 2) continue;
      dlgTotal++;
      const minDur = Math.min(15, Math.ceil(chars / 3.5) + 2);
      if (Number(x.durationSec ?? 0) >= minDur - 1) dlgOk++;
    }
    console.log(`\n【${r.tag}】✓ ${r.ms}ms｜输出 ${r.text.length} 字符`);
    console.log(
      `  镜数 ${arr.length}｜类型标注 ${withFn}/${arr.length}｜反应镜 ${reactions}｜固定镜占比 ${Math.round((fixed / arr.length) * 100)}%｜台词时长达标 ${dlgOk}/${dlgTotal}`
    );
    console.log(`  样例镜:`, JSON.stringify(arr[Math.min(2, arr.length - 1)]).slice(0, 220));
  }

  // ---------- 任务 B：片段视频提示词（第 1 集前 3 镜） ----------
  const ep1shots = await db
    .select()
    .from(shots)
    .where(and(eq(shots.scriptId, SCRIPT_ID), eq(shots.episodeNo, 1)))
    .orderBy(asc(shots.shotNo))
    .then((r) => r.slice(0, 3));
  if (ep1shots.length < 2) {
    console.log("\n第 1 集分镜不足，跳过任务 B");
    process.exit(0);
  }
  const dur = ep1shots.reduce((s, x) => s + (x.durationSec ?? 3), 0);
  const videoSkill = getSkillPrompt("视频");
  const segUser = [
    `【本片段（来自已确认的分镜表）】片段 1：测试片段\n目标总时长：${Math.min(dur, 15)} 秒（≤15）\n成员镜：\n${ep1shots
      .map((s) => `镜${s.shotNo}｜${s.sceneLabel}｜${s.shotType}/${s.cameraMove}｜${s.durationSec ?? "?"}s｜${s.summary}${s.dialogue ? `｜台词:${s.dialogue}` : ""}`)
      .join("\n")}`,
    [
      `【任务】为本片段生成**一条**多镜合并的 Seedance 2.0 视频提示词（不是逐镜各一条）。严格按 skill 的 11 节结构序依次写，不跳不乱：`,
      `1. @handle 声明：@image1 起逐条重编，**只标资产是什么，不写外观描述**——格式如「@image1=杨延昭（战损状态）」；仅状态词需要标注。`,
      `2. 通用警告：⚠️空间布局／⚠️对白规则：一句台词=一个镜头／⚠️本视频严格只有 ${ep1shots.length} 个镜头——禁止添加额外镜头。`,
      `3. 【镜头N】块逐镜写：机位（焦段mm+光圈+景别）／摄影机运动（绑情绪，一镜一动）／背景／动作（分步①②③）／⚠️⚠️⚠️微表演细节（肌肉/呼吸/眼神/皮肤，禁抽象情绪词）。`,
      `4. 风格块：practicals-only。5. 环境活动（禁空旷背景）。6. 失败模式 ⚠️ 防御+标准禁块。`,
      `7. 收尾：质量锚定语 +「无水印、无字幕。${Math.min(dur, 15)}秒。16:9。」`,
      `全文 ≤3000 字符、纯中文。只输出提示词本身。`,
    ].join("\n"),
    note,
  ].join("\n\n");

  console.log("\n====== 任务 B：片段视频提示词（第 1 集镜 1-3）======");
  for (const m of MODELS) {
    const r = await run(m.tag, m.model, videoSkill, segUser, 5000);
    if (!r.ok) {
      console.log(`\n【${r.tag}】❌ 调用失败（${r.ms}ms）：${r.error}`);
      continue;
    }
    const p = r.text.trim();
    const checks = {
      handle声明: p.includes("@image1"),
      空间布局: p.includes("空间布局"),
      严格N镜: new RegExp(`严格只有\\s*${ep1shots.length}\\s*个镜头`).test(p),
      镜头块数: (p.match(/【镜头\d/g) || []).length,
      微表演: p.includes("微表演"),
      锚定语: p.includes("面部稳定不变形"),
      画幅收尾: /16:9/.test(p.slice(-50)),
      字数: p.length,
    };
    console.log(`\n【${r.tag}】✓ ${r.ms}ms`);
    console.log("  ", JSON.stringify(checks));
    console.log("  开头:", JSON.stringify(p.slice(0, 100)));
  }
  process.exit(0);
}

void main();
