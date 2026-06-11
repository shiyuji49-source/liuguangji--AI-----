"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import {
  Copy,
  FileText,
  ImagePlus,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ChatMeta = {
  costCredits?: number;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  docs?: { name: string; chars: number }[];
  createdAt?: string;
};

type Conversation = { id: string; title: string; createdAt: string };
type Doc = { name: string; text: string; chars: number };
type Img = { mediaType: string; dataUrl: string; name: string };

export function ChatWorkspace({
  appKey,
  projectId,
  mode,
  paramsBar,
  sendBody,
  allowDocUpload,
  allowImageUpload,
  artifactTypes,
  placeholder,
  prefill,
  autoSend,
}: {
  appKey: string;
  projectId: string;
  mode?: string;
  paramsBar?: React.ReactNode;
  sendBody?: () => Record<string, unknown>;
  allowDocUpload?: boolean;
  allowImageUpload?: boolean;
  artifactTypes: string[];
  placeholder?: string;
  /** 跨应用带入（仅「资产清单→提示词生成器」）：nonce 变化时把 text 填进输入框 */
  prefill?: { text: string; nonce: number } | null;
  /** 快捷操作：nonce 变化时把 text 作为消息直接发送（如「通读诊断」按钮） */
  autoSend?: { text: string; nonce: number } | null;
}) {
  const router = useRouter();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [images, setImages] = useState<Img[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [saveTarget, setSaveTarget] = useState<{ content: string } | null>(null);

  // 发送时才读取的最新参数：transport 的请求构造在事件时刻执行，从 ref 取最新值
  const activeIdRef = useRef<string | null>(null);
  const docsRef = useRef<Doc[]>([]);
  const sendBodyRef = useRef(sendBody);
  useEffect(() => {
    activeIdRef.current = activeId;
    docsRef.current = docs;
    sendBodyRef.current = sendBody;
  });

  const listUrl = useMemo(() => {
    const q = new URLSearchParams({ projectId, appKey });
    if (mode) q.set("mode", mode);
    return `/api/conversations?${q}`;
  }, [projectId, appKey, mode]);

  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, trigger }) => ({
          body: {
            conversationId: activeIdRef.current,
            trigger,
            messages: messages.slice(-1),
            params: {
              ...(sendBodyRef.current?.() ?? {}),
              docs: docsRef.current.map((d) => ({ name: d.name, text: d.text })),
            },
          },
        }),
      })
  );

  const { messages, setMessages, sendMessage, regenerate, status } = useChat({
    id: activeId ?? "pending",
    transport,
    onFinish: () => {
      void syncMessages(activeIdRef.current);
      void fetchConvs();
      router.refresh(); // 刷新顶栏余额
    },
    onError: (err) => {
      let msg = err.message;
      try {
        msg = (JSON.parse(err.message) as { error?: string }).error ?? msg;
      } catch {
        /* 非 JSON 错误体 */
      }
      toast.error(msg || "生成失败，请重试");
    },
  });
  const busy = status === "submitted" || status === "streaming";

  const fetchConvs = useCallback(async () => {
    const res = await fetch(listUrl);
    if (!res.ok) return [] as Conversation[];
    const data = await res.json();
    setConvs(data.conversations);
    return data.conversations as Conversation[];
  }, [listUrl]);

  const syncMessages = useCallback(
    async (id: string | null) => {
      if (!id) return;
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages as UIMessage[]);
    },
    [setMessages]
  );

  const createConv = useCallback(async () => {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, appKey, mode }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "创建会话失败");
      return null;
    }
    await fetchConvs();
    return data.conversation as Conversation;
  }, [projectId, appKey, mode, fetchConvs]);

  // 初始化：取会话列表，选中最新一条；为空则先建一个，
  // 保证首次发送前 useChat 的 id 已稳定（否则流式输出落在旧实例上不可见）
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let cancelled = false;
    (async () => {
      const list = await fetchConvs();
      if (cancelled) return;
      if (list.length > 0) {
        setActiveId(list[0].id);
        await syncMessages(list[0].id);
      } else {
        const conv = await createConv();
        if (!cancelled && conv) {
          setActiveId(conv.id);
          setMessages([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConvs, syncMessages, setMessages, createConv]);

  // 带入资产清单（唯一跨应用带入）。nonce 守卫以挂载时的值初始化：
  // 重挂载（HMR/切换工作区 key）时不得重放父组件里残留的旧信号
  const lastNonce = useRef(prefill?.nonce ?? 0);
  useEffect(() => {
    if (prefill && prefill.nonce !== lastNonce.current) {
      lastNonce.current = prefill.nonce;
      setInput((v) => (v ? `${v}\n\n${prefill.text}` : prefill.text));
    }
  }, [prefill]);

  // 快捷操作直接发送（同上，仅响应挂载后的新信号）
  const lastAutoSendNonce = useRef(autoSend?.nonce ?? 0);
  useEffect(() => {
    if (autoSend && autoSend.nonce !== lastAutoSendNonce.current) {
      lastAutoSendNonce.current = autoSend.nonce;
      void handleSend(autoSend.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend 每次渲染都是新引用，仅以 nonce 为触发信号
  }, [autoSend]);

  async function selectConv(id: string) {
    if (busy) return;
    setActiveId(id);
    setMessages([]);
    await syncMessages(id);
  }

  async function newConv() {
    if (busy) return;
    const conv = await createConv();
    if (conv) {
      setActiveId(conv.id);
      setMessages([]);
    }
  }

  async function deleteConv(id: string) {
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除失败");
      return;
    }
    const list = await fetchConvs();
    if (activeId === id) {
      if (list.length > 0) {
        setActiveId(list[0].id);
        await syncMessages(list[0].id);
      } else {
        const conv = await createConv();
        if (conv) {
          setActiveId(conv.id);
          setMessages([]);
        }
      }
    }
  }

  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text && docs.length === 0 && images.length === 0) return;
    if (busy) return;

    let convId = activeId;
    if (!convId) {
      const conv = await createConv();
      if (!conv) return;
      convId = conv.id;
      setActiveId(convId);
    }
    activeIdRef.current = convId;

    await sendMessage({
      text: text || "（见附件）",
      files: images.map((i) => ({ type: "file" as const, mediaType: i.mediaType, url: i.dataUrl })),
    });
    setInput("");
    setDocs([]);
    setImages([]);
  }

  async function onDocPicked(file: File) {
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "文件解析失败");
        return;
      }
      setDocs((d) => [...d, { name: data.name, text: data.text, chars: data.chars }]);
      if (data.truncated) toast.warning("文件过长，已截断到 80 万字");
    } finally {
      setExtracting(false);
    }
  }

  function onImagePicked(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("图片不能超过 4MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setImages((arr) => [...arr, { mediaType: file.type, dataUrl: String(reader.result), name: file.name }]);
    reader.readAsDataURL(file);
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="grid h-[calc(100vh-8.5rem)] grid-cols-[230px_1fr] gap-4">
      {/* 会话列表 */}
      <aside className="flex flex-col rounded-[10px] border border-border bg-card">
        <div className="border-b border-border p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={newConv} disabled={busy}>
            <Plus className="size-3.5" /> 新会话
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-2">
            {convs.map((c) => (
              <div
                key={c.id}
                className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                  c.id === activeId ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"
                }`}
                onClick={() => selectConv(c.id)}
              >
                <span className="flex-1 truncate">{c.title}</span>
                <button
                  className="hidden text-muted-foreground hover:text-destructive group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConv(c.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {convs.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无会话</p>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* 对话区 */}
      <section className="flex min-w-0 flex-col rounded-[10px] border border-border bg-card">
        {paramsBar && <div className="border-b border-border px-4 py-2">{paramsBar}</div>}

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {messages.length === 0 && !busy && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                发送第一条消息开始创作
              </p>
            )}
            {messages.map((m) => {
              const meta = (m.metadata ?? {}) as ChatMeta;
              const text = m.parts
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("");
              const files = m.parts.filter(
                (p): p is { type: "file"; mediaType: string; url: string } => p.type === "file"
              );
              const isUser = m.role === "user";
              return (
                <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`group max-w-[85%] rounded-[10px] px-4 py-3 text-sm leading-7 ${
                      isUser ? "bg-secondary" : "border border-border bg-background"
                    }`}
                  >
                    {files.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {files.map((f, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={f.url} alt="参考图" className="h-20 rounded-md border border-border" />
                        ))}
                      </div>
                    )}
                    {(meta.docs?.length ?? 0) > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {meta.docs!.map((d, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                          >
                            <FileText className="size-3" />
                            {d.name}（{d.chars.toLocaleString()} 字）
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{text}</div>

                    {!isUser && (
                      <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                        {typeof meta.costCredits === "number" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default text-primary">
                                消耗 {meta.costCredits.toLocaleString()} 积分
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="space-y-0.5 text-xs">
                                <div>模型：{meta.model}</div>
                                <div>输入：{meta.usage?.inputTokens?.toLocaleString() ?? 0} tokens</div>
                                <div>缓存命中：{meta.usage?.cacheReadTokens?.toLocaleString() ?? 0} tokens</div>
                                <div>缓存写入：{meta.usage?.cacheWriteTokens?.toLocaleString() ?? 0} tokens</div>
                                <div>输出：{meta.usage?.outputTokens?.toLocaleString() ?? 0} tokens</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5"
                            onClick={() => {
                              navigator.clipboard.writeText(text);
                              toast.success("已复制");
                            }}
                          >
                            <Copy className="size-3" /> 复制
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5"
                            onClick={() => setSaveTarget({ content: text })}
                          >
                            <Save className="size-3" /> 存为产物
                          </Button>
                          {m.id === lastAssistantId && !busy && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5"
                              onClick={() => regenerate()}
                            >
                              <RefreshCw className="size-3" /> 重新生成
                            </Button>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> 思考中…
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 输入区 */}
        <div className="border-t border-border p-3">
          {(docs.length > 0 || images.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-2">
              {docs.map((d, i) => (
                <span
                  key={`d${i}`}
                  className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-1 text-xs"
                >
                  <Paperclip className="size-3" />
                  {d.name}（{d.chars.toLocaleString()} 字）
                  <button onClick={() => setDocs((arr) => arr.filter((_, j) => j !== i))}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {images.map((img, i) => (
                <span key={`i${i}`} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="h-12 rounded border border-border" />
                  <button
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-background"
                    onClick={() => setImages((arr) => arr.filter((_, j) => j !== i))}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {allowDocUpload && (
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".docx,.pdf,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onDocPicked(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="icon" asChild disabled={extracting}>
                  <span>
                    {extracting ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                  </span>
                </Button>
              </label>
            )}
            {allowImageUpload && (
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    for (const f of Array.from(e.target.files ?? [])) onImagePicked(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="icon" asChild>
                  <span>
                    <ImagePlus className="size-4" />
                  </span>
                </Button>
              </label>
            )}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={placeholder ?? "输入消息，Enter 发送，Shift+Enter 换行"}
              className="max-h-40 min-h-[44px] flex-1 resize-none"
              rows={2}
            />
            <Button onClick={() => void handleSend()} disabled={busy} size="icon">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </Button>
          </div>
        </div>
      </section>

      <SaveArtifactDialog
        key={saveTarget ? saveTarget.content.slice(0, 64) : "none"}
        target={saveTarget}
        onClose={() => setSaveTarget(null)}
        projectId={projectId}
        conversationId={activeId}
        artifactTypes={artifactTypes}
      />
    </div>
  );
}

function SaveArtifactDialog({
  target,
  onClose,
  projectId,
  conversationId,
  artifactTypes,
}: {
  target: { content: string } | null;
  onClose: () => void;
  projectId: string;
  conversationId: string | null;
  artifactTypes: string[];
}) {
  const firstLine = target?.content.split("\n").find((l) => l.trim());
  const initialTitle = (firstLine ?? "未命名产物").replace(/^[#\s*->]+/, "").slice(0, 30);
  const [type, setType] = useState(artifactTypes[0]);
  const [title, setTitle] = useState(initialTitle);
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!target) return;
    setLoading(true);
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        type,
        title,
        content: target.content,
        sourceConversationId: conversationId ?? undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "保存失败");
      return;
    }
    toast.success("已存为产物");
    onClose();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>存为项目产物</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {artifactTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Button className="w-full" onClick={save} disabled={loading || !title.trim()}>
            {loading ? "保存中…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
