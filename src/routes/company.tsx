import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppPage } from "@/components/layout/Chrome";
import { Button, Eyebrow, formatStamp } from "@/components/ui-tt/primitives";
import { actions, uid, useHydratedStore, useStore } from "@/lib/store";
import { formatInr, stateLabel } from "@/data/demo";
import type { CompanyProfile, EvidenceState } from "@/types/tender";

export const Route = createFileRoute("/company")({
  head: () => ({
    meta: [
      { title: "Company evidence — TenderTrap" },
      { name: "description", content: "Your contractor evidence register: turnover, experience, registrations." },
      { property: "og:title", content: "Company evidence register" },
      { property: "og:description", content: "Structured contractor evidence for tender assessments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Company,
});

const states: EvidenceState[] = ["not_provided", "uploaded_unreviewed", "reviewed", "expired"];
const inputCls = "h-10 w-full border-b border-input bg-transparent text-sm outline-none focus:border-primary";

function Company() {
  const stored = useStore((s) => s.company);
  const hydrated = useHydratedStore();
  const [c, setC] = useState<CompanyProfile>(stored);
  const [saved, setSaved] = useState(false);
  useEffect(() => setC(stored), [stored]);

  const dirty = JSON.stringify(c) !== JSON.stringify(stored);
  const save = () => {
    actions.saveCompany(c);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!hydrated) return <AppPage><div className="min-h-[50vh]" /></AppPage>;

  return (
    <AppPage>
      <div className="shell py-12 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow>Contractor evidence</Eyebrow>
            <h1 className="mt-4 text-4xl font-semibold md:text-[44px]">Company evidence</h1>
            <p className="mt-3 max-w-lg text-muted-foreground">
              Incomplete profiles still work — missing evidence is surfaced during assessment, never treated as a failure. Past assessments keep their own snapshot.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {saved && <span className="meta anim-fade text-met-ink">Saved</span>}
            <span className="meta text-muted-foreground">Updated {formatStamp(stored.updatedAt)}</span>
            <Button onClick={save} disabled={!dirty}>Save profile</Button>
          </div>
        </div>

        <Block title="Business identity">
          <div className="grid gap-6 sm:grid-cols-2">
            {([
              ["legalName", "Legal business name"],
              ["businessType", "Business type"],
              ["identifiers", "Business identifiers (e.g. GSTIN, Udyam)"],
              ["address", "Registered address"],
            ] as const).map(([k, l]) => (
              <label key={k} className="text-sm">
                <span className="text-muted-foreground">{l}</span>
                <input className={inputCls} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <p className="meta mt-4 text-muted-foreground">Aadhaar and bank details are never required.</p>
        </Block>

        <Block title="Financial capacity" onAdd={() => setC({ ...c, turnover: [...c.turnover, { id: uid("to"), financialYear: "", amountInr: 0, state: "not_provided" }] })}>
          {c.turnover.map((t, i) => (
            <Row key={t.id} onRemove={() => setC({ ...c, turnover: c.turnover.filter((x) => x.id !== t.id) })} state={t.state} onState={(s) => upd("turnover", i, { state: s })}>
              <Field label="Financial year" value={t.financialYear} onChange={(v) => upd("turnover", i, { financialYear: v })} />
              <Field label="Turnover (₹)" type="number" value={String(t.amountInr)} onChange={(v) => upd("turnover", i, { amountInr: Number(v) || 0 })} hint={formatInr(t.amountInr)} />
            </Row>
          ))}
        </Block>

        <Block title="Experience" onAdd={() => setC({ ...c, projects: [...c.projects, { id: uid("pr"), name: "", client: "", valueInr: 0, completed: "", state: "not_provided" }] })}>
          {c.projects.map((p, i) => (
            <Row key={p.id} onRemove={() => setC({ ...c, projects: c.projects.filter((x) => x.id !== p.id) })} state={p.state} onState={(s) => upd("projects", i, { state: s })}>
              <Field label="Project" value={p.name} onChange={(v) => upd("projects", i, { name: v })} />
              <Field label="Client / authority" value={p.client} onChange={(v) => upd("projects", i, { client: v })} />
              <Field label="Value (₹)" type="number" value={String(p.valueInr)} onChange={(v) => upd("projects", i, { valueInr: Number(v) || 0 })} />
              <Field label="Completed" type="date" value={p.completed} onChange={(v) => upd("projects", i, { completed: v })} />
            </Row>
          ))}
        </Block>

        <Block title="Registrations and certifications" onAdd={() => setC({ ...c, registrations: [...c.registrations, { id: uid("rg"), name: "", authority: "", validUntil: null, state: "not_provided" }] })}>
          {c.registrations.map((r, i) => (
            <Row key={r.id} onRemove={() => setC({ ...c, registrations: c.registrations.filter((x) => x.id !== r.id) })} state={r.state} onState={(s) => upd("registrations", i, { state: s })}>
              <Field label="Registration" value={r.name} onChange={(v) => upd("registrations", i, { name: v })} />
              <Field label="Issuing authority" value={r.authority} onChange={(v) => upd("registrations", i, { authority: v })} />
              <Field label="Valid until" type="date" value={r.validUntil ?? ""} onChange={(v) => upd("registrations", i, { validUntil: v || null })} />
            </Row>
          ))}
        </Block>
        <p className="meta mt-12 text-muted-foreground">"Reviewed" means reviewed by you for this profile. TenderTrap does not perform official verification.</p>
      </div>
    </AppPage>
  );

  function upd<K extends "turnover" | "projects" | "registrations">(key: K, i: number, patch: Partial<CompanyProfile[K][number]>) {
    setC((prev) => ({ ...prev, [key]: prev[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  }
}

function Block({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd?: () => void }) {
  return (
    <section className="mt-16 grid gap-6 border-t border-border pt-8 lg:grid-cols-[260px_1fr] lg:gap-12">
      <div className="flex items-start justify-between gap-4 lg:flex-col">
        <h2 className="text-xl font-semibold">{title}</h2>
        {onAdd && <Button variant="ghost" size="sm" onClick={onAdd}>+ Add record</Button>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ children, onRemove, state, onState }: { children: React.ReactNode; onRemove: () => void; state: EvidenceState; onState: (s: EvidenceState) => void }) {
  return (
    <div className="grid gap-4 border-b border-border pb-5 sm:grid-cols-2 xl:grid-cols-[repeat(4,1fr)_auto] xl:items-end">
      {children}
      <label className="text-sm">
        <span className="text-muted-foreground">Evidence state</span>
        <select className={inputCls} value={state} onChange={(e) => onState(e.target.value as EvidenceState)}>
          {states.map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
        </select>
      </label>
      <Button variant="ghost" size="sm" onClick={onRemove} className="justify-self-start text-muted-foreground">Remove</Button>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  return (
    <label className="text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input type={type} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="meta mt-1 block text-muted-foreground">{hint}</span>}
    </label>
  );
}
