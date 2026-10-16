import type { TenderRequirement } from "@/types/tender";

/** Centralised API client. The extraction backend is configured with VITE_API_BASE_URL. */
export const API_BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") || null;

export class ApiError extends Error {}

export async function extractTender(file: File): Promise<TenderRequirement[]> {
  if (!API_BASE) throw new ApiError("The extraction service is not connected.");
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_BASE}/api/tenders/extract`, { method: "POST", body });
  if (!res.ok) throw new ApiError(`Extraction failed (${res.status}). Your file was not analysed.`);
  const data: unknown = await res.json();
  return validateRequirements(data);
}

const STATUSES = ["MET", "UNMET", "UNKNOWN"];

export function validateRequirements(data: unknown): TenderRequirement[] {
  const list = (data as { requirements?: unknown })?.requirements;
  if (!Array.isArray(list)) throw new ApiError("The extraction result was not in the expected format.");
  return list.map((r, i) => {
    const o = r as Partial<Record<keyof TenderRequirement, unknown>>;
    if (typeof o.title !== "string" || !STATUSES.includes(o.status as string))
      throw new ApiError(`Requirement ${i + 1} failed validation.`);
    return {
      id: String(o.id ?? `r${i}`),
      title: o.title,
      category: (o.category as TenderRequirement["category"]) ?? "other",
      mandatory: typeof o.mandatory === "boolean" ? o.mandatory : "unknown",
      normalizedCondition: String(o.normalizedCondition ?? ""),
      source: (o.source as TenderRequirement["source"]) ?? null,
      status: o.status as TenderRequirement["status"],
      matchedEvidenceIds: Array.isArray(o.matchedEvidenceIds) ? (o.matchedEvidenceIds as string[]) : [],
      rationale: String(o.rationale ?? ""),
      requiresHumanReview: Boolean(o.requiresHumanReview),
      review: "pending",
    };
  });
}

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export async function validatePdf(file: File): Promise<string | null> {
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_PDF_BYTES) return "This file is larger than 25 MB.";
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return "Only PDF files are supported.";
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== "%PDF-") return "This file doesn't look like a valid PDF. It may be corrupted.";
  } catch {
    return "This file could not be read.";
  }
  return null;
}
