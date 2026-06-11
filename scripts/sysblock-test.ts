// 探针：乐奇对多 system 块（多缓存断点）的处理是否正常
import { generateText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readFileSync } from "node:fs";

const apiKey = process.env.LLM_API_KEY!;
const provider = createAnthropic({
  baseURL: `${process.env.LLM_BASE_URL}/v1`,
  apiKey,
  fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    h.delete("x-api-key");
    h.set("authorization", `Bearer ${apiKey}`);
    return fetch(url, { ...init, headers: h });
  }) as typeof fetch,
});

const skill = readFileSync("docs/鎏光智绘提示词SKILL/人物提示词SKILL.md", "utf8");
const fakeScript = "【项目剧本《测试》第 1 集】\n\n场1 日 内 客栈\n木兰擦拭横刀。";
const cc = { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } } };

async function probe(label: string, messages: ModelMessage[]) {
  const { text } = await generateText({
    model: provider("claude-opus-4-8"),
    messages,
    maxOutputTokens: 150,
  });
  console.log(`\n=== ${label} ===\n${text.slice(0, 200)}`);
}

async function main() {
  const user = { role: "user" as const, content: "用一句话回答：你的身份和职责是什么？" };
  await probe("A: 三个 system 块（skill缓存 + 剧本缓存 + 附注）", [
    { role: "system", content: skill, ...cc },
    { role: "system", content: fakeScript, ...cc },
    { role: "system", content: "【项目分级】B 级" },
    user,
  ]);
  await probe("B: 单个合并 system 块（一个缓存断点）", [
    { role: "system", content: `${skill}\n\n---\n\n${fakeScript}\n\n---\n\n【项目分级】B 级`, ...cc },
    user,
  ]);
  await probe("C: 两个 system 块（skill缓存 + 附注，旧路径）", [
    { role: "system", content: skill, ...cc },
    { role: "system", content: "【项目分级】B 级" },
    user,
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
