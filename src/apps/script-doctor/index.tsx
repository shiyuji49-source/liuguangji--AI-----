"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Stethoscope,
  Eye,
  BookOpenText,
  ClipboardList,
  FilePenLine,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

type Script = {
  id: string;
  title: string;
  episodeCount: number;
  totalChars: number;
};
type Episode = { episodeNo: number; title: string; chars: number };
type Scope = "full" | number;

/**
 * 应用①剧本医生（P0）：结构化工作台，项目剧本的纯消费者。
 * 剧本属于项目（在项目控制台上传/管理）；这里只「选剧本 → 按集导航 → 诊断/修改」。
 * 模型 = LLM_MODEL_HEAVY（claude-opus-4-8，1M 上下文），全剧块走前缀缓存。
 */
export function ScriptDoctorApp({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
  projectTier: ProjectTier;
  projectAspect: string;
  projectRole: ProjectRole;
  userId: string;
}) {
  const [scriptsList, setScriptsList] = useState<Script[] | null>(null);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [scope, setScope] = useState<Scope>("full");
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [autoSend, setAutoSend] = useState<{ text: string; nonce: number } | null>(null);

  const activeScript = scriptsList?.find((s) => s.id === activeScriptId) ?? null;

  const fetchScripts = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/scripts`);
    if (!res.ok) return;
    const data = await res.json();
    setScriptsList(data.scripts);
    if (data.scripts.length > 0) setActiveScriptId((cur) => cur ?? data.scripts[0].id);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await fetchScripts();
    })();
  }, [fetchScripts]);

  useEffect(() => {
    if (!activeScriptId) return;
    (async () => {
      const res = await fetch(`/api/scripts/${activeScriptId}`);
      if (!res.ok) return;
      const data = await res.json();
      setEpisodes(data.episodes);
      setScope("full");
    })();
  }, [activeScriptId]);

  async function openPreview(no: number, title: string) {
    if (!activeScriptId) return;
    const res = await fetch(`/api/scripts/${activeScriptId}/episodes/${no}`);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "加载失败");
      return;
    }
    setPreview({ title: `第 ${no} 集${title ? ` · ${title}` : ""}`, content: data.episode.content });
  }

  function quickAction(kind: "diagnose" | "revise" | "assets") {
    if (!activeScript) return;
    if (kind === "diagnose") {
      setScope("full");
      setAutoSend({
        text: "请按 skill 工作流通读全剧，输出完整诊断报告（含「连贯性诊断：制作连贯性台账 + 剪辑连贯性」），写完报告停下来，等我确认修改策略后再动笔改。",
        nonce: Date.now(),
      });
    } else if (kind === "revise") {
      if (scope === "full") {
        toast.info("先在左侧选中要修改的某一集");
        return;
      }
      setAutoSend({
        text: `请按已确认的修改策略修改第 ${scope} 集：输出修改后剧本（规范剧本格式）+ 改动说明（按七个维度分组标注）+ 本集资产清单更新。`,
        nonce: Date.now(),
      });
    } else {
      setScope("full");
      setAutoSend({
        text: "请基于全剧输出完整的资产清单：固定角色档 / 固定场景档（含环境音）/ 道具与服装清单，包含多状态版本（如 @角色-常服 / @角色-战损），格式符合资产 skill 的建档要求。",
        nonce: Date.now(),
      });
    }
  }

  // ===== 无剧本：引导去项目控制台上传（剧本是项目资源，不在应用内管理）=====
  if (scriptsList !== null && scriptsList.length === 0) {
    return (
      <div className="space-y-4">
        <Header projectName={projectName} />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-20">
            <FolderOpen className="size-8 text-primary" />
            <p className="text-sm text-muted-foreground">本项目还没有剧本</p>
            <Button asChild>
              <Link href={`/projects/${projectId}`}>去项目页上传剧本</Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              剧本是项目资源，上传一次后剧本医生与提示词生成器都能用
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Header projectName={projectName} />
        {activeScript && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {scriptsList && scriptsList.length > 1 ? (
              <Select value={activeScript.id} onValueChange={setActiveScriptId}>
                <SelectTrigger className="h-7 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scriptsList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span>《{activeScript.title}》</span>
            )}
            <span>
              {activeScript.episodeCount} 集 · {(activeScript.totalChars / 10000).toFixed(1)} 万字
            </span>
            <Button asChild variant="ghost" size="sm" className="h-7 px-1.5">
              <Link href={`/projects/${projectId}`}>管理剧本</Link>
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[200px_1fr] gap-4">
        {/* 集列表导航 */}
        <aside className="flex h-[calc(100vh-8.5rem)] flex-col rounded-[10px] border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">工作范围</div>
          <ScrollArea className="flex-1">
            <div className="space-y-0.5 p-2">
              <button
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  scope === "full"
                    ? "bg-secondary text-primary"
                    : "text-muted-foreground hover:bg-secondary/60"
                }`}
                onClick={() => setScope("full")}
              >
                全剧总览
              </button>
              {(activeScript ? episodes : []).map((e) => (
                <div
                  key={e.episodeNo}
                  className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                    scope === e.episodeNo
                      ? "bg-secondary text-primary"
                      : "text-muted-foreground hover:bg-secondary/60"
                  }`}
                  onClick={() => setScope(e.episodeNo)}
                >
                  <span className="flex-1 truncate">
                    第 {e.episodeNo} 集{e.title ? ` ${e.title}` : ""}
                  </span>
                  <span className="text-[10px] opacity-60">{(e.chars / 1000).toFixed(1)}k</span>
                  <button
                    className="hidden text-muted-foreground hover:text-primary group-hover:block"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void openPreview(e.episodeNo, e.title);
                    }}
                  >
                    <Eye className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* 会话工作区 */}
        <div className="min-w-0">
          <ChatWorkspace
            appKey="script-doctor"
            projectId={projectId}
            sendBody={() => ({ scriptId: activeScript?.id, scope })}
            artifactTypes={["诊断报告", "资产清单", "剧本"]}
            autoSend={autoSend}
            placeholder={
              scope === "full"
                ? "针对全剧提问或下指令（也可用上方快捷操作）"
                : `针对第 ${scope} 集提问或下指令`
            }
            paramsBar={
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="border-primary/40 text-primary">
                  {scope === "full" ? "全剧" : `第 ${scope} 集`}
                </Badge>
                <span className="mr-2 text-xs text-muted-foreground">
                  通读诊断 → 确认策略 → 逐集修改 → 资产清单
                </span>
                <Button variant="outline" size="sm" className="h-7" onClick={() => quickAction("diagnose")}>
                  <BookOpenText className="size-3.5" /> 通读诊断
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={scope === "full"}
                  onClick={() => quickAction("revise")}
                >
                  <FilePenLine className="size-3.5" /> 修改本集
                </Button>
                <Button variant="outline" size="sm" className="h-7" onClick={() => quickAction("assets")}>
                  <ClipboardList className="size-3.5" /> 出资产清单
                </Button>
              </div>
            }
          />
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <pre className="whitespace-pre-wrap text-sm leading-6">{preview?.content}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({ projectName }: { projectName: string }) {
  return (
    <div className="flex items-center gap-2">
      <Stethoscope className="size-4 text-primary" />
      <h1 className="text-base">剧本医生</h1>
      <span className="text-xs text-muted-foreground">{projectName}</span>
    </div>
  );
}
