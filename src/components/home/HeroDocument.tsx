/** Illustrative annotated tender page for the hero. */
export function HeroDocument() {
  return (
    <figure className="relative" aria-label="Illustrative tender page with one clause selected for review">
      <div
        className="anim-mask relative border border-border bg-paper px-6 pb-10 pt-6 shadow-[0_1px_0_var(--color-border),0_30px_60px_-40px_color-mix(in_oklab,var(--color-foreground)_35%,transparent)] sm:px-10 sm:pt-8"
        style={{ ["--d" as string]: "150ms" }}
      >
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="space-y-1">
            <p className="meta text-muted-foreground">Tender / 2026 / 014</p>
            <p className="meta text-foreground">Eligibility / Clause 03</p>
          </div>
          <p className="meta text-muted-foreground">p. 04 / 22</p>
        </div>

        <p className="mt-6 font-display text-lg font-semibold tracking-tight">3. Qualification of bidders</p>

        <ol className="mt-5 space-y-4 text-[13.5px] leading-relaxed text-muted-foreground">
          <li className="flex gap-4">
            <span className="meta pt-0.5">3.1</span>
            <span>The bidder shall be a registered firm under applicable law in India.</span>
          </li>
          <li className="relative flex gap-4">
            <span className="meta pt-0.5 text-primary">3.2</span>
            <span className="relative text-foreground">
              <span className="clause-mark box-decoration-clone px-0.5" style={{ ["--d" as string]: "1150ms" }}>
                Minimum annual turnover as specified in the tender conditions.
              </span>
              <span
                aria-hidden="true"
                className="scan-beam pointer-events-none absolute -inset-y-1 left-0 w-0.5 bg-primary"
                style={{ ["--d" as string]: "800ms", ["--scan-to" as string]: "min(380px, 70vw)" }}
              />
            </span>
          </li>
          <li className="flex gap-4">
            <span className="meta pt-0.5">3.3</span>
            <span>Completion of at least one similar work during the last five years.</span>
          </li>
          <li className="flex gap-4 opacity-60">
            <span className="meta pt-0.5">3.4</span>
            <span>Earnest money deposit as stated in the notice inviting tender.</span>
          </li>
        </ol>

        <div className="mt-8 space-y-2" aria-hidden="true">
          <div className="h-px w-full bg-border" />
          <div className="h-px w-4/5 bg-border" />
          <div className="h-px w-2/3 bg-border" />
        </div>
        <p className="meta mt-6 text-muted-foreground/80">Illustrative document · not a real tender</p>
      </div>

      {/* Evidence annotation */}
      <div
        className="anim-rise relative mt-4 border-l-2 border-primary bg-ink p-5 text-ink-foreground sm:absolute sm:-bottom-24 sm:-left-16 sm:mt-0 sm:w-[300px] lg:-left-24"
        style={{ ["--d" as string]: "1400ms" }}
      >
        <p className="meta text-ink-muted">Source / page 04 · clause 3.2</p>
        <p className="meta mt-4 text-ink-muted">Supporting evidence</p>
        <p className="mt-1 text-[15px]">Financial statement not provided</p>
        <div className="mt-4 flex items-center justify-between border-t border-ink-soft pt-3">
          <span className="meta">Status / Unknown</span>
          <span className="meta text-wine">Review required</span>
        </div>
      </div>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute hidden"
        style={{ left: 40, bottom: 66 }}
        width="60"
        height="120"
        fill="none"
      >
        <path d="M58 2 H30 V118" stroke="var(--color-primary)" strokeWidth="1" className="draw" style={{ ["--len" as string]: 150, ["--d" as string]: "1300ms" }} />
      </svg>
    </figure>
  );
}
