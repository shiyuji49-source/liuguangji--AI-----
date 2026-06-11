"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wand2, Import, ClipboardList, Clapperboard, Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { ProjectContextBadges } from "@/components/project-context-badges";
import { promptModesFor, ASSET_MODES, type PromptMode } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

const ASPECTS = ["9:16", "16:9", "4:5", "3:4", "1:1", "2.39:1"];

type Workspace = "资产" | "静帧" | "视频";
type ScriptLite = { id: string; title: string; episodeCount: number };
type EpisodeLite = { episodeNo: number; title: string; chars: number };

/**
 * 应用②提示词生成器（P0）：结构化工作台，三工作区各自连上流水线的自然输入。
 * - 资产（人物/服装/道具/场景/群演 5 模式）← 带入剧本医生的「资产清单」
 * - 静帧 ← 选项目剧本的某一集（服务端把该集喂给分镜大师 skill）
 * - 视频 ← 带入「静帧提示词」产物（+ 资产/参考图）
 * 数据连上、流程可见，但每步仍是人来驱动、多轮迭代。模型 = LLM_MODEL_MAIN（sonnet）。
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
  const allowedModes = useMemo(() => promptModesFor(projectRole), [projectRole]);
  const workspaces = useMemo(() => {
    const ws: Workspace[] = [];
    if (allowedModes.some((m) => (ASSET_MODES as string[]).includes(m))) ws.push("资产");
    if (allowedModes.includes("静帧")) ws.push("静帧");
    if (allowedModes.includes("视频")) ws.push("视频");
    return ws;
  }, [allowedModes]);

  const [workspace, setWorkspace] = useState<Workspace>(workspaces[0] ?? "资产");
  const [assetMode, setAssetMode] = useState<PromptMode>(
    (allowedModes.find((m) => (ASSET_MODES as string[]).includes(m)) as PromptMode) ?? "人物"
  );
  const [episode, setEpisode] = useState("");
  const [aspect, setAspect] = useState(projectAspect); // 默认=项目画幅，可临时覆盖
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [autoSend, setAutoSend] = useState<{ text: string; nonce: number } | null>(null);
  const [importType, setImportType] = useState<string | null>(null);

  // 静帧工作区：项目剧本 + 选集
  const [scripts, setScripts] = useState<ScriptLite[]>([]);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [epNo, setEpNo] = useState<number | null>(null);
  // 资产工作区：项目里可带入的资产清单数量
  const [assetListCount, setAssetListCount] = useState<number | null>(null);

  const loadScripts = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/scripts`);
    if (!res.ok) return;
    const data = await res.json();
    setScripts(data.scripts);
    if (data.scripts.length > 0) setScriptId((cur) => cur ?? data.scripts[0].id);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      if (workspace === "静帧") await loadScripts();
      if (workspace === "资产") {
        const res = await fetch(
          `/api/artifacts?projectId=${projectId}&type=${encodeURIComponent("资产清单")}`
        );
        if (res.ok) {
          const data = await res.json();
          setAssetListCount(data.artifacts.length);
        }
      }
    })();
  }, [workspace, loadScripts, projectId]);

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

  const mode: PromptMode = workspace === "资产" ? assetMode : (workspace as PromptMode);
  const artifactTypes =
    workspace === "资产"
      ? ["资产提示词"]
      : workspace === "静帧"
        ? ["静帧提示词"]
        : ["视频提示词"];

  if (workspaces.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">当前角色无可用工作区</p>;
  }

  const sendBody = () => {
    if (workspace === "静帧") {
      return { aspect, scriptId: scriptId ?? undefined, scope: epNo ?? undefined };
    }
    return { episode: episode || undefined, aspect };
  };

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
        <Tabs value={workspace} onValueChange={(v) => setWorkspace(v as Workspace)} className="ml-auto">
          <TabsList>
            {workspaces.map((w) => (
              <TabsTrigger key={w} value={w}>
                {w === "资产" ? "资产提示词" : w === "静帧" ? "静帧提示词" : "视频提示词"}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ChatWorkspace
        key={workspace === "资产" ? assetMode : workspace}
        appKey="prompt-studio"
        projectId={projectId}
        mode={mode}
        sendBody={sendBody}
        allowImageUpload
        artifactTypes={artifactTypes}
        prefill={prefill}
        autoSend={autoSend}
        placeholder={
          workspace === "资产"
            ? `描述要生成的${assetMode}，或先「带入资产清单」批量生成`
            : workspace === "静帧"
              ? epNo
                ? `已选第 ${epNo} 集，可直接说「生成本集关键帧静帧」或补充镜头偏好`
                : "选一集剧本后生成静帧；也可直接粘贴单场戏"
              : "先「带入静帧提示词」，再补充资产/参考图生成 Seedance 视频提示词"
        }
        paramsBar={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {workspace === "资产" && (
              <>
                <Select value={assetMode} onValueChange={(v) => setAssetMode(v as PromptMode)}>
                  <SelectTrigger className="h-7 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_MODES.filter((m) => allowedModes.includes(m)).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <EpisodeInput value={episode} onChange={setEpisode} />
              </>
            )}

            {workspace === "静帧" && (
              <StillframeSource
                scripts={scripts}
                scriptId={scriptId}
                onScript={(id) => {
                  setScriptId(id);
                  setEpNo(null);
                }}
                episodes={episodes}
                epNo={epNo}
                onEpisode={setEpNo}
              />
            )}

            {workspace === "视频" && <EpisodeInput value={episode} onChange={setEpisode} />}

            <label className="flex items-center gap-2 text-muted-foreground">
              画幅
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger className="h-7 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECTS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {aspect !== projectAspect ? (
              <span className="text-xs text-primary">已临时覆盖项目画幅 {projectAspect}</span>
            ) : (
              <span className="text-xs text-muted-foreground">画幅随项目默认</span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {workspace === "资产" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setImportType("资产清单")}
                  disabled={assetListCount === 0}
                >
                  <Import className="size-3.5" /> 带入资产清单
                  {assetListCount ? <span className="ml-1 opacity-60">({assetListCount})</span> : null}
                </Button>
              )}
              {workspace === "静帧" && epNo !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() =>
                    setAutoSend({
                      text: `为第 ${epNo} 集生成关键帧静帧提示词：先按 skill 做关键帧筛选与合并，再按 24 字段格式输出，每帧末尾附可直接喂 image2 的成品提示词。`,
                      nonce: Date.now(),
                    })
                  }
                >
                  <Clapperboard className="size-3.5" /> 生成本集静帧
                </Button>
              )}
              {workspace === "视频" && (
                <Button variant="outline" size="sm" className="h-7" onClick={() => setImportType("静帧提示词")}>
                  <Film className="size-3.5" /> 带入静帧提示词
                </Button>
              )}
            </div>
          </div>
        }
      />

      <ImportArtifactDialog
        type={importType}
        onClose={() => setImportType(null)}
        projectId={projectId}
        onPick={(text) => {
          setPrefill({ text, nonce: Date.now() });
          setImportType(null);
          toast.success("已带入输入框，可编辑后发送");
        }}
      />
    </div>
  );
}

function EpisodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-muted-foreground">
      集数
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="选填"
        className="h-7 w-16"
      />
    </label>
  );
}

function StillframeSource({
  scripts,
  scriptId,
  onScript,
  episodes,
  epNo,
  onEpisode,
}: {
  scripts: ScriptLite[];
  scriptId: string | null;
  onScript: (id: string) => void;
  episodes: EpisodeLite[];
  epNo: number | null;
  onEpisode: (n: number | null) => void;
}) {
  if (scripts.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        本项目还没有剧本（可让导演在剧本医生上传）；也可直接粘贴单场戏生成
      </span>
    );
  }
  return (
    <>
      {scripts.length > 1 && (
        <Select value={scriptId ?? undefined} onValueChange={onScript}>
          <SelectTrigger className="h-7 w-36">
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
        value={epNo === null ? "none" : String(epNo)}
        onValueChange={(v) => onEpisode(v === "none" ? null : Number(v))}
      >
        <SelectTrigger className="h-7 w-40">
          <SelectValue placeholder="选集" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">不带入（自由输入）</SelectItem>
          {episodes.map((e) => (
            <SelectItem key={e.episodeNo} value={String(e.episodeNo)}>
              第 {e.episodeNo} 集{e.title ? ` · ${e.title}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {epNo !== null && (
        <Badge variant="outline" className="border-primary/40 text-primary">
          已带入第 {epNo} 集
        </Badge>
      )}
    </>
  );
}

function ImportArtifactDialog({
  type,
  onClose,
  projectId,
  onPick,
}: {
  type: string | null;
  onClose: () => void;
  projectId: string;
  onPick: (text: string) => void;
}) {
  const [items, setItems] = useState<{ id: string; title: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const open = type !== null;
  const label = type === "静帧提示词" ? "静帧提示词" : "资产清单";
  const from = type === "静帧提示词" ? "（来自本工作台静帧工作区）" : "（来自剧本医生）";

  async function load() {
    if (!type) return;
    setLoading(true);
    const res = await fetch(`/api/artifacts?projectId=${projectId}&type=${encodeURIComponent(type)}`);
    const data = await res.json();
    setLoading(false);
    if (res.ok) setItems(data.artifacts);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) void load();
        else onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-4 text-primary" />
            带入{label}
            <span className="text-xs font-normal text-muted-foreground">{from}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-2">
            {loading && <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>}
            {!loading && items.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                暂无「{label}」产物。请先生成并「存为产物」。
              </p>
            )}
            {items.map((a) => (
              <button
                key={a.id}
                className="block w-full rounded-md border border-border p-3 text-left text-sm transition-colors hover:border-primary/50"
                onClick={() => onPick(a.content)}
              >
                <div className="mb-1">{a.title}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{a.content}</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
