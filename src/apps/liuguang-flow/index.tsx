"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clapperboard,
  Image as ImageIcon,
  Film,
  Loader2,
  Sparkles,
  Download,
  X,
  ImagePlus,
  FileDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import { ASSET_MODES } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

/**
 * 应用 · 鎏光flow（P2，合并图像+视频生成器，Google-Flow 式工作台）。
 * Phase 1：四区布局 + 图像模式端到端（image2 / nano banana pro，经 DMXAPI）。
 *   左=资产墙，中=舞台画布（放大预览/下载），右=History 版本栈，底=命令条。
 * 视频模式占位禁用，Phase 3 接 Seedance。复用 /api/image-studio /api/video-studio /api/assets。
 */

// 读秒（内联，避免跨应用 import；与 prompt-studio/stopwatch 同实现）
function useStopwatch(running: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) return;
    let n = 0;
    const reset = setTimeout(() => setSec(0), 0);
    const id = setInterval(() => {
      n += 1;
      setSec(n);
    }, 1000);
    return () => {
      clearTimeout(reset);
      clearInterval(id);
    };
  }, [running]);
  return running ? sec : 0;
}
function Elapsed({ running }: { running: boolean }) {
  const sec = useStopwatch(running);
  if (!running) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return <span className="tabular-nums opacity-80">{m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`}</span>;
}

// 画幅：nano 自由比例；gpt-image-2 只给朝向（实际比例随清晰度）。
const ASPECTS_NANO = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];
const ASPECTS_GPT = ["16:9", "1:1", "9:16"];
function aspectsFor(engine: "gpt" | "nano") {
  return engine === "nano" ? ASPECTS_NANO : ASPECTS_GPT;
}
function aspectOrient(aspect: string): -1 | 0 | 1 {
  const [a, b] = aspect.split(":").map(Number);
  if (!a || !b || a === b) return 0;
  return a > b ? 1 : -1;
}
const ORIENT_WORD = { "1": "横", "-1": "竖", "0": "方" } as const;
function snapAspect(aspect: string, engine: "gpt" | "nano"): string {
  if (aspectsFor(engine).includes(aspect)) return aspect;
  const o = aspectOrient(aspect);
  return o > 0 ? "16:9" : o < 0 ? "9:16" : "1:1";
}
function aspectLabel(aspect: string, engine: "gpt" | "nano"): string {
  const word = ORIENT_WORD[String(aspectOrient(aspect)) as "1" | "-1" | "0"];
  return engine === "gpt" ? word : `${aspect} ${word}`;
}

const ENGINES = [
  { key: "gpt", label: "image2（GPT）" },
  { key: "nano", label: "nano banana pro" },
] as const;
const TIERS = [
  { key: "1k", label: "标清 1K" },
  { key: "2k", label: "高清 2K" },
  { key: "4k", label: "超清 4K" },
] as const;

type Asset = {
  id: string;
  kind: string;
  atName: string;
  filePath: string;
  meta: { engine?: string; tier?: string; prompt?: string } | null;
};

export function LiuguangFlowApp({
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
  const [mode, setMode] = useState<"image" | "video">("image");
  const [engine, setEngine] = useState<"gpt" | "nano">("gpt");
  const [aspect, setAspect] = useState(() => snapAspect(projectAspect || "9:16", "gpt"));
  const [tier, setTier] = useState<"1k" | "2k" | "4k">("2k");
  const [kind, setKind] = useState<string>("人物");
  const [prompt, setPrompt] = useState("");
  const [atName, setAtName] = useState("");
  const [busy, setBusy] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("全部");
  const [refIds, setRefIds] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<Asset | null>(null);

  const [assetPrompts, setAssetPrompts] = useState<{ name: string; promptText: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/image-studio/assets?projectId=${projectId}`);
    if (res.ok) setAssets((await res.json()).assets);
  }, [projectId]);

  const loadAssetPrompts = useCallback(async () => {
    const res = await fetch(`/api/prompt-studio/items?projectId=${projectId}&workspace=资产`);
    if (!res.ok) return;
    const items: { name: string; promptText: string | null; state: string }[] = (await res.json()).items;
    setAssetPrompts(
      items.filter((i) => i.state === "done" && i.promptText).map((i) => ({ name: i.name, promptText: i.promptText! }))
    );
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await load();
      await loadAssetPrompts();
    })();
  }, [load, loadAssetPrompts]);

  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const refAssets = assets.filter((a) => refIds.includes(a.id));
  // History：与选中图同名（@名）的历次生成
  const history = selected ? assets.filter((a) => a.atName === selected.atName) : [];

  function toggleRef(id: string) {
    setRefIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length >= 8 ? r : [...r, id]));
  }

  async function generate() {
    if (mode !== "image") return;
    if (!prompt.trim()) {
      toast.error("先写提示词");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/image-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          engine,
          prompt: prompt.trim(),
          tier,
          kind,
          aspectRatio: aspect,
          atName: atName.trim() || undefined,
          refAssetIds: refIds.length ? refIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "出图失败");
        return;
      }
      toast.success(`出图成功，已入资产墙（消耗 ${data.credits} 积分）`);
      await load();
      if (data.assets?.[0]?.id) setSelectedId(data.assets[0].id);
    } finally {
      setBusy(false);
    }
  }

  async function del(a: Asset) {
    if (!confirm("从资产墙删除这张图？")) return;
    await fetch(`/api/image-studio/assets/${a.id}`, { method: "DELETE" });
    setAssets((arr) => arr.filter((x) => x.id !== a.id));
    if (selectedId === a.id) setSelectedId(null);
    setRefIds((r) => r.filter((x) => x !== a.id));
  }

  const kinds = ["全部", ...ASSET_MODES, "静帧", "视频"];
  const shown = filter === "全部" ? assets : assets.filter((a) => a.kind === filter);

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[600px] flex-col gap-3">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Clapperboard className="size-4 text-primary" />
        <h1 className="text-base text-liuguang">鎏光flow</h1>
        <span className="text-xs text-muted-foreground">{projectName}</span>
        <ProjectContextBadges
          tier={projectTier}
          aspect={projectAspect}
          productionType={projectProductionType}
          styleGenre={projectStyleGenre}
        />
        <span className="ml-auto text-[11px] text-muted-foreground">图像+视频统一工作台 · 出图入资产墙</span>
      </div>

      {/* 中部三区 */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左 · 资产墙 */}
        <aside className="flex w-60 shrink-0 flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  filter === k
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
                {k !== "全部" && <span className="ml-1 opacity-60">{assets.filter((a) => a.kind === k).length}</span>}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
            {shown.length === 0 ? (
              <p className="px-2 py-10 text-center text-xs text-muted-foreground">资产墙为空——右下出图即入墙</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {shown.map((a) => {
                  const isRef = refIds.includes(a.id);
                  return (
                    <div
                      key={a.id}
                      className={`group relative cursor-pointer overflow-hidden rounded-md border-2 ${
                        selectedId === a.id ? "border-primary" : "border-transparent"
                      }`}
                      onClick={() => setSelectedId(a.id)}
                      title={a.atName}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/assets/${a.filePath}`} alt={a.atName} className="aspect-square w-full object-cover" loading="lazy" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRef(a.id);
                        }}
                        title={isRef ? "移出参考" : "设为参考"}
                        className={`absolute right-1 top-1 rounded-full p-0.5 backdrop-blur transition-colors ${
                          isRef ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary"
                        }`}
                      >
                        <ImagePlus className="size-3" />
                      </button>
                      <div className="truncate bg-background/80 px-1 py-0.5 text-[10px]">{a.atName}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 从提示词生成器带入（Phase 1 基础版；Phase 2 做集/角色/场景分类） */}
          {assetPrompts.length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => setImportOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <FileDown className="size-3.5" /> 从提示词生成器带入（{assetPrompts.length}）
              </button>
              {importOpen && (
                <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
                  {assetPrompts.map((a) => (
                    <button
                      key={a.name}
                      onClick={() => {
                        setPrompt(a.promptText);
                        if (!atName) setAtName(a.name);
                        setImportOpen(false);
                      }}
                      className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                      title={a.promptText}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* 中 · 舞台画布 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {busy ? (
              <div className="card-generating flex flex-col items-center gap-3 rounded-xl px-10 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-7 animate-spin text-primary" />
                <span>
                  出图中 <Elapsed running={busy} /> · 约 30-90 秒
                </span>
              </div>
            ) : selected ? (
              <button className="flex max-h-full max-w-full items-center justify-center" onClick={() => setLightbox(selected)} title="点击放大">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${selected.filePath}`} alt={selected.atName} className="max-h-full max-w-full rounded-lg object-contain" />
              </button>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                <Sparkles className="size-7 opacity-50" />
                <span>在下方写提示词出图，或点左侧资产墙选一张预览</span>
              </div>
            )}
          </div>
          {selected && !busy && (
            <div className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs">
              <span className="truncate font-medium" title={selected.atName}>{selected.atName}</span>
              {selected.meta?.engine && (
                <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                  {selected.meta.engine} {selected.meta.tier ?? ""}
                </span>
              )}
              <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => toggleRef(selected.id)}>
                <ImagePlus className="size-3.5" /> {refIds.includes(selected.id) ? "已设参考" : "设为参考"}
              </Button>
              <Button variant="ghost" size="sm" className="h-7" asChild>
                <a href={`/api/assets/${selected.filePath}`} download>
                  <Download className="size-3.5" /> 下载
                </a>
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-destructive" onClick={() => del(selected)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* 右 · History 版本栈 */}
        <aside className="flex w-52 shrink-0 flex-col gap-2">
          <div className="text-xs text-muted-foreground">History · 版本栈</div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
            {!selected ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">选一张图看它的历次版本与提示词</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setSelectedId(h.id)}
                    className={`flex w-full gap-2 rounded-md border p-1 text-left transition-colors ${
                      h.id === selectedId ? "border-primary/60 bg-primary/5" : "border-transparent hover:bg-secondary"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/assets/${h.filePath}`} alt={h.atName} className="size-12 shrink-0 rounded object-cover" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-muted-foreground">{h.meta?.engine} {h.meta?.tier}</div>
                      <div className="line-clamp-3 text-[11px] leading-tight">{h.meta?.prompt ?? "—"}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* 底部 · 命令条 */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "image" | "video")}>
            <TabsList className="h-8">
              <TabsTrigger value="image" className="gap-1 text-xs">
                <ImageIcon className="size-3.5" /> 图像
              </TabsTrigger>
              <TabsTrigger value="video" disabled className="gap-1 text-xs" title="视频模式 Phase 3 接入 Seedance">
                <Film className="size-3.5" /> 视频
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Select
            value={engine}
            onValueChange={(v) => {
              const e = v as "gpt" | "nano";
              setEngine(e);
              setAspect((cur) => snapAspect(cur, e));
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENGINES.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={aspect} onValueChange={setAspect}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {aspectsFor(engine).map((r) => <SelectItem key={r} value={r}>{aspectLabel(r, engine)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={tier} onValueChange={(v) => setTier(v as "1k" | "2k" | "4k")}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIERS.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSET_MODES.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>

          {refAssets.length > 0 && (
            <div className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] text-primary">
              参考 {refAssets.length}
              <button onClick={() => setRefIds([])} title="清空参考" className="hover:text-foreground">
                <X className="size-3" />
              </button>
            </div>
          )}
          {engine === "gpt" && (
            <span className="text-[10px] text-muted-foreground">image2 仅 方/横/竖；要任意比例切 nano</span>
          )}
        </div>

        <div className="flex items-end gap-2">
          <Input
            value={atName}
            onChange={(e) => setAtName(e.target.value)}
            placeholder="给这张图起名（可空）"
            title="给生成的图起个名字（如 木兰、横刀）。右侧 History 会按名归组同一资产的历次版本；命名后也能在别处用 @这个名 引用它。留空则自动取提示词开头。"
            className="h-9 w-36 shrink-0 text-xs"
          />
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="写图片提示词…（@资产引用、可从左下「带入」）"
            className="max-h-28 min-h-9 flex-1 resize-y text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void generate();
            }}
          />
          <Button className="h-9 shrink-0 gap-1.5" onClick={generate} disabled={busy || mode !== "image"}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            生成（{aspectLabel(aspect, engine)}·{tier.toUpperCase()}）
            <Elapsed running={busy} />
          </Button>
        </div>
      </div>

      {/* 放大预览 lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/assets/${lightbox.filePath}`} alt={lightbox.atName} className="max-h-full max-w-full rounded-lg object-contain" />
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/assets/${lightbox.filePath}`} download>
                <Download className="size-4" /> 下载
              </a>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setLightbox(null)}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
