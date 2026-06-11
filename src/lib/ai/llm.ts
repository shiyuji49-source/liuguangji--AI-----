import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * LLM 接入（规划书 §2）：乐奇API Anthropic 原生兼容端点。
 * 鉴权头可切换：bearer（乐奇，Authorization: Bearer lq-xxx）| x-api-key（Anthropic 官方，切换预案）。
 * 模型用裸名；两档路由 heavy/main 由 env 决定。
 */
const AUTH_STYLE = process.env.LLM_AUTH_STYLE ?? "bearer";

function provider() {
  const apiKey = process.env.LLM_API_KEY ?? "";
  const baseURL = `${(process.env.LLM_BASE_URL ?? "https://lqapi.top").replace(/\/+$/, "")}/v1`;
  return createAnthropic({
    baseURL,
    apiKey,
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (AUTH_STYLE === "bearer" && init) {
        const headers = new Headers(init.headers);
        headers.delete("x-api-key");
        headers.set("authorization", `Bearer ${apiKey}`);
        init = { ...init, headers };
      }
      if (process.env.LLM_DEBUG === "1" && init?.body) {
        try {
          const body = JSON.parse(String(init.body)) as {
            model?: string;
            system?: { cache_control?: unknown; text?: string }[];
          };
          console.log(
            "[llm] model=%s system=%s",
            body.model,
            JSON.stringify(body.system?.map((b) => ({ cc: b.cache_control, chars: b.text?.length })))
          );
        } catch {
          /* 非 JSON body 忽略 */
        }
      }
      return fetch(url, init);
    }) as typeof fetch,
  });
}

export const MODEL_HEAVY = () => process.env.LLM_MODEL_HEAVY ?? "claude-opus-4-8";
export const MODEL_MAIN = () => process.env.LLM_MODEL_MAIN ?? "claude-sonnet-4-6";

/** 剧本医生（1M 上下文通读长剧本） */
export function heavyModel() {
  return provider()(MODEL_HEAVY());
}

/** 其余一切：提示词生成器三工作区 + 会话标题等轻任务 */
export function mainModel() {
  return provider()(MODEL_MAIN());
}

export function modelForApp(appKey: string) {
  return appKey === "script-doctor" ? heavyModel() : mainModel();
}

export function modelNameForApp(appKey: string) {
  return appKey === "script-doctor" ? MODEL_HEAVY() : MODEL_MAIN();
}
