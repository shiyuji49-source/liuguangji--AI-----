import { Badge } from "@/components/ui/badge";
import { TIER_LABELS } from "@/lib/labels";

/** 应用头部展示项目继承的创作规格，让用户清楚当前提示词的上下文来自项目 */
export function ProjectContextBadges({
  tier,
  aspect,
  productionType,
  styleGenre,
}: {
  tier: string;
  aspect: string;
  productionType: string;
  styleGenre?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="border-primary/40 text-primary">
        {TIER_LABELS[tier as "B" | "A" | "S"] ?? tier}
      </Badge>
      <Badge variant="outline">{aspect}</Badge>
      <Badge variant="outline">{productionType}</Badge>
      {styleGenre && <Badge variant="outline">{styleGenre}</Badge>}
    </div>
  );
}
