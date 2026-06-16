"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Loader2,
  Plus,
  Download,
  X,
  Trash2,
  ArrowUp,
  Search,
  Upload,
  FileDown,
  Image as ImageIcon,
  Film,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import { ASSET_MODES } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

/**
 * 应用 · 鎏光flow（P2）：Google-Flow 式生产工作台（图像+视频）。
 * 布局对齐 Flow：主区=项目媒体网格（全宽）｜底部浮动命令条（[+] 上传/带入 在左，
 * 提示框居中，模型+设置弹层在右）｜设置弹层=图片/视频·画幅·张数·模型·(时长)·点数。
 * 图片模式下「上传图」=改图/编辑底图（经 gpt /v1/images/edits、nano inline_data）。
 * Phase1/2 图像端到端；视频模式占位（Phase3 接 Seedance）。复用 /api/image-studio /api/assets。
 */

// 读秒（内联，避免跨应用 import）
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

// 画幅：图片模式 gpt 用官方比例（DMXAPI 按约束出精确 size）；nano 自由（这里给主流 5 项）。
const ASPECTS_GPT = ["auto", "16:9", "4:3", "1:1", "3:4", "9:16"];
const ASPECTS_NANO = ["16:9", "4:3", "1:1", "3:4", "9:16"];
function aspectsFor(engine: "gpt" | "nano") {
  return engine === "nano" ? ASPECTS_NANO : ASPECTS_GPT;
}
function aspectOrient(aspect: string): -1 | 0 | 1 {
  const [a, b] = aspect.split(":").map(Number);
  if (!a || !b || a === b) return 0;
  return a > b ? 1 : -1;
}
function snapAspect(aspect: string, engine: "gpt" | "nano"): string {
  if (aspectsFor(engine).includes(aspect)) return aspect;
  const o = aspectOrient(aspect);
  return o > 0 ? "16:9" : o < 0 ? "9:16" : "1:1";
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
// 点数预估（与 DEFAULT_PRICING 对齐；实际以服务端计费为准）
const IMG_PRICE: Record<"gpt" | "nano", Record<"1k" | "2k" | "4k", number>> = {
  gpt: { "1k": 12, "2k": 60, "4k": 230 },
  nano: { "1k": 150, "2k": 150, "4k": 260 },
};

const CATEGORIES = ["全部", "图片", "视频", "角色", "场景", "上传的内容"] as const;
function inCategory(a: Asset, cat: string): boolean {
  if (cat === "全部") return true;
  if (cat === "图片") return a.kind !== "视频" && a.kind !== "参考";
  if (cat === "视频") return a.kind === "视频";
  if (cat === "角色") return a.kind === "人物";
  if (cat === "场景") return a.kind === "场景";
  if (cat === "上传的内容") return a.kind === "参考";
  return true;
}

type Asset = {
  id: string;
  kind: string;
  atName: string;
  filePath: string;
  meta: { engine?: string; tier?: string; prompt?: string; uploaded?: boolean } | null;
};
type ImportItem = { name: string; promptText: string; kind: string; episodes: number[] };

/** 画幅迷你图标（按比例画矩形，仿 Flow） */
function AspectIcon({ r }: { r: string }) {
  if (r === "auto") return <span className="text-[10px] leading-none">A</span>;
  const [a, b] = r.split(":").map(Number);
  const max = 16;
  const w = a >= b ? max : Math.round((a / b) * max);
  const h = b >= a ? max : Math.round((b / a) * max);
  return <span style={{ width: w, height: h }} className="block rounded-[2px] border border-current" />;
}

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
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [atName, setAtName] = useState("");
  const [busy, setBusy] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [category, setCategory] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [inputIds, setInputIds] = useState<string[]>([]); // 本次喂给模型的图（改图/参考底图）
  const [preview, setPreview] = useState<Asset | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importDim, setImportDim] = useState<"type" | "episode">("type");
  const [importQuery, setImportQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [assetPrompts, setAssetPrompts] = useState<ImportItem[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/image-studio/assets?projectId=${projectId}`);
    if (res.ok) setAssets((await res.json()).assets);
  }, [projectId]);

  const loadAssetPrompts = useCallback(async () => {
    const res = await fetch(`/api/prompt-studio/items?projectId=${projectId}&workspace=资产`);
    if (!res.ok) return;
    const items: {
      name: string;
      promptText: string | null;
      state: string;
      kind: string;
      episodes: number[] | null;
    }[] = (await res.json()).items;
    setAssetPrompts(
      items
        .filter((i) => i.state === "done" && i.promptText)
        .map((i) => ({ name: i.name, promptText: i.promptText!, kind: i.kind, episodes: i.episodes ?? [] }))
    );
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await load();
      await loadAssetPrompts();
    })();
  }, [load, loadAssetPrompts]);

  const inputAssets = assets.filter((a) => inputIds.includes(a.id));
  function toggleInput(id: string) {
    setInputIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length >= 8 ? r : [...r, id]));
  }

  // 网格（按分类 + 搜索）
  const shown = assets.filter((a) => inCategory(a, category) && (!query.trim() || a.atName.includes(query.trim())));

  const priceEach = IMG_PRICE[engine][tier];
  const estCredits = priceEach * count;

  async function generate() {
    if (mode !== "image") return;
    if (!prompt.trim()) {
      toast.error("先写提示词");
      return;
    }
    setBusy(true);
    setSettingsOpen(false);
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
          n: count,
          atName: atName.trim() || undefined,
          refAssetIds: inputIds.length ? inputIds : undefined, // 改图/参考底图
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "出图失败");
        return;
      }
      toast.success(`出图成功（消耗 ${data.credits} 积分）`);
      await load();
      if (data.assets?.[0]) setPreview(data.assets[0]);
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("file", file);
      const res = await fetch("/api/image-studio/assets", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "上传失败");
        return;
      }
      setAssets((arr) => [data.asset, ...arr]);
      setInputIds((r) => (r.includes(data.asset.id) ? r : r.length >= 8 ? r : [...r, data.asset.id]));
      toast.success(mode === "image" ? "已加入：将作为改图/编辑底图" : "已上传");
    } finally {
      setUploading(false);
    }
  }

  async function del(a: Asset) {
    if (!confirm("删除这张？")) return;
    await fetch(`/api/image-studio/assets/${a.id}`, { method: "DELETE" });
    setAssets((arr) => arr.filter((x) => x.id !== a.id));
    setInputIds((r) => r.filter((x) => x !== a.id));
    if (preview?.id === a.id) setPreview(null);
  }

  // 带入分组
  const importFiltered = assetPrompts.filter((p) => !importQuery.trim() || p.name.includes(importQuery.trim()));
  const importGroups: { label: string; items: ImportItem[] }[] =
    importDim === "type"
      ? [...ASSET_MODES]
          .map((k) => ({ label: k, items: importFiltered.filter((p) => p.kind === k) }))
          .filter((g) => g.items.length > 0)
      : (() => {
          const eps = [...new Set(importFiltered.flatMap((p) => p.episodes))].sort((a, b) => a - b);
          const groups = eps.map((e) => ({
            label: e === 0 ? "前置资料" : `第 ${e} 集`,
            items: importFiltered.filter((p) => p.episodes.includes(e)),
          }));
          const noEp = importFiltered.filter((p) => p.episodes.length === 0);
          if (noEp.length) groups.push({ label: "未标集", items: noEp });
          return groups;
        })();

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
        <div className="relative ml-auto w-64 max-w-[40vw]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索媒体（按名字）"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* 中部：左分类导航 + 主媒体网格 */}
      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-36 shrink-0 flex-col gap-0.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                category === c
                  ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_rgba(216,177,115,.35)]"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <span className={category === c ? "text-primary" : ""}>{c}</span>
              <span className="text-[11px] tabular-nums opacity-50">{assets.filter((a) => inCategory(a, c)).length}</span>
            </button>
          ))}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card/40 p-3">
          {shown.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="size-8 opacity-40" />
              <span>{assets.length === 0 ? "还没有媒体——在下方写提示词出图" : "该分类下没有媒体"}</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {shown.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setPreview(a)}
                  className="group relative overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/50"
                  title={a.atName}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${a.filePath}`} alt={a.atName} className="aspect-square w-full object-cover" loading="lazy" />
                  {inputIds.includes(a.id) && (
                    <span className="absolute left-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">已选</span>
                  )}
                  {a.kind === "参考" && (
                    <span className="absolute right-1 top-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground backdrop-blur">上传</span>
                  )}
                  <div className="truncate bg-background/80 px-1.5 py-1 text-left text-[10px]">{a.atName}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部 · 浮动命令条 */}
      <div className="relative mx-auto w-full max-w-4xl">
        {/* [+] 菜单弹层 */}
        {addMenuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setAddMenuOpen(false)} />
            <div className="absolute bottom-full left-0 z-30 mb-2 w-56 space-y-1 rounded-xl border border-border bg-card p-1.5 shadow-xl">
              <button
                onClick={() => {
                  fileRef.current?.click();
                  setAddMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-secondary"
              >
                <Upload className="size-4 text-primary" />
                <span>
                  上传图片
                  <span className="block text-[10px] text-muted-foreground">
                    {mode === "image" ? "作改图/编辑底图" : "作首尾帧/参考"}
                  </span>
                </span>
              </button>
              <button
                onClick={() => {
                  setImportOpen(true);
                  setAddMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-secondary"
                disabled={assetPrompts.length === 0}
              >
                <FileDown className="size-4 text-primary" />
                <span>
                  从提示词生成器带入
                  <span className="block text-[10px] text-muted-foreground">按类型/集数（{assetPrompts.length}）</span>
                </span>
              </button>
            </div>
          </>
        )}

        {/* 带入面板 */}
        {importOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setImportOpen(false)} />
            <div className="absolute bottom-full left-0 z-30 mb-2 w-72 space-y-1.5 rounded-xl border border-border bg-card p-2 shadow-xl">
              <div className="flex items-center gap-1">
                <button onClick={() => setImportDim("type")} className={`rounded-full border px-2 py-0.5 text-[10px] ${importDim === "type" ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>按类型</button>
                <button onClick={() => setImportDim("episode")} className={`rounded-full border px-2 py-0.5 text-[10px] ${importDim === "episode" ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>按集</button>
                <Input value={importQuery} onChange={(e) => setImportQuery(e.target.value)} placeholder="搜名字" className="h-6 flex-1 text-[11px]" />
              </div>
              <div className="max-h-60 space-y-1.5 overflow-y-auto">
                {importGroups.length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-muted-foreground">没有匹配的资产</p>
                ) : (
                  importGroups.map((g) => (
                    <div key={g.label}>
                      <div className="px-1 text-[10px] font-medium text-muted-foreground">{g.label}（{g.items.length}）</div>
                      {g.items.map((a) => (
                        <button
                          key={`${g.label}-${a.name}`}
                          onClick={() => {
                            setPrompt(a.promptText);
                            if (!atName) setAtName(a.name);
                            if ((ASSET_MODES as readonly string[]).includes(a.kind)) setKind(a.kind);
                            setImportOpen(false);
                          }}
                          className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                          title={a.promptText}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* 设置弹层 */}
        {settingsOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setSettingsOpen(false)} />
            <div className="absolute bottom-full right-0 z-30 mb-2 w-80 space-y-2.5 rounded-xl border border-border bg-card p-3 shadow-xl">
              {/* 图片 | 视频 */}
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
                <button onClick={() => setMode("image")} className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs ${mode === "image" ? "bg-background shadow" : "text-muted-foreground"}`}>
                  <ImageIcon className="size-3.5" /> 图片
                </button>
                <button onClick={() => setMode("video")} className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs ${mode === "video" ? "bg-background shadow" : "text-muted-foreground"}`}>
                  <Film className="size-3.5" /> 视频
                </button>
              </div>

              {mode === "image" ? (
                <>
                  {/* 模型 + 资产类型 */}
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={engine} onValueChange={(v) => { const e = v as "gpt" | "nano"; setEngine(e); setAspect((cur) => snapAspect(cur, e)); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{ENGINES.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={kind} onValueChange={setKind}>
                      <SelectTrigger className="h-8 text-xs" title="出图归类（人物/场景…）"><SelectValue /></SelectTrigger>
                      <SelectContent>{[...ASSET_MODES, "静帧"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  {/* 画幅图标行 */}
                  <div>
                    <div className="mb-1 text-[10px] text-muted-foreground">画幅</div>
                    <div className="flex flex-wrap gap-1">
                      {aspectsFor(engine).map((r) => (
                        <button
                          key={r}
                          onClick={() => setAspect(r)}
                          title={r === "auto" ? "自动" : r}
                          className={`flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-lg border text-[10px] transition-colors ${
                            aspect === r ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <span className="flex h-4 items-center"><AspectIcon r={r} /></span>
                          {r === "auto" ? "自动" : r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 清晰度 */}
                  <div>
                    <div className="mb-1 text-[10px] text-muted-foreground">清晰度</div>
                    <div className="grid grid-cols-3 gap-1">
                      {TIERS.map((t) => (
                        <button key={t.key} onClick={() => setTier(t.key)} className={`rounded-lg border py-1.5 text-xs ${tier === t.key ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 张数 */}
                  <div>
                    <div className="mb-1 text-[10px] text-muted-foreground">生成张数</div>
                    <div className="grid grid-cols-4 gap-1">
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} onClick={() => setCount(n)} className={`rounded-lg border py-1.5 text-xs ${count === n ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                          {n === 1 ? "1x" : `x${n}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-2 text-center text-[11px] text-muted-foreground">
                    生成将约消耗 <span className="text-primary">{estCredits}</span> 积分（{count} 张 × {priceEach}）
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  视频模式（Seedance 2.0）<br />Phase 3 接入中：首尾帧 / 素材参考 / 运镜 / 时长
                </div>
              )}
            </div>
          </>
        )}

        {/* 命令条本体 */}
        <div className="rounded-2xl border border-border bg-card p-2 shadow-lg">
          {/* 附带的输入图（改图/参考底图）chips */}
          {inputAssets.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
              <span className="text-[10px] text-muted-foreground">{mode === "image" ? "改图底图" : "帧/参考"}：</span>
              {inputAssets.map((a) => (
                <div key={a.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${a.filePath}`} alt={a.atName} className="size-9 rounded border border-primary/50 object-cover" />
                  <button onClick={() => toggleInput(a.id)} title="移除" className="absolute -right-1 -top-1 rounded-full bg-background text-muted-foreground hover:text-destructive">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-full border border-border"
              onClick={() => setAddMenuOpen((v) => !v)}
              disabled={uploading}
              title="上传图片 / 带入提示词"
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </Button>

            <Input
              value={atName}
              onChange={(e) => setAtName(e.target.value)}
              placeholder="@名"
              title="给生成的图命名（可空）：右侧/网格按名归组，之后可 @引用。留空取提示词开头。"
              className="h-9 w-20 shrink-0 text-xs"
            />

            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="您希望创作什么内容？（⌘/Ctrl+Enter 生成）"
              className="max-h-28 min-h-9 flex-1 resize-y border-0 bg-transparent text-sm focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void generate();
              }}
            />

            {/* 模型·画幅·张数 chip（开设置） */}
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="生成设置"
            >
              {mode === "image" ? (
                <>
                  <span>{engine === "nano" ? "nano banana" : "image2"}</span>
                  <span className="opacity-60">·{aspect === "auto" ? "自动" : aspect}·{tier.toUpperCase()}·{count === 1 ? "1x" : `x${count}`}</span>
                </>
              ) : (
                <span>视频 · Seedance</span>
              )}
            </button>

            <Button className="size-9 shrink-0 rounded-full p-0" onClick={generate} disabled={busy || mode !== "image"} title="生成">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </div>
          {busy && (
            <div className="px-2 pt-1 text-[11px] text-muted-foreground">
              出图中 <Elapsed running={busy} /> · 约 30-90 秒
            </div>
          )}
        </div>
      </div>

      {/* 预览弹窗（点网格放大 + 操作） */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setPreview(null)}>
          <div className="flex max-h-full max-w-5xl flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/assets/${preview.filePath}`} alt={preview.atName} className="max-h-[78vh] max-w-full rounded-lg object-contain" />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm text-white/80">{preview.atName}</span>
              {preview.meta?.engine && <span className="rounded border border-white/20 px-1.5 text-[10px] text-white/60">{preview.meta.engine} {preview.meta.tier ?? ""}</span>}
              <Button variant="secondary" size="sm" onClick={() => { toggleInput(preview.id); }}>
                {inputIds.includes(preview.id) ? "移出底图" : mode === "image" ? "作改图底图" : "加为帧/参考"}
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href={`/api/assets/${preview.filePath}`} download><Download className="size-4" /> 下载</a>
              </Button>
              <Button variant="secondary" size="sm" className="text-destructive" onClick={() => del(preview)}>
                <Trash2 className="size-4" /> 删除
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}><X className="size-4" /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
