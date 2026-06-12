"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Stethoscope, Wand2, Loader2, Copy, Save, FolderOpen, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

type ScriptLite = { id: string; title: string; episodeCount: number };
type EpisodeLite = { episodeNo: number; title: string };
type Mode = "diagnose" | "revise";

/**
 * 剧本医生（分镜前置）过渡版：结构化、非对话。
 * 选剧本+集 → 诊断报告 / 影视化改写 → 结果可复制/存为产物 / 提修改建议再生成。
 */
export function ScriptDoctorApp({
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
  const [scripts, setScripts] = useState<ScriptLite[] | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [epNo, setEpNo] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("diagnose");
  const [result, setResult] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refine, setRefine] = useState("");

  const isDirector = projectRole === "director";

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
      setEpNo((cur) => {
        if (cur !== null && data.episodes.some((e: EpisodeLite) => e.episodeNo === cur)) return cur;
        const first = data.episodes.find((e: EpisodeLite) => e.episodeNo > 0) ?? data.episodes[0];
        return first ? first.episodeNo : null;
      });
    })();
  }, [scriptId]);

  async function run(m: Mode, refineText?: string) {
    if (!scriptId || epNo === null) {
      toast.error("先选剧本和集");
      return;
    }
    setMode(m);
    setLoading(true);
    try {
      const res = await fetch("/api/script-doctor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, scriptId, episodeNo: epNo, mode: m, refine: refineText }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "执行失败");
        return;
      }
      setResult(data.text);
      setCredits(data.credits);
      setRefine("");
      toast.success(`${m === "diagnose" ? "诊断" : "改写"}完成（消耗 ${data.credits} 积分）`);
    } finally {
      setLoading(false);
    }
  }

  async function saveArtifact() {
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        type: mode === "diagnose" ? "剧本诊断" : "影视化剧本",
        title: `第${epNo}集 ${mode === "diagnose" ? "诊断报告" : "影视化改写"}`,
        content: result,
      }),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("已存为产物");
  }

  if (!isDirector) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          剧本医生（分镜前置）仅导演可用。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Stethoscope className="size-4 text-primary" />
        <h1 className="text-base">剧本医生</h1>
        <span className="text-xs text-muted-foreground">{projectName} · 分镜前置</span>
        <ProjectContextBadges
          tier={projectTier}
          aspect={projectAspect}
          productionType={projectProductionType}
          styleGenre={projectStyleGenre}
        />
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
          {/* 选剧本 + 集 + 动作 */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            {scripts && scripts.length > 1 && (
              <Select
                value={scriptId ?? undefined}
                disabled={loading}
                onValueChange={(v) => {
                  setScriptId(v);
                  setEpNo(null);
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
            <Select
              value={epNo === null ? undefined : String(epNo)}
              disabled={loading}
              onValueChange={(v) => setEpNo(Number(v))}
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="选集" />
              </SelectTrigger>
              <SelectContent>
                {episodes.map((e) => (
                  <SelectItem key={e.episodeNo} value={String(e.episodeNo)}>
                    {e.episodeNo === 0 ? "前置资料" : `第 ${e.episodeNo} 集`}
                    {e.title ? ` · ${e.title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button size="sm" className="h-8" onClick={() => run("diagnose")} disabled={loading}>
              {loading && mode === "diagnose" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Stethoscope className="size-3.5" />
              )}
              诊断本集
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => run("revise")}
              disabled={loading}
            >
              {loading && mode === "revise" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              影视化改写
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              诊断=找问题列改法；改写=出 AI 友好版本（分镜前置）
            </span>
          </div>

          {/* 结果 */}
          {result ? (
            <Card>
              <CardContent className="space-y-2 pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">
                    {mode === "diagnose" ? "诊断报告" : "影视化改写"} · 第 {epNo} 集
                  </span>
                  {typeof credits === "number" && (
                    <span className="text-xs text-muted-foreground">消耗 {credits} 积分</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7"
                    onClick={() => {
                      navigator.clipboard.writeText(result);
                      toast.success("已复制");
                    }}
                  >
                    <Copy className="size-3.5" /> 复制
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={saveArtifact}>
                    <Save className="size-3.5" /> 存为产物
                  </Button>
                </div>
                <Textarea
                  key={result.slice(0, 20)}
                  defaultValue={result}
                  readOnly
                  className="max-h-[60vh] min-h-80 resize-y overflow-y-auto text-sm leading-6"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    value={refine}
                    onChange={(e) => setRefine(e.target.value)}
                    disabled={loading}
                    placeholder="对结果提修改要求，按要求重做（如：诊断再聚焦合规风险 / 改写保留更多原台词）"
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && refine.trim() && !loading) run(mode, refine.trim());
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={!refine.trim() || loading}
                    onClick={() => run(mode, refine.trim())}
                  >
                    <Send className="size-3.5" /> 按建议重做
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                选一集，点「诊断本集」找出视听语言/合规/连贯性问题，或「影视化改写」出可直接进生成流水线的版本。
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
