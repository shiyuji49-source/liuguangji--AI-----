"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, RefreshCw, Copy, Save, Loader2, Film, Scissors, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { Shot } from "./types";

export type VideoSegment = {
  id: string;
  projectId: string;
  scriptId: string;
  episodeNo: number;
  segmentNo: number;
  label: string;
  shotNos: number[];
  durationSec: number | null;
  prompt: string | null;
  state: "empty" | "generating" | "done" | "failed";
  error: string | null;
  params: { credits?: number } | null;
};

const STATE_LABEL: Record<VideoSegment["state"], { text: string; cls: string }> = {
  empty: { text: "未生成", cls: "text-muted-foreground" },
  generating: { text: "生成中", cls: "text-primary" },
  done: { text: "已生成", cls: "text-primary" },
  failed: { text: "失败", cls: "text-destructive" },
};

/**
 * 阶段④视频（多镜合并）：「划分片段」把整集分镜表按 skill 规则分组（同场/同角色组/
 * 情绪连续/≤15s），每片段生成**一条**含多镜时序切片的 Seedance 提示词。不做一镜一提示词。
 */
export function VideoSegmentsStage({
  projectId,
  scriptId,
  episodeNo,
  shots,
  segments,
  onSegmentsChange,
  onBusyChange,
}: {
  projectId: string;
  scriptId: string | null;
  episodeNo: number | null;
  shots: Shot[];
  segments: VideoSegment[];
  onSegmentsChange: (segments: VideoSegment[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [planning, setPlanning] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  function setSegment(id: string, patch: Partial<VideoSegment>) {
    onSegmentsChange(segments.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function plan(replace: boolean) {
    if (!scriptId || !episodeNo) return;
    setPlanning(true);
    try {
      const res = await fetch("/api/prompt-studio/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, scriptId, episodeNo, replace }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needConfirm) {
        if (confirm(data.error)) await plan(true);
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "划分失败");
        return;
      }
      onSegmentsChange(data.segments);
      toast.success(`已划分 ${data.segments.length} 个片段（消耗 ${data.credits} 积分）`);
      router.refresh();
    } finally {
      setPlanning(false);
    }
  }

  async function generateOne(seg: VideoSegment): Promise<boolean> {
    setSegment(seg.id, { state: "generating" });
    const res = await fetch(`/api/prompt-studio/segments/${seg.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      setSegment(seg.id, { state: "failed", error: data.error });
      return false;
    }
    setSegment(seg.id, { state: "done", prompt: data.promptText, error: null });
    return true;
  }

  async function handleOne(seg: VideoSegment) {
    const ok = await generateOne(seg);
    if (ok) router.refresh();
    else toast.error("生成失败（余额不足或服务异常）");
  }

  async function generateAll() {
    const pending = segments.filter((s) => s.state !== "done");
    if (pending.length === 0) {
      toast.info("没有待生成的片段");
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
    if (failed) toast.warning(`完成，${failed} 个片段失败（可单独重试）`);
    else toast.success("全部生成完成");
  }

  async function deleteSegment(id: string) {
    await fetch(`/api/prompt-studio/segments/${id}`, { method: "DELETE" });
    onSegmentsChange(segments.filter((s) => s.id !== id));
  }

  if (shots.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          本集还没有分镜表。先到「分镜表」阶段构建，再回来划分片段、生成视频提示词。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-sm">
        <Button size="sm" className="h-8" onClick={() => plan(false)} disabled={planning || !!batch}>
          {planning ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
          {segments.length > 0 ? "重新划分片段" : "划分片段"}
        </Button>
        {segments.length > 0 && (
          <Button variant="outline" size="sm" className="h-8" onClick={generateAll} disabled={!!batch || planning}>
            {batch ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> 生成中 {batch.done}/{batch.total}
              </>
            ) : (
              <>
                <Wand2 className="size-3.5" /> 批量生成全部
              </>
            )}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {segments.length > 0
            ? `${segments.length} 个片段（${shots.length} 镜合并）· ${segments.filter((s) => s.state === "done").length} 已生成`
            : "一条提示词 = 一个 ≤15 秒片段（内含多镜），先划分"}
        </span>
      </div>

      {segments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            点「划分片段」：按 skill 规则把本集 {shots.length} 镜按「同场景/同角色组/情绪连续/≤15
            秒」合并成若干片段，每个片段生成一条多镜时序切片的 Seedance 提示词。
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {segments.map((seg) => (
            <SegmentCard
              key={seg.id}
              segment={seg}
              shots={shots}
              onGenerate={() => handleOne(seg)}
              onEdit={async (text) => {
                setSegment(seg.id, { prompt: text });
                await fetch(`/api/prompt-studio/segments/${seg.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ prompt: text }),
                });
              }}
              onDelete={() => deleteSegment(seg.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentCard({
  segment,
  shots,
  onGenerate,
  onEdit,
  onDelete,
}: {
  segment: VideoSegment;
  shots: Shot[];
  onGenerate: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const st = STATE_LABEL[segment.state];
  const busy = segment.state === "generating";
  const memberShots = shots.filter((s) => (segment.shotNos ?? []).includes(s.shotNo));
  const stillCount = memberShots.filter((s) => s.stillPrompt).length;

  async function saveArtifact() {
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: segment.projectId,
        type: "视频提示词",
        title: `第${segment.episodeNo}集 片段${segment.segmentNo}${segment.label ? ` ${segment.label}` : ""}`,
        content: ref.current?.value ?? segment.prompt ?? "",
      }),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("已存为产物");
  }

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Film className="size-3.5 text-primary" />
          <span className="text-sm font-medium">片段 {segment.segmentNo}</span>
          {segment.label && <span className="text-xs text-muted-foreground">{segment.label}</span>}
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            镜 {(segment.shotNos ?? []).join("、")}
          </Badge>
          {segment.durationSec && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              ~{segment.durationSec}s
            </Badge>
          )}
          {stillCount > 0 && (
            <Badge variant="outline" className="border-primary/40 px-1.5 py-0 text-[10px] text-primary">
              {stillCount} 静帧锚
            </Badge>
          )}
          <span className={`ml-auto text-xs ${st.cls}`}>
            {busy && <Loader2 className="mr-1 inline size-3 animate-spin" />}
            {st.text}
          </span>
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground">
          {memberShots.map((s) => `镜${s.shotNo} ${s.summary.slice(0, 18)}`).join(" → ")}
        </p>

        {segment.prompt || segment.state === "done" ? (
          <Textarea
            key={segment.prompt ?? "empty"}
            ref={ref}
            defaultValue={segment.prompt ?? ""}
            onBlur={() => {
              const v = ref.current?.value ?? "";
              if (v !== (segment.prompt ?? "")) onEdit(v);
            }}
            className="min-h-40 text-sm leading-6"
          />
        ) : segment.state === "failed" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {segment.error ?? "生成失败"}
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            未生成。一条 ≤15 秒多镜提示词：技术规格块 + @资产声明 + 空间布局 + 时序切片五要素 + 质量锚定语
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" className="h-7" onClick={onGenerate} disabled={busy}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : segment.prompt ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Wand2 className="size-3.5" />
            )}
            {segment.prompt ? "重新生成" : "生成提示词"}
          </Button>
          {segment.prompt && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => {
                  navigator.clipboard.writeText(ref.current?.value ?? segment.prompt ?? "");
                  toast.success("已复制");
                }}
              >
                <Copy className="size-3.5" /> 复制
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={saveArtifact}>
                <Save className="size-3.5" /> 存为产物
              </Button>
            </>
          )}
          {typeof segment.params?.credits === "number" && (
            <span className="text-xs text-muted-foreground">消耗 {segment.params.credits} 积分</span>
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
      </CardContent>
    </Card>
  );
}
