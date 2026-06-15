"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, ListPlus, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ASSET_MODES } from "@/apps/registry";
import { PromptItemCard, type PromptItem } from "./item-card";

/**
 * 阶段①资产：先「提取资产」把全剧的人物/服装/道具/场景/群演抓全，
 * 再逐卡/批量用对应资产 skill 生成提示词。
 */
export function AssetsStage({
  projectId,
  scriptId,
  allowedKinds,
}: {
  projectId: string;
  scriptId: string | null;
  allowedKinds: string[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PromptItem[]>([]);
  const [extractProg, setExtractProg] = useState<{ done: number; total: number } | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("全部");

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

  // 逐集提取全剧资产：每集单独喂模型（穷尽列举），跨集按名字去重累积。
  // 顺序执行——避免两集并发把同名新资产各插一份（去重在落库层按 name）。
  async function extract() {
    if (!scriptId) {
      toast.error("先选剧本");
      return;
    }
    // 取集列表（含前置资料 0：人物表常列全角色）
    const epRes = await fetch(`/api/scripts/${scriptId}`);
    if (!epRes.ok) {
      toast.error("读取剧本分集失败");
      return;
    }
    const episodes: { episodeNo: number }[] = (await epRes.json()).episodes ?? [];
    if (episodes.length === 0) {
      toast.error("剧本还没有分集");
      return;
    }
    setExtractProg({ done: 0, total: episodes.length });
    let totalAdded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < episodes.length; i++) {
        const res = await fetch("/api/prompt-studio/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            workspace: "资产",
            scriptId,
            episodeNo: episodes[i].episodeNo,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          totalAdded += data.added ?? 0;
          setItems(data.items); // 实时显示累积增长
        } else {
          failed++;
        }
        setExtractProg({ done: i + 1, total: episodes.length });
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

  async function generateAll() {
    const pending = items.filter((it) => it.state !== "done").map((it) => it.id);
    if (pending.length === 0) {
      toast.info("没有待生成的资产");
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

  const kinds = ["全部", ...ASSET_MODES.filter((m) => allowedKinds.includes(m))];
  const shown = kindFilter === "全部" ? items : items.filter((i) => i.kind === kindFilter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <Button size="sm" className="h-8" onClick={extract} disabled={!!extractProg || !scriptId}>
          {extractProg ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> 提取中 {extractProg.done}/{extractProg.total} 集
            </>
          ) : (
            <>
              <ListPlus className="size-3.5" /> 提取资产（逐集全剧）
            </>
          )}
        </Button>
        {items.length > 0 && (
          <Button variant="outline" size="sm" className="h-8" onClick={generateAll} disabled={!!batch || !!extractProg}>
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
        {items.length > 0 && (
          <Button variant="ghost" size="sm" className="h-8" asChild>
            <a href={`/api/projects/${projectId}/export?type=assets`} download>
              <Download className="size-3.5" /> 导出 Excel
            </a>
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {items.length > 0
            ? `${items.filter((i) => i.state === "done").length}/${items.length} 已生成`
            : "先提取，再生成"}
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
                <span className="ml-1.5 opacity-60">{items.filter((i) => i.kind === k).length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            还没有资产。点「提取资产」从全剧自动抓出人物/服装/道具/场景/群演，再逐张生成提示词。
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
  );
}
