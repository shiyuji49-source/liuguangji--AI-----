"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export type ArtifactItem = {
  id: string;
  type: string;
  title: string;
  content: string;
  version: number;
  createdAt: string;
  authorName: string;
};

export function ArtifactList({ items }: { items: ArtifactItem[] }) {
  const [active, setActive] = useState<ArtifactItem | null>(null);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          暂无产物。在剧本医生 / 提示词生成器的回复上点「存为产物」即可归档到这里。
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <Card
            key={a.id}
            className="cursor-pointer transition-colors hover:border-primary/50"
            onClick={() => setActive(a)}
          >
            <CardContent className="space-y-2 pt-6">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-primary/40 text-primary">
                  {a.type}
                </Badge>
                <span className="truncate text-sm">{a.title}</span>
              </div>
              <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">{a.content}</p>
              <div className="text-xs text-muted-foreground">
                v{a.version} · {a.authorName} · {new Date(a.createdAt).toLocaleString("zh-CN")}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary">
                {active?.type}
              </Badge>
              {active?.title}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <pre className="whitespace-pre-wrap text-sm leading-6">{active?.content}</pre>
          </ScrollArea>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(active?.content ?? "");
              toast.success("已复制");
            }}
          >
            复制全文
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
