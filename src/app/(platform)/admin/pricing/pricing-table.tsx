"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const KEY_HINTS: Record<string, string> = {
  markup: "默认加价倍率",
  "llm.sonnet.in_per_1m": "Sonnet 输入 积分/百万token（上线前按乐奇实价核定）",
  "llm.sonnet.out_per_1m": "Sonnet 输出 积分/百万token（上线前按乐奇实价核定）",
  "llm.opus.in_per_1m": "Opus 输入 积分/百万token",
  "llm.opus.out_per_1m": "Opus 输出 积分/百万token",
  "llm.cached_in_ratio": "缓存命中输入折扣系数",
  "llm.min_per_call": "LLM 单次最低收费（积分）",
  "image.per_1k": "图片 1K 积分/张",
  "image.per_2k": "图片 2K 积分/张",
  "image.per_4k": "图片 4K 积分/张",
  "image.input_per_1m": "图片输入词元 积分/百万token",
  "video.720p.per_1k_tokens": "视频 720P 积分/千token",
  "video.1080p.per_1k_tokens": "视频 1080P 积分/千token",
};

export function PricingTable({
  items,
}: {
  items: { key: string; value: number; updatedAt: string }[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function save(key: string) {
    const value = Number(edits[key]);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("请输入有效数字");
      return;
    }
    const res = await fetch("/api/admin/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "保存失败");
      return;
    }
    toast.success(`${key} 已更新`);
    setEdits((e) => {
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        1 元 = 100 积分（固定）。所有单价存数据库，修改后约 30 秒内对新请求生效。
      </p>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>配置项</TableHead>
              <TableHead>说明</TableHead>
              <TableHead className="w-40 text-right">当前值</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.key}>
                <TableCell className="font-mono text-xs">{item.key}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {KEY_HINTS[item.key] ?? ""}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="h-7 text-right"
                    value={edits[item.key] ?? String(item.value)}
                    onChange={(e) => setEdits((d) => ({ ...d, [item.key]: e.target.value }))}
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.updatedAt}</TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={edits[item.key] === undefined || Number(edits[item.key]) === item.value}
                    onClick={() => save(item.key)}
                  >
                    保存
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
