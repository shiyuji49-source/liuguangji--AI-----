"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, RefreshCw, Copy, Save, Loader2, Film, Camera, MessageSquarePlus, Send, Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Elapsed } from "./stopwatch";
import type { Shot } from "./types";

const STATE_LABEL: Record<Shot["stillState"], { text: string; cls: string }> = {
  empty: { text: "未生成", cls: "text-muted-foreground" },
  generating: { text: "生成中", cls: "text-primary" },
  done: { text: "已生成", cls: "text-primary" },
  failed: { text: "失败", cls: "text-destructive" },
};

/**
 * 阶段③静帧 / 阶段④视频：从分镜表逐镜生成提示词。
 * 静帧 = 分镜大师 skill（24 字段 + 成品提示词，needStill 取舍）；
 * 视频 = Seedance skill（带静帧锚 + 关联资产，分级定骨架）。
 */
export function ShotPromptsStage({
  target,
  shots,
  onShotsChange,
  tier,
  onBusyChange,
}: {
  target: "still" | "video";
  shots: Shot[];
  onShotsChange: (shots: Shot[]) => void;
  tier: string;
  /** 批量生成进行中（父级用来锁定剧本/集选择，防止中途切换） */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [onlyNeeded, setOnlyNeeded] = useState(target === "still");

  const stateKey = target === "still" ? "stillState" : "videoState";
  const promptKey = target === "still" ? "stillPrompt" : "videoPrompt";

  const relevant = target === "still" && onlyNeeded ? shots.filter((s) => s.needStill) : shots;

  function setShot(id: string, patch: Partial<Shot>) {
    onShotsChange(shots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function generateOne(shot: Shot, refine?: string): Promise<boolean> {
    setShot(shot.id, { [stateKey]: "generating" } as Partial<Shot>);
    const res = await fetch(`/api/prompt-studio/shots/${shot.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, refine }),
    });
    const data = await res.json();
    if (!res.ok) {
      setShot(shot.id, {
        [stateKey]: "failed",
        [target === "still" ? "stillError" : "videoError"]: data.error,
      } as Partial<Shot>);
      return false;
    }
    setShot(shot.id, { [stateKey]: "done", [promptKey]: data.promptText } as Partial<Shot>);
    return true;
  }

  async function handleOne(shot: Shot, refine?: string) {
    const ok = await generateOne(shot, refine);
    if (ok) router.refresh();
    else toast.error("生成失败（余额不足或服务异常）");
  }

  async function generateAll() {
    const pending = relevant.filter((s) => s[stateKey] !== "done");
    if (pending.length === 0) {
      toast.info("没有待生成的镜");
      return;
    }
    const total = pending.length;
    setBatch({ done: 0, total });
    onBusyChange?.(true);
    let done = 0;
    let failed = 0;
    try {
      const queue = [...pending];
      const worker = async () => {
        while (queue.length) {
          const s = queue.shift()!;
          if (!(await generateOne(s))) failed++;
          done++;
          setBatch({ done, total });
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      setBatch(null);
      onBusyChange?.(false);
    }
    router.refresh();
    if (failed) toast.warning(`完成，${failed} 镜失败（可单独重试）`);
    else toast.success("全部生成完成");
  }

  if (shots.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          本集还没有分镜表。先到「分镜表」阶段构建，再回来逐镜生成
          {target === "still" ? "静帧" : "视频"}提示词。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <Button variant="outline" size="sm" className="h-8" onClick={generateAll} disabled={!!batch}>
          {batch ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> 生成中 {batch.done}/{batch.total}{" "}
              <Elapsed running className="ml-1 text-xs" />
            </>
          ) : (
            <>
              <Wand2 className="size-3.5" /> 批量生成{target === "still" ? "（按取舍）" : "全部"}
            </>
          )}
        </Button>
        {target === "still" && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyNeeded}
              onChange={(e) => setOnlyNeeded(e.target.checked)}
              disabled={!!batch}
              className="accent-[var(--primary)]"
            />
            只看需出静帧的镜（{tier} 级取舍，可在分镜表改）
          </label>
        )}
        {shots.length > 0 && (
          <Button variant="ghost" size="sm" className="h-8" asChild>
            <a
              href={`/api/projects/${shots[0].projectId}/export?type=${target === "still" ? "stills" : "segments"}&scriptId=${shots[0].scriptId}&episodeNo=${shots[0].episodeNo}`}
              download
            >
              <Download className="size-3.5" /> 导出 Excel
            </a>
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {relevant.filter((s) => s[stateKey] === "done").length}/{relevant.length} 已生成
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {relevant.map((shot) => (
          <ShotPromptCard
            key={shot.id}
            shot={shot}
            target={target}
            onGenerate={(refine) => handleOne(shot, refine)}
            onEdit={async (text) => {
              setShot(shot.id, { [promptKey]: text } as Partial<Shot>);
              await fetch(`/api/prompt-studio/shots/${shot.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [promptKey]: text }),
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ShotPromptCard({
  shot,
  target,
  onGenerate,
  onEdit,
}: {
  shot: Shot;
  target: "still" | "video";
  onGenerate: (refine?: string) => void;
  onEdit: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const state = target === "still" ? shot.stillState : shot.videoState;
  const prompt = target === "still" ? shot.stillPrompt : shot.videoPrompt;
  const error = target === "still" ? shot.stillError : shot.videoError;
  const credits = target === "still" ? shot.params?.stillCredits : shot.params?.videoCredits;
  const st = STATE_LABEL[state];
  const busy = state === "generating";

  async function saveArtifact() {
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: shot.projectId,
        type: target === "still" ? "静帧提示词" : "视频提示词",
        title: `第${shot.episodeNo}集 镜${shot.shotNo}${shot.sceneLabel ? ` ${shot.sceneLabel}` : ""}`,
        content: ref.current?.value ?? prompt ?? "",
      }),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("已存为产物");
  }

  return (
    <Card className={busy ? "card-generating" : ""}>
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-center gap-2">
          {target === "still" ? (
            <Camera className="size-3.5 text-primary" />
          ) : (
            <Film className="size-3.5 text-primary" />
          )}
          <span className="text-sm font-medium">镜 {shot.shotNo}</span>
          {shot.sceneLabel && <span className="text-xs text-muted-foreground">{shot.sceneLabel}</span>}
          {shot.shotType && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {shot.shotType}
            </Badge>
          )}
          {target === "video" && shot.stillPrompt && (
            <Badge variant="outline" className="border-primary/40 px-1.5 py-0 text-[10px] text-primary">
              有静帧锚
            </Badge>
          )}
          <span className={`ml-auto text-xs ${st.cls}`}>
            {busy && <Loader2 className="mr-1 inline size-3 animate-spin" />}
            {st.text}
            {busy && <Elapsed running className="ml-1" />}
          </span>
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground">
          {shot.summary}
          {shot.cameraMove ? ` · ${shot.cameraMove}` : ""}
          {shot.dialogue ? `　「${shot.dialogue}」` : ""}
        </p>
        {((shot.assetRefs as string[] | null) ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(shot.assetRefs as string[]).map((a) => (
              <Badge key={a} variant="outline" className="px-1 py-0 text-[10px]">
                {a}
              </Badge>
            ))}
          </div>
        )}

        {prompt || state === "done" ? (
          <Textarea
            key={prompt ?? "empty"}
            ref={ref}
            defaultValue={prompt ?? ""}
            onBlur={() => {
              const v = ref.current?.value ?? "";
              if (v !== (prompt ?? "")) onEdit(v);
            }}
            className="max-h-80 min-h-32 resize-y overflow-y-auto text-sm leading-6"
          />
        ) : state === "failed" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error ?? "生成失败"}
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {target === "still" ? "未生成。24 字段 + 成品提示词" : "未生成。Seedance 提示词（分级定骨架）"}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" className="h-7" onClick={() => onGenerate()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : prompt ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Wand2 className="size-3.5" />
            )}
            {prompt ? "重新生成" : "生成提示词"}
          </Button>
          {prompt && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => {
                  navigator.clipboard.writeText(ref.current?.value ?? prompt ?? "");
                  toast.success("已复制");
                }}
              >
                <Copy className="size-3.5" /> 复制
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={saveArtifact}>
                <Save className="size-3.5" /> 存为产物
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setRefineOpen((v) => !v)} disabled={busy}>
                <MessageSquarePlus className="size-3.5" /> 改
              </Button>
            </>
          )}
          {typeof credits === "number" && (
            <span className="ml-auto text-xs text-muted-foreground">消耗 {credits} 积分</span>
          )}
        </div>

        {refineOpen && (
          <div className="flex items-center gap-1.5">
            <Input
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="说出修改要求，按要求重新生成本镜提示词"
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
      </CardContent>
    </Card>
  );
}
