import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/layout/Chrome";
import { Eyebrow, StatusTag } from "@/components/ui-tt/primitives";

export const Route = createFileRoute("/evidence-standard")({
  head: () => ({
    meta: [
      { title: "Evidence standard — TenderTrap" },
      { name: "description", content: "How TenderTrap defines MET, UNMET and UNKNOWN, and what PROCEED, INVESTIGATE and SKIP mean." },
      { property: "og:title", content: "The TenderTrap evidence standard" },
      { property: "og:description", content: "Missing evidence is not a failure. Every finding names its source." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Standard,
});

function Standard() {
  return (
    <div>
      <SiteHeader />
      <main className="shell py-16 md:py-28">
        <Eyebrow>Evidence standard</Eyebrow>
        <h1 className="display-lg mt-6 max-w-3xl">Precise language, or no claim at all.</h1>

        <section className="mt-20 grid gap-12 border-t border-border pt-12 lg:grid-cols-[1fr_2fr]">
          <h2 className="text-2xl font-semibold">Requirement status</h2>
          <dl className="space-y-8">
            <div><dt><StatusTag status="MET" long /></dt><dd className="mt-3 max-w-xl text-muted-foreground">Sufficient supporting evidence has been identified.</dd></div>
            <div><dt><StatusTag status="UNKNOWN" long /></dt><dd className="mt-3 max-w-xl text-muted-foreground">Evidence is missing, incomplete, ambiguous, or not reviewed. Unknown is not a failed requirement.</dd></div>
            <div><dt><StatusTag status="UNMET" long /></dt><dd className="mt-3 max-w-xl text-muted-foreground">Reliable evidence establishes that the requirement is not satisfied.</dd></div>
          </dl>
        </section>

        <section className="mt-20 grid gap-12 border-t border-border pt-12 lg:grid-cols-[1fr_2fr]">
          <h2 className="text-2xl font-semibold">Recommendations</h2>
          <dl className="space-y-8">
            {[
              ["Proceed", "No known blocking issue in the reviewed requirements. Not a guarantee of eligibility or award."],
              ["Investigate", "Material evidence gaps, ambiguity, or unresolved risks remain."],
              ["Skip", "A mandatory condition is established as unmet, or a documented constraint makes the bid impractical."],
            ].map(([t, d]) => (
              <div key={t}><dt className="font-display text-3xl font-semibold tracking-tight">{t}</dt><dd className="mt-2 max-w-xl text-muted-foreground">{d}</dd></div>
            ))}
          </dl>
        </section>

        <section className="mt-20 grid gap-12 border-t border-border pt-12 lg:grid-cols-[1fr_2fr]">
          <h2 className="text-2xl font-semibold">Commitments</h2>
          <ul className="max-w-xl space-y-3 text-muted-foreground">
            <li>— No fabricated quotations, page numbers, or evidence links. Missing sources are labelled.</li>
            <li>— Human overrides are recorded separately from automated findings.</li>
            <li>— No "Verified", "Eligible" or "Compliant" claims without a real validation process.</li>
            <li>— A user-uploaded tender is never presented as an official portal record.</li>
            <li>— No unexplained scores. Every recommendation lists its reasons.</li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
