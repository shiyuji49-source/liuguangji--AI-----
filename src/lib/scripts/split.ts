/**
 * 剧本分集（规划书 §7：服务端抽文本后切分，不跑 Python）。
 * 规则与 skill 自带 scripts/extract_script.py 一致：
 * 识别行首 "第X集/第X回"（含中文数字、【】［］等包裹）与 "EP1/Ep.1/E01"。
 */
export type SplitEpisode = { episodeNo: number; title: string; content: string; chars: number };
export type SplitResult = { episodes: SplitEpisode[]; warnings: string[] };

const EP_RE =
  /^[\s【［[(〔]*第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*[集回]|^[\s【［[(〔]*(?:EP|Ep|ep|E)\s*[.\-:：]?\s*([0-9]+)\b/;

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function parseChineseNumber(s: string): number | null {
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  let result = 0;
  let current = 0;
  for (const ch of s) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
    } else if (ch === "十") {
      result += (current || 1) * 10;
      current = 0;
    } else if (ch === "百") {
      result += (current || 1) * 100;
      current = 0;
    } else if (ch === "千") {
      result += (current || 1) * 1000;
      current = 0;
    } else {
      return null;
    }
  }
  return result + current;
}

export function splitScript(text: string): SplitResult {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  type Marker = { lineIdx: number; no: number | null; title: string };
  const markers: Marker[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(EP_RE);
    if (!m) continue;
    const no = m[1] ? parseChineseNumber(m[1]) : m[2] ? parseInt(m[2], 10) : null;
    const title = lines[i]
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[\s　:：·\-—【】［\]）)]+/, "")
      .trim()
      .slice(0, 40);
    markers.push({ lineIdx: i, no, title });
  }

  if (markers.length === 0) {
    warnings.push(
      "未发现任何分集标记（第X集 / EP1 等）。已按整本处理——若这是小说/大纲，请先确认是否需要「小说转剧本」。"
    );
    const content = text.trim();
    return {
      episodes: [{ episodeNo: 1, title: "全本（未分集）", content, chars: content.length }],
      warnings,
    };
  }

  if (markers[0].lineIdx > 0) {
    const head = lines.slice(0, markers[0].lineIdx).join("\n").trim();
    // 第一个标记前的内容（片名/人物表等）并入第一集开头展示，不单独成集
    if (head.length > 400) {
      warnings.push(`第一个分集标记前有 ${head.length} 字前置内容（片名/人物表等），已并入第 1 集开头。`);
    }
  }

  const episodes: SplitEpisode[] = [];
  let lastNo = 0;
  for (let i = 0; i < markers.length; i++) {
    const start = i === 0 ? 0 : markers[i].lineIdx;
    const end = i + 1 < markers.length ? markers[i + 1].lineIdx : lines.length;
    const content = lines.slice(start, end).join("\n").trim();
    if (!content) continue;
    let no = markers[i].no ?? lastNo + 1;
    if (no <= lastNo) {
      // 集号重复或乱序（如上/下两部各自从1开始）：顺延编号，保留原始标题
      no = lastNo + 1;
      if (!warnings.some((w) => w.includes("集号顺延"))) {
        warnings.push("发现重复/乱序集号，已按出现顺序顺延编号（原集名保留在标题里）。");
      }
    }
    lastNo = no;
    episodes.push({ episodeNo: no, title: markers[i].title, content, chars: content.length });
  }

  return { episodes, warnings };
}
