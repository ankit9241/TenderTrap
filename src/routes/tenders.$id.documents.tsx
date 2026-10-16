import { createFileRoute, Link } from "@tanstack/react-router";
import { useAssessment } from "@/lib/store";
import type { DocumentStatus } from "@/types/tender";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tenders/$id/documents")({
  component: Documents,
});

const statusText: Record<DocumentStatus, [string, string]> = {
  processing: ["Processing", "bg-muted text-foreground"],
  ready: ["Ready for review", "bg-met text-met-ink"],
  failed: ["Extraction failed", "bg-unmet text-unmet-ink"],
  mapping_incomplete: ["Source mapping incomplete", "bg-unknown text-unknown-ink"],
  unsupported: ["Unsupported format", "bg-unmet text-unmet-ink"],
  not_processed: ["Not processed", "bg-muted text-muted-foreground"],
};

function Documents() {
  const { id } = Route.useParams();
  const a = useAssessment(id);
  if (!a) return null;

  return (
    <div className="shell py-10 md:py-14">
      <ul className="border-t border-border">
        {a.documents.map((d) => {
          const refs = a.requirements.filter((r) => r.source?.documentId === d.id);
          const [label, cls] = statusText[d.status];
          return (
            <li key={d.id} className="grid gap-6 border-b border-border py-8 md:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="meta text-muted-foreground">
                  {d.kind === "tender" ? "Tender document" : "Supporting evidence"} ·{" "}
                  {d.sourceType === "user_upload" ? "User upload" : "Illustrative sample"}
                </p>
                <p className="mt-2 break-all font-display text-xl">{d.filename}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className={cn("meta px-2 py-1", cls)}>{label}</span>
                  {d.sizeBytes != null && <span className="meta text-muted-foreground">{(d.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>}
                </div>
                {d.note && <p className="mt-3 text-sm text-muted-foreground">{d.note}</p>}
              </div>
              <div>
                <p className="meta text-muted-foreground">Extracted references · {refs.length}</p>
                {refs.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No requirements map to this document.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {refs.map((r) => (
                      <li key={r.id}>
                        <Link to="/tenders/$id/requirements" params={{ id }} search={{ r: r.id }} className="flex justify-between gap-4 hover:text-primary">
                          <span>{r.title}</span>
                          <span className="meta text-muted-foreground">p. {r.source?.pageNumber ?? "?"}{r.source?.clauseNumber && ` · ${r.source.clauseNumber}`}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="meta mt-10 text-muted-foreground">
        Documents are user-provided or illustrative. TenderTrap does not check live GeM or government portals.
      </p>
    </div>
  );
}
