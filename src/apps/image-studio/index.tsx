"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Loader2, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectContextBadges } from "@/components/project-context-badges";
import { ASSET_MODES } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

type Asset = {
  id: string;
  kind: string;
  atName: string;
  filePath: string;
  meta: { engine?: string; tier?: string; prompt?: string } | null;
};

const ENGINES = [
  { key: "gpt", label: "image2（GPT）" },
  { key: "nano", label: "nano banana pro" },
] as const;
const TIERS = [
  { key: "1k", label: "标清 1K" },
  { key: "2k", label: "高清 2K" },
  { key: "4k", label: "超清 4K" },
] as const;

/**
 * 应用 · 图像生成器（P1）：左栏出图（image2/nano banana pro，经 DMXAPI），
 * 出图即落项目资产墙（右栏网格）。每张可被视频生成器 @ 调用。
 */
export function ImageStudioApp({
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
  const [engine, setEngine] = useState<"gpt" | "nano">("gpt");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<string>("人物");
  const [tier, setTier] = useState<"1k" | "2k" | "4k">("2k");
  const [atName, setAtName] = useState("");
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState("全部");

  const load = useCallback(async () => {
    const res = await fetch(`/api/image-studio/assets?projectId=${projectId}`);
    if (res.ok) setAssets((await res.json()).assets);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function generate() {
    if (!prompt.trim()) {
      toast.error("先写提示词");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/image-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, engine, prompt: prompt.trim(), tier, kind, atName: atName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "出图失败");
        return;
      }
      toast.success(`出图成功，已入资产墙（消耗 ${data.credits} 积分）`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("从资产墙删除这张图？")) return;
    await fetch(`/api/image-studio/assets/${id}`, { method: "DELETE" });
    setAssets((a) => a.filter((x) => x.id !== id));
  }

  const kinds = ["全部", ...ASSET_MODES];
  const shown = filter === "全部" ? assets : assets.filter((a) => a.kind === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ImageIcon className="size-4 text-primary" />
        <h1 className="text-base">图像生成器</h1>
        <span className="text-xs text-muted-foreground">{projectName}</span>
        <ProjectContextBadges
          tier={projectTier}
          aspect={projectAspect}
          productionType={projectProductionType}
          styleGenre={projectStyleGenre}
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 左：出图台 */}
        <div className="w-full shrink-0 space-y-3 lg:w-80">
          <Tabs value={engine} onValueChange={(v) => setEngine(v as "gpt" | "nano")}>
            <TabsList className="w-full">
              {ENGINES.map((e) => (
                <TabsTrigger key={e.key} value={e.key} className="flex-1 text-xs">
                  {e.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="图片提示词（可从提示词生成器复制资产提示词粘进来）"
            className="max-h-60 min-h-32 resize-y text-sm leading-6"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">资产类型</span>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_MODES.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">清晰度</span>
              <Select value={tier} onValueChange={(v) => setTier(v as "1k" | "2k" | "4k")}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIERS.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Input
            value={atName}
            onChange={(e) => setAtName(e.target.value)}
            placeholder="资产 @名（可留空，默认取提示词开头）"
            className="h-8 text-sm"
          />

          <Button className="w-full" onClick={generate} disabled={busy}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> 出图中（约 20-40 秒）…</> : <><Sparkles className="size-4" /> 生成（{projectAspect}）</>}
          </Button>
          <p className="text-[11px] text-muted-foreground">出图即入资产墙，可被视频生成器 @ 调用。</p>
        </div>

        {/* 右：资产墙 */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === k ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
                {k !== "全部" && <span className="ml-1.5 opacity-60">{assets.filter((a) => a.kind === k).length}</span>}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">资产墙还是空的——左侧出图即入墙</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((a) => (
                <div key={a.id} className="group relative overflow-hidden rounded-lg border border-border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/assets/${a.filePath}`}
                    alt={a.atName}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span className="truncate text-xs" title={a.atName}>{a.atName}</span>
                    <button
                      onClick={() => del(a.id)}
                      className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
