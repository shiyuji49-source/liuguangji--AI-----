"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, Trash2, Loader2, FileText, Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type Script = {
  id: string;
  title: string;
  filename: string;
  episodeCount: number;
  totalChars: number;
};
type Episode = { episodeNo: number; title: string; chars: number };

/**
 * 项目级剧本区：剧本是项目资源，建项目后即可在这里上传一次，贯穿全程。
 * 导演可上传/删除；成员可查看。剧本医生与提示词生成器都读它。
 */
export function ProjectScripts({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ title: string; episodes: Episode[]; scriptId: string } | null>(
    null
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/scripts`);
    if (!res.ok) return;
    const data = await res.json();
    setScripts(data.scripts);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/scripts`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "上传失败");
        return;
      }
      for (const w of data.warnings ?? []) toast.warning(w, { duration: 8000 });
      toast.success(`已分集：${data.episodes.length} 集`);
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(s: Script) {
    if (!confirm(`删除剧本《${s.title}》？已生成的产物不受影响。`)) return;
    const res = await fetch(`/api/scripts/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除失败");
      return;
    }
    await load();
  }

  async function onResplit(s: Script) {
    if (
      !confirm(
        `用升级后的分集器重新拆分《${s.title}》？\n\n会清空该剧本已有的分镜表、视频片段和集级提示词（资产提示词保留），集号将恢复为剧本原始集号。`
      )
    )
      return;
    setUploading(true);
    try {
      const res = await fetch(`/api/scripts/${s.id}/resplit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "重新分集失败");
        return;
      }
      for (const w of data.warnings ?? []) toast.warning(w, { duration: 8000 });
      toast.success(
        `重新分集完成：正文 ${data.episodeCount} 集${data.hasPreamble ? "（人物表/梗概已归入前置资料）" : ""}`
      );
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function openPreview(s: Script) {
    const res = await fetch(`/api/scripts/${s.id}`);
    const data = await res.json();
    if (res.ok) setPreview({ title: s.title, episodes: data.episodes, scriptId: s.id });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-muted-foreground">项目剧本</h2>
        {canWrite && (
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".docx,.pdf,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" asChild disabled={uploading}>
              <span>
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                上传剧本
              </span>
            </Button>
          </label>
        )}
      </div>

      {scripts === null ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">加载中…</CardContent>
        </Card>
      ) : scripts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {canWrite
              ? "上传整部剧本（.docx/.pdf/.txt），自动按集拆分；剧本医生和提示词生成器都会用到"
              : "项目还没有剧本，等导演上传"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scripts.map((s) => (
            <Card key={s.id} className="transition-colors hover:border-primary/50">
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <span className="truncate text-sm">{s.title}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.episodeCount} 集 · {(s.totalChars / 10000).toFixed(1)} 万字
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openPreview(s)}>
                    <Eye className="size-3.5" /> 查看分集
                  </Button>
                  {canWrite && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onResplit(s)}
                        disabled={uploading}
                      >
                        <RefreshCw className="size-3.5" /> 重新分集
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => onDelete(s)}
                      >
                        <Trash2 className="size-3.5" /> 删除
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>《{preview?.title}》分集</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh]">
            <div className="space-y-1">
              {preview?.episodes.map((e) => (
                <div
                  key={e.episodeNo}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>
                    第 {e.episodeNo} 集{e.title ? ` · ${e.title}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{(e.chars / 1000).toFixed(1)}k</span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <p className="text-xs text-muted-foreground">
            在剧本医生里可逐集诊断/修改；在提示词生成器静帧工作区可选集生成静帧
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
