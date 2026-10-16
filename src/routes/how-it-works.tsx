import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/layout/Chrome";
import { ActionLink, Eyebrow, Reveal } from "@/components/ui-tt/primitives";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — TenderTrap" },
      { name: "description", content: "From tender PDF to an explainable bid decision in four steps." },
      { property: "og:title", content: "How TenderTrap works" },
      { property: "og:description", content: "Extract requirements, match evidence, apply deterministic rules, decide." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HowItWorks,
});

const stages = [
  ["Upload the tender", "A single tender PDF. Pages and clause numbers are preserved so every finding can point back to its source."],
  ["Extract requirements", "Clauses are turned into structured requirements: eligibility, turnover, experience, registrations, EMD, deadlines. Ambiguous wording is flagged, not forced into a category."],
  ["Match your evidence", "Each requirement is compared with your company profile — turnover by year, completed projects, registrations. An extracted clause is never treated as proof."],
  ["Apply the rules", "Deterministic checks decide status. A model never decides eligibility on its own. Missing proof stays UNKNOWN; only reliable evidence produces UNMET."],
  ["Review and decide", "Confirm, reject, or flag each finding. Human decisions are kept separate from automated ones. The recommendation lists its reasons."],
];

function HowItWorks() {
  return (
    <div>
      <SiteHeader />
      <main className="shell py-16 md:py-28">
        <Eyebrow>How it works</Eyebrow>
        <h1 className="display-lg mt-6 max-w-3xl">Read the requirement. Check the evidence. Then decide.</h1>
        <ol className="mt-20 border-t border-border">
          {stages.map(([t, d], i) => (
            <Reveal as="li" key={t} className="grid gap-4 border-b border-border py-10 md:grid-cols-[120px_1fr_1.4fr] md:gap-10">
              <span className="meta text-primary">Stage {String(i + 1).padStart(2, "0")}</span>
              <h2 className="text-2xl font-semibold">{t}</h2>
              <p className="max-w-xl leading-relaxed text-muted-foreground">{d}</p>
            </Reveal>
          ))}
        </ol>
        <div className="mt-16"><ActionLink to="/tenders/new">Assess a tender ↗</ActionLink></div>
      </main>
      <SiteFooter />
    </div>
  );
}
