import { useState } from "react";
import { ActionLink, StatusTag } from "@/components/ui-tt/primitives";
import { cn } from "@/lib/utils";
import type { RequirementStatus } from "@/types/tender";

const rows: {
  id: string;
  title: string;
  status: RequirementStatus;
  source: string;
  clause: string;
  why: string;
}[] = [
  {
    id: "a",
    title: "Similar completed work ≥ ₹80 lakh",
    status: "MET",
    source: "p. 05 · cl. 3.3",
    clause: "Completed at least one similar work costing not less than Rs. 80.00 lakh during the last five years.",
    why: "A ₹94 lakh drainage project completed in March 2025 matches both value and recency.",
  },
  {
    id: "b",
    title: "Average annual turnover ≥ ₹2 crore",
    status: "UNKNOWN",
    source: "p. 04 · cl. 3.1",
    clause: "Minimum average annual turnover of Rs. 2.00 crore during the last two financial years.",
    why: "One year's statement is uploaded but unreviewed. Missing proof is a gap, not a failure.",
  },
  {
    id: "c",
    title: "Valid Class II contractor registration",
    status: "UNMET",
    source: "p. 04 · cl. 3.2",
    clause: "The bidder must hold a valid Class-II or above registration with the State PWD.",
    why: "The registration on file expired in January 2026. No renewal is recorded.",
  },
];

export function AssessmentPreview() {
  const [sel, setSel] = useState("b");
  const active = rows.find((r) => r.id === sel)!;
  return (
    <div className="grid border border-border bg-paper lg:grid-cols-[1.1fr_1fr]">
      <div className="border-b border-border p-6 sm:p-10 lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="meta text-muted-foreground">Tender / 2026 / 014 · illustrative</p>
          <p className="meta text-muted-foreground">3 of 6 requirements</p>
        </div>
        <p className="mt-6 text-[15px] text-muted-foreground">Storm-water drain desilting, Zone 4</p>
        <p className="meta mt-8 text-muted-foreground">Current recommendation</p>
        <p className="mt-2 font-display text-5xl font-semibold tracking-[-0.04em] text-unknown-ink sm:text-6xl">
          Investigate
        </p>
        <ul className="mt-10 border-t border-border" role="listbox" aria-label="Example requirements">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                role="option"
                aria-selected={sel === r.id}
                onClick={() => setSel(r.id)}
                className={cn(
                  "group flex w-full items-center justify-between gap-4 border-b border-border py-4 text-left transition-colors",
                  sel === r.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-3">
                  <span className={cn("h-5 w-0.5 transition-colors", sel === r.id ? "bg-primary" : "bg-transparent")} />
                  <span className="text-[15px]">{r.title}</span>
                </span>
                <StatusTag status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div key={active.id} className="anim-rise flex flex-col p-6 sm:p-10">
        <p className="meta text-muted-foreground">Original clause · {active.source}</p>
        <blockquote className="mt-4 border-l-2 border-primary pl-5 font-display text-xl leading-snug tracking-tight sm:text-2xl">
          “{active.clause}”
        </blockquote>
        <p className="meta mt-10 text-muted-foreground">Why this status</p>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed">{active.why}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-10">
          <span className="meta text-muted-foreground">Illustrative example · no real tender analysed</span>
          <ActionLink to="/workspace" variant="ghost">
            Inspect the example ↗
          </ActionLink>
        </div>
      </div>
    </div>
  );
}
