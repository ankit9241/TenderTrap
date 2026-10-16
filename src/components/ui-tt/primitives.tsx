import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { RequirementStatus } from "@/types/tender";

export const action = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap px-5 text-sm font-medium transition-all duration-300 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-foreground",
        ink: "bg-foreground text-background hover:bg-primary",
        ghost: "text-foreground underline decoration-border underline-offset-[6px] hover:decoration-primary px-0",
        outline: "border border-foreground/80 text-foreground hover:bg-foreground hover:text-background",
        inverse: "bg-ink-foreground text-ink hover:bg-primary hover:text-primary-foreground",
        quiet: "border border-border bg-paper text-foreground hover:border-foreground",
      },
      size: { md: "", sm: "min-h-9 px-3 text-[13px]" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  variant,
  size,
  className,
  ...p
}: ComponentProps<"button"> & VariantProps<typeof action>) {
  return <button className={cn(action({ variant, size }), className)} {...p} />;
}

export function ActionLink({
  variant,
  size,
  className,
  ...p
}: ComponentProps<typeof Link> & VariantProps<typeof action>) {
  return <Link className={cn(action({ variant, size }), className)} {...p} />;
}

const statusStyles: Record<RequirementStatus, string> = {
  MET: "bg-met text-met-ink",
  UNKNOWN: "bg-unknown text-unknown-ink",
  UNMET: "bg-unmet text-unmet-ink",
};
const statusWords: Record<RequirementStatus, string> = {
  MET: "Evidence matched",
  UNKNOWN: "Needs evidence",
  UNMET: "Requirement not met",
};

export function StatusTag({ status, long }: { status: RequirementStatus; long?: boolean }) {
  return (
    <span className={cn("meta inline-flex items-center gap-1.5 px-2 py-1", statusStyles[status])}>
      <span className="size-1.5 bg-current" aria-hidden="true" />
      {long ? statusWords[status] : status}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("meta text-muted-foreground", className)}>{children}</p>;
}

export function DemoBadge() {
  return (
    <span className="meta border border-primary/40 px-2 py-1 text-primary" title="Synthetic sample data">
      Demo · illustrative data
    </span>
  );
}

/** Scroll-triggered reveal. Content stays visible without JS or with reduced motion. */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          el.dataset["reveal"] = "in";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      className={className}
      style={{ ["--d" as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "Not specified";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
export function formatStamp(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
