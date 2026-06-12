"use client";

import { useRef, useState } from "react";
import { Wand2, RefreshCw, Save, Trash2, Copy, Loader2, ChevronDown, ChevronRight, MessageSquarePlus, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export type PromptItem = {
  id: string;
  workspace: string;
  kind: string;
  name: string;
  brief: string;
  episodes?: number[] | null;
  episodeNo: number | null;
  promptText: string | null;
  state: "empty" | "generating" | "done" | "failed";
  error?: string | null;
  params?: { credits?: number } | null;
};

const STATE_LABEL: Record<PromptItem["state"], { text: string; cls: string }> = {
  empty: { text: "未生成", cls: "text-muted-foreground" },
  generating: { text: "生成中", cls: "text-primary" },
  done: { text: "已生成", cls: "text-primary" },
  failed: { text: "失败", cls: "text-destructive" },
};

/** 一条 = 一张卡：内嵌提示词文本 + 生成/重生成/编辑/存档/删除 + 状态徽标（非对话） */
export function PromptItemCard({
  item,
  showKind,
  onGenerate,
  onEdit,
  onSave,
  onDelete,
}: {
  item: PromptItem;
  showKind: boolean;
  onGenerate: (refine?: string) => void;
  onEdit: (text: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  // 非受控 textarea + ref：key 随 promptText 变化（生成完成即重挂），编辑经 onBlur 落库，
  // 避免在渲染/effect 里 setState 同步外部值
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const st = STATE_LABEL[item.state];
  const busy = item.state === "generating";
  const hasText = !!item.promptText;

  return (
    <Card className={busy ? "card-generating" : ""}>
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          {showKind && (
            <Badge variant="outline" className="border-primary/40 text-primary">
              {item.kind}
            </Badge>
          )}
          <span className="truncate text-sm font-medium">{item.name}</span>
          {!!item.episodes?.length && (
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground" title="出现集数">
              {epRangeLabel(item.episodes)}
            </Badge>
          )}
          <span className={`ml-auto text-xs ${st.cls}`}>
            {busy && <Loader2 className="mr-1 inline size-3 animate-spin" />}
            {st.text}
          </span>
        </div>

        {item.brief && <p className="line-clamp-2 text-xs text-muted-foreground">{item.brief}</p>}

        {expanded && (
          <>
            {hasText || item.state === "done" ? (
              <Textarea
                key={item.promptText ?? "empty"}
                ref={ref}
                defaultValue={item.promptText ?? ""}
                onBlur={() => {
                  const v = ref.current?.value ?? "";
                  if (v !== (item.promptText ?? "")) onEdit(v);
                }}
                className="max-h-80 min-h-32 resize-y overflow-y-auto text-sm leading-6"
                placeholder="生成的提示词将显示在这里，可直接编辑"
              />
            ) : item.state === "failed" ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {item.error ?? "生成失败"}
              </p>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                还未生成，点「生成提示词」
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1">
              <Button variant="outline" size="sm" className="h-7" onClick={() => onGenerate()} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : hasText ? (
                  <RefreshCw className="size-3.5" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                {hasText ? "重新生成" : "生成提示词"}
              </Button>
              {hasText && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      navigator.clipboard.writeText(ref.current?.value ?? item.promptText ?? "");
                      toast.success("已复制");
                    }}
                  >
                    <Copy className="size-3.5" /> 复制
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={onSave}>
                    <Save className="size-3.5" /> 存为产物
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => setRefineOpen((v) => !v)}
                    disabled={busy}
                  >
                    <MessageSquarePlus className="size-3.5" /> 改
                  </Button>
                </>
              )}
              {typeof item.params?.credits === "number" && (
                <span className="text-xs text-muted-foreground">消耗 {item.params.credits} 积分</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
                disabled={busy}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            {refineOpen && (
              <div className="flex items-center gap-1.5">
                <Input
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  placeholder="说出修改要求，按要求重新生成（如：运镜再克制一点 / 加一句台词）"
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && refineText.trim() && !busy) {
                      onGenerate(refineText.trim());
                      setRefineOpen(false);
                      setRefineText("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={!refineText.trim() || busy}
                  onClick={() => {
                    onGenerate(refineText.trim());
                    setRefineOpen(false);
                    setRefineText("");
                  }}
                >
                  <Send className="size-3.5" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 集数折叠标注：1,2,3,5 → 1-3、5 集 */
function epRangeLabel(arr: number[]): string {
  const parts: string[] = [];
  let s = arr[0];
  let p = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    if (i < arr.length && arr[i] === p + 1) {
      p = arr[i];
      continue;
    }
    parts.push(s === p ? `${s}` : `${s}-${p}`);
    if (i < arr.length) {
      s = arr[i];
      p = arr[i];
    }
  }
  return `第${parts.join("、")}集`;
}
