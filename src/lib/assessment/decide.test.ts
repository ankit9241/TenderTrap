import { describe, expect, it } from "vitest";
import type { TenderRequirement } from "@/types/tender";
import { decide, effectiveStatus } from "./decide";

const req = (p: Partial<TenderRequirement>): TenderRequirement => ({
  id: Math.random().toString(36),
  title: "t",
  category: "eligibility",
  mandatory: true,
  normalizedCondition: "c",
  source: null,
  status: "MET",
  matchedEvidenceIds: [],
  rationale: "",
  requiresHumanReview: false,
  review: "pending",
  ...p,
});

describe("decide", () => {
  it("a mandatory UNMET requirement is a blocker → SKIP", () => {
    expect(decide([req({ status: "UNMET" })]).recommendation).toBe("SKIP");
  });
  it("missing evidence (UNKNOWN) is not a failure → INVESTIGATE", () => {
    const d = decide([req({ status: "UNKNOWN" })]);
    expect(d.recommendation).toBe("INVESTIGATE");
    expect(d.blockers).toHaveLength(0);
  });
  it("a non-mandatory UNMET requirement is not a blocker", () => {
    expect(decide([req({ status: "UNMET", mandatory: false })]).recommendation).toBe("PROCEED");
  });
  it("all MET and reviewed → PROCEED", () => {
    expect(decide([req({}), req({})]).recommendation).toBe("PROCEED");
  });
  it("a rejected finding becomes UNKNOWN and no longer blocks", () => {
    const r = req({ status: "UNMET", review: "rejected" });
    expect(effectiveStatus(r)).toBe("UNKNOWN");
    expect(decide([r]).recommendation).toBe("INVESTIGATE");
  });
  it("no requirements → incomplete, no recommendation", () => {
    const d = decide([]);
    expect(d.incomplete).toBe(true);
    expect(d.recommendation).toBeNull();
  });
});
