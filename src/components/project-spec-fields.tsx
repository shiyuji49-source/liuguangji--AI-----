"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TIER_OPTIONS,
  TIER_LABELS,
  ASPECT_OPTIONS,
  PRODUCTION_TYPE_OPTIONS,
  PRODUCTION_TYPE_HINT,
  STYLE_GENRE_SUGGESTIONS,
} from "@/lib/labels";

export type ProjectSpec = {
  tier: string;
  aspect: string;
  productionType: string;
  styleGenre: string;
};

export const DEFAULT_SPEC: ProjectSpec = {
  tier: "B",
  aspect: "9:16",
  productionType: "真人",
  styleGenre: "",
};

/**
 * 项目级创作规格表单（建项目向导 + 规格卡编辑共用）。
 * 级别/画幅即时贯穿 skill；制作类型/风格当前为软提示，P1 出图时编译为模型入参。
 */
export function ProjectSpecFields({
  value,
  onChange,
}: {
  value: ProjectSpec;
  onChange: (next: ProjectSpec) => void;
}) {
  const set = (patch: Partial<ProjectSpec>) => onChange({ ...value, ...patch });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>级别</Label>
        <Select value={value.tier} onValueChange={(v) => set({ tier: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIER_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>
                {TIER_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">定静帧取舍与视频骨架（S/A=1080P，B=720P）</p>
      </div>

      <div className="space-y-2">
        <Label>画幅</Label>
        <Select value={value.aspect} onValueChange={(v) => set({ aspect: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECT_OPTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">下沉到分镜/视频构图，应用内可临时改</p>
      </div>

      <div className="space-y-2">
        <Label>制作类型</Label>
        <Select value={value.productionType} onValueChange={(v) => set({ productionType: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRODUCTION_TYPE_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{PRODUCTION_TYPE_HINT[value.productionType]}</p>
      </div>

      <div className="space-y-2">
        <Label>风格 / 题材（选填）</Label>
        <Input
          value={value.styleGenre}
          onChange={(e) => set({ styleGenre: e.target.value })}
          list="style-genre-suggestions"
          placeholder="如 古装、现代都市…"
        />
        <datalist id="style-genre-suggestions">
          {STYLE_GENRE_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">多数 skill 会从剧本自动识别题材</p>
      </div>
    </div>
  );
}
