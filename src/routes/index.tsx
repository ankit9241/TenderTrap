import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/layout/Chrome";
import { HeroDocument } from "@/components/home/HeroDocument";
import { AssessmentPreview } from "@/components/home/AssessmentPreview";
import { ActionLink, Eyebrow, Reveal } from "@/components/ui-tt/primitives";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TenderTrap — A tender is a document. A bid is a decision." },
      {
        name: "description",
        content: "Evidence-first bid/no-bid intelligence for contractors in India. Know what you qualify for before you bid.",
      },
      { property: "og:title", content: "TenderTrap — Know the risk before you bid" },
      { property: "og:description", content: "Read the requirement. Check the evidence. Understand the risk. Then decide." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const steps = [
  { n: "01", t: "Extract", d: "Identify relevant clauses, financial thresholds, deadlines, experience requirements, and certificates." },
  { n: "02", t: "Match", d: "Compare each requirement with the contractor's actual profile and supporting evidence." },
  { n: "03", t: "Decide", d: "Understand confirmed blockers, missing proof, unresolved questions, and the next action." },
];

function Home() {
  return (
    <div className="overflow-x-clip">
      <SiteHeader animateLogo />
      <main>
        {/* Hero */}
        <section className="shell grid min-h-[calc(100svh-5rem)] items-center gap-16 pb-24 pt-10 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:pt-6">
          <div>
            <Eyebrow className="anim-fade">
              Procurement intelligence / India
            </Eyebrow>
            <h1 className="display-xl mt-8">
              <span className="line-mask"><span style={{ ["--d" as string]: "250ms" }}>A tender is</span></span>
              <span className="line-mask"><span style={{ ["--d" as string]: "350ms" }}>a document.</span></span>
              <span className="line-mask"><span style={{ ["--d" as string]: "500ms" }}>A bid is a</span></span>
              <span className="line-mask"><span className="text-primary" style={{ ["--d" as string]: "650ms" }}>decision.</span></span>
            </h1>
            <p className="anim-rise mt-8 max-w-md text-lg leading-relaxed text-muted-foreground" style={{ ["--d" as string]: "800ms" }}>
              Know what you qualify for, what is missing, and what could cost you a bid.
            </p>
            <div className="anim-rise mt-10 flex flex-wrap items-center gap-x-8 gap-y-4" style={{ ["--d" as string]: "950ms" }}>
              <ActionLink to="/tenders/new">Assess a tender ↗</ActionLink>
              <ActionLink to="/how-it-works" variant="ghost">See how it works</ActionLink>
            </div>
            <p className="meta anim-fade mt-16 flex items-center gap-3 text-muted-foreground" style={{ ["--d" as string]: "1300ms" }}>
              <span className="h-px w-10 bg-primary" /> Evidence first. Assumptions last.
            </p>
          </div>
          <div className="lg:pl-10">
            <HeroDocument />
          </div>
        </section>

        {/* The difference */}
        <section className="bg-ink text-ink-foreground">
          <div className="shell py-24 md:py-36">
            <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
              <Reveal>
                <h2 className="display-lg">A summary isn't<br />a decision.</h2>
              </Reveal>
              <Reveal delay={120}>
                <p className="max-w-md text-lg leading-relaxed text-ink-muted">
                  A tender tells you what is required. TenderTrap helps you understand what those requirements mean for your business.
                </p>
              </Reveal>
            </div>
            <ol className="mt-20 grid border-t border-ink-soft md:grid-cols-3">
              {steps.map((s, i) => (
                <Reveal as="li" key={s.n} delay={i * 120} className="border-b border-ink-soft py-10 md:border-b-0 md:border-r md:px-8 md:first:pl-0 md:last:border-r-0">
                  <p className="font-display text-7xl font-light tracking-[-0.05em] text-wine md:text-8xl">{s.n}</p>
                  <h3 className="mt-6 text-2xl font-semibold">{s.t}</h3>
                  <p className="mt-3 max-w-xs leading-relaxed text-ink-muted">{s.d}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Preview */}
        <section className="shell py-24 md:py-36">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
            <Reveal>
              <Eyebrow>An assessment, up close</Eyebrow>
              <h2 className="display-lg mt-5">Every finding<br />shows its source.</h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="max-w-md text-muted-foreground lg:justify-self-end">
                Select a requirement to see the original clause and why it received its status. MET, UNKNOWN and UNMET never blur together.
              </p>
            </Reveal>
          </div>
          <Reveal className="mt-14">
            <AssessmentPreview />
          </Reveal>
        </section>

        {/* Closing */}
        <section className="border-t border-border">
          <div className="shell grid gap-12 py-24 md:py-40 lg:grid-cols-[1fr_auto] lg:items-end">
            <Reveal>
              <h2 className="display-xl max-w-4xl">Before you commit a week, know the risks.</h2>
              <p className="mt-8 max-w-md text-lg text-muted-foreground">Understand the requirements before the preparation begins.</p>
            </Reveal>
            <Reveal delay={150} className="flex flex-col items-start gap-6">
              <p className="meta text-muted-foreground">Clause 3.2 · Status / pending your evidence</p>
              <ActionLink to="/tenders/new">Start an assessment ↗</ActionLink>
              <Link to="/evidence-standard" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Read the evidence standard
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
