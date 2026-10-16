import { cn } from "@/lib/utils";

interface MarkProps {
  size?: number | undefined;
  className?: string | undefined;
  animate?: boolean | undefined;
  tone?: "default" | "inverse" | undefined;
}

/**
 * The Evidence Mark: a document outline, a scanning line, and a bracket isolating one clause.
 */
export function TenderTrapMark({ size = 32, className, animate = false, tone = "default" }: MarkProps) {
  const a = animate ? "draw" : "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn(tone === "inverse" ? "text-ink-foreground" : "text-foreground", className)}
    >
      <path
        d="M7 3.5h12.5L25 9v19.5H7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="miter"
        className={a}
        style={{ ["--len" as string]: 90, ["--d" as string]: "0ms" }}
      />
      <path d="M19.5 3.5V9H25" stroke="currentColor" strokeWidth="1.8" className={a} style={{ ["--len" as string]: 14, ["--d" as string]: "250ms" }} />
      <path d="M11 13h7" stroke="currentColor" strokeWidth="1.6" className={a} style={{ ["--len" as string]: 8, ["--d" as string]: "350ms" }} />
      <path d="M11 23.5h9" stroke="currentColor" strokeWidth="1.6" className={a} style={{ ["--len" as string]: 10, ["--d" as string]: "420ms" }} />
      <path
        d="M10 16v5h-1.5M22 16v5h1.5M10 16H8.5M22 16h1.5"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
        className={a}
        style={{ ["--len" as string]: 24, ["--d" as string]: "520ms" }}
      />
      <path d="M12 18.5h8" stroke="var(--color-primary)" strokeWidth="2.2" className={a} style={{ ["--len" as string]: 9, ["--d" as string]: "650ms" }} />
    </svg>
  );
}

export function TenderTrapLogo({ className, animate, tone }: Omit<MarkProps, "size">) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="TenderTrap">
      <TenderTrapMark size={28} animate={animate} tone={tone} />
      <span
        aria-hidden="true"
        className={cn(
          "font-display text-[19px] font-semibold tracking-[-0.04em]",
          tone === "inverse" ? "text-ink-foreground" : "text-foreground",
        )}
      >
        tender<span className="text-primary">trap</span>
      </span>
    </span>
  );
}
