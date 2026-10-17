import type {
  CompanyProfile,
  ProjectRecord,
  RegistrationRecord,
  RequirementCategory,
  RequirementStatus,
  TenderRequirement,
  TurnoverRecord,
} from "@/types/tender";

export interface MatchOptions {
  tenderDeadline?: string | null;
}

/**
 * Safely formats amounts in Indian Rupee format without throwing.
 */
export function formatInr(n: number): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${n}`;
  }
}

/**
 * Deterministically parses explicit Indian currency amounts from text.
 * Returns null if no explicit monetary amount is detected or if ambiguous.
 */
export function parseInrAmount(text: string): number | null {
  if (!text || typeof text !== "string") return null;

  // 1. Crores: e.g. "2.0 crore", "₹2 cr", "Rs. 2.50 Crores"
  const cr = text.match(/(?:(?:rs\.?|inr|₹)\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:cr(?:ore)?s?)\b/i);
  if (cr && cr[1]) {
    const val = parseFloat(cr[1]);
    if (!isNaN(val) && val > 0) return Math.round(val * 10_000_000);
  }

  // 2. Lakhs: e.g. "80 lakh", "Rs. 80.00 lakhs", "₹ 80 Lac"
  const lakh = text.match(/(?:(?:rs\.?|inr|₹)\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:lakh?s?|lac|lacs)\b/i);
  if (lakh && lakh[1]) {
    const val = parseFloat(lakh[1]);
    if (!isNaN(val) && val > 0) return Math.round(val * 100_000);
  }

  // 3. Explicit currency symbol + digits with Indian or standard commas
  const direct = text.match(/(?:rs\.?|inr|₹)\s*([0-9]{1,3}(?:,[0-9]{2,3})+|\b[0-9]{5,}\b)/i);
  if (direct && direct[1]) {
    const clean = direct[1].replace(/,/g, "");
    const val = parseFloat(clean);
    if (!isNaN(val) && val > 0) return Math.round(val);
  }

  return null;
}

/**
 * Normalizes text for keyword and substring matching.
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Matches a registration or certification requirement against company registrations.
 */
function matchRegistration(
  r: TenderRequirement,
  company: CompanyProfile,
  cutoffDate: string,
): {
  status: RequirementStatus;
  matchedEvidenceIds: string[];
  rationaleNote: string;
  requiresHumanReview: boolean;
} {
  const reqText = `${r.title} ${r.normalizedCondition} ${r.source?.excerpt || ""}`.toLowerCase();

  // Identify candidate registration from company profile
  let candidate: RegistrationRecord | null = null;

  // 1. GST check
  if (/gst|goods and services tax|gstin/i.test(reqText)) {
    candidate =
      company.registrations.find((reg) => /gst/i.test(reg.name) || /gst/i.test(reg.authority)) || null;
    // If not found in registrations list, check identifiers
    if (!candidate && /gstin|\bgst\b/i.test(company.identifiers)) {
      return {
        status: "MET",
        matchedEvidenceIds: [],
        rationaleNote: `[Match: GST identifier recorded on company profile: ${company.identifiers}.]`,
        requiresHumanReview: false,
      };
    }
  }

  // 2. Contractor Class / PWD check
  if (!candidate && /class[-\s]*(?:i{1,3}|iv|v|[1-5])|contractor registration|pwd\b|cpwd\b/i.test(reqText)) {
    candidate =
      company.registrations.find(
        (reg) =>
          /class|contractor|pwd|cpwd/i.test(reg.name) ||
          /pwd|cpwd/i.test(reg.authority),
      ) || null;
  }

  // 3. EPF check
  if (!candidate && /epf|provident\s+fund/i.test(reqText)) {
    candidate =
      company.registrations.find((reg) => /epf|provident/i.test(reg.name) || /epf/i.test(reg.authority)) || null;
  }

  // 4. ESIC check
  if (!candidate && /esic|esi\b|employee state insurance/i.test(reqText)) {
    candidate =
      company.registrations.find((reg) => /esi/i.test(reg.name) || /esi/i.test(reg.authority)) || null;
  }

  // 5. Generic substring matching between requirement and registration names
  if (!candidate) {
    for (const reg of company.registrations) {
      const regNorm = normalize(reg.name);
      if (regNorm.length >= 4 && normalize(reqText).includes(regNorm)) {
        candidate = reg;
        break;
      }
    }
  }

  if (!candidate) {
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [],
      rationaleNote: `[Evidence gap: No matching registration record found on company profile.]`,
      requiresHumanReview: false,
    };
  }

  // Evaluate candidate state and validity
  if (candidate.state === "expired") {
    return {
      status: "UNMET",
      matchedEvidenceIds: [candidate.id],
      rationaleNote: `[Match: Registration '${candidate.name}' (${candidate.authority}) is marked expired${candidate.validUntil ? ` on ${candidate.validUntil}` : ""}.]`,
      requiresHumanReview: false,
    };
  }

  if (candidate.state === "uploaded_unreviewed") {
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [candidate.id],
      rationaleNote: `[Match: Registration '${candidate.name}' (${candidate.authority}) is uploaded but unreviewed. Unreviewed evidence cannot prove eligibility.]`,
      requiresHumanReview: true,
    };
  }

  if (candidate.state === "not_provided") {
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [],
      rationaleNote: `[Match: Registration '${candidate.name}' is marked as not provided.]`,
      requiresHumanReview: false,
    };
  }

  // candidate.state === "reviewed"
  if (candidate.validUntil) {
    if (candidate.validUntil < cutoffDate) {
      return {
        status: "UNMET",
        matchedEvidenceIds: [candidate.id],
        rationaleNote: `[Match: Registration '${candidate.name}' (${candidate.authority}) expired on ${candidate.validUntil} (prior to evaluation/deadline date ${cutoffDate}).]`,
        requiresHumanReview: false,
      };
    }
    return {
      status: "MET",
      matchedEvidenceIds: [candidate.id],
      rationaleNote: `[Match: Valid reviewed registration on file: ${candidate.name} (${candidate.authority}, valid until ${candidate.validUntil}).]`,
      requiresHumanReview: false,
    };
  }

  return {
    status: "MET",
    matchedEvidenceIds: [candidate.id],
    rationaleNote: `[Match: Valid reviewed registration on file: ${candidate.name} (${candidate.authority}).]`,
    requiresHumanReview: false,
  };
}

/**
 * Matches a financial capacity requirement (turnover) against company turnover records.
 */
function matchFinancial(
  r: TenderRequirement,
  company: CompanyProfile,
): {
  status: RequirementStatus;
  matchedEvidenceIds: string[];
  rationaleNote: string;
  requiresHumanReview: boolean;
} {
  const reqText = `${r.title} ${r.normalizedCondition} ${r.source?.excerpt || ""}`;
  const threshold = parseInrAmount(reqText);

  if (threshold === null) {
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [],
      rationaleNote: `[Ambiguity: Financial threshold or formula could not be parsed deterministically from condition text. Requires human evaluation.]`,
      requiresHumanReview: true,
    };
  }

  if (!company.turnover || company.turnover.length === 0) {
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [],
      rationaleNote: `[Evidence gap: No turnover records found in company profile for comparison with required ${formatInr(threshold)}.]`,
      requiresHumanReview: false,
    };
  }

  const isAverage = /average\s+(?:annual\s+)?turnover|avg(?:\.|\b)/i.test(reqText);
  const reviewedTurnover = company.turnover.filter((t) => t.state === "reviewed" && t.amountInr > 0);
  const unreviewedTurnover = company.turnover.filter(
    (t) => t.state === "uploaded_unreviewed" && t.amountInr > 0,
  );

  if (isAverage) {
    // Determine number of years if explicitly mentioned, e.g. "last two financial years"
    const yearsMatch = reqText.match(/last\s+(two|three|four|five|\d+)\s+(?:financial\s+)?years/i);
    let nYears = 0;
    if (yearsMatch && yearsMatch[1]) {
      const word = yearsMatch[1].toLowerCase();
      const numMap: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
      nYears = numMap[word] ?? parseInt(word, 10);
    }
    if (nYears <= 0) {
      nYears = Math.min(company.turnover.length, 3);
    }

    // Sort descending by financialYear
    const sortedReviewed = [...reviewedTurnover].sort((a, b) => b.financialYear.localeCompare(a.financialYear));
    const sortedAll = [...company.turnover]
      .filter((t) => t.amountInr > 0 && (t.state === "reviewed" || t.state === "uploaded_unreviewed"))
      .sort((a, b) => b.financialYear.localeCompare(a.financialYear));

    const reviewedSlice = sortedReviewed.slice(0, nYears);
    const avgReviewed =
      reviewedSlice.length > 0
        ? Math.round(reviewedSlice.reduce((sum, t) => sum + t.amountInr, 0) / reviewedSlice.length)
        : 0;

    if (reviewedSlice.length >= nYears && avgReviewed >= threshold) {
      return {
        status: "MET",
        matchedEvidenceIds: reviewedSlice.map((t) => t.id),
        rationaleNote: `[Match: Average annual turnover of reviewed statements (${formatInr(avgReviewed)}) meets or exceeds required ${formatInr(threshold)} across ${reviewedSlice.length} years.]`,
        requiresHumanReview: false,
      };
    }

    const allSlice = sortedAll.slice(0, nYears);
    const avgAll =
      allSlice.length > 0
        ? Math.round(allSlice.reduce((sum, t) => sum + t.amountInr, 0) / allSlice.length)
        : 0;

    if (avgAll >= threshold && allSlice.some((t) => t.state === "uploaded_unreviewed")) {
      return {
        status: "UNKNOWN",
        matchedEvidenceIds: allSlice.map((t) => t.id),
        rationaleNote: `[Match: Average turnover (${formatInr(avgAll)}) would meet required ${formatInr(threshold)} only if unreviewed financial statements are accepted. Requires human verification.]`,
        requiresHumanReview: true,
      };
    }

    if (avgAll > 0 && avgAll < threshold) {
      return {
        status: "UNMET",
        matchedEvidenceIds: allSlice.map((t) => t.id),
        rationaleNote: `[Match: Recorded average annual turnover (${formatInr(avgAll)}) falls short of the required threshold (${formatInr(threshold)}).]`,
        requiresHumanReview: false,
      };
    }

    return {
      status: "UNKNOWN",
      matchedEvidenceIds: allSlice.map((t) => t.id),
      rationaleNote: `[Evidence gap: Insufficient turnover records to calculate ${nYears}-year average for ${formatInr(threshold)}.]`,
      requiresHumanReview: true,
    };
  }

  // Single year / annual turnover check
  const maxReviewed = reviewedTurnover.length > 0 ? Math.max(...reviewedTurnover.map((t) => t.amountInr)) : 0;
  if (maxReviewed >= threshold) {
    const qualifying = reviewedTurnover.filter((t) => t.amountInr >= threshold);
    return {
      status: "MET",
      matchedEvidenceIds: qualifying.map((t) => t.id),
      rationaleNote: `[Match: Reviewed annual turnover (${formatInr(maxReviewed)}) meets or exceeds required ${formatInr(threshold)}.]`,
      requiresHumanReview: false,
    };
  }

  const maxUnreviewed = unreviewedTurnover.length > 0 ? Math.max(...unreviewedTurnover.map((t) => t.amountInr)) : 0;
  if (maxUnreviewed >= threshold) {
    const qualifying = unreviewedTurnover.filter((t) => t.amountInr >= threshold);
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: qualifying.map((t) => t.id),
      rationaleNote: `[Match: Annual turnover of ${formatInr(maxUnreviewed)} meets threshold (${formatInr(threshold)}) but is unreviewed. Requires human verification.]`,
      requiresHumanReview: true,
    };
  }

  const allAmounts = company.turnover.map((t) => t.amountInr).filter((a) => a > 0);
  const highest = allAmounts.length > 0 ? Math.max(...allAmounts) : 0;
  if (highest > 0 && highest < threshold && reviewedTurnover.length === company.turnover.length) {
    return {
      status: "UNMET",
      matchedEvidenceIds: company.turnover.map((t) => t.id),
      rationaleNote: `[Match: Highest recorded turnover (${formatInr(highest)}) falls short of required ${formatInr(threshold)}.]`,
      requiresHumanReview: false,
    };
  }

  return {
    status: "UNKNOWN",
    matchedEvidenceIds: company.turnover.map((t) => t.id),
    rationaleNote: `[Evidence gap: Recorded turnover statements do not demonstrably satisfy ${formatInr(threshold)}.]`,
    requiresHumanReview: false,
  };
}

/**
 * Matches an experience requirement (past completed projects) against company projects.
 */
function matchExperience(
  r: TenderRequirement,
  company: CompanyProfile,
  cutoffDate: string,
): {
  status: RequirementStatus;
  matchedEvidenceIds: string[];
  rationaleNote: string;
  requiresHumanReview: boolean;
} {
  const reqText = `${r.title} ${r.normalizedCondition} ${r.source?.excerpt || ""}`;

  if (!company.projects || company.projects.length === 0) {
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [],
      rationaleNote: `[Evidence gap: No completed project records found in company profile.]`,
      requiresHumanReview: false,
    };
  }

  const threshold = parseInrAmount(reqText);
  if (threshold === null) {
    // Qualitative experience condition without exact monetary threshold
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: company.projects.map((p) => p.id),
      rationaleNote: `[Requires verification: Qualitative similarity of past project works must be confirmed by human review.]`,
      requiresHumanReview: true,
    };
  }

  // Check recency restriction: e.g. "last 5 years" / "last five years"
  const yearsMatch = reqText.match(/last\s+(two|three|four|five|seven|ten|\d+)\s+years/i);
  let recencyYears: number | null = null;
  if (yearsMatch && yearsMatch[1]) {
    const word = yearsMatch[1].toLowerCase();
    const map: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, seven: 7, ten: 10 };
    recencyYears = map[word] ?? parseInt(word, 10);
  }

  let earliestAllowedDate: string | null = null;
  if (recencyYears && recencyYears > 0) {
    try {
      const d = new Date(cutoffDate);
      d.setFullYear(d.getFullYear() - recencyYears);
      earliestAllowedDate = d.toISOString().slice(0, 10);
    } catch {
      earliestAllowedDate = null;
    }
  }

  // Check for qualifying reviewed projects
  const reviewedMeeting = company.projects.filter(
    (p) => p.state === "reviewed" && p.valueInr >= threshold,
  );

  for (const proj of reviewedMeeting) {
    if (earliestAllowedDate && proj.completed && proj.completed < earliestAllowedDate) {
      continue; // Outside recency
    }
    return {
      status: "MET",
      matchedEvidenceIds: [proj.id],
      rationaleNote: `[Match: Reviewed project '${proj.name}' (${proj.client}, ${formatInr(proj.valueInr)}, completed ${proj.completed}) satisfies value requirement (≥ ${formatInr(threshold)}).]`,
      requiresHumanReview: false,
    };
  }

  // Check unreviewed projects meeting value
  const unreviewedMeeting = company.projects.filter(
    (p) => p.state === "uploaded_unreviewed" && p.valueInr >= threshold,
  );
  if (unreviewedMeeting.length > 0) {
    const proj = unreviewedMeeting[0]!;
    return {
      status: "UNKNOWN",
      matchedEvidenceIds: [proj.id],
      rationaleNote: `[Match: Project '${proj.name}' (${formatInr(proj.valueInr)}) meets value threshold but is unreviewed. Requires human verification.]`,
      requiresHumanReview: true,
    };
  }

  // Check if all projects fail value
  const allReviewed = company.projects.every((p) => p.state === "reviewed");
  const maxProjectVal = Math.max(...company.projects.map((p) => p.valueInr));
  if (allReviewed && maxProjectVal < threshold) {
    return {
      status: "UNMET",
      matchedEvidenceIds: company.projects.map((p) => p.id),
      rationaleNote: `[Match: No completed project meets the minimum required value of ${formatInr(threshold)}. Highest completed project on file is ${formatInr(maxProjectVal)}.]`,
      requiresHumanReview: false,
    };
  }

  return {
    status: "UNKNOWN",
    matchedEvidenceIds: company.projects.map((p) => p.id),
    rationaleNote: `[Evidence gap: No verified project satisfies both the required value of ${formatInr(threshold)} and recency criteria.]`,
    requiresHumanReview: true,
  };
}

/**
 * Pure, deterministic requirement matching engine.
 * Evaluates extracted tender requirements against company profile evidence.
 *
 * Rules:
 * - Deterministic evaluations only (registrations, turnover, project experience).
 * - MET only when reviewed, relevant evidence demonstrably satisfies the condition.
 * - UNMET only when explicitly contradicted by valid evidence (e.g. expired credential or verified shortfall).
 * - UNKNOWN for missing, unreviewed, or ambiguous conditions.
 * - Source citations and existing requiresHumanReview flags are strictly preserved and never cleared.
 */
export function matchRequirements(
  requirements: TenderRequirement[],
  company: CompanyProfile,
  options?: MatchOptions,
): TenderRequirement[] {
  const cutoffDate = options?.tenderDeadline || new Date().toISOString().slice(0, 10);

  return requirements.map((r) => {
    // Retain existing incoming requiresHumanReview from citation repair, low OCR confidence, etc.
    const incomingNeedsReview = Boolean(r.requiresHumanReview);
    let matchedStatus: RequirementStatus = "UNKNOWN";
    let matchedEvidenceIds: string[] = [];
    let note = "";
    let matcherNeedsReview = false;

    // Evaluate by category
    if (r.category === "registration" || r.category === "certification") {
      const match = matchRegistration(r, company, cutoffDate);
      matchedStatus = match.status;
      matchedEvidenceIds = match.matchedEvidenceIds;
      note = match.rationaleNote;
      matcherNeedsReview = match.requiresHumanReview;
    } else if (r.category === "financial") {
      const match = matchFinancial(r, company);
      matchedStatus = match.status;
      matchedEvidenceIds = match.matchedEvidenceIds;
      note = match.rationaleNote;
      matcherNeedsReview = match.requiresHumanReview;
    } else if (r.category === "experience") {
      const match = matchExperience(r, company, cutoffDate);
      matchedStatus = match.status;
      matchedEvidenceIds = match.matchedEvidenceIds;
      note = match.rationaleNote;
      matcherNeedsReview = match.requiresHumanReview;
    } else if (r.category === "emd") {
      // EMD is a commercial condition
      const reqText = `${r.title} ${r.normalizedCondition} ${r.source?.excerpt || ""}`.toLowerCase();
      const mentionsExemption = /exemption|exempt|msme|udyam/i.test(reqText);
      const hasUdyam =
        /udyam|msme/i.test(company.identifiers) ||
        company.registrations.some((reg) => /udyam|msme/i.test(reg.name));

      if (mentionsExemption && hasUdyam) {
        matchedStatus = "UNKNOWN";
        matcherNeedsReview = true;
        note = `[Commercial condition: Tender references EMD exemption and company has MSME/Udyam on file. Exemption applicability must be verified against tender rules.]`;
      } else {
        matchedStatus = "UNKNOWN";
        note = `[Commercial condition: EMD is a mandatory submission requirement.]`;
      }
    } else if (r.category === "deadline") {
      matchedStatus = "UNKNOWN";
      note = `[Commercial milestone: Submission deadline must be tracked during bid preparation.]`;
    } else {
      matchedStatus = "UNKNOWN";
      note = `[Unmapped condition: Requires human review against contractor capabilities.]`;
    }

    // Safety rule: If the extracted clause itself had unverified citation or low-confidence OCR,
    // it MUST NOT be marked MET without human confirmation.
    if (incomingNeedsReview && matchedStatus === "MET") {
      matchedStatus = "UNKNOWN";
      matcherNeedsReview = true;
      note = `${note} [Requires verification: Underlying tender clause citation or OCR has uncertainty.]`;
    }

    const finalRequiresHumanReview = incomingNeedsReview || matcherNeedsReview;
    const existingRationale = r.rationale ? r.rationale.trim() : "";
    const combinedRationale = note
      ? existingRationale
        ? `${existingRationale} ${note}`
        : note
      : existingRationale;

    return {
      ...r,
      status: matchedStatus,
      matchedEvidenceIds,
      rationale: combinedRationale,
      requiresHumanReview: finalRequiresHumanReview,
      // Source citations are preserved verbatim
      source: r.source ? { ...r.source } : null,
    };
  });
}

/**
 * Evaluates whether a requirement's source citation validly maps to an assessment document.
 * Requires:
 * 1. Matching documentId or filename.
 * 2. Grounded integer page number > 0.
 * 3. Non-empty verbatim supporting excerpt.
 * A requirement with missing/invalid citations (e.g. pageNumber: null, empty excerpt, mismatched document)
 * will never create a false link to the document.
 */
export function isRequirementLinkedToDocument(
  req: TenderRequirement,
  doc: { id: string; filename: string },
): boolean {
  if (!req.source) return false;
  const matchesDoc = req.source.documentId === doc.id || req.source.documentId === doc.filename;
  if (!matchesDoc) return false;

  const hasValidPage = typeof req.source.pageNumber === "number" && req.source.pageNumber > 0;
  const hasValidExcerpt = Boolean(req.source.excerpt && req.source.excerpt.trim().length > 0);

  return hasValidPage && hasValidExcerpt;
}

/**
 * Links requirements to the uploaded document ID only when they have a grounded, valid citation.
 * Requirements with missing citations or belonging to another source are preserved without false links.
 */
export function linkRequirementsToDocument(
  requirements: TenderRequirement[],
  doc: { id: string; filename: string },
): TenderRequirement[] {
  return requirements.map((r) => {
    if (isRequirementLinkedToDocument(r, doc)) {
      return {
        ...r,
        source: {
          ...r.source!,
          documentId: doc.id,
        },
      };
    }
    // If requirement has a missing citation or empty excerpt, remove any false documentId mapping
    if (r.source && (r.source.documentId === doc.filename || r.source.documentId === doc.id)) {
      return {
        ...r,
        source: {
          ...r.source,
          documentId: undefined,
        },
      };
    }
    return r;
  });
}

