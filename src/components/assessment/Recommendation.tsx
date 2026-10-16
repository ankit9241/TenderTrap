import { cn } from "@/lib/utils";
import type { Recommendation } from "@/types/tender";

const tone: Record<Recommendation, string> = {
  PROCEED: "text-met-ink",
  INVESTIGATE: "text-unknown-ink",
  SKIP: "text-unmet-ink",
};

export function RecommendationWord({ rec, className }: { rec: Recommendation | null; className?: string }) {
  return (
    <span className={cn("block font-display font-semibold capitalize tracking-[-0.035em]", rec ? tone[rec] : "text-muted-foreground", className)}>
      {rec ? rec.toLowerCase() : "Incomplete"}
    </span>
  );
}
