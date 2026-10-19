import { describe, expect, it } from "vitest";
import { getRequirementSummary } from "@/lib/assessment/summary";
import type { TenderRequirement } from "@/types/tender";

function requirement(id: string, status: TenderRequirement["status"]): TenderRequirement {
  return {
    id,
    title: id,
    category: "other",
    normalizedCondition: id,
    mandatory: true,
    status,
    matchedEvidenceIds: [],
    source: { documentId: "doc-1", pageNumber: 1, excerpt: id },
    rationale: "",
    requiresHumanReview: false,
    review: "pending",
  };
}

describe("requirement summary", () => {
  it("counts the same criteria collection used by the requirement list", () => {
    const criteria = [
      requirement("met", "MET"),
      requirement("unmet", "UNMET"),
      requirement("unknown", "UNKNOWN"),
      requirement("unknown-2", "UNKNOWN"),
    ];

    expect(getRequirementSummary(criteria)).toEqual({
      total: 4,
      met: 1,
      unmet: 1,
      unknown: 2,
    });
  });
});
