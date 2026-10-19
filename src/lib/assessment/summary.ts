import { effectiveStatus } from "./decide";
import type { TenderRequirement } from "@/types/tender";

export function getRequirementSummary(requirements: TenderRequirement[]) {
  return requirements.reduce(
    (summary, requirement) => {
      summary.total += 1;
      summary[effectiveStatus(requirement).toLowerCase() as "met" | "unmet" | "unknown"] += 1;
      return summary;
    },
    { total: 0, met: 0, unmet: 0, unknown: 0 },
  );
}
