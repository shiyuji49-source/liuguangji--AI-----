"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Wand2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
type EpisodeLite = { episodeNo: number; title: string };

/**
 * 应用②提示词生成器（P0）：四阶段流水线（Toonflow 模型，非对话）。
 * ① 资产：全剧提取 5 类资产 → 各用对应 skill 生成资产提示词
 * ② 分镜表：选集构建 shotlist（分镜大师关键帧筛选规则）→ 可编辑表格
 * ③ 静帧：逐镜生成 24 字段静帧提示词（needStill 分级取舍）
 * ④ 视频：逐镜生成 Seedance 提示词（静帧锚 + 关联资产 + 分级骨架）
 * 项目规格（级别/画幅/制作类型/风格）自动注入每次生成。
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
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [epNo, setEpNo] = useState<number | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [segments, setSegments] = useState<VideoSegment[]>([]); // 视频片段（多镜合并）
  const [batchBusy, setBatchBusy] = useState(false); // 批量生成中锁定剧本/集切换

  const needEpisode = stage !== "资产";

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${projectId}/scripts`);
      if (!res.ok) return;
      const data = await res.json();
      setScripts(data.scripts);
      if (data.scripts.length > 0) setScriptId((cur) => cur ?? data.scripts[0].id);
    })();
  }, [projectId]);

  useEffect(() => {
    (async () => {
      if (!scriptId) {
        setEpisodes([]);
        return;
      }
      const res = await fetch(`/api/scripts/${scriptId}`);
      if (!res.ok) return;
      const data = await res.json();
      setEpisodes(data.episodes);
    })();
  }, [scriptId]);

  // 选中集 → 加载该集分镜表 + 视频片段（②③④共享）。AbortController 防过期响应覆盖新集数据
  const loadShots = useCallback(
    async (signal?: AbortSignal) => {
      if (!scriptId || !epNo) {
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
        <Tabs value={stage} onValueChange={(v) => setStage(v as PromptStage)} className="ml-auto">
          <TabsList>
            {stages.map((s, i) => (
              <TabsTrigger key={s} value={s}>
                {i + 1} {s}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* 流水线：发光节点 + 流动金连线 */}
      <div className="flex flex-wrap items-center gap-0 text-xs">
        {(
          [
            { key: "资产", label: "提取资产 → 资产提示词", info: "" },
            {
              key: "分镜表",
              label: "构建分镜表",
              info: shots.length > 0 && epNo ? `${shots.length} 镜` : "",
            },
            {
              key: "静帧",
              label: "静帧提示词",
              info:
                shots.length > 0 ? `${stillDone}/${shots.filter((s) => s.needStill).length}` : "",
            },
            {
              key: "视频",
              label: "视频提示词 · 多镜合并",
              info: segments.length > 0 ? `${segDone}/${segments.length} 片段` : "",
            },
          ] as { key: PromptStage; label: string; info: string }[]
        ).map((s, i, arr) => {
          const active = stage === s.key;
          return (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => stages.includes(s.key) && setStage(s.key)}
                className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all duration-200 ${
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground shadow-[0_0_18px_-4px_var(--glow-gold)]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
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
                <div className={`h-px w-6 sm:w-10 ${active ? "liuguang-line" : "bg-border"}`} />
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
      ) : (
        <>
          {/* 源选择（剧本；②③④还要选集） */}
          {(scripts && scripts.length > 1) || needEpisode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {scripts && scripts.length > 1 && (
                <Select
                  value={scriptId ?? undefined}
                  disabled={batchBusy}
                  onValueChange={(v) => {
                    setScriptId(v);
                    setEpNo(null);
                    setShots([]);
                  }}
                >
                  <SelectTrigger className="h-8 w-44">
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
              )}
              {needEpisode && (
                <Select
                  value={epNo === null ? undefined : String(epNo)}
                  disabled={batchBusy}
                  onValueChange={(v) => setEpNo(Number(v))}
                >
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue placeholder="选集（②③④按集工作）" />
                  </SelectTrigger>
                  <SelectContent>
                    {episodes.map((e) => (
                      <SelectItem key={e.episodeNo} value={String(e.episodeNo)}>
                        第 {e.episodeNo} 集{e.title ? ` · ${e.title}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}

          {stage === "资产" && (
            <AssetsStage projectId={projectId} scriptId={scriptId} allowedKinds={allowedKinds} />
          )}
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
            (epNo ? (
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
            (epNo ? (
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
      )}
    </div>
  );
}

function EpisodeHint() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        先在上方选一集（静帧/视频按集逐镜工作）
      </CardContent>
    </Card>
  );
}
