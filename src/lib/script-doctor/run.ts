import { generateText, type ModelMessage } from "ai";
import { heavyModel, MODEL_HEAVY, toLlmUsage } from "../ai/llm";
import { getSkillPrompt, buildRuntimeNote } from "../ai/skills";
import { chargeLlm, precheck, estimateLlmMaxCredits } from "../billing/charge";
import type { ProjectTier } from "../db/schema";

/**
 * 剧本医生（分镜前置）过渡版：结构化、非对话。
 * 两个动作——诊断（七维度+制作/剪辑连贯性报告）/ 影视化改写（AI 友好版本）。
 * 用 script-revision skill + 重模型（CLAUDE.md：剧本医生走 LLM_MODEL_HEAVY）。
 */
export type DoctorMode = "diagnose" | "revise";

const MAX_OUT = 16000;

export async function runScriptDoctor(opts: {
  userId: string;
  mode: DoctorMode;
  episodeNo: number;
  episodeContent: string;
  spec: { tier: ProjectTier; aspect: string; productionType: string; styleGenre: string | null };
  refine?: string;
}): Promise<{ text: string; credits: number }> {
  const skill = getSkillPrompt("script-doctor");
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.episodeNo,
  });

  const task =
    opts.mode === "diagnose"
      ? [
          `【任务】只做"诊断报告"：通读第 ${opts.episodeNo} 集，按你 skill 的诊断维度输出一份结构化诊断报告（Markdown）。`,
          `必须覆盖：① 视听语言问题（看不见/听不见的内容、抽象心理、需外化或删的地方）② 内容合规（血腥/露骨/明星/品牌/反射镜头等风险点）③ 制作连贯性（资产/服装/道具/场景跨镜一致性隐患）④ 剪辑连贯性（时空/动作/视线衔接）⑤ 微短剧节奏（钩子/反转/付费点/留白）。`,
          `每条给：问题定位（哪场/哪句）+ 为什么是隐患 + 具体改法建议。只诊断、列改法，不直接重写全文。报告用 Markdown 标题与清单，简洁可执行。`,
        ].join("\n")
      : [
          `【任务】只做"影视化改写"：把第 ${opts.episodeNo} 集改写成 AI 能稳定生成、下游提示词可用的影视化版本（分镜前置）。`,
          `准则：① 视听语言——把看不见/听不见的（心理活动、抽象情绪、画外信息）外化成可拍的画面与声音，或删除；② 内容合规——血腥/露骨/明星/品牌转非直白表达，规避反射镜头叙事。多人场面/复杂动作/高速运镜/画面文字此阶段不必回避（交给下游静帧强控）。`,
          `保持剧情逻辑、人物关系、因果、时代设定不变。输出改写后的剧本正文（Markdown，可保留场号/场景标题），末尾附一段"主要改动说明"列出关键改了什么、为什么。`,
        ].join("\n");

  const parts = [task];
  parts.push(`【输出格式】直接从报告标题/改写正文的第一个字开始，不要"我来…""好的…"之类的开场白或结尾寒暄。`);
  if (opts.refine) parts.push(`【额外要求】${opts.refine}`);
  if (note) parts.push(note);
  parts.push(`----- 第 ${opts.episodeNo} 集原文 -----\n${opts.episodeContent.slice(0, 100000)}`);
  const userText = parts.join("\n\n");

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: skill,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: userText },
  ];
  const est = await estimateLlmMaxCredits(MODEL_HEAVY(), skill.length + userText.length, MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: heavyModel(),
    messages,
    maxOutputTokens: MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  if (!text.trim()) throw Object.assign(new Error("模型返回空内容，请重试"), { status: 502 });
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_HEAVY(),
    usage: toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined),
    ref: { appKey: "script-doctor", note: `${opts.mode === "diagnose" ? "诊断" : "改写"}-第${opts.episodeNo}集` },
  });
  return { text: text.trim(), credits };
}
