"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import type { ProjectRole, ProjectTier } from "@/lib/db/schema";

/**
 * 应用①剧本医生（P0）：通读长剧本 → 诊断/分集修改/产出资产清单。
 * 模型 = LLM_MODEL_HEAVY（claude-opus-4-8，1M 上下文），由服务端按 appKey 路由。
 */
export function ScriptDoctorApp({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
  projectTier: ProjectTier;
  projectRole: ProjectRole;
  userId: string;
}) {
  const [episode, setEpisode] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Stethoscope className="size-4 text-primary" />
        <h1 className="text-base">剧本医生</h1>
        <span className="text-xs text-muted-foreground">
          {projectName} · 上传剧本（.docx/.pdf/.txt）做诊断、分集修改，产出资产清单
        </span>
      </div>
      <ChatWorkspace
        appKey="script-doctor"
        projectId={projectId}
        sendBody={() => ({ episode: episode || undefined })}
        allowDocUpload
        artifactTypes={["资产清单", "剧本"]}
        placeholder="例如：通读全剧给出诊断报告 / 修改第 3 集 / 输出全剧资产清单"
        paramsBar={
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground">
              当前集
              <Input
                value={episode}
                onChange={(e) => setEpisode(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="选填"
                className="h-7 w-20"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              产出的「资产清单」存为产物后，可在提示词生成器一键带入
            </span>
          </div>
        }
      />
    </div>
  );
}
