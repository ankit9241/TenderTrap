import type { Recommendation, RequirementStatus, TenderRequirement } from "@/types/tender";

/** Status after human review. A rejected finding is no longer trusted, so it becomes UNKNOWN. */
export function effectiveStatus(r: TenderRequirement): RequirementStatus {
  return r.review === "rejected" ? "UNKNOWN" : r.status;
}

export function needsReview(r: TenderRequirement): boolean {
  if (r.review === "flagged" || r.review === "rejected") return true;
  return r.requiresHumanReview && r.review !== "confirmed";
}

export interface Decision {
  recommendation: Recommendation | null;
  incomplete: boolean;
  blockers: TenderRequirement[];
  gaps: TenderRequirement[];
  unresolved: TenderRequirement[];
  commercial: TenderRequirement[];
  summary: string;
}

/**
 * Deterministic rules — the model never decides eligibility:
 * - SKIP: a mandatory requirement is UNMET and that finding was not disputed.
 * - INVESTIGATE: any evidence gap (UNKNOWN) or clause needing human review.
 * - PROCEED: no known blocker among reviewed requirements (not a guarantee).
 */
export function decide(requirements: TenderRequirement[]): Decision {
  const blockers = requirements.filter(
    (r) => r.mandatory === true && effectiveStatus(r) === "UNMET",
  );
  const gaps = requirements.filter((r) => effectiveStatus(r) === "UNKNOWN");
  const unresolved = requirements.filter((r) => needsReview(r));
  const commercial = requirements.filter((r) => r.category === "emd" || r.category === "deadline");

  if (requirements.length === 0) {
    return {
      recommendation: null,
      incomplete: true,
      blockers,
      gaps,
      unresolved,
      commercial,
      summary: "No requirements have been extracted yet. The assessment is incomplete.",
    };
  }

  let recommendation: Recommendation;
  let summary: string;
  if (blockers.length > 0) {
    recommendation = "SKIP";
    summary = `${count(blockers.length, "mandatory requirement")} not met based on the evidence provided.`;
  } else if (gaps.length > 0 || unresolved.length > 0) {
    recommendation = "INVESTIGATE";
    const n = new Set([...gaps, ...unresolved].map((r) => r.id)).size;
    summary = `${count(n, "material requirement")} need${n === 1 ? "s" : ""} review before committing to bid preparation.`;
  } else {
    recommendation = "PROCEED";
    summary =
      "No known blocking issue in the reviewed requirements. This is not a guarantee of eligibility or award.";
  }

  return { recommendation, incomplete: false, blockers, gaps, unresolved, commercial, summary };
}

function count(n: number, noun: string) {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
  return `${words[n] ?? n} ${noun}${n === 1 ? "" : "s"}`;
}
