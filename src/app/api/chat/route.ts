import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import {
  streamText,
  generateText,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { db } from "@/lib/db";
import { conversations, messages as messagesTable } from "@/lib/db/schema";
import { requireUser, requireProjectMember, AuthError, toErrorResponse } from "@/lib/auth-helpers";
import { getApp, appsVisibleFor, promptModesFor, type PromptMode } from "@/apps/registry";
import { getSkillPrompt, buildRuntimeNote, type SkillKey } from "@/lib/ai/skills";
import { modelForApp, modelNameForApp, mainModel, MODEL_MAIN } from "@/lib/ai/llm";
import { precheck, chargeLlm, estimateLlmMaxCredits, type LlmUsage } from "@/lib/billing/charge";

export const maxDuration = 600;

type DocAttachment = { kind: "doc"; name: string; text: string };
type ImageAttachment = { kind: "image"; mediaType: string; dataUrl: string };
type Attachment = DocAttachment | ImageAttachment;

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  trigger: z.enum(["submit-message", "regenerate-message"]).default("submit-message"),
  messages: z.array(z.unknown()).default([]),
  params: z
    .object({
      episode: z.union([z.string(), z.number()]).optional(),
      aspect: z.string().max(20).optional(),
      // 剧本医生：项目级剧本注入（scope = "full" 全剧 | 集号）
      scriptId: z.string().uuid().optional(),
      scope: z.union([z.literal("full"), z.number().int().positive()]).optional(),
      docs: z
        .array(z.object({ name: z.string().max(200), text: z.string().max(900_000) }))
        .max(5)
        .default([]),
    })
    .default({ docs: [] }),
});

const MAX_OUTPUT = { heavy: 16384, main: 8192 };

/**
 * AI SDK usage → 计费 usage。
 * generateText 填充 inputTokenDetails；streamText（v6）该字段可能为空，
 * 此时回退读 usage.raw / providerMetadata.anthropic.usage 的 Anthropic 原始字段
 * （input_tokens 本身不含缓存分量）。
 */
function usageToLlmUsage(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    raw?: Record<string, unknown>;
  },
  providerMetadata?: Record<string, Record<string, unknown>>
): LlmUsage {
  const raw = (usage.raw ?? providerMetadata?.anthropic?.usage ?? {}) as Record<string, number>;
  const d = usage.inputTokenDetails ?? {};
  const cacheRead = d.cacheReadTokens ?? raw.cache_read_input_tokens ?? 0;
  const cacheWrite = d.cacheWriteTokens ?? raw.cache_creation_input_tokens ?? 0;
  const fresh =
    d.noCacheTokens ??
    raw.input_tokens ??
    Math.max((usage.inputTokens ?? 0) - cacheRead - cacheWrite, 0);
  return {
    inputTokens: fresh,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

/** DB 行 → 模型消息（附件文本包进用户消息，图片转 image part） */
function rowToModelMessage(row: {
  role: "user" | "assistant" | "system";
  content: string;
  attachments: unknown;
}): ModelMessage {
  if (row.role !== "user") {
    return { role: "assistant", content: row.content };
  }
  const atts = (row.attachments as Attachment[] | null) ?? [];
  const parts: Array<
    { type: "text"; text: string } | { type: "image"; image: string }
  > = [];
  for (const a of atts) {
    if (a.kind === "image") parts.push({ type: "image", image: a.dataUrl });
  }
  let text = row.content;
  for (const a of atts) {
    if (a.kind === "doc") {
      text += `\n\n<附件文件 name="${a.name}">\n${a.text}\n</附件文件>`;
    }
  }
  if (parts.length === 0) return { role: "user", content: text };
  parts.push({ type: "text", text });
  return { role: "user", content: parts };
}

async function generateTitle(opts: {
  userId: string;
  conversationId: string;
  userText: string;
}) {
  const { text, usage } = await generateText({
    model: mainModel(),
    prompt: `用不超过 12 个字给下面这条创作请求起一个中文标题，只输出标题本身，不要引号和标点：\n\n${opts.userText.slice(0, 500)}`,
    maxOutputTokens: 100,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  const title = text.trim().slice(0, 20);
  if (title) {
    await db.update(conversations).set({ title }).where(eq(conversations.id, opts.conversationId));
  }
  await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: usageToLlmUsage(usage),
    ref: { appKey: "platform", note: "会话标题", conversationId: opts.conversationId },
  });
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: "请求参数不正确" }, { status: 400 });
    const { conversationId, trigger, params } = parsed.data;
    const incoming = parsed.data.messages as UIMessage[];

    const user = await requireUser();
    const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
    if (!conv) throw new AuthError("会话不存在", 404);
    if (conv.createdBy !== user.id) throw new AuthError("无权访问该会话", 403); // 会话隔离
    if (!conv.projectId) throw new AuthError("会话未关联项目", 400);

    const app = getApp(conv.appKey);
    if (!app) throw new AuthError("应用不存在", 404);
    const { project, projectRole } = await requireProjectMember(conv.projectId);
    // API 层应用可见性校验（与 UI 双重）
    if (!appsVisibleFor(projectRole).some((a) => a.key === app.key)) {
      throw new AuthError("当前角色无权使用该应用", 403);
    }

    // skill 选择：剧本医生固定；提示词生成器按会话 mode（并校验角色工作区权限）
    let skillKey: SkillKey;
    if (app.key === "script-doctor") {
      skillKey = "script-doctor";
    } else if (app.key === "prompt-studio") {
      const mode = conv.mode as PromptMode | null;
      if (!mode || !promptModesFor(projectRole).includes(mode)) {
        throw new AuthError("当前角色无权使用该工作区", 403);
      }
      skillKey = mode;
    } else {
      throw new AuthError("该应用不支持对话", 400);
    }

    // 1) 取服务端权威历史，并组装本轮工作集（先预检后写库，402 时不留孤儿消息）
    const stored = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(asc(messagesTable.createdAt));

    type WorkingRow = {
      role: "user" | "assistant" | "system";
      content: string;
      attachments: Attachment[] | null;
    };
    let rows: WorkingRow[];
    let toDeleteId: string | null = null;
    let newUserMessage: WorkingRow | null = null;

    if (trigger === "regenerate-message") {
      const last = stored[stored.length - 1];
      if (last?.role === "assistant") {
        toDeleteId = last.id;
        rows = stored.slice(0, -1) as WorkingRow[];
      } else {
        rows = stored as WorkingRow[];
      }
    } else {
      const lastIncoming = incoming[incoming.length - 1] as UIMessage | undefined;
      const textParts: string[] = [];
      const images: ImageAttachment[] = [];
      for (const part of lastIncoming?.parts ?? []) {
        if (part.type === "text") textParts.push(part.text);
        if (part.type === "file" && part.mediaType?.startsWith("image/") && part.url) {
          images.push({ kind: "image", mediaType: part.mediaType, dataUrl: part.url });
        }
      }
      const docs: DocAttachment[] = params.docs.map((d) => ({ kind: "doc", ...d }));
      const content = textParts.join("\n").trim();
      if (!content && docs.length === 0 && images.length === 0) {
        return Response.json({ error: "消息为空" }, { status: 400 });
      }
      newUserMessage = {
        role: "user",
        content,
        attachments: images.length || docs.length ? [...docs, ...images] : null,
      };
      rows = [...(stored as WorkingRow[]), newUserMessage];
    }
    if (rows.length === 0 || rows[rows.length - 1].role !== "user") {
      return Response.json({ error: "没有可生成的用户消息" }, { status: 400 });
    }

    const skillText = getSkillPrompt(skillKey);

    // 项目级剧本注入（仅剧本医生）：全剧=独立缓存块（与 skill 同享前缀缓存）；单集=轻量注入
    let scriptBlock = "";
    let scopeEpisode: number | undefined;
    if (app.key === "script-doctor" && params.scriptId) {
      const { loadScriptForDirector } = await import("@/lib/scripts/access");
      const { scriptEpisodes } = await import("@/lib/db/schema");
      const { asc: ascFn } = await import("drizzle-orm");
      const script = await loadScriptForDirector(params.scriptId);
      if (script.projectId !== conv.projectId) throw new AuthError("剧本不属于该项目", 403);

      if (params.scope === "full" || params.scope === undefined) {
        const eps = await db
          .select()
          .from(scriptEpisodes)
          .where(eq(scriptEpisodes.scriptId, script.id))
          .orderBy(ascFn(scriptEpisodes.episodeNo));
        scriptBlock =
          `【项目剧本《${script.title}》全剧 · 共 ${eps.length} 集】\n\n` +
          eps
            .map((e) => `=== 第 ${e.episodeNo} 集${e.title ? ` · ${e.title}` : ""} ===\n\n${e.content}`)
            .join("\n\n");
      } else {
        scopeEpisode = params.scope;
        const episode = await db.query.scriptEpisodes.findFirst({
          where: and(
            eq(scriptEpisodes.scriptId, script.id),
            eq(scriptEpisodes.episodeNo, params.scope)
          ),
        });
        if (!episode) throw new AuthError("该集不存在", 404);
        scriptBlock = `【项目剧本《${script.title}》第 ${episode.episodeNo} 集${episode.title ? ` · ${episode.title}` : ""}】\n\n${episode.content}`;
      }
    }

    const runtimeNote = buildRuntimeNote({
      tier: project.tier,
      aspect: params.aspect,
      episode: scopeEpisode ?? params.episode,
    });

    // 2) 预检（按上限估：全部输入按未命中缓存计 + 最大输出）；通过后才写库
    const isHeavy = app.key === "script-doctor";
    const maxOutputTokens = isHeavy ? MAX_OUTPUT.heavy : MAX_OUTPUT.main;
    const modelName = modelNameForApp(app.key);
    let inputChars = skillText.length + scriptBlock.length + runtimeNote.length;
    let imageCount = 0;
    for (const r of rows) {
      inputChars += r.content.length;
      for (const a of r.attachments ?? []) {
        if (a.kind === "doc") inputChars += a.text.length;
        else imageCount += 1;
      }
    }
    const estimate = await estimateLlmMaxCredits(modelName, inputChars, maxOutputTokens + imageCount * 2000);
    await precheck(user.id, estimate);

    // 3) 预检通过：落库本轮用户消息 / 删除被重生成的回复
    if (toDeleteId) {
      await db
        .delete(messagesTable)
        .where(and(eq(messagesTable.id, toDeleteId), eq(messagesTable.conversationId, conv.id)));
    }
    if (newUserMessage) {
      await db.insert(messagesTable).values({
        conversationId: conv.id,
        role: newUserMessage.role,
        content: newUserMessage.content,
        attachments: newUserMessage.attachments,
      });
    }

    const history = rows.map((r) =>
      rowToModelMessage({ role: r.role, content: r.content, attachments: r.attachments })
    );

    // 运行时附注贴在最后一条用户消息上（发送时拼接，不入库）：
    // 既保证 system 块字节稳定（缓存前缀不被参数变化打破），
    // 也规避乐奇部分上游对多 system 块的丢弃问题
    if (runtimeNote) {
      const last = history[history.length - 1];
      if (last.role === "user") {
        if (typeof last.content === "string") {
          last.content = `${last.content}\n\n${runtimeNote}`;
        } else if (Array.isArray(last.content)) {
          const textPart = [...last.content].reverse().find((p) => p.type === "text");
          if (textPart && "text" in textPart) textPart.text = `${textPart.text}\n\n${runtimeNote}`;
        }
      }
    }

    // 单一 system 块（skill + 项目剧本）+ 单缓存断点。
    // 不拆多块：实测乐奇部分上游只保留单 system 块，多块会丢失 skill。
    const systemText = scriptBlock ? `${skillText}\n\n${"=".repeat(20)}\n\n${scriptBlock}` : skillText;
    const modelMessages: ModelMessage[] = [
      {
        role: "system",
        content: systemText,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      ...history,
    ];

    const isFirstExchange = conv.title === "新会话";
    const firstUserText = rows.find((r) => r.role === "user")?.content ?? "";

    // 4) 流式生成；onFinish 按实际 usage 扣费并落库
    const result = streamText({
      model: modelForApp(app.key),
      messages: modelMessages,
      maxOutputTokens,
      providerOptions: { anthropic: { metadata: { userId: user.id } } },
      onFinish: async ({ text, usage, providerMetadata }) => {
        try {
          const llmUsage = usageToLlmUsage(
            usage,
            providerMetadata as Record<string, Record<string, unknown>> | undefined
          );
          const { credits } = await chargeLlm({
            userId: user.id,
            model: modelName,
            usage: llmUsage,
            ref: {
              appKey: app.key,
              mode: conv.mode ?? undefined,
              conversationId: conv.id,
              projectId: conv.projectId,
            },
          });
          await db.insert(messagesTable).values({
            conversationId: conv.id,
            role: "assistant",
            content: text,
            meta: { costCredits: credits, usage: llmUsage, model: modelName },
          });
          if (isFirstExchange) {
            void generateTitle({
              userId: user.id,
              conversationId: conv.id,
              userText: firstUserText,
            }).catch((e) => console.error("标题生成失败", e));
          }
        } catch (e) {
          console.error("结算/落库失败", e);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    return toErrorResponse(e);
  }
}
