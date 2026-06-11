// 调试：检查 cache_control 是否进入请求体、乐奇返回的 usage 原文
import { generateText, streamText, type ModelMessage } from "ai";
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
    const body = JSON.parse(String(init?.body));
    console.log(
      "REQUEST system blocks:",
      JSON.stringify(
        (body.system ?? []).map((b: { type: string; cache_control?: unknown; text?: string }) => ({
          type: b.type,
          cache_control: b.cache_control,
          chars: b.text?.length,
        }))
      )
    );
    const res = await fetch(url, { ...init, headers: h });
    const clone = res.clone();
    const json = await clone.json().catch(() => null);
    if (json?.usage) console.log("RESPONSE usage:", JSON.stringify(json.usage));
    return res;
  }) as typeof fetch,
});

const skill = readFileSync("docs/鎏光智绘提示词SKILL/人物提示词SKILL.md", "utf8");

async function once(label: string) {
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: skill,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: "用一句话介绍你的功能" },
  ];
  const { usage } = await generateText({
    model: provider("claude-sonnet-4-6"),
    messages,
    maxOutputTokens: 100,
    providerOptions: { anthropic: { metadata: { userId: "test-user-001" } } },
  });
  console.log(label, "usage:", JSON.stringify(usage.inputTokenDetails));
}

async function onceStream(label: string) {
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: skill,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: "用一句话介绍你的功能" },
  ];
  const result = streamText({
    model: provider("claude-sonnet-4-6"),
    messages,
    maxOutputTokens: 100,
    providerOptions: { anthropic: { metadata: { userId: "test-user-001" } } },
    onFinish: ({ usage, providerMetadata }) => {
      console.log(label, "stream usage details:", JSON.stringify(usage.inputTokenDetails));
      console.log(
        label,
        "stream anthropic.usage:",
        JSON.stringify((providerMetadata as Record<string, Record<string, unknown>>)?.anthropic?.usage)
      );
    },
  });
  await result.consumeStream();
}

async function main() {
  await once("非流式一");
  await once("非流式二");
  await onceStream("流式一");
  await onceStream("流式二");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
