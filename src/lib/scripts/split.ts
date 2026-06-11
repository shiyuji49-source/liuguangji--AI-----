/**
 * 剧本分集 v2（规划书 §7：服务端切分，不跑 Python）。
 * 真实剧本常见结构：人物表/简介 + 分集梗概（每行"第X集 一句话"）+ 正文 N 集。
 * v1 的教训：把梗概行当集标记 + 乱序级联顺延，会把 60 集切成 11-90。
 * v2 算法：
 *   1. 收集所有行首集标记；
 *   2. 把标记划分为「连续编号链」（编号递增、步长 ≤2）；
 *   3. 正文链 = 总字数最大的链（梗概/目录链字数小，必然落选）；
 *   4. 正文链之前的全部内容归入 episodeNo=0「前置资料」；链外标记一律忽略（文本留在所在集内）；
 *   5. 集号 = 原始集号，不再顺延；同号重复（上/下）合并内容。
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

function cleanTitle(raw: string): string {
  return raw
    .replace(/^[\s　:：·\-—]+/, "")
    .replace(/^[【［[(〔]+/, "")
    .replace(/[】］\])〕]+$/, "")
    .replace(/^[\s　:：·\-—]+/, "")
    .trim()
    .slice(0, 40);
}

type Marker = { lineIdx: number; no: number; title: string };
type Run = { markers: Marker[]; totalChars: number };

export function splitScript(text: string): SplitResult {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // 1) 收集标记
  const markers: Marker[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(EP_RE);
    if (!m) continue;
    const no = m[1] ? parseChineseNumber(m[1]) : m[2] ? parseInt(m[2], 10) : null;
    if (no === null || no <= 0 || no > 2000) continue;
    markers.push({ lineIdx: i, no, title: cleanTitle(lines[i].slice((m.index ?? 0) + m[0].length)) });
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

  // 段落字数（marker i 到 marker i+1 之间）
  const segChars = (i: number) => {
    const start = markers[i].lineIdx;
    const end = i + 1 < markers.length ? markers[i + 1].lineIdx : lines.length;
    return lines.slice(start, end).join("\n").length;
  };

  // 2) 划分连续编号链（递增、步长 1-2；同号视作延续，归入同链）
  const runs: Run[] = [];
  let cur: Marker[] = [];
  for (let i = 0; i < markers.length; i++) {
    const prev = cur[cur.length - 1];
    if (!prev || (markers[i].no >= prev.no && markers[i].no - prev.no <= 2)) {
      cur.push(markers[i]);
    } else {
      runs.push({ markers: cur, totalChars: 0 });
      cur = [markers[i]];
    }
  }
  if (cur.length) runs.push({ markers: cur, totalChars: 0 });
  for (const run of runs) {
    run.totalChars = run.markers.reduce((sum, mk) => sum + segChars(markers.indexOf(mk)), 0);
  }

  // 3) 正文链 = 总字数最大的链
  const body = runs.reduce((a, b) => (b.totalChars > a.totalChars ? b : a));
  if (runs.length > 1) {
    warnings.push(
      `识别到 ${runs.length} 段集号序列（如目录/分集梗概与正文并存），已取字数最大的一段为正文（${body.markers.length} 个标记）；其余文本归入前置资料或所在集。`
    );
  }

  // 4) 前置资料（正文第一个标记之前的全部内容）
  const episodes: SplitEpisode[] = [];
  const bodyStartLine = body.markers[0].lineIdx;
  const preamble = lines.slice(0, bodyStartLine).join("\n").trim();
  if (preamble.length >= 300) {
    episodes.push({
      episodeNo: 0,
      title: "前置资料（人物表/梗概等）",
      content: preamble,
      chars: preamble.length,
    });
    warnings.push(`正文前有 ${preamble.length} 字前置内容（人物表/分集梗概等），已归入「前置资料」。`);
  }

  // 5) 正文切分：只按正文链标记切；同号合并；忽略链外标记
  const bodySet = new Set(body.markers.map((m) => m.lineIdx));
  const bodyMarkers = body.markers;
  for (let i = 0; i < bodyMarkers.length; i++) {
    const start = i === 0 && preamble.length < 300 ? 0 : bodyMarkers[i].lineIdx;
    const end = i + 1 < bodyMarkers.length ? bodyMarkers[i + 1].lineIdx : lines.length;
    const content = lines.slice(start, end).join("\n").trim();
    if (!content) continue;
    const no = bodyMarkers[i].no;
    const existing = episodes.find((e) => e.episodeNo === no);
    if (existing) {
      // 同号（上/下篇）：合并
      existing.content += `\n\n${content}`;
      existing.chars = existing.content.length;
    } else {
      episodes.push({ episodeNo: no, title: bodyMarkers[i].title, content, chars: content.length });
    }
  }
  void bodySet;

  const bodyCount = episodes.filter((e) => e.episodeNo > 0).length;
  if (bodyCount === 0) {
    const content = text.trim();
    return {
      episodes: [{ episodeNo: 1, title: "全本（未分集）", content, chars: content.length }],
      warnings,
    };
  }

  // 去重 warnings
  return { episodes, warnings: [...new Set(warnings)] };
}
