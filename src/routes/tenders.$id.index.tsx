import { createFileRoute, Link } from "@tanstack/react-router";
import { decide, effectiveStatus } from "@/lib/assessment/decide";
import { Eyebrow, Reveal, StatusTag } from "@/components/ui-tt/primitives";
import { RecommendationWord } from "@/components/assessment/Recommendation";
import { useAssessment } from "@/lib/store";
import type { TenderRequirement } from "@/types/tender";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tenders/$id/")({
  component: Overview,
});

function Overview() {
  const { id } = Route.useParams();
  const a = useAssessment(id);
  if (!a) return null;
  const d = decide(a.requirements);
  const actionsList = [...d.blockers, ...d.unresolved, ...d.gaps].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i).slice(0, 4);

  return (
    <div className="shell py-14 md:py-20">
      <section className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        <div className="anim-rise">
          <Eyebrow>Current recommendation{d.incomplete ? " · assessment incomplete" : ""}</Eyebrow>
          <div className="mt-3 flex items-stretch gap-5">
            <span className={cn("w-1", d.recommendation === "SKIP" ? "bg-unmet-ink" : d.recommendation === "PROCEED" ? "bg-met-ink" : "bg-unknown-ink")} aria-hidden="true" />
            <RecommendationWord rec={d.recommendation} className="text-5xl md:text-7xl" />
          </div>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">{d.summary}</p>
        </div>
        <div className="anim-rise flex flex-wrap gap-x-6 gap-y-3 text-sm lg:justify-end" style={{ ["--d" as string]: "150ms" }}>
          <Link to="/tenders/$id/requirements" params={{ id }} className="underline underline-offset-4 hover:text-primary">View requirements</Link>
          <Link to="/tenders/$id/documents" params={{ id }} className="underline underline-offset-4 hover:text-primary">Inspect documents</Link>
          <Link to="/company" className="underline underline-offset-4 hover:text-primary">Update company evidence</Link>
        </div>
      </section>

      <div className="mt-20 grid border-t border-border md:grid-cols-2">
        <Group title="Confirmed blockers" note="Mandatory requirements established as unmet." items={d.blockers} id={id} />
        <Group title="Evidence gaps" note="Supporting information missing or incomplete." items={d.gaps} id={id} />
        <Group title="Unresolved clauses" note="Ambiguity or findings that need a human decision." items={d.unresolved} id={id} />
        <Group
          title="Commercial and preparation risks"
          note={a.emdAmount ? `EMD stated in the document: ${a.emdAmount}.` : "EMD and deadline conditions from the document."}
          items={d.commercial}
          id={id}
        />
      </div>

      {actionsList.length > 0 && (
        <Reveal as="section" className="mt-20">
          <h2 className="text-2xl font-semibold">Next actions</h2>
          <ol className="mt-6 border-t border-border">
            {actionsList.map((r, i) => (
              <li key={r.id} className="border-b border-border">
                <Link to="/tenders/$id/requirements" params={{ id }} search={{ r: r.id }} className="group flex items-baseline gap-6 py-4">
                  <span className="meta text-primary">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 transition-transform duration-300 group-hover:translate-x-1">
                    {effectiveStatus(r) === "UNMET" ? `Resolve: ${r.title}` : `Review evidence for ${r.title.toLowerCase()}`}
                  </span>
                  <span className="meta text-muted-foreground">Open ↗</span>
                </Link>
              </li>
            ))}
          </ol>
        </Reveal>
      )}
      <p className="meta mt-16 text-muted-foreground">TenderTrap supports decisions. It does not guarantee eligibility, award, or legal compliance.</p>
    </div>
  );
}

function Group({ title, note, items, id }: { title: string; note: string; items: TenderRequirement[]; id: string }) {
  return (
    <Reveal as="section" className="border-b border-border py-8 md:odd:pr-10 md:even:border-l md:even:pl-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="font-display text-3xl font-light">{items.length}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
      {items.length === 0 ? (
        <p className="meta mt-6 text-muted-foreground">None identified</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {items.map((r) => (
            <li key={r.id}>
              <Link to="/tenders/$id/requirements" params={{ id }} search={{ r: r.id }} className="flex items-center justify-between gap-4 text-[15px] hover:text-primary">
                <span>{r.title}</span>
                <StatusTag status={effectiveStatus(r)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Reveal>
  );
}
