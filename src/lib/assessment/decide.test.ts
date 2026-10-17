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
  it("non-tender documents (circular, contract conditions, compilation) return INVESTIGATE, never PROCEED", () => {
    // Even if all requirements are MET, circulars/GCC must not claim tender eligibility
    const reqs = [req({ status: "MET" }), req({ status: "MET" })];

    const circDecision = decide(reqs, { documentType: "circular_or_policy" });
    expect(circDecision.recommendation).toBe("INVESTIGATE");
    expect(circDecision.summary).toContain("administrative circular or policy clarification");

    const gccDecision = decide(reqs, { documentType: "contract_conditions" });
    expect(gccDecision.recommendation).toBe("INVESTIGATE");
    expect(gccDecision.summary).toContain("general conditions of contract");

    const compDecision = decide(reqs, { documentType: "mixed_compilation" });
    expect(compDecision.recommendation).toBe("INVESTIGATE");
    expect(compDecision.summary).toContain("mixed compilation");

    // Mandatory UNMET blocker still produces SKIP
    const blockerReqs = [req({ status: "UNMET", mandatory: true })];
    const blockedCirc = decide(blockerReqs, { documentType: "circular_or_policy" });
    expect(blockedCirc.recommendation).toBe("SKIP");

    // Genuine tender notice allows PROCEED
    const tenderDecision = decide(reqs, { documentType: "tender_notice" });
    expect(tenderDecision.recommendation).toBe("PROCEED");
  });
});
