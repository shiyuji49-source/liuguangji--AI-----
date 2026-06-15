"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, ListPlus, Loader2, Download, BookOpen, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ASSET_MODES } from "@/apps/registry";
import { PromptItemCard, type PromptItem } from "./item-card";
import { Elapsed } from "./stopwatch";

type EpisodeLite = { episodeNo: number; title?: string };

/**
 * 阶段①资产：左侧集数侧栏（总和置顶）+ 顶部分类行（人物/服装/道具/场景/群演），
 * 与分镜一致的布局。逐集提取全剧资产（穷尽列举、跨集按名去重累积），已识别的可一键生成——
 * 提取与生成可并行；切走再回来会轮询恢复服务端已完成的生成。
 */
export function AssetsStage({
  projectId,
  scriptId,
  allowedKinds,
  episodes,
}: {
  projectId: string;
  scriptId: string | null;
  allowedKinds: string[];
  episodes: EpisodeLite[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PromptItem[]>([]);
  const [extractProg, setExtractProg] = useState<{ done: number; total: number } | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("全部");
  const [epFilter, setEpFilter] = useState<number | null>(null); // null = 总和（全部集）

  const loadItems = useCallback(async () => {
    const q = new URLSearchParams({ projectId, workspace: "资产" });
    const res = await fetch(`/api/prompt-studio/items?${q}`);
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await loadItems();
    })();
  }, [loadItems]);

  // 切走再回来 / 上次断连留下的 generating：轮询刷新拾起服务端已完成的结果（本地批量/提取时不抢）
  useEffect(() => {
    if (batch || extractProg) return;
    if (!items.some((i) => i.state === "generating")) return;
    const id = setInterval(() => void loadItems(), 4000);
    return () => clearInterval(id);
  }, [items, batch, extractProg, loadItems]);

  // 逐集提取全剧资产：每集单独喂模型（穷尽列举），跨集按名字去重累积。
  // 顺序执行——避免两集并发把同名新资产各插一份（去重在落库层按 name）。
  async function extract() {
    if (!scriptId) {
      toast.error("先选剧本");
      return;
    }
    const epList: EpisodeLite[] =
      episodes.length > 0
        ? episodes
        : ((await (await fetch(`/api/scripts/${scriptId}`)).json().catch(() => ({})))?.episodes ?? []);
    if (epList.length === 0) {
      toast.error("剧本还没有分集");
      return;
    }
    setExtractProg({ done: 0, total: epList.length });
    let totalAdded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < epList.length; i++) {
        const res = await fetch("/api/prompt-studio/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            workspace: "资产",
            scriptId,
            episodeNo: epList[i].episodeNo,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          totalAdded += data.added ?? 0;
          setItems(data.items); // 实时显示累积增长（已识别的可同步生成）
        } else {
          failed++;
        }
        setExtractProg({ done: i + 1, total: epList.length });
      }
      await loadItems();
      toast.success(
        `逐集提取完成：累计 ${totalAdded} 个资产${failed ? `（${failed} 集失败，可重跑补齐）` : ""}`
      );
      router.refresh();
    } finally {
      setExtractProg(null);
    }
  }

  async function generateOne(id: string, refine?: string): Promise<boolean> {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, state: "generating" } : it)));
    const res = await fetch(`/api/prompt-studio/items/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(refine ? { refine } : {}),
    });
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

  async function handleGenerateOne(id: string, refine?: string) {
    const ok = await generateOne(id, refine);
    if (ok) router.refresh();
    else toast.error("生成失败（余额不足或服务异常）");
  }

  // 批量生成：作用于当前筛选视图（总和=全剧；选某集/某分类=该范围内待生成）。
  // 不被「提取中」阻塞——已识别好的可与后续提取并行生成。
  async function generateAll() {
    const pending = shown.filter((it) => it.state !== "done").map((it) => it.id);
    if (pending.length === 0) {
      toast.info("当前范围没有待生成的资产");
      return;
    }
    const total = pending.length;
    setBatch({ done: 0, total });
    let done = 0;
    let failed = 0;
    try {
      const queue = [...pending];
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift()!;
          if (!(await generateOne(id))) failed++;
          done++;
          setBatch({ done, total });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      setBatch(null);
    }
    router.refresh();
    if (failed) toast.warning(`完成，${failed} 条失败（可单独重试）`);
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
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        type: "资产提示词",
        title: item.name,
        content: item.promptText ?? "",
      }),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("已存为产物");
  }

  // 当前集筛选后的子集（再叠加分类筛选）
  const inEpisode =
    epFilter === null ? items : items.filter((i) => (i.episodes ?? []).includes(epFilter));
  const kinds = ["全部", ...ASSET_MODES.filter((m) => allowedKinds.includes(m))];
  const shown = kindFilter === "全部" ? inEpisode : inEpisode.filter((i) => i.kind === kindFilter);
  const pendingCount = shown.filter((i) => i.state !== "done").length;
  const epCount = (no: number) => items.filter((i) => (i.episodes ?? []).includes(no)).length;

  return (
    <div className="flex gap-4">
      {/* 左：集数侧栏（总和置顶） */}
      <aside className="w-44 shrink-0">
        <div className="max-h-[calc(100vh-16rem)] space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
          <SidebarRow
            active={epFilter === null}
            onClick={() => setEpFilter(null)}
            icon={<Layers className="size-3.5 shrink-0 opacity-70" />}
            label="总和"
            count={items.length}
            emphasize
          />
          {episodes.map((e) => (
            <SidebarRow
              key={e.episodeNo}
              active={epFilter === e.episodeNo}
              onClick={() => setEpFilter(e.episodeNo)}
              icon={
                e.episodeNo === 0 ? <BookOpen className="size-3.5 shrink-0 opacity-70" /> : null
              }
              label={e.episodeNo === 0 ? "前置资料" : `第 ${e.episodeNo} 集`}
              sub={e.episodeNo !== 0 ? e.title : undefined}
              count={epCount(e.episodeNo)}
            />
          ))}
          {episodes.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">提取后按集归类</p>
          )}
        </div>
      </aside>

      {/* 右：工具条 + 分类行 + 资产卡片 */}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <Button size="sm" className="h-8" onClick={extract} disabled={!!extractProg || !scriptId}>
            {extractProg ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> 提取中 {extractProg.done}/
                {extractProg.total} 集 <Elapsed running className="ml-1 text-xs" />
              </>
            ) : (
              <>
                <ListPlus className="size-3.5" /> {items.length > 0 ? "继续提取（逐集）" : "提取资产（逐集全剧）"}
              </>
            )}
          </Button>
          {items.length > 0 && (
            <Button variant="outline" size="sm" className="h-8" onClick={generateAll} disabled={!!batch}>
              {batch ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> 生成中 {batch.done}/{batch.total}{" "}
                  <Elapsed running className="ml-1 text-xs" />
                </>
              ) : (
                <>
                  <Wand2 className="size-3.5" /> 一键生成
                  {epFilter !== null || kindFilter !== "全部" ? "（本范围" : "（全部"}
                  {pendingCount > 0 ? ` ${pendingCount}` : ""}）
                </>
              )}
            </Button>
          )}
          {items.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8" asChild>
              <a href={`/api/projects/${projectId}/export?type=assets`} download>
                <Download className="size-3.5" /> 导出 Excel
              </a>
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {items.length > 0
              ? `${shown.filter((i) => i.state === "done").length}/${shown.length} 已生成`
              : "先提取，再生成（两者可并行）"}
          </span>
        </div>

        {items.length > 0 && (
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
                    {inEpisode.filter((i) => i.kind === k).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {items.length === 0
                ? "还没有资产。点「提取资产」从全剧逐集抓出人物/服装/道具/场景/群演，识别好的可同步生成。"
                : "该集 / 该分类下暂无资产。"}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shown.map((item) => (
              <PromptItemCard
                key={item.id}
                item={item}
                showKind
                onGenerate={(refine) => handleGenerateOne(item.id, refine)}
                onEdit={(text) => editItem(item.id, text)}
                onSave={() => saveArtifact(item)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarRow({
  active,
  onClick,
  icon,
  label,
  sub,
  count,
  emphasize,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  sub?: string;
  count: number;
  emphasize?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_rgba(216,177,115,.35)]"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      } ${emphasize ? "border-b border-border/60" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-sm">
        {icon}
        <span className={`truncate ${active || emphasize ? "text-primary" : ""}`}>{label}</span>
        {sub && <span className="truncate text-xs opacity-60">{sub}</span>}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums opacity-60">{count}</span>
      </div>
    </button>
  );
}
