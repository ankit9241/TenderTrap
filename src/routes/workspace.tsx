import { createFileRoute, Link } from "@tanstack/react-router";
import { AppPage } from "@/components/layout/Chrome";
import { action, ActionLink, Button, DemoBadge, Eyebrow, formatDate, formatStamp } from "@/components/ui-tt/primitives";
import { decide } from "@/lib/assessment/decide";
import { actions, uid, useHydratedStore, useStore } from "@/lib/store";
import { buildDemoAssessment } from "@/data/demo";
import { RecommendationWord } from "@/components/assessment/Recommendation";
import type { Assessment } from "@/types/tender";

export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [
      { title: "Your tender desk — TenderTrap" },
      { name: "description", content: "Review opportunities, resolve missing evidence, and decide where to focus bid effort." },
      { property: "og:title", content: "TenderTrap workspace" },
      { property: "og:description", content: "Your tender desk." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const assessments = useStore((s) => s.assessments);
  const company = useStore((s) => s.company);
  const hydrated = useHydratedStore();
  const [active, ...rest] = assessments;

  const loadDemo = () => actions.addAssessment(buildDemoAssessment(uid("as"), {}, company));

  return (
    <AppPage>
      <div className="shell py-12 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow>Procurement workspace</Eyebrow>
            <h1 className="mt-4 text-4xl font-semibold md:text-[44px]">Your tender desk</h1>
            <p className="mt-3 max-w-lg text-muted-foreground">
              Review opportunities, resolve missing evidence, and decide where to focus your bid effort.
            </p>
          </div>
          <ActionLink to="/tenders/new">Assess a tender</ActionLink>
        </div>

        {!hydrated ? null : !active ? (
          <section className="mt-16 grid gap-10 border-t border-border py-24 md:grid-cols-[1.4fr_1fr] md:items-end">
            <div>
              <h2 className="display-md max-w-xl">Your next decision starts with a document.</h2>
              <p className="mt-4 text-muted-foreground">Upload a tender to begin reviewing its requirements and evidence.</p>
            </div>
            <div className="flex flex-col items-start gap-4">
              <ActionLink to="/tenders/new">Assess a tender</ActionLink>
              <button onClick={loadDemo} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Or open an illustrative demo assessment
              </button>
            </div>
          </section>
        ) : (
          <>
            <ActiveCard a={active} />
            {rest.length > 0 && (
              <section className="mt-16">
                <h2 className="meta text-muted-foreground">Other assessments · {rest.length}</h2>
                <ul className="mt-4 border-t border-border">
                  {rest.map((a) => (
                    <Row key={a.id} a={a} />
                  ))}
                </ul>
              </section>
            )}
            <div className="mt-10">
              <button onClick={loadDemo} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Add another illustrative demo
              </button>
            </div>
          </>
        )}
      </div>
    </AppPage>
  );
}

function ActiveCard({ a }: { a: Assessment }) {
  const d = decide(a.requirements);
  const outstanding = new Set([...d.gaps, ...d.unresolved, ...d.blockers].map((r) => r.id)).size;
  return (
    <section className="anim-rise mt-14 grid border border-border bg-paper lg:grid-cols-[1.5fr_1fr]">
      <div className="p-6 sm:p-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="meta text-muted-foreground">{a.reference}</span>
          {a.demo && <DemoBadge />}
        </div>
        <h2 className="mt-4 text-2xl font-semibold md:text-3xl">{a.title}</h2>
        <dl className="mt-8 grid grid-cols-2 gap-6 text-sm md:grid-cols-3">
          <Meta k="Authority" v={a.authority} />
          <Meta k="Source" v={a.procurementSource} />
          <Meta k="Submission deadline" v={formatDate(a.deadline)} />
        </dl>
      </div>
      <div className="flex flex-col border-t border-border p-6 sm:p-10 lg:border-l lg:border-t-0">
        <p className="meta text-muted-foreground">Current recommendation</p>
        <RecommendationWord rec={d.recommendation} className="mt-2 text-4xl" />
        <p className="mt-4 text-sm text-muted-foreground">{outstanding} outstanding requirement{outstanding === 1 ? "" : "s"}</p>
        <div className="mt-auto flex items-center justify-between gap-4 pt-8">
          <span className="meta text-muted-foreground">Updated {formatStamp(a.updatedAt)}</span>
          <Link to="/tenders/$id" params={{ id: a.id }} className={action({ variant: "ink", size: "sm" })}>Continue review ↗</Link>
        </div>
      </div>
    </section>
  );
}

function Row({ a }: { a: Assessment }) {
  const d = decide(a.requirements);
  return (
    <li className="group flex items-center gap-4 border-b border-border">
      <Link to="/tenders/$id" params={{ id: a.id }} className="grid flex-1 gap-1 py-5 transition-transform duration-300 group-hover:translate-x-1 md:grid-cols-[160px_1fr_140px_140px] md:items-center md:gap-6">
        <span className="meta text-muted-foreground">{a.reference}</span>
        <span className="text-[15px]">{a.title}</span>
        <span className="meta text-muted-foreground">Due {formatDate(a.deadline)}</span>
        <RecommendationWord rec={d.recommendation} className="text-base" />
      </Link>
      <Button variant="ghost" size="sm" onClick={() => actions.removeAssessment(a.id)} aria-label={`Remove ${a.title}`} className="text-muted-foreground">
        Remove
      </Button>
    </li>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="meta text-muted-foreground">{k}</dt>
      <dd className="mt-1">{v}</dd>
    </div>
  );
}
