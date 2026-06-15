"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2, Film, Play, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

type ScriptLite = { id: string; title: string };
type EpisodeLite = { episodeNo: number; title: string };
type Segment = {
  id: string;
  segmentNo: number;
  label: string;
  shotNos: number[];
  durationSec: number | null;
  prompt: string | null;
  params: { videoState?: string; videoKey?: string } | null;
};

const RES = [
  { key: "480p", label: "标清 480p" },
  { key: "720p", label: "高清 720p" },
  { key: "1080p", label: "超清 1080p" },
] as const;

/**
 * 应用 · 视频生成器（P2）：读分镜片段（提示词生成器产出的多镜合并 Seedance 提示词），
 * 逐片段送 Seedance 2.0 异步出片（提交→轮询→入资产墙→时间线预览）。
 */
export function VideoStudioApp({
  projectId,
  projectName,
  projectTier,
  projectAspect,
  projectProductionType,
  projectStyleGenre,
}: {
  projectId: string;
  projectName: string;
  projectTier: ProjectTier;
  projectAspect: string;
  projectProductionType: string;
  projectStyleGenre: string;
  projectRole: ProjectRole;
  userId: string;
}) {
  const [scripts, setScripts] = useState<ScriptLite[]>([]);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [epNo, setEpNo] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [busy, setBusy] = useState<Record<string, boolean>>({}); // segId → 生成中
  const polling = useRef<Set<string>>(new Set());
  // 参考图（从资产墙选，锁角色一致性；本集所有片段共用，Seedance 2.0 ≤9 张）
  const [refAssets, setRefAssets] = useState<{ id: string; atName: string; filePath: string }[]>([]);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refPickerOpen, setRefPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${projectId}/scripts`);
      if (res.ok) {
        const data = await res.json();
        setScripts(data.scripts);
        if (data.scripts.length) setScriptId((c) => c ?? data.scripts[0].id);
      }
      // 资产墙里的图片资产（供选参考图，排除视频）
      const ar = await fetch(`/api/image-studio/assets?projectId=${projectId}`);
      if (ar.ok) {
        const list: { id: string; atName: string; filePath: string; kind: string }[] = (await ar.json()).assets;
        setRefAssets(list.filter((a) => a.kind !== "视频"));
      }
    })();
  }, [projectId]);

  function toggleRef(id: string) {
    setRefIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length >= 9 ? r : [...r, id]));
  }

  useEffect(() => {
    (async () => {
      if (!scriptId) return;
      const res = await fetch(`/api/scripts/${scriptId}`);
      if (!res.ok) return;
      const data = await res.json();
      setEpisodes(data.episodes);
      setEpNo((c) => {
        if (c !== null && data.episodes.some((e: EpisodeLite) => e.episodeNo === c)) return c;
        const first = data.episodes.find((e: EpisodeLite) => e.episodeNo > 0) ?? data.episodes[0];
        return first ? first.episodeNo : null;
      });
    })();
  }, [scriptId]);

  const loadSegments = useCallback(async () => {
    if (!scriptId || epNo === null) {
      setSegments([]);
      return;
    }
    const q = new URLSearchParams({ projectId, scriptId, episodeNo: String(epNo) });
    const res = await fetch(`/api/prompt-studio/segments?${q}`);
    if (res.ok) setSegments((await res.json()).segments);
  }, [projectId, scriptId, epNo]);

  useEffect(() => {
    (async () => {
      await loadSegments();
    })();
  }, [loadSegments]);

  // 轮询单个任务直到结束
  const poll = useCallback(
    async (segId: string, taskId: string) => {
      if (polling.current.has(taskId)) return;
      polling.current.add(taskId);
      setBusy((b) => ({ ...b, [segId]: true }));
      try {
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          const res = await fetch(`/api/video-studio/tasks/${taskId}`);
          const data = await res.json().catch(() => null);
          if (data?.status === "succeeded") {
            toast.success(`片段视频生成完成（消耗 ${data.credits} 积分）`);
            await loadSegments();
            break;
          }
          if (data?.status === "failed") {
            toast.error(`视频生成失败：${data.error ?? "未知"}`);
            await loadSegments();
            break;
          }
        }
      } finally {
        polling.current.delete(taskId);
        setBusy((b) => ({ ...b, [segId]: false }));
      }
    },
    [loadSegments]
  );

  async function generate(seg: Segment) {
    setBusy((b) => ({ ...b, [seg.id]: true }));
    const res = await fetch("/api/video-studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, segmentId: seg.id, resolution, refAssetIds: refIds.length ? refIds : undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "提交失败");
      setBusy((b) => ({ ...b, [seg.id]: false }));
      return;
    }
    toast.info("已提交 Seedance，出片约 1-4 分钟，完成自动入资产墙");
    void poll(seg.id, data.taskId);
  }

  // 重挂时恢复 running 段的轮询
  useEffect(() => {
    for (const s of segments) {
      const p = s.params as { videoState?: string; videoTaskId?: string } | null;
      if (p?.videoState === "running" && p.videoTaskId) void poll(s.id, p.videoTaskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Clapperboard className="size-4 text-primary" />
        <h1 className="text-base">视频生成器</h1>
        <span className="text-xs text-muted-foreground">{projectName} · Seedance 2.0</span>
        <ProjectContextBadges
          tier={projectTier}
          aspect={projectAspect}
          productionType={projectProductionType}
          styleGenre={projectStyleGenre}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        {scripts.length > 1 && (
          <Select value={scriptId ?? undefined} onValueChange={(v) => { setScriptId(v); setEpNo(null); }}>
            <SelectTrigger className="h-8 w-40"><SelectValue placeholder="选剧本" /></SelectTrigger>
            <SelectContent>{scripts.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Select value={epNo === null ? undefined : String(epNo)} onValueChange={(v) => setEpNo(Number(v))}>
          <SelectTrigger className="h-8 w-40"><SelectValue placeholder="选集" /></SelectTrigger>
          <SelectContent>
            {episodes.filter((e) => e.episodeNo > 0).map((e) => (
              <SelectItem key={e.episodeNo} value={String(e.episodeNo)}>第 {e.episodeNo} 集{e.title ? ` · ${e.title}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">分辨率</span>
        <Select value={resolution} onValueChange={(v) => setResolution(v as "480p" | "720p" | "1080p")}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{RES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
        {refAssets.length > 0 && (
          <button
            onClick={() => setRefPickerOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ImagePlus className="size-3.5" /> 参考图（{refIds.length}）
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {segments.length > 0 ? `${segments.filter((s) => s.params?.videoState === "done").length}/${segments.length} 片段已出片` : "先到分镜表/视频阶段划分片段并生成提示词"}
        </span>
      </div>

      {/* 参考图选择（本集片段共用，锁角色一致性） */}
      {refIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-xs text-muted-foreground">本集参考图（锁角色一致性）：</span>
          {refAssets.filter((a) => refIds.includes(a.id)).map((a) => (
            <div key={a.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${a.filePath}`} alt={a.atName} className="size-10 rounded border border-primary/50 object-cover" />
              <button onClick={() => toggleRef(a.id)} className="absolute -right-1 -top-1 rounded-full bg-background text-muted-foreground hover:text-destructive">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {refPickerOpen && refAssets.length > 0 && (
        <div className="grid max-h-48 grid-cols-6 gap-1.5 overflow-y-auto rounded-lg border border-border bg-card p-2 sm:grid-cols-8">
          {refAssets.map((a) => (
            <button
              key={a.id}
              onClick={() => toggleRef(a.id)}
              className={`overflow-hidden rounded border-2 ${refIds.includes(a.id) ? "border-primary" : "border-transparent"}`}
              title={a.atName}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${a.filePath}`} alt={a.atName} className="aspect-square w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {segments.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">本集还没有视频片段。先去「提示词生成器 → 视频」划分片段并生成多镜提示词。</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {segments.map((seg) => {
            const vState = seg.params?.videoState;
            const vKey = seg.params?.videoKey;
            const isBusy = busy[seg.id] || vState === "running";
            return (
              <Card key={seg.id}>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex items-center gap-2">
                    <Film className="size-3.5 text-primary" />
                    <span className="text-sm font-medium">片段 {seg.segmentNo}</span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">镜 {(seg.shotNos ?? []).join(",")}</Badge>
                    {seg.durationSec && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{seg.durationSec}s</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{seg.label}</span>
                  </div>

                  {vKey ? (
                    <video src={`/api/assets/${vKey}`} controls className="w-full rounded-lg bg-black" />
                  ) : (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{seg.prompt?.slice(0, 120) ?? "（无提示词）"}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-8" disabled={isBusy || !seg.prompt} onClick={() => generate(seg)}>
                      {isBusy ? <><Loader2 className="size-3.5 animate-spin" /> 出片中…</> : vKey ? <><Play className="size-3.5" /> 重新生成</> : <><Play className="size-3.5" /> 生成视频</>}
                    </Button>
                    {vState === "failed" && <span className="text-xs text-destructive">上次失败，可重试</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
