import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type DragEvent } from "react";
import { AppPage } from "@/components/layout/Chrome";
import { Button, Eyebrow } from "@/components/ui-tt/primitives";
import { TenderTrapLoader } from "@/components/brand/TenderTrapLoader";
import { API_BASE, extractTender, validatePdf } from "@/lib/api";
import { actions, uid, useStore } from "@/lib/store";
import { buildDemoAssessment, snapshotEvidence } from "@/data/demo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tenders/new")({
  head: () => ({
    meta: [
      { title: "Start an assessment — TenderTrap" },
      { name: "description", content: "Upload a tender PDF to extract its requirements." },
      { property: "og:title", content: "Start a tender assessment" },
      { property: "og:description", content: "Extract the requirements first." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewTender,
});

const fields = [
  ["title", "Tender title"],
  ["reference", "Tender reference"],
  ["authority", "Issuing authority"],
  ["procurementSource", "Procurement source"],
] as const;

function NewTender() {
  const navigate = useNavigate();
  const company = useStore((s) => s.company);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({ title: "", reference: "", authority: "", procurementSource: "", deadline: "" });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const problem = await validatePdf(f);
    setError(problem);
    setFile(problem ? null : f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length > 1) return setError("Upload a single tender PDF.");
    void pick(e.dataTransfer.files[0]);
  };

  const extract = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const requirements = await extractTender(file);
      const id = uid("as");
      const now = new Date().toISOString();
      actions.addAssessment({
        id,
        demo: false,
        title: meta.title || file.name.replace(/\.pdf$/i, ""),
        reference: meta.reference || "Reference not provided",
        authority: meta.authority || "Not specified",
        procurementSource: meta.procurementSource || "User upload",
        deadline: meta.deadline || null,
        companyId: company.id,
        evidenceSnapshot: snapshotEvidence(company),
        documents: [{ id: `${id}-doc`, filename: file.name, kind: "tender", sizeBytes: file.size, status: "ready", sourceType: "user_upload" }],
        requirements,
        createdAt: now,
        updatedAt: now,
      });
      navigate({ to: "/tenders/$id", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed. Your file was not analysed.");
    } finally {
      setBusy(false);
    }
  };

  const openDemo = () => {
    const id = uid("as");
    actions.addAssessment(buildDemoAssessment(id, { title: meta.title, reference: meta.reference, authority: meta.authority, procurementSource: meta.procurementSource, ...(meta.deadline ? { deadline: meta.deadline } : {}) }, company));
    navigate({ to: "/tenders/$id", params: { id } });
  };

  return (
    <AppPage>
      <div className="shell grid gap-14 py-12 md:py-20 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <Eyebrow>Document intake</Eyebrow>
          <h1 className="display-md mt-4">Start with the tender.</h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Extract the requirements first. Evaluate your eligibility only after the evidence is compared.
          </p>
          <div className="mt-10 border-t border-border pt-6 text-sm">
            <p className="meta text-muted-foreground">Company profile used</p>
            <p className="mt-2">{company.legalName}</p>
            <p className="mt-1 text-muted-foreground">Evidence is snapshotted at assessment time.</p>
          </div>
          {!API_BASE && (
            <div className="mt-10 border-l-2 border-unknown-ink bg-unknown px-5 py-4 text-sm">
              <p className="font-medium">Extraction service not connected</p>
              <p className="mt-1 text-muted-foreground">
                Real PDFs can't be analysed yet. You can still explore an illustrative demo assessment — it uses synthetic data and does not read your file.
              </p>
            </div>
          )}
        </div>

        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cn(
              "relative flex min-h-64 flex-col items-center justify-center border border-dashed bg-paper p-8 text-center transition-colors duration-300",
              drag ? "border-primary bg-unmet/40" : "border-input",
            )}
          >
            {busy ? (
              <TenderTrapLoader variant="medium" label="Extracting requirements" />
            ) : file ? (
              <div className="anim-rise w-full text-left">
                <p className="meta text-muted-foreground">Selected tender</p>
                <p className="mt-2 break-all font-display text-xl">{file.name}</p>
                <p className="meta mt-1 text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB · PDF</p>
                <div className="mt-6 flex gap-4">
                  <Button variant="quiet" size="sm" onClick={() => input.current?.click()}>Replace</Button>
                  <Button variant="ghost" size="sm" onClick={() => setFile(null)}>Remove</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-display text-xl">Drop a tender PDF here</p>
                <p className="mt-2 text-sm text-muted-foreground">One file · up to 25 MB</p>
                <Button variant="quiet" className="mt-6" onClick={() => input.current?.click()}>Choose file</Button>
              </>
            )}
            <label className="sr-only" htmlFor="tender-file">Tender PDF</label>
            <input
              id="tender-file"
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }}
            />
          </div>
          {error && <p role="alert" className="anim-rise mt-4 border-l-2 border-primary pl-4 text-sm text-unmet-ink">{error}</p>}

          <fieldset className="mt-10 grid gap-5 sm:grid-cols-2">
            <legend className="meta mb-4 text-muted-foreground">Optional details</legend>
            {fields.map(([k, label]) => (
              <label key={k} className="block text-sm">
                <span className="text-muted-foreground">{label}</span>
                <input
                  value={meta[k]}
                  onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
                  className="mt-1.5 h-11 w-full border-b border-input bg-transparent outline-none transition-colors focus:border-primary"
                />
              </label>
            ))}
            <label className="block text-sm">
              <span className="text-muted-foreground">Submission deadline</span>
              <input type="date" value={meta.deadline} onChange={(e) => setMeta({ ...meta, deadline: e.target.value })} className="mt-1.5 h-11 w-full border-b border-input bg-transparent outline-none focus:border-primary" />
            </label>
          </fieldset>

          <div className="mt-10 flex flex-wrap items-center gap-6">
            <Button onClick={extract} disabled={!file || busy || !API_BASE} title={!API_BASE ? "Extraction service not connected" : undefined}>
              Extract requirements ↗
            </Button>
            <Button variant="ghost" onClick={openDemo} disabled={busy}>Open illustrative demo instead</Button>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
