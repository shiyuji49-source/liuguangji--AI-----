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
  ArrowLeft,
  Search,
  Upload,
  FileDown,
  Check,
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
// 视频运镜词（Seedance 无结构化相机，写进提示词由模型解释）
const CAMERA_MOVES = ["推近", "拉远", "横移", "摇镜", "升降", "环绕", "跟随", "手持", "固定机位"];
// 视频点数粗估（约 积分/秒，实际按 usage 计费）
const VIDEO_RATE: Record<"480p" | "720p" | "1080p", number> = { "480p": 70, "720p": 110, "1080p": 160 };

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
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium"); // image2 画质档
  const [kind, setKind] = useState<string>("人物");
  const [count, setCount] = useState(1);
  // 视频模式（Seedance 2.0）
  const [videoSub, setVideoSub] = useState<"frames" | "ingredients">("ingredients"); // 帧 / 素材
  const [videoRatio, setVideoRatio] = useState(() => (projectAspect === "16:9" ? "16:9" : "9:16"));
  const [videoRes, setVideoRes] = useState<"480p" | "720p" | "1080p">("720p");
  const [videoDur, setVideoDur] = useState(5);
  const [videoAudio, setVideoAudio] = useState(true);
  const [videoBusy, setVideoBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [atName, setAtName] = useState("");
  const [busy, setBusy] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [category, setCategory] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [inputIds, setInputIds] = useState<string[]>([]); // 本次喂给模型的图（改图/参考底图）
  const [selectedIds, setSelectedIds] = useState<string[]>([]); // 网格多选（批量删除）
  const [preview, setPreview] = useState<Asset | null>(null);
  const [editPrompt, setEditPrompt] = useState(""); // 预览弹窗里的改图指令
  const [editing, setEditing] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importCat, setImportCat] = useState<string>("全部"); // 带入：分类（人物/场景…）
  const [importEp, setImportEp] = useState<number | null>(null); // 带入：集筛选
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
          quality: engine === "gpt" ? quality : undefined,
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
    setSelectedIds((s) => s.filter((x) => x !== a.id));
    if (preview?.id === a.id) setPreview(null);
  }

  function toggleSelected(id: string) {
    setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function delMany() {
    if (selectedIds.length === 0) return;
    if (!confirm(`删除所选 ${selectedIds.length} 张？`)) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => fetch(`/api/image-studio/assets/${id}`, { method: "DELETE" })));
    setAssets((arr) => arr.filter((x) => !ids.includes(x.id)));
    setInputIds((r) => r.filter((x) => !ids.includes(x)));
    setSelectedIds([]);
    toast.success(`已删除 ${ids.length} 张`);
  }

  // 视频生成（Seedance 2.0，异步）：提交 → 轮询 → 出片入媒体库
  function pollVideo(taskId: string) {
    const tick = async () => {
      try {
        const r = await fetch(`/api/video-studio/tasks/${taskId}`);
        const d = await r.json();
        if (d.status === "succeeded") {
          toast.success(`出片完成（消耗 ${d.credits} 积分）`);
          setVideoBusy(false);
          await load();
          if (d.asset) setPreview(d.asset);
          return;
        }
        if (d.status === "failed") {
          toast.error(`出片失败：${d.error ?? ""}`);
          setVideoBusy(false);
          return;
        }
        setTimeout(tick, 6000); // running → 继续轮询
      } catch {
        setTimeout(tick, 8000);
      }
    };
    setTimeout(tick, 6000);
  }
  async function generateVideo() {
    if (!prompt.trim()) {
      toast.error("先写视频提示词");
      return;
    }
    setVideoBusy(true);
    setSettingsOpen(false);
    try {
      // 参考图按 帧/素材 定角色：帧=首/尾帧(≤2)，素材=参考图(≤9)
      const refs =
        videoSub === "frames"
          ? inputIds.slice(0, 2).map((id, i) => ({ assetId: id, role: i === 0 ? "first_frame" : "last_frame" }))
          : inputIds.slice(0, 9).map((id) => ({ assetId: id, role: "reference_image" }));
      const res = await fetch("/api/video-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt: prompt.trim(),
          durationSec: videoDur,
          ratio: videoRatio,
          resolution: videoRes,
          generateAudio: videoAudio,
          atName: atName.trim() || undefined,
          refs: refs.length ? refs : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "提交失败");
        setVideoBusy(false);
        return;
      }
      toast.success("已提交，出片约 3-5 分钟，完成后自动入媒体库");
      pollVideo(data.taskId);
    } catch {
      toast.error("提交失败");
      setVideoBusy(false);
    }
  }

  // 预览弹窗里改图：以当前图为底图，按指令重生成；保留同名 → 归入历史版本
  async function editImage() {
    if (!preview || !editPrompt.trim()) return;
    const editKind = preview.kind === "参考" || preview.kind === "视频" ? "人物" : preview.kind;
    setEditing(true);
    try {
      const res = await fetch("/api/image-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          engine,
          prompt: editPrompt.trim(),
          tier,
          kind: editKind,
          aspectRatio: aspect,
          quality: engine === "gpt" ? quality : undefined,
          atName: preview.atName,
          refAssetIds: [preview.id],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "改图失败");
        return;
      }
      toast.success(`改图完成（消耗 ${data.credits} 积分）`);
      setEditPrompt("");
      await load();
      if (data.assets?.[0]) setPreview(data.assets[0]);
    } finally {
      setEditing(false);
    }
  }

  // 带入：分类 chip（人物/服装/道具/场景/群演）+ 集筛选 + 搜索 → 平铺列表
  const importCats = ["全部", ...ASSET_MODES.filter((k) => assetPrompts.some((p) => p.kind === k))];
  const importEpisodes = [...new Set(assetPrompts.flatMap((p) => p.episodes))].sort((a, b) => a - b);
  const importList = assetPrompts.filter(
    (p) =>
      (importCat === "全部" || p.kind === importCat) &&
      (importEp === null || p.episodes.includes(importEp)) &&
      (!importQuery.trim() || p.name.includes(importQuery.trim()))
  );

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

        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/40">
          {/* 多选批量条 */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-sm">
              <span className="text-primary">已选 {selectedIds.length} 张</span>
              <button onClick={() => setSelectedIds(shown.map((a) => a.id))} className="text-xs text-muted-foreground hover:text-foreground">全选本页</button>
              <button onClick={() => setSelectedIds([])} className="text-xs text-muted-foreground hover:text-foreground">取消</button>
              <Button variant="destructive" size="sm" className="ml-auto h-7" onClick={delMany}>
                <Trash2 className="size-3.5" /> 删除所选
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {shown.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <ImageIcon className="size-8 opacity-40" />
                <span>{assets.length === 0 ? "还没有媒体——在下方写提示词出图" : "该分类下没有媒体"}</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {shown.map((a) => {
                  const sel = selectedIds.includes(a.id);
                  return (
                    <div
                      key={a.id}
                      className={`group relative overflow-hidden rounded-lg border bg-card transition-colors ${
                        sel
                          ? "border-primary ring-2 ring-primary/40"
                          : inputIds.includes(a.id)
                            ? "border-primary/60"
                            : "border-border hover:border-primary/50"
                      }`}
                      title={a.atName}
                    >
                      <button onClick={() => { setPreview(a); setEditPrompt(""); }} className="block w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/assets/${a.filePath}`} alt={a.atName} className="aspect-square w-full object-cover" loading="lazy" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelected(a.id);
                        }}
                        title={sel ? "取消选择" : "选择"}
                        className={`absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border-2 transition-all ${
                          sel
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-white/80 bg-black/30 text-transparent opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <Check className="size-3" />
                      </button>
                      {a.kind === "参考" && (
                        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground backdrop-blur">上传</span>
                      )}
                      <div className="pointer-events-none truncate bg-background/80 px-1.5 py-1 text-left text-[10px]">{a.atName}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
                  <span className="block text-[10px] text-muted-foreground">按分类/集找（{assetPrompts.length}）</span>
                </span>
              </button>
            </div>
          </>
        )}

        {/* 带入面板：分类 chip + 集筛选 + 搜索 + 平铺列表 */}
        {importOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setImportOpen(false)} />
            <div className="absolute bottom-full left-0 z-30 mb-2 w-80 space-y-2 rounded-xl border border-border bg-card p-2 shadow-xl">
              <div className="text-[11px] font-medium text-muted-foreground">从提示词生成器带入资产</div>
              {/* 分类（用户最能区分） */}
              <div className="flex flex-wrap gap-1">
                {importCats.map((c) => (
                  <button
                    key={c}
                    onClick={() => setImportCat(c)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      importCat === c ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c}
                    {c !== "全部" && <span className="ml-1 opacity-60">{assetPrompts.filter((p) => p.kind === c).length}</span>}
                  </button>
                ))}
              </div>
              {/* 搜索 + 集筛选 */}
              <div className="flex items-center gap-1.5">
                <Input value={importQuery} onChange={(e) => setImportQuery(e.target.value)} placeholder="搜名字" className="h-7 flex-1 text-xs" />
                {importEpisodes.length > 0 && (
                  <select
                    value={importEp ?? ""}
                    onChange={(e) => setImportEp(e.target.value === "" ? null : Number(e.target.value))}
                    className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-muted-foreground"
                  >
                    <option value="">全部集</option>
                    {importEpisodes.map((e) => (
                      <option key={e} value={e}>
                        {e === 0 ? "前置资料" : `第${e}集`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {/* 列表 */}
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {importList.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-muted-foreground">没有匹配的资产</p>
                ) : (
                  importList.map((a) => (
                    <button
                      key={`${a.kind}-${a.name}`}
                      onClick={() => {
                        setPrompt(a.promptText);
                        if (!atName) setAtName(a.name);
                        if ((ASSET_MODES as readonly string[]).includes(a.kind)) setKind(a.kind);
                        setImportOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-secondary"
                      title={a.promptText}
                    >
                      <span className="truncate text-xs">{a.name}</span>
                      {importCat === "全部" && (
                        <span className="ml-auto shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground">{a.kind}</span>
                      )}
                    </button>
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

                  {/* 画质（仅 image2/gpt 有低中高） */}
                  {engine === "gpt" && (
                    <div>
                      <div className="mb-1 text-[10px] text-muted-foreground">
                        画质 <span className="opacity-60">· 高更精细但慢很多(~3分钟)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {([
                          ["low", "低"],
                          ["medium", "中"],
                          ["high", "高"],
                        ] as const).map(([q, label]) => (
                          <button
                            key={q}
                            onClick={() => setQuality(q)}
                            className={`rounded-lg border py-1.5 text-xs ${quality === q ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

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
                <>
                  <div className="text-[10px] text-muted-foreground">模型 · Seedance 2.0（出片约 3-5 分钟，较贵）</div>
                  {/* 帧 / 素材 */}
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => setVideoSub("frames")} className={`rounded-lg border py-1.5 text-xs ${videoSub === "frames" ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`} title="用首/尾帧图约束镜头两端">
                      帧（首/尾帧）
                    </button>
                    <button onClick={() => setVideoSub("ingredients")} className={`rounded-lg border py-1.5 text-xs ${videoSub === "ingredients" ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`} title="用参考图锁角色/物体一致性">
                      素材（参考图）
                    </button>
                  </div>
                  {/* 画幅 + 清晰度 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[10px] text-muted-foreground">画幅</div>
                      <div className="grid grid-cols-2 gap-1">
                        {["9:16", "16:9"].map((r) => (
                          <button key={r} onClick={() => setVideoRatio(r)} className={`rounded-lg border py-1.5 text-xs ${videoRatio === r ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] text-muted-foreground">清晰度</div>
                      <div className="grid grid-cols-3 gap-1">
                        {(["480p", "720p", "1080p"] as const).map((r) => (
                          <button key={r} onClick={() => setVideoRes(r)} className={`rounded-lg border py-1.5 text-[11px] ${videoRes === r ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* 时长 + 配音 */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="mb-1 text-[10px] text-muted-foreground">时长</div>
                      <div className="grid grid-cols-3 gap-1">
                        {[5, 10, 15].map((d) => (
                          <button key={d} onClick={() => setVideoDur(d)} className={`rounded-lg border py-1.5 text-xs ${videoDur === d ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{d}s</button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 self-end pb-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={videoAudio} onChange={(e) => setVideoAudio(e.target.checked)} className="accent-[var(--primary)]" />
                      配音
                    </label>
                  </div>
                  {/* 运镜（写进提示词） */}
                  <div>
                    <div className="mb-1 text-[10px] text-muted-foreground">运镜（点击追加进提示词）</div>
                    <div className="flex flex-wrap gap-1">
                      {CAMERA_MOVES.map((m) => (
                        <button
                          key={m}
                          onClick={() => setPrompt((p) => (p.trim() ? `${p.trim()}，镜头${m}` : `镜头${m}`))}
                          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-border pt-2 text-center text-[11px] text-muted-foreground">
                    出片约消耗 <span className="text-primary">~{videoDur * VIDEO_RATE[videoRes]}</span> 积分（{videoDur}s·{videoRes}，实际按用量）
                  </div>
                </>
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
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  if (mode === "image" && !busy) void generate();
                  if (mode === "video" && !videoBusy) void generateVideo();
                }
              }}
            />

            {/* 模型·设置 chip（开设置弹层） */}
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
                <>
                  <span>Seedance</span>
                  <span className="opacity-60">·{videoRatio}·{videoRes}·{videoDur}s</span>
                </>
              )}
            </button>

            <Button
              className="size-9 shrink-0 rounded-full p-0"
              onClick={mode === "image" ? generate : generateVideo}
              disabled={mode === "image" ? busy : videoBusy}
              title="生成"
            >
              {(mode === "image" ? busy : videoBusy) ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </div>
          {(busy || videoBusy) && (
            <div className="px-2 pt-1 text-[11px] text-muted-foreground">
              {videoBusy ? (
                <>出片中 <Elapsed running={videoBusy} /> · 约 3-5 分钟，完成自动入库（可继续操作）</>
              ) : (
                <>出图中 <Elapsed running={busy} /> · 约 30-90 秒</>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 预览 / 改图弹窗（Flow 式编辑视图） */}
      {preview &&
        (() => {
          const isVideo = preview.kind === "视频";
          const versions = assets.filter((a) => a.atName === preview.atName);
          return (
            <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
              {/* 顶栏 */}
              <div className="flex items-center gap-3 px-4 py-3 text-white">
                <button onClick={() => setPreview(null)} className="opacity-80 hover:opacity-100"><ArrowLeft className="size-5" /></button>
                <span className="truncate text-sm">{preview.atName}</span>
                {preview.meta?.engine && (
                  <span className="rounded border border-white/20 px-1.5 text-[10px] text-white/60">{preview.meta.engine} {preview.meta.tier ?? ""}</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => toggleInput(preview.id)} className="rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10" title="作改图/参考底图">
                    {inputIds.includes(preview.id) ? "移出底图" : "作底图"}
                  </button>
                  <a href={`/api/assets/${preview.filePath}`} download className="rounded-full p-2 text-white/80 hover:bg-white/10" title="下载"><Download className="size-4" /></a>
                  <button onClick={() => del(preview)} className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-destructive" title="删除"><Trash2 className="size-4" /></button>
                  <Button size="sm" variant="secondary" onClick={() => setPreview(null)}>完成</Button>
                </div>
              </div>
              {/* 中部：大图 + 右侧历史版本 */}
              <div className="flex min-h-0 flex-1 gap-3 px-4 pb-3">
                <div className="flex min-w-0 flex-1 items-center justify-center">
                  {isVideo ? (
                    <video src={`/api/assets/${preview.filePath}`} controls className="max-h-full max-w-full rounded-lg" />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={`/api/assets/${preview.filePath}`} alt={preview.atName} className="max-h-full max-w-full rounded-lg object-contain" />
                  )}
                </div>
                {versions.length > 1 && (
                  <aside className="w-48 shrink-0 space-y-1.5 overflow-y-auto">
                    <div className="text-[11px] text-white/50">历史版本（{versions.length}）</div>
                    {versions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setPreview(v)}
                        className={`block w-full overflow-hidden rounded-lg border ${v.id === preview.id ? "border-primary" : "border-white/10 hover:border-white/30"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/assets/${v.filePath}`} alt={v.atName} className="aspect-video w-full object-cover" loading="lazy" />
                        {v.meta?.prompt && <div className="line-clamp-2 px-1.5 py-1 text-left text-[10px] text-white/60">{v.meta.prompt}</div>}
                      </button>
                    ))}
                  </aside>
                )}
              </div>
              {/* 底部：改图框（视频暂不支持改图） */}
              {!isVideo && (
                <div className="mx-auto mb-4 w-full max-w-2xl px-4">
                  <div className="flex items-end gap-2 rounded-2xl border border-white/15 bg-neutral-900 p-2">
                    <Textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="您想要更改什么？（基于当前图改图，⌘/Ctrl+Enter）"
                      className="max-h-24 min-h-9 flex-1 resize-y border-0 bg-transparent text-sm text-white focus-visible:ring-0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && editPrompt.trim() && !editing) void editImage();
                      }}
                    />
                    <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70">{engine === "nano" ? "nano banana" : "image2"}</span>
                    <Button className="size-9 shrink-0 rounded-full p-0" onClick={editImage} disabled={editing || !editPrompt.trim()} title="改图">
                      {editing ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </Button>
                  </div>
                  {editing && <div className="px-2 pt-1 text-[11px] text-white/50">改图中 <Elapsed running={editing} /> · 约 30-90 秒</div>}
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
