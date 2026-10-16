import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TenderTrapLogo } from "@/components/brand/TenderTrapLogo";
import { ActionLink } from "@/components/ui-tt/primitives";
import { cn } from "@/lib/utils";

export function SiteHeader({ animateLogo }: { animateLogo?: boolean | undefined }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-colors duration-500",
        scrolled ? "border-b border-border bg-background/95 backdrop-blur-sm" : "border-b border-transparent",
      )}
    >
      <div className="shell flex h-16 items-center justify-between gap-4 md:h-20">
        <Link to="/" aria-label="TenderTrap home">
          <TenderTrapLogo animate={animateLogo} />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5 md:gap-8">
          <Link to="/how-it-works" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline" activeProps={{ className: "text-foreground" }}>
            How it works
          </Link>
          <Link to="/evidence-standard" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline" activeProps={{ className: "text-foreground" }}>
            Evidence standard
          </Link>
          <ActionLink to="/workspace" variant="ink" size="sm" className="px-4">
            Open workspace ↗
          </ActionLink>
        </nav>
      </div>
    </header>
  );
}

const appNav = [
  { to: "/workspace", label: "Tender desk" },
  { to: "/tenders/new", label: "New assessment" },
  { to: "/company", label: "Company evidence" },
] as const;

export function AppHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="shell flex min-h-16 flex-wrap items-center justify-between gap-x-8 gap-y-2 py-3">
        <Link to="/" aria-label="TenderTrap home">
          <TenderTrapLogo />
        </Link>
        <nav aria-label="Workspace" className="-mx-1 flex gap-1 overflow-x-auto">
          {appNav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="relative px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeOptions={{ exact: n.to !== "/workspace" }}
              activeProps={{ className: "text-foreground after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:bg-primary" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="shell grid gap-8 py-12 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-4">
          <TenderTrapLogo />
          <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
            TenderTrap supports procurement decisions. It does not guarantee eligibility, bid success, or legal
            compliance. It does not connect to GeM or government portals.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-6 text-sm">
          <Link to="/how-it-works" className="hover:text-primary">How it works</Link>
          <Link to="/evidence-standard" className="hover:text-primary">Evidence standard</Link>
          <Link to="/workspace" className="hover:text-primary">Workspace</Link>
        </nav>
      </div>
    </footer>
  );
}

export function AppPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="anim-fade">{children}</main>
    </div>
  );
}
