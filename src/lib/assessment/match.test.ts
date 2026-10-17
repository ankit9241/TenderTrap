import { describe, expect, it } from "vitest";
import type { CompanyProfile, TenderRequirement } from "@/types/tender";
import { snapshotEvidence } from "@/data/demo";
import { decide } from "./decide";
import { matchRequirements, parseInrAmount } from "./match";

const baseCompany: CompanyProfile = {
  id: "co-test",
  legalName: "Test Infrastructure Ltd",
  businessType: "Private Limited",
  identifiers: "GSTIN: 29AABCU9603R1ZM, Udyam: UDYAM-KR-12-0012345",
  address: "Bengaluru, Karnataka",
  turnover: [
    { id: "to-1", financialYear: "FY 2023–24", amountInr: 22000000, state: "reviewed" },
    { id: "to-2", financialYear: "FY 2024–25", amountInr: 24000000, state: "reviewed" },
  ],
  projects: [
    {
      id: "pr-1",
      name: "Water pipeline installation",
      client: "Water Supply Board",
      valueInr: 12000000,
      completed: "2025-06-15",
      state: "reviewed",
    },
  ],
  registrations: [
    { id: "rg-gst", name: "GST registration", authority: "GSTN", validUntil: null, state: "reviewed" },
    { id: "rg-pwd", name: "Class II PWD Contractor", authority: "State PWD", validUntil: "2028-12-31", state: "reviewed" },
  ],
  updatedAt: "2026-10-17T12:00:00.000Z",
};

const makeReq = (overrides: Partial<TenderRequirement>): TenderRequirement => ({
  id: "req-1",
  title: "Test Requirement",
  category: "eligibility",
  mandatory: true,
  normalizedCondition: "Test condition",
  source: {
    documentId: "tender.pdf",
    pageNumber: 3,
    clauseNumber: "2.1",
    excerpt: "Verbatim clause text from page 3",
  },
  status: "UNKNOWN",
  matchedEvidenceIds: [],
  rationale: "Extracted clause from tender notice",
  requiresHumanReview: false,
  review: "pending",
  ...overrides,
});

describe("Deterministic Requirement Matching (matchRequirements)", () => {
  describe("parseInrAmount", () => {
    it("parses crore amounts reliably", () => {
      expect(parseInrAmount("₹2.0 crore")).toBe(20000000);
      expect(parseInrAmount("Rs. 2.50 Crores")).toBe(25000000);
      expect(parseInrAmount("1 cr")).toBe(10000000);
    });

    it("parses lakh amounts reliably", () => {
      expect(parseInrAmount("Rs. 80.00 lakh")).toBe(8000000);
      expect(parseInrAmount("₹ 80 Lakhs")).toBe(8000000);
      expect(parseInrAmount("50 lacs")).toBe(5000000);
    });

    it("parses explicit numbers with commas", () => {
      expect(parseInrAmount("Rs. 15,00,000")).toBe(1500000);
      expect(parseInrAmount("₹50000")).toBe(50000);
    });

    it("returns null for non-monetary or ambiguous text", () => {
      expect(parseInrAmount("Satisfactory financial performance")).toBeNull();
      expect(parseInrAmount("")).toBeNull();
    });
  });

  describe("Registration Matching", () => {
    it("marks reviewed valid registration as MET with matched evidence ID", () => {
      const req = makeReq({
        title: "GST registration",
        category: "registration",
        normalizedCondition: "Valid GST registration certificate.",
      });

      const [matched] = matchRequirements([req], baseCompany);
      expect(matched.status).toBe("MET");
      expect(matched.matchedEvidenceIds).toContain("rg-gst");
      expect(matched.rationale).toContain("GST registration");
    });

    it("marks expired registration as UNMET with explanation", () => {
      const companyWithExpired: CompanyProfile = {
        ...baseCompany,
        registrations: [
          {
            id: "rg-expired",
            name: "Class II PWD Contractor",
            authority: "State PWD",
            validUntil: "2025-01-01",
            state: "expired",
          },
        ],
      };

      const req = makeReq({
        title: "Contractor registration",
        category: "registration",
        normalizedCondition: "Valid Class II PWD contractor registration.",
      });

      const [matched] = matchRequirements([req], companyWithExpired, { tenderDeadline: "2026-11-01" });
      expect(matched.status).toBe("UNMET");
      expect(matched.matchedEvidenceIds).toContain("rg-expired");
      expect(matched.rationale).toContain("expired");
    });

    it("marks unreviewed registration as UNKNOWN with requiresHumanReview: true", () => {
      const companyWithUnreviewed: CompanyProfile = {
        ...baseCompany,
        registrations: [
          {
            id: "rg-unreviewed",
            name: "Class II PWD Contractor",
            authority: "State PWD",
            validUntil: "2028-12-31",
            state: "uploaded_unreviewed",
          },
        ],
      };

      const req = makeReq({
        title: "Contractor registration",
        category: "registration",
        normalizedCondition: "Valid Class II PWD contractor registration.",
      });

      const [matched] = matchRequirements([req], companyWithUnreviewed);
      expect(matched.status).toBe("UNKNOWN");
      expect(matched.requiresHumanReview).toBe(true);
      expect(matched.matchedEvidenceIds).toContain("rg-unreviewed");
      expect(matched.rationale).toContain("unreviewed");
    });

    it("marks missing registration as UNKNOWN (evidence gap, not false failure)", () => {
      const req = makeReq({
        title: "EPF registration",
        category: "registration",
        normalizedCondition: "Valid Employees Provident Fund registration.",
      });

      const [matched] = matchRequirements([req], baseCompany);
      expect(matched.status).toBe("UNKNOWN");
      expect(matched.matchedEvidenceIds).toHaveLength(0);
      expect(matched.rationale).toContain("Evidence gap");
    });
  });

  describe("Financial Turnover Matching", () => {
    it("marks reviewed turnover meeting average threshold as MET", () => {
      const req = makeReq({
        title: "Average annual turnover",
        category: "financial",
        normalizedCondition: "Average annual turnover of the last two financial years ≥ ₹2.0 crore.",
      });

      const [matched] = matchRequirements([req], baseCompany);
      expect(matched.status).toBe("MET");
      expect(matched.matchedEvidenceIds).toEqual(["to-2", "to-1"]);
      expect(matched.rationale).toContain("meets or exceeds required");
    });

    it("marks turnover as UNKNOWN with review flag when meeting threshold depends on unreviewed statements", () => {
      const companyMixed: CompanyProfile = {
        ...baseCompany,
        turnover: [
          { id: "to-1", financialYear: "FY 2023–24", amountInr: 18500000, state: "reviewed" },
          { id: "to-2", financialYear: "FY 2024–25", amountInr: 22100000, state: "uploaded_unreviewed" },
        ],
      };

      const req = makeReq({
        title: "Average annual turnover",
        category: "financial",
        normalizedCondition: "Average annual turnover of the last two financial years ≥ ₹2.0 crore.",
      });

      const [matched] = matchRequirements([req], companyMixed);
      expect(matched.status).toBe("UNKNOWN");
      expect(matched.requiresHumanReview).toBe(true);
      expect(matched.matchedEvidenceIds).toEqual(["to-2", "to-1"]);
      expect(matched.rationale).toContain("unreviewed financial statements");
    });

    it("marks turnover below threshold as UNMET when all statements are reviewed", () => {
      const companyLowTurnover: CompanyProfile = {
        ...baseCompany,
        turnover: [
          { id: "to-1", financialYear: "FY 2023–24", amountInr: 8000000, state: "reviewed" },
          { id: "to-2", financialYear: "FY 2024–25", amountInr: 9000000, state: "reviewed" },
        ],
      };

      const req = makeReq({
        title: "Average annual turnover",
        category: "financial",
        normalizedCondition: "Average annual turnover of the last two financial years ≥ ₹2.0 crore.",
      });

      const [matched] = matchRequirements([req], companyLowTurnover);
      expect(matched.status).toBe("UNMET");
      expect(matched.rationale).toContain("falls short of the required threshold");
    });

    it("marks ambiguous financial condition as UNKNOWN with review flag", () => {
      const req = makeReq({
        title: "Financial soundness",
        category: "financial",
        normalizedCondition: "Bidder must demonstrate adequate liquid assets and credit facilities.",
      });

      const [matched] = matchRequirements([req], baseCompany);
      expect(matched.status).toBe("UNKNOWN");
      expect(matched.requiresHumanReview).toBe(true);
      expect(matched.rationale).toContain("Ambiguity");
    });
  });

  describe("Experience & Similar Works Matching", () => {
    it("marks reviewed project meeting value and recency as MET", () => {
      const req = makeReq({
        title: "Similar completed work",
        category: "experience",
        normalizedCondition: "Completed at least one similar work costing not less than Rs. 80.00 lakh during the last five years.",
      });

      const [matched] = matchRequirements([req], baseCompany, { tenderDeadline: "2026-10-01" });
      expect(matched.status).toBe("MET");
      expect(matched.matchedEvidenceIds).toContain("pr-1");
      expect(matched.rationale).toContain("Water pipeline installation");
    });

    it("marks project failing value as UNMET when all projects are reviewed", () => {
      const companySmallProjects: CompanyProfile = {
        ...baseCompany,
        projects: [
          {
            id: "pr-small",
            name: "Minor culvert repair",
            client: "Town Panchayat",
            valueInr: 2500000,
            completed: "2025-01-10",
            state: "reviewed",
          },
        ],
      };

      const req = makeReq({
        title: "Major work experience",
        category: "experience",
        normalizedCondition: "Completed one similar work of value ≥ ₹1.0 crore.",
      });

      const [matched] = matchRequirements([req], companySmallProjects);
      expect(matched.status).toBe("UNMET");
      expect(matched.rationale).toContain("No completed project meets the minimum required value");
    });

    it("flags qualitative experience conditions without numeric threshold for human review", () => {
      const req = makeReq({
        title: "Civil engineering experience",
        category: "experience",
        normalizedCondition: "Demonstrated track record in specialized trenchless pipeline rehabilitation.",
      });

      const [matched] = matchRequirements([req], baseCompany);
      expect(matched.status).toBe("UNKNOWN");
      expect(matched.requiresHumanReview).toBe(true);
      expect(matched.rationale).toContain("Qualitative similarity");
    });
  });

  describe("Preservation of Invariants", () => {
    it("ensures matchedEvidenceIds strictly resolve to actual snapshot records", () => {
      const reqs: TenderRequirement[] = [
        makeReq({ id: "r-reg", title: "GST registration", category: "registration", normalizedCondition: "Valid GST" }),
        makeReq({ id: "r-fin", title: "Turnover", category: "financial", normalizedCondition: "Annual turnover ≥ ₹1.0 crore" }),
        makeReq({ id: "r-exp", title: "Project", category: "experience", normalizedCondition: "Similar work ≥ ₹80 lakh" }),
      ];

      const matched = matchRequirements(reqs, baseCompany);
      const snapshot = snapshotEvidence(baseCompany);
      const snapshotIds = new Set(snapshot.map((s) => s.id));

      for (const r of matched) {
        for (const evId of r.matchedEvidenceIds) {
          expect(snapshotIds.has(evId)).toBe(true);
        }
      }
    });

    it("preserves source citations and never clears existing requiresHumanReview flags", () => {
      const reqWithOcrFlag = makeReq({
        title: "GST registration",
        category: "registration",
        normalizedCondition: "Valid GST registration certificate.",
        source: {
          documentId: "scanned_tender.pdf",
          pageNumber: 14,
          clauseNumber: "4.2(a)",
          excerpt: "GST registration required.",
        },
        requiresHumanReview: true, // e.g. from low OCR confidence or ambiguous citation repair
        rationale: "[Requires verification: Source page 14 was extracted via OCR with low confidence (30% confidence).]",
      });

      const [matched] = matchRequirements([reqWithOcrFlag], baseCompany);

      // Source citation must be preserved verbatim
      expect(matched.source).toEqual({
        documentId: "scanned_tender.pdf",
        pageNumber: 14,
        clauseNumber: "4.2(a)",
        excerpt: "GST registration required.",
      });

      // Human review flag must NEVER be cleared
      expect(matched.requiresHumanReview).toBe(true);

      // Uncertainty in underlying clause prevents marking it as MET
      expect(matched.status).toBe("UNKNOWN");
      expect(matched.rationale).toContain("Underlying tender clause citation or OCR has uncertainty");
    });

    it("integrates truthfully with decide() rules: SKIP on mandatory UNMET, INVESTIGATE on UNKNOWN, PROCEED on MET", () => {
      // 1. Mandatory UNMET -> SKIP
      const expiredRegReq = makeReq({
        title: "Contractor license",
        category: "registration",
        mandatory: true,
        normalizedCondition: "Valid Class II registration",
      });
      const companyExpired: CompanyProfile = {
        ...baseCompany,
        registrations: [{ id: "r-exp", name: "Class II registration", authority: "PWD", validUntil: "2024-01-01", state: "expired" }],
      };
      const [matchedUnmet] = matchRequirements([expiredRegReq], companyExpired, { tenderDeadline: "2026-10-01" });
      expect(matchedUnmet.status).toBe("UNMET");
      expect(decide([matchedUnmet]).recommendation).toBe("SKIP");

      // 2. Evidence gap (UNKNOWN) -> INVESTIGATE
      const missingReq = makeReq({
        title: "Electrical license",
        category: "registration",
        mandatory: true,
        normalizedCondition: "High Voltage Electrical Contractor License",
      });
      const [matchedUnknown] = matchRequirements([missingReq], baseCompany);
      expect(matchedUnknown.status).toBe("UNKNOWN");
      expect(decide([matchedUnknown]).recommendation).toBe("INVESTIGATE");

      // 3. Fully met and reviewed -> PROCEED
      const metReq1 = makeReq({ id: "m1", title: "GST", category: "registration", normalizedCondition: "Valid GST" });
      const metReq2 = makeReq({ id: "m2", title: "Turnover", category: "financial", normalizedCondition: "Turnover >= 1 cr" });
      const matchedAllMet = matchRequirements([metReq1, metReq2], baseCompany);
      expect(matchedAllMet.every((r) => r.status === "MET" && !r.requiresHumanReview)).toBe(true);
      expect(decide(matchedAllMet).recommendation).toBe("PROCEED");
    });
  });
});
