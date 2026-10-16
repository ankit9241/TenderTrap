import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AppPage } from "@/components/layout/Chrome";
import { ActionLink, DemoBadge, formatDate, formatStamp } from "@/components/ui-tt/primitives";
import { useAssessment, useHydratedStore } from "@/lib/store";

export const Route = createFileRoute("/tenders/$id")({
  head: () => ({
    meta: [
      { title: "Tender assessment — TenderTrap" },
      { name: "description", content: "Evidence-backed recommendation for a tender." },
      { property: "og:title", content: "Tender assessment" },
      { property: "og:description", content: "Review blockers, evidence gaps and unresolved clauses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TenderLayout,
});

const tabs = [
  { to: "/tenders/$id", label: "Overview", exact: true },
  { to: "/tenders/$id/requirements", label: "Requirements", exact: false },
  { to: "/tenders/$id/documents", label: "Documents", exact: false },
] as const;

function TenderLayout() {
  const { id } = Route.useParams();
  const a = useAssessment(id);
  const hydrated = useHydratedStore();

  if (!hydrated) return <AppPage><div className="min-h-[50vh]" /></AppPage>;
  if (!a)
    return (
      <AppPage>
        <div className="shell py-24">
          <h1 className="display-md">Assessment not found.</h1>
          <p className="mt-3 text-muted-foreground">It may have been removed from this browser.</p>
          <ActionLink to="/workspace" className="mt-8">Back to tender desk</ActionLink>
        </div>
      </AppPage>
    );

  return (
    <AppPage>
      <div className="border-b border-border">
        <div className="shell pt-10 md:pt-14">
          <div className="flex flex-wrap items-center gap-3">
            <span className="meta text-muted-foreground">{a.reference}</span>
            {a.demo && <DemoBadge />}
          </div>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold md:text-[40px] md:leading-tight">{a.title}</h1>
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            {[
              ["Authority", a.authority],
              ["Source", a.procurementSource],
              ["Deadline", formatDate(a.deadline)],
              ["Document", a.documents[0]?.status === "ready" ? "Ready for review" : "Not processed"],
              ["Last assessed", formatStamp(a.updatedAt)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="meta text-muted-foreground">{k}</dt>
                <dd className="mt-1">{v}</dd>
              </div>
            ))}
          </dl>
          <nav aria-label="Assessment sections" className="mt-8 flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                params={{ id }}
                activeOptions={{ exact: t.exact }}
                className="relative px-3 py-3 text-sm text-muted-foreground transition-colors first:pl-0 hover:text-foreground"
                activeProps={{ className: "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary first:after:left-0" }}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <Outlet />
    </AppPage>
  );
}
