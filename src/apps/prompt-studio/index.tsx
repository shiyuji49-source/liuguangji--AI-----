"use client";

import { useMemo, useState } from "react";
import { Wand2, Import } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { promptModesFor, ASSET_MODES, type PromptMode } from "@/apps/registry";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

const ASPECTS = ["9:16", "16:9", "4:5", "3:4", "1:1", "2.39:1"];

type Workspace = "资产" | "静帧" | "视频";

/**
 * 应用②提示词生成器（P0）：资产（人物/服装/道具/场景/群演 5 模式）/ 静帧 / 视频三工作区。
 * 模型 = LLM_MODEL_MAIN（claude-sonnet-4-6）。「带入资产清单」为全站唯一跨应用带入。
 */
export function PromptStudioApp({
  projectId,
  projectName,
  projectTier,
  projectRole,
}: {
  projectId: string;
  projectName: string;
  projectTier: ProjectTier;
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
  const [aspect, setAspect] = useState("9:16");
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Wand2 className="size-4 text-primary" />
        <h1 className="text-base">提示词生成器</h1>
        <span className="text-xs text-muted-foreground">{projectName}</span>
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
        key={mode}
        appKey="prompt-studio"
        projectId={projectId}
        mode={mode}
        sendBody={() => ({ episode: episode || undefined, aspect })}
        allowImageUpload
        artifactTypes={artifactTypes}
        prefill={prefill}
        placeholder={
          workspace === "资产"
            ? `描述要生成的${assetMode}，或带入资产清单批量生成`
            : workspace === "静帧"
              ? "粘贴本集剧本片段或描述画面，生成静帧（分镜）提示词"
              : "描述镜头内容（可附静帧提示词/参考图），生成 Seedance 视频提示词"
        }
        paramsBar={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {workspace === "资产" && (
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
            )}
            <label className="flex items-center gap-2 text-muted-foreground">
              集数
              <Input
                value={episode}
                onChange={(e) => setEpisode(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="选填"
                className="h-7 w-16"
              />
            </label>
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
            <span className="text-xs text-muted-foreground">分级 {projectTier}</span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7"
              onClick={() => setImportOpen(true)}
            >
              <Import className="size-3.5" /> 带入资产清单
            </Button>
          </div>
        }
      />

      <ImportArtifactDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId}
        onPick={(text) => {
          setPrefill({ text, nonce: Date.now() });
          setImportOpen(false);
          toast.success("已带入输入框，可编辑后发送");
        }}
      />
    </div>
  );
}

function ImportArtifactDialog({
  open,
  onClose,
  projectId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onPick: (text: string) => void;
}) {
  const [items, setItems] = useState<{ id: string; title: string; content: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/artifacts?projectId=${projectId}&type=${encodeURIComponent("资产清单")}`);
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
          <DialogTitle>带入资产清单（来自剧本医生）</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-2">
            {loading && <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>}
            {!loading && items.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                暂无「资产清单」产物。请先在剧本医生中生成并「存为产物」。
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
