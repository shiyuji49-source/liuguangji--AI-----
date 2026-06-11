"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Wand2, FolderOpen, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import { promptStagesFor, promptModesFor, type PromptStage } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";
import { AssetsStage } from "./assets-stage";
import { ShotlistStage } from "./shotlist-stage";
import { ShotPromptsStage } from "./shot-prompts-stage";
import { VideoSegmentsStage, type VideoSegment } from "./video-segments-stage";
import type { Shot } from "./types";

type ScriptLite = { id: string; title: string; episodeCount: number };
type EpisodeOverview = {
  episodeNo: number;
  title: string;
  chars: number;
  shotCount: number;
  needStill: number;
  stillDone: number;
  segCount: number;
  segDone: number;
};

/**
 * 应用②提示词生成器（P0）：四阶段流水线（Toonflow 模型，非对话）。
 * ① 资产：全剧提取 5 类资产 → 各用对应 skill 生成资产提示词
 * ② 分镜表：选集构建 shotlist（分镜大师关键帧筛选规则）→ 可编辑表格
 * ③ 静帧：逐镜生成 24 字段静帧提示词（needStill 分级取舍）
 * ④ 视频：划分片段（多镜合并 ≤15s）→ 逐片段生成 Seedance 提示词
 * ②③④以左侧集列表导航（分集展示）；流水线条是唯一的阶段切换。
 */
export function PromptStudioApp({
  projectId,
  projectName,
  projectTier,
  projectAspect,
  projectProductionType,
  projectStyleGenre,
  projectRole,
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
  const stages = useMemo(() => promptStagesFor(projectRole), [projectRole]);
  const allowedKinds = useMemo(() => promptModesFor(projectRole) as string[], [projectRole]);

  const [stage, setStage] = useState<PromptStage>(stages[0] ?? "资产");
  const [scripts, setScripts] = useState<ScriptLite[] | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [overview, setOverview] = useState<EpisodeOverview[]>([]);
  const [epNo, setEpNo] = useState<number | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [segments, setSegments] = useState<VideoSegment[]>([]); // 视频片段（多镜合并）
  const [batchBusy, setBatchBusy] = useState(false); // 批量生成中锁定剧本/集切换

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${projectId}/scripts`);
      if (!res.ok) return;
      const data = await res.json();
      setScripts(data.scripts);
      if (data.scripts.length > 0) setScriptId((cur) => cur ?? data.scripts[0].id);
    })();
  }, [projectId]);

  // 分集总览（侧栏数据：每集镜数/静帧/片段进度）
  const loadOverview = useCallback(async () => {
    if (!scriptId) {
      setOverview([]);
      return;
    }
    const q = new URLSearchParams({ projectId, scriptId });
    const res = await fetch(`/api/prompt-studio/overview?${q}`);
    if (!res.ok) return;
    const data = await res.json();
    setOverview(data.episodes);
    // 自动选第一正集
    setEpNo((cur) => {
      if (cur !== null && data.episodes.some((e: EpisodeOverview) => e.episodeNo === cur)) return cur;
      const first = data.episodes.find((e: EpisodeOverview) => e.episodeNo > 0) ?? data.episodes[0];
      return first ? first.episodeNo : null;
    });
  }, [projectId, scriptId]);

  useEffect(() => {
    (async () => {
      await loadOverview();
    })();
  }, [loadOverview]);

  // 选中集 → 加载该集分镜表 + 视频片段（②③④共享）。AbortController 防过期响应覆盖新集数据
  const loadShots = useCallback(
    async (signal?: AbortSignal) => {
      if (!scriptId || epNo === null) {
        setShots([]);
        setSegments([]);
        return;
      }
      const q = new URLSearchParams({ projectId, scriptId, episodeNo: String(epNo) });
      try {
        const [shotsRes, segRes] = await Promise.all([
          fetch(`/api/prompt-studio/shots?${q}`, { signal }),
          fetch(`/api/prompt-studio/segments?${q}`, { signal }),
        ]);
        if (signal?.aborted) return;
        setShots(shotsRes.ok ? (await shotsRes.json()).shots : []);
        setSegments(segRes.ok ? (await segRes.json()).segments : []);
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) {
          setShots([]);
          setSegments([]);
        }
      }
    },
    [projectId, scriptId, epNo]
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      await loadShots(controller.signal);
    })();
    return () => controller.abort();
  }, [loadShots]);

  if (stages.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">当前角色无可用工作区</p>;
  }

  const stillDone = shots.filter((s) => s.stillState === "done").length;
  const segDone = segments.filter((s) => s.state === "done").length;

  // 当前集的侧栏行用本地状态实时校正（构建/生成后无需等总览刷新）
  const liveOverview = overview.map((e) =>
    e.episodeNo === epNo
      ? {
          ...e,
          shotCount: shots.length,
          needStill: shots.filter((s) => s.needStill).length,
          stillDone,
          segCount: segments.length,
          segDone,
        }
      : e
  );

  const stageContent = (
    <>
      {stage === "分镜表" && (
        <ShotlistStage
          projectId={projectId}
          scriptId={scriptId}
          episodeNo={epNo}
          shots={shots}
          onShotsChange={setShots}
        />
      )}
      {stage === "静帧" &&
        (epNo !== null ? (
          <ShotPromptsStage
            target="still"
            shots={shots}
            onShotsChange={setShots}
            tier={projectTier}
            onBusyChange={setBatchBusy}
          />
        ) : (
          <EpisodeHint />
        ))}
      {stage === "视频" &&
        (epNo !== null ? (
          <VideoSegmentsStage
            projectId={projectId}
            scriptId={scriptId}
            episodeNo={epNo}
            shots={shots}
            segments={segments}
            onSegmentsChange={setSegments}
            onBusyChange={setBatchBusy}
          />
        ) : (
          <EpisodeHint />
        ))}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Wand2 className="size-4 text-primary" />
        <h1 className="text-base">提示词生成器</h1>
        <span className="text-xs text-muted-foreground">{projectName}</span>
        <ProjectContextBadges
          tier={projectTier}
          aspect={projectAspect}
          productionType={projectProductionType}
          styleGenre={projectStyleGenre}
        />
      </div>

      {/* 阶段导航（唯一）：发光节点 + 流动金连线。节点只负责切换阶段，操作按钮在各阶段内部 */}
      <div className="flex flex-wrap items-center gap-0 text-xs">
        {(
          [
            { key: "资产", label: "资产", info: "" },
            {
              key: "分镜表",
              label: "分镜表",
              info: shots.length > 0 && epNo !== null ? `${shots.length} 镜` : "",
            },
            {
              key: "静帧",
              label: "静帧",
              info:
                shots.length > 0 ? `${stillDone}/${shots.filter((s) => s.needStill).length}` : "",
            },
            {
              key: "视频",
              label: "视频 · 多镜合并",
              info: segments.length > 0 ? `${segDone}/${segments.length} 片段` : "",
            },
          ] as { key: PromptStage; label: string; info: string }[]
        ).map((s, i, arr) => {
          const active = stage === s.key;
          const allowed = stages.includes(s.key);
          return (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => allowed && setStage(s.key)}
                disabled={!allowed}
                className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all duration-200 disabled:opacity-35 ${
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground shadow-[0_0_18px_-4px_var(--glow-gold)]"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                <span
                  className={`flex size-4.5 items-center justify-center rounded-full text-[10px] font-medium transition-all ${
                    active
                      ? "bg-[linear-gradient(135deg,var(--gold-a),var(--gold-c))] text-primary-foreground shadow-[0_0_10px_var(--glow-gold)]"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <span>{s.label}</span>
                {s.info && <span className={active ? "text-primary" : "opacity-60"}>{s.info}</span>}
              </button>
              {i < arr.length - 1 && (
                <div className={`h-px w-5 sm:w-8 ${active ? "liuguang-line" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>

      {scripts !== null && scripts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <FolderOpen className="size-8 text-primary" />
            <p className="text-sm text-muted-foreground">本项目还没有剧本</p>
            <Button asChild>
              <Link href={`/projects/${projectId}`}>去项目页上传剧本</Link>
            </Button>
          </CardContent>
        </Card>
      ) : stage === "资产" ? (
        <>
          {scripts && scripts.length > 1 && (
            <ScriptSelect scripts={scripts} scriptId={scriptId} disabled={batchBusy} onChange={(v) => {
              setScriptId(v);
              setEpNo(null);
            }} />
          )}
          <AssetsStage projectId={projectId} scriptId={scriptId} allowedKinds={allowedKinds} />
        </>
      ) : (
        /* ②③④：左侧集列表（分集展示）+ 右侧阶段内容 */
        <div className="flex gap-4">
          <aside className="w-60 shrink-0 space-y-2">
            {scripts && scripts.length > 1 && (
              <ScriptSelect scripts={scripts} scriptId={scriptId} disabled={batchBusy} onChange={(v) => {
                setScriptId(v);
                setEpNo(null);
              }} />
            )}
            <div className="max-h-[calc(100vh-18rem)] space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
              {liveOverview.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">剧本分集加载中…</p>
              ) : (
                liveOverview.map((e) => {
                  const active = e.episodeNo === epNo;
                  const isPre = e.episodeNo === 0;
                  return (
                    <button
                      key={e.episodeNo}
                      disabled={batchBusy}
                      onClick={() => setEpNo(e.episodeNo)}
                      className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
                        active
                          ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_rgba(216,177,115,.35)]"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-sm">
                        {isPre ? (
                          <>
                            <BookOpen className="size-3.5 shrink-0 opacity-70" />
                            <span className="truncate">前置资料</span>
                          </>
                        ) : (
                          <>
                            <span className={active ? "text-primary" : ""}>第 {e.episodeNo} 集</span>
                            {e.title && <span className="truncate text-xs opacity-70">{e.title}</span>}
                          </>
                        )}
                      </div>
                      {!isPre && (
                        <div className="mt-0.5 text-[11px] opacity-60">
                          {e.shotCount > 0
                            ? `${e.shotCount} 镜 · 静 ${e.stillDone}/${e.needStill} · 片段 ${e.segDone}/${e.segCount}`
                            : `${(e.chars / 1000).toFixed(1)}k 字 · 未构建`}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>
          <div className="min-w-0 flex-1">{stageContent}</div>
        </div>
      )}
    </div>
  );
}

function ScriptSelect({
  scripts,
  scriptId,
  disabled,
  onChange,
}: {
  scripts: ScriptLite[];
  scriptId: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={scriptId ?? undefined} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full max-w-60">
        <SelectValue placeholder="选剧本" />
      </SelectTrigger>
      <SelectContent>
        {scripts.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EpisodeHint() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        先在左侧选一集（②③④按集工作）
      </CardContent>
    </Card>
  );
}
