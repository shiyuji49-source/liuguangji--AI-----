import ExcelJS from "exceljs";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { promptItems, shots, videoSegments, projects } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";
import { assertWorkspaceAccess } from "@/lib/prompt-studio/access";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2433" },
};
const HEADER_FONT = { bold: true, color: { argb: "FFEED9A0" }, size: 11 };

/** 统一表头样式 + 冻结首行 + 自动换行 */
function styleSheet(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = HEADER_FONT;
  header.height = 22;
  header.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.alignment = { vertical: "middle" };
    c.border = { bottom: { style: "thin", color: { argb: "FF54607A" } } };
  });
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

function epLabel(episodes: unknown): string {
  const arr = Array.isArray(episodes) ? (episodes as number[]) : [];
  if (!arr.length) return "";
  // 连续段折叠：1,2,3,5 → 1-3、5
  const parts: string[] = [];
  let s = arr[0];
  let p = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    if (i < arr.length && arr[i] === p + 1) {
      p = arr[i];
      continue;
    }
    parts.push(s === p ? `${s}` : `${s}-${p}`);
    if (i < arr.length) {
      s = arr[i];
      p = arr[i];
    }
  }
  return parts.join("、");
}

// 导出 xlsx：type=assets|shotlist|stills|segments（后三者需 scriptId+episodeNo）
export async function GET(req: Request, { params }: Params) {
  try {
    const { id: projectId } = await params;
    const { projectRole } = await requireProjectMember(projectId);
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "assets";
    // 导出权限按工作区对应角色（与各生成阶段同一口径）：资产→资产工作区，分镜/静帧→分镜，片段→视频
    assertWorkspaceAccess(projectRole, type === "assets" ? "资产" : type === "segments" ? "视频" : "静帧");
    const scriptId = url.searchParams.get("scriptId");
    const episodeNo = url.searchParams.get("episodeNo");
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    const pname = project?.name ?? "项目";

    const wb = new ExcelJS.Workbook();
    wb.creator = "鎏光机";
    let filename = `${pname}-导出`;

    if (type === "assets") {
      filename = `${pname}-全剧资产提示词`;
      const items = await db
        .select()
        .from(promptItems)
        .where(and(eq(promptItems.projectId, projectId), eq(promptItems.workspace, "资产")))
        .orderBy(asc(promptItems.sortIndex), asc(promptItems.createdAt));
      for (const kind of ["人物", "服装", "道具", "场景", "群演"]) {
        const rows = items.filter((i) => i.kind === kind);
        const ws = wb.addWorksheet(`${kind}（${rows.length}）`);
        ws.columns = [
          { header: "名称", key: "name", width: 22 },
          { header: "出现集数", key: "eps", width: 16 },
          { header: "简介", key: "brief", width: 36 },
          { header: "状态", key: "state", width: 8 },
          { header: "提示词（可直接粘贴出图）", key: "prompt", width: 110 },
        ];
        for (const r of rows) {
          ws.addRow({
            name: r.name,
            eps: epLabel(r.episodes),
            brief: r.brief,
            state: r.state === "done" ? "已生成" : "未生成",
            prompt: r.promptText ?? "",
          });
        }
        styleSheet(ws);
      }
    } else if (type === "shotlist" || type === "stills") {
      if (!scriptId || !episodeNo) return Response.json({ error: "缺少参数" }, { status: 400 });
      const rows = await db
        .select()
        .from(shots)
        .where(
          and(
            eq(shots.projectId, projectId),
            eq(shots.scriptId, scriptId),
            eq(shots.episodeNo, Number(episodeNo))
          )
        )
        .orderBy(asc(shots.shotNo));
      if (type === "shotlist") {
        filename = `${pname}-第${episodeNo}集-分镜表`;
        const ws = wb.addWorksheet(`第${episodeNo}集分镜表（${rows.length}镜）`);
        ws.columns = [
          { header: "镜号", key: "no", width: 6 },
          { header: "场", key: "scene", width: 18 },
          { header: "镜头类型", key: "fn", width: 10 },
          { header: "画面/动作", key: "summary", width: 60 },
          { header: "台词/声音", key: "dialogue", width: 40 },
          { header: "景别", key: "type", width: 8 },
          { header: "运镜", key: "move", width: 18 },
          { header: "时长(s)", key: "dur", width: 8 },
          { header: "关联资产", key: "refs", width: 26 },
          { header: "出静帧", key: "still", width: 8 },
        ];
        for (const s of rows) {
          ws.addRow({
            no: s.shotNo,
            scene: s.sceneLabel,
            fn: s.shotFunction,
            summary: s.summary,
            dialogue: s.dialogue,
            type: s.shotType,
            move: s.cameraMove,
            dur: s.durationSec ?? "",
            refs: ((s.assetRefs as string[] | null) ?? []).join("、"),
            still: s.needStill ? "是" : "否",
          });
        }
        styleSheet(ws);
      } else {
        filename = `${pname}-第${episodeNo}集-静帧提示词`;
        const ws = wb.addWorksheet(`第${episodeNo}集静帧（${rows.filter((r) => r.stillPrompt).length}）`);
        ws.columns = [
          { header: "镜号", key: "no", width: 6 },
          { header: "场", key: "scene", width: 18 },
          { header: "画面摘要", key: "summary", width: 40 },
          { header: "静帧提示词（24字段+成品）", key: "prompt", width: 120 },
        ];
        for (const s of rows) {
          if (!s.stillPrompt) continue;
          ws.addRow({ no: s.shotNo, scene: s.sceneLabel, summary: s.summary, prompt: s.stillPrompt });
        }
        styleSheet(ws);
      }
    } else if (type === "segments") {
      if (!scriptId || !episodeNo) return Response.json({ error: "缺少参数" }, { status: 400 });
      filename = `${pname}-第${episodeNo}集-视频提示词（多镜合并）`;
      const segs = await db
        .select()
        .from(videoSegments)
        .where(
          and(
            eq(videoSegments.projectId, projectId),
            eq(videoSegments.scriptId, scriptId),
            eq(videoSegments.episodeNo, Number(episodeNo))
          )
        )
        .orderBy(asc(videoSegments.segmentNo));
      const ws = wb.addWorksheet(`第${episodeNo}集片段（${segs.length}）`);
      ws.columns = [
        { header: "片段", key: "no", width: 6 },
        { header: "标签", key: "label", width: 28 },
        { header: "成员镜", key: "shots", width: 14 },
        { header: "时长(s)", key: "dur", width: 8 },
        { header: "字数", key: "len", width: 8 },
        { header: "视频提示词（可直接粘贴 Seedance）", key: "prompt", width: 120 },
      ];
      for (const s of segs) {
        ws.addRow({
          no: s.segmentNo,
          label: s.label,
          shots: ((s.shotNos as number[]) ?? []).join("、"),
          dur: s.durationSec ?? "",
          len: s.prompt?.length ?? "",
          prompt: s.prompt ?? "",
        });
      }
      styleSheet(ws);
    } else {
      return Response.json({ error: "未知导出类型" }, { status: 400 });
    }

    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
