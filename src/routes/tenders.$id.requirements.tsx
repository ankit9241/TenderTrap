import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { effectiveStatus, needsReview } from "@/lib/assessment/decide";
import { actions } from "@/lib/store";
import { Button, StatusTag, formatStamp } from "@/components/ui-tt/primitives";
import { useAssessment } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Assessment, ReviewState, TenderRequirement } from "@/types/tender";

type Filter = "all" | "MET" | "UNMET" | "UNKNOWN" | "mandatory" | "review";

export const Route = createFileRoute("/tenders/$id/requirements")({
  validateSearch: (s: Record<string, unknown>): { r?: string } => (typeof s["r"] === "string" ? { r: s["r"] } : {}),
  component: Register,
});

const filterDefs: { key: Filter; label: string; test: (r: TenderRequirement) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "MET", label: "Met", test: (r) => effectiveStatus(r) === "MET" },
  { key: "UNMET", label: "Unmet", test: (r) => effectiveStatus(r) === "UNMET" },
  { key: "UNKNOWN", label: "Unknown", test: (r) => effectiveStatus(r) === "UNKNOWN" },
  { key: "mandatory", label: "Mandatory", test: (r) => r.mandatory === true },
  { key: "review", label: "Needs review", test: needsReview },
];

function Register() {
  const { id } = Route.useParams();
  const { r: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const a = useAssessment(id);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    if (!a) return [];
    const f = filterDefs.find((d) => d.key === filter)!;
    const needle = q.trim().toLowerCase();
    return a.requirements.filter(
      (r) =>
        f.test(r) &&
        (!needle ||
          [r.title, r.normalizedCondition, r.source?.excerpt, r.source?.clauseNumber].some((s) => s?.toLowerCase().includes(needle))),
    );
  }, [a, filter, q]);

  if (!a) return null;
  const selected = a.requirements.find((r) => r.id === selectedId) ?? (selectedId ? undefined : list[0]);
  const select = (rid?: string) => navigate({ search: rid ? { r: rid } : {}, replace: true });

  return (
    <div className="shell py-10 md:py-14">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter requirements">
          {filterDefs.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "min-h-9 border px-3 text-[13px] transition-colors",
                filter === f.key ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground",
              )}
            >
              {f.label} <span className="meta ml-1 opacity-70">{a.requirements.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto w-full sm:w-72">
          <span className="sr-only">Search requirements</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, clause or reference"
            className="h-10 w-full border-b border-input bg-transparent text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      <div className="mt-8 grid gap-0 lg:grid-cols-[1fr_1.15fr] lg:gap-12">
        <ul className={cn("border-t border-border", selected && "hidden lg:block")} aria-label="Requirement register">
          {list.length === 0 && <li className="py-10 text-sm text-muted-foreground">No requirements match this view.</li>}
          {list.map((r) => {
            const on = selected?.id === r.id;
            return (
              <li key={r.id}>
                <button
                  onClick={() => select(r.id)}
                  aria-current={on}
                  className={cn("flex w-full items-start gap-4 border-b border-border py-4 text-left transition-colors", on ? "bg-paper" : "hover:bg-paper/60")}
                >
                  <span className={cn("mt-1 h-10 w-0.5 shrink-0", on ? "bg-primary" : "bg-transparent")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{r.title}</span>
                    <span className="meta mt-1.5 block text-muted-foreground">
                      {r.category} · {r.mandatory === true ? "mandatory" : r.mandatory === false ? "optional" : "mandatory unclear"} ·{" "}
                      {r.source ? `p. ${r.source.pageNumber ?? "?"}${r.source.clauseNumber ? ` cl. ${r.source.clauseNumber}` : ""}` : "source unverified"}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5">
                    <StatusTag status={effectiveStatus(r)} />
                    {needsReview(r) && <span className="meta text-primary">Review</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected ? (
          <Detail key={selected.id} a={a} r={selected} onBack={() => select(undefined)} />
        ) : (
          <p className="hidden py-10 text-sm text-muted-foreground lg:block">Select a requirement to inspect its evidence.</p>
        )}
      </div>
    </div>
  );
}

const reviewLabels: Record<ReviewState, string> = {
  pending: "Automated finding · not reviewed",
  confirmed: "Confirmed by you",
  rejected: "Rejected by you · treated as unknown",
  flagged: "Flagged for further review",
};

function Detail({ a, r, onBack }: { a: Assessment; r: TenderRequirement; onBack: () => void }) {
  const doc = a.documents.find((d) => d.id === r.source?.documentId);
  const evidence = a.evidenceSnapshot.filter((e) => r.matchedEvidenceIds.includes(e.id));
  const setReview = (s: ReviewState) => actions.review(a.id, r.id, s);

  return (
    <article className="anim-rise border-t border-border lg:sticky lg:top-6 lg:self-start" aria-label={`Evidence for ${r.title}`}>
      <button onClick={onBack} className="meta mt-4 text-muted-foreground hover:text-foreground lg:hidden">← All requirements</button>
      <div className="flex items-center justify-between gap-4 pt-6">
        <StatusTag status={effectiveStatus(r)} long />
        <span className="meta text-muted-foreground">{r.id.split("-").pop()}</span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold">{r.title}</h2>
      <Section label="Requirement"><p>{r.normalizedCondition}</p></Section>

      <Section label="Original clause">
        {r.source ? (
          <blockquote className="border-l-2 border-primary pl-5 font-display text-lg leading-snug">
            <span className="clause-mark">“{r.source.excerpt}”</span>
          </blockquote>
        ) : (
          <p className="border-l-2 border-unknown-ink bg-unknown px-4 py-3 text-sm">Source clause not located. This finding needs source verification.</p>
        )}
      </Section>

      <Section label="Source reference">
        {r.source ? (
          <p className="meta">
            {doc?.filename ?? "Unknown document"} · page {r.source.pageNumber ?? "not identified"}
            {r.source.clauseNumber && ` · clause ${r.source.clauseNumber}`}
          </p>
        ) : (
          <p className="meta text-unknown-ink">Source not confirmed</p>
        )}
      </Section>

      <Section label="Company evidence">
        {evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">No company record matched. Add evidence to your profile and re-run the assessment.</p>
        ) : (
          <ul className="space-y-2">
            {evidence.map((e) => (
              <li key={e.id} className="flex flex-col border-b border-border pb-2 text-sm">
                <span>{e.label}</span>
                <span className="meta text-muted-foreground">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="meta mt-2 text-muted-foreground">Snapshot taken when this assessment was created.</p>
      </Section>

      <Section label="Assessment rationale"><p className="leading-relaxed">{r.rationale || "No rationale was provided."}</p></Section>

      <Section label="Your review">
        <p className="meta text-muted-foreground">{reviewLabels[r.review]}{r.reviewedAt ? ` · ${formatStamp(r.reviewedAt)}` : ""}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant={r.review === "confirmed" ? "ink" : "quiet"} onClick={() => setReview("confirmed")}>Confirm finding</Button>
          <Button size="sm" variant={r.review === "rejected" ? "ink" : "quiet"} onClick={() => setReview("rejected")}>Reject</Button>
          <Button size="sm" variant={r.review === "flagged" ? "ink" : "quiet"} onClick={() => setReview("flagged")}>Flag for review</Button>
          {r.review !== "pending" && <Button size="sm" variant="ghost" onClick={() => setReview("pending")}>Undo</Button>}
        </div>
      </Section>
    </article>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="meta mb-3 font-sans text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}
