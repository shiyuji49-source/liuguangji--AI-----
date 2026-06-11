"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2, ListPlus, Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import { promptModesFor, ASSET_MODES, type PromptMode } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";
import { PromptItemCard, type PromptItem } from "./item-card";

type Workspace = "资产" | "静帧" | "视频";
type ScriptLite = { id: string; title: string; episodeCount: number };
type EpisodeLite = { episodeNo: number; title: string };

/**
 * 应用②提示词生成器（P0）：卡片式生产工具（参考 Toonflow，非对话）。
 * 流程：选剧本/集 → 「提取」出条目列表 → 每条卡片「生成」对应 skill 提示词 → 编辑/存档。
 * 项目规格（级别/画幅/制作类型/风格）自动注入每次生成。模型 = sonnet。
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
  const router = useRouter();
  const allowedModes = useMemo(() => promptModesFor(projectRole), [projectRole]);
  const workspaces = useMemo(() => {
    const ws: Workspace[] = [];
    if (allowedModes.some((m) => (ASSET_MODES as string[]).includes(m))) ws.push("资产");
    if (allowedModes.includes("静帧")) ws.push("静帧");
    if (allowedModes.includes("视频")) ws.push("视频");
    return ws;
  }, [allowedModes]);

  const [workspace, setWorkspace] = useState<Workspace>(workspaces[0] ?? "资产");
  const [scripts, setScripts] = useState<ScriptLite[] | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [epNo, setEpNo] = useState<number | null>(null);
  const [items, setItems] = useState<PromptItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("全部");

  const needEpisode = workspace !== "资产";

  // 项目剧本
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${projectId}/scripts`);
      if (!res.ok) return;
      const data = await res.json();
      setScripts(data.scripts);
      if (data.scripts.length > 0) setScriptId((cur) => cur ?? data.scripts[0].id);
    })();
  }, [projectId]);

  // 选中剧本 → 集列表
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

  // 加载当前范围条目
  const loadItems = useCallback(async () => {
    const q = new URLSearchParams({ projectId, workspace });
    if (needEpisode && epNo) q.set("episodeNo", String(epNo));
    const res = await fetch(`/api/prompt-studio/items?${q}`);
    if (!res.ok) {
      setItems([]);
      return;
    }
    const data = await res.json();
    setItems(data.items);
  }, [projectId, workspace, needEpisode, epNo]);

  useEffect(() => {
    (async () => {
      if (needEpisode && !epNo) {
        setItems([]);
        return;
      }
      await loadItems();
    })();
  }, [loadItems, needEpisode, epNo]);

  // 切工作区时重置筛选
  const lastWs = useRef(workspace);
  useEffect(() => {
    if (lastWs.current !== workspace) {
      lastWs.current = workspace;
      setKindFilter("全部");
    }
  }, [workspace]);

  async function extract() {
    if (!scriptId) {
      toast.error("先选剧本");
      return;
    }
    if (needEpisode && !epNo) {
      toast.error("先选集");
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch("/api/prompt-studio/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, workspace, scriptId, episodeNo: needEpisode ? epNo : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "提取失败");
        return;
      }
      setItems(data.items);
      toast.success(data.added > 0 ? `新增 ${data.added} 条` : "没有新增条目（已是最新）");
      router.refresh();
    } finally {
      setExtracting(false);
    }
  }

  async function generateOne(id: string): Promise<boolean> {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, state: "generating" } : it)));
    const res = await fetch(`/api/prompt-studio/items/${id}/generate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setItems((arr) =>
        arr.map((it) => (it.id === id ? { ...it, state: "failed", error: data.error } : it))
      );
      return false;
    }
    setItems((arr) =>
      arr.map((it) =>
        it.id === id ? { ...it, state: "done", promptText: data.promptText, error: null } : it
      )
    );
    return true;
  }

  async function handleGenerateOne(id: string) {
    const ok = await generateOne(id);
    if (ok) router.refresh();
    else toast.error("生成失败（余额不足或服务异常）");
  }

  // 批量生成：并发 3
  async function generateAll() {
    const pending = items.filter((it) => it.state !== "done").map((it) => it.id);
    if (pending.length === 0) {
      toast.info("没有待生成的条目");
      return;
    }
    setBatch({ done: 0, total: pending.length });
    let done = 0;
    let failed = 0;
    const queue = [...pending];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        const ok = await generateOne(id);
        if (!ok) failed++;
        done++;
        setBatch({ done, total: pending.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBatch(null);
    router.refresh();
    if (failed) toast.warning(`完成，${failed} 条失败（可能余额不足，单独重试）`);
    else toast.success("全部生成完成");
  }

  async function editItem(id: string, promptText: string) {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, promptText } : it)));
    await fetch(`/api/prompt-studio/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptText }),
    });
  }

  async function deleteItem(id: string) {
    await fetch(`/api/prompt-studio/items/${id}`, { method: "DELETE" });
    setItems((arr) => arr.filter((it) => it.id !== id));
  }

  async function saveArtifact(item: PromptItem) {
    const type = workspace === "资产" ? "资产提示词" : workspace === "静帧" ? "静帧提示词" : "视频提示词";
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, type, title: item.name, content: item.promptText ?? "" }),
    });
    if (!res.ok) {
      const d = await res.json();
      toast.error(d.error ?? "保存失败");
      return;
    }
    toast.success("已存为产物");
  }

  if (workspaces.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">当前角色无可用工作区</p>;
  }

  const extractLabel = workspace === "资产" ? "提取资产" : workspace === "静帧" ? "提取分镜" : "提取镜头";
  const kinds = workspace === "资产" ? ["全部", ...ASSET_MODES.filter((m) => allowedModes.includes(m))] : [];
  const shown = kindFilter === "全部" ? items : items.filter((i) => i.kind === kindFilter);

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

      {/* 无剧本引导 */}
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
          {/* 源 + 提取 + 批量 */}
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-sm">
            {scripts && scripts.length > 1 && (
              <Select value={scriptId ?? undefined} onValueChange={setScriptId}>
                <SelectTrigger className="h-8 w-40">
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
                onValueChange={(v) => setEpNo(Number(v))}
              >
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="选集" />
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
            <Button
              size="sm"
              className="h-8"
              onClick={extract}
              disabled={extracting || (needEpisode && !epNo)}
            >
              {extracting ? <Loader2 className="size-3.5 animate-spin" /> : <ListPlus className="size-3.5" />}
              {extractLabel}
            </Button>
            {items.length > 0 && (
              <Button variant="outline" size="sm" className="h-8" onClick={generateAll} disabled={!!batch}>
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
              {items.length > 0
                ? `${items.filter((i) => i.state === "done").length}/${items.length} 已生成`
                : "先提取条目"}
            </span>
          </div>

          {/* 资产类型筛选 */}
          {workspace === "资产" && items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    kindFilter === k
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {k}
                  {k !== "全部" && (
                    <span className="ml-1.5 opacity-60">
                      {items.filter((i) => i.kind === k).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 卡片网格 */}
          {needEpisode && !epNo ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                先选一集，再「{extractLabel}」
              </CardContent>
            </Card>
          ) : shown.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                还没有条目。点「{extractLabel}」从剧本{needEpisode ? "本集" : ""}自动拆出列表，再逐张生成提示词。
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {shown.map((item) => (
                <PromptItemCard
                  key={item.id}
                  item={item}
                  showKind={workspace === "资产"}
                  onGenerate={() => handleGenerateOne(item.id)}
                  onEdit={(text) => editItem(item.id, text)}
                  onSave={() => saveArtifact(item)}
                  onDelete={() => deleteItem(item.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export type { PromptMode };
