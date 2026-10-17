import type { Assessment, CompanyProfile, EvidenceRecord } from "@/types/tender";

/** All content in this file is synthetic and illustrative. It is not a real tender or company. */

export const demoCompany: CompanyProfile = {
  id: "co-demo",
  legalName: "Kaveri Civil Works (Illustrative)",
  businessType: "Partnership firm",
  identifiers: "Udyam registration on file",
  address: "Mysuru, Karnataka",
  turnover: [
    { id: "to-1", financialYear: "FY 2023–24", amountInr: 18500000, state: "reviewed" },
    { id: "to-2", financialYear: "FY 2024–25", amountInr: 22100000, state: "uploaded_unreviewed" },
  ],
  projects: [
    {
      id: "pr-1",
      name: "Ward drainage rehabilitation, Phase II",
      client: "City Municipal Council",
      valueInr: 9400000,
      completed: "2025-03-31",
      state: "reviewed",
    },
  ],
  registrations: [
    { id: "rg-1", name: "GST registration", authority: "GSTN", validUntil: null, state: "reviewed" },
    {
      id: "rg-2",
      name: "Class II contractor registration",
      authority: "State PWD",
      validUntil: "2026-01-31",
      state: "expired",
    },
  ],
  updatedAt: "2026-10-10T09:00:00.000Z",
};

export function snapshotEvidence(c: CompanyProfile): EvidenceRecord[] {
  return [
    ...c.turnover.map((t) => ({
      id: t.id,
      kind: "turnover" as const,
      label: `Turnover ${t.financialYear}`,
      detail: `${formatInr(t.amountInr)} · ${stateLabel(t.state)}`,
    })),
    ...c.projects.map((p) => ({
      id: p.id,
      kind: "project" as const,
      label: p.name,
      detail: `${p.client} · ${formatInr(p.valueInr)} · completed ${p.completed}`,
    })),
    ...c.registrations.map((r) => ({
      id: r.id,
      kind: "registration" as const,
      label: r.name,
      detail: `${r.authority}${r.validUntil ? ` · valid until ${r.validUntil}` : ""} · ${stateLabel(r.state)}`,
    })),
  ];
}

export function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function stateLabel(s: string) {
  return (
    {
      not_provided: "Not provided",
      uploaded_unreviewed: "Uploaded, not reviewed",
      reviewed: "Reviewed for profile",
      expired: "Expired / requires review",
    } as Record<string, string>
  )[s] ?? s;
}

export function buildDemoAssessment(
  id: string,
  overrides: Partial<Pick<Assessment, "title" | "reference" | "authority" | "procurementSource" | "deadline">> = {},
  company: CompanyProfile = demoCompany,
): Assessment {
  const now = new Date().toISOString();
  const docId = `${id}-doc`;
  return {
    id,
    demo: true,
    title: overrides.title || "Storm-water drain desilting and repair, Zone 4",
    reference: overrides.reference || "TENDER/2026/014",
    authority: overrides.authority || "Illustrative Municipal Corporation",
    procurementSource: overrides.procurementSource || "State e-procurement (illustrative)",
    deadline: overrides.deadline ?? "2026-11-12",
    bidSubmissionDeadline: overrides.deadline ?? "2026-11-12",
    documentType: "tender_notice",
    emdAmount: "₹1,20,000",
    companyId: company.id,
    evidenceSnapshot: snapshotEvidence(company),
    documents: [
      {
        id: docId,
        filename: "illustrative-tender-2026-014.pdf",
        kind: "tender",
        sizeBytes: null,
        status: "ready",
        sourceType: "illustrative",
        note: "Synthetic sample document. No real PDF was analysed.",
      },
      {
        id: `${id}-ev1`,
        filename: "Financial statement FY 2024–25",
        kind: "evidence",
        sizeBytes: null,
        status: "mapping_incomplete",
        sourceType: "illustrative",
        note: "Uploaded to the profile, not yet reviewed.",
      },
    ],
    requirements: [
      {
        id: `${id}-r1`,
        title: "Minimum average annual turnover",
        category: "financial",
        mandatory: true,
        normalizedCondition: "Average annual turnover of the last two financial years ≥ ₹2.0 crore.",
        source: {
          documentId: docId,
          pageNumber: 4,
          clauseNumber: "3.1",
          excerpt:
            "The bidder shall have a minimum average annual turnover of Rs. 2.00 crore during the last two financial years.",
        },
        status: "UNKNOWN",
        matchedEvidenceIds: ["to-1", "to-2"],
        rationale:
          "FY 2023–24 is reviewed (₹1.85 cr). FY 2024–25 (₹2.21 cr) is uploaded but not reviewed. The average would be ₹2.03 cr only if the unreviewed statement is accepted.",
        requiresHumanReview: true,
        review: "pending",
      },
      {
        id: `${id}-r2`,
        title: "Similar completed work",
        category: "experience",
        mandatory: true,
        normalizedCondition: "One similar work of value ≥ ₹80 lakh completed in the last five years.",
        source: {
          documentId: docId,
          pageNumber: 5,
          clauseNumber: "3.3",
          excerpt:
            "Completed at least one similar work costing not less than Rs. 80.00 lakh during the last five years.",
        },
        status: "MET",
        matchedEvidenceIds: ["pr-1"],
        rationale: "Ward drainage rehabilitation (₹94 lakh, completed March 2025) matches value and recency.",
        requiresHumanReview: false,
        review: "pending",
      },
      {
        id: `${id}-r3`,
        title: "Valid contractor registration",
        category: "registration",
        mandatory: true,
        normalizedCondition: "Valid Class II or higher contractor registration on the bid due date.",
        source: {
          documentId: docId,
          pageNumber: 4,
          clauseNumber: "3.2",
          excerpt: "The bidder must hold a valid Class-II or above registration with the State PWD.",
        },
        status: "UNMET",
        matchedEvidenceIds: ["rg-2"],
        rationale: "The Class II registration on file expired on 31 January 2026. No renewal is recorded.",
        requiresHumanReview: false,
        review: "pending",
      },
      {
        id: `${id}-r4`,
        title: "Earnest money deposit",
        category: "emd",
        mandatory: true,
        normalizedCondition: "EMD of ₹1,20,000 via bank guarantee or online payment.",
        source: {
          documentId: docId,
          pageNumber: 2,
          clauseNumber: "1.6",
          excerpt: "EMD: Rs. 1,20,000/- (Rupees One Lakh Twenty Thousand only). Exemption as per applicable policy.",
        },
        status: "UNKNOWN",
        matchedEvidenceIds: [],
        rationale:
          "The clause references an exemption 'as per applicable policy' without naming it. Whether the firm qualifies cannot be determined from the document.",
        requiresHumanReview: true,
        review: "pending",
      },
      {
        id: `${id}-r5`,
        title: "GST registration",
        category: "registration",
        mandatory: true,
        normalizedCondition: "Valid GST registration.",
        source: null,
        status: "MET",
        matchedEvidenceIds: ["rg-1"],
        rationale: "GST registration is recorded on the company profile. The source clause was not located.",
        requiresHumanReview: false,
        review: "pending",
      },
      {
        id: `${id}-r6`,
        title: "Site visit certificate",
        category: "technical",
        mandatory: "unknown",
        normalizedCondition: "Bidders are advised to visit the site before submission.",
        source: {
          documentId: docId,
          pageNumber: 7,
          clauseNumber: "5.4",
          excerpt: "Bidders are advised to inspect the site and may obtain a site visit certificate.",
        },
        status: "UNKNOWN",
        matchedEvidenceIds: [],
        rationale: "Wording is advisory ('advised', 'may'). Not treated as mandatory without support.",
        requiresHumanReview: false,
        review: "pending",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
