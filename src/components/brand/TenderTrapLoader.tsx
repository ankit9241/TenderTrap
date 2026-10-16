import { cn } from "@/lib/utils";

const sizes = { inline: 20, medium: 56, page: 96 } as const;

/**
 * Precision-instrument loader. Used only during real asynchronous work.
 * Cycle ≈1.6s: outline draws → clause lines → merlot scan → bracket closes → check resolves.
 */
export function TenderTrapLoader({
  variant = "medium",
  label = "Processing",
  className,
}: {
  variant?: keyof typeof sizes;
  label?: string;
  className?: string;
}) {
  const s = sizes[variant];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex flex-col items-center gap-3", className)}>
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="tt-loader text-foreground">
        <style>{`
          .tt-loader .o{stroke-dasharray:90;animation:ttl-o 1.6s var(--ease-precise) infinite}
          .tt-loader .l{stroke-dasharray:10;animation:ttl-l 1.6s ease infinite}
          .tt-loader .l2{animation-delay:.1s}.tt-loader .l3{animation-delay:.2s}
          .tt-loader .b{stroke-dasharray:24;animation:ttl-b 1.6s var(--ease-precise) infinite}
          .tt-loader .s{animation:ttl-s 1.6s var(--ease-precise) infinite}
          .tt-loader .c{stroke-dasharray:9;animation:ttl-c 1.6s var(--ease-precise) infinite}
          @keyframes ttl-o{0%{stroke-dashoffset:90}30%,100%{stroke-dashoffset:0}}
          @keyframes ttl-l{0%,20%{opacity:0}35%,100%{opacity:1}}
          @keyframes ttl-s{0%,30%{transform:translateY(0);opacity:0}35%{opacity:1}60%{transform:translateY(16px);opacity:1}65%,100%{opacity:0;transform:translateY(16px)}}
          @keyframes ttl-b{0%,55%{stroke-dashoffset:24}75%,100%{stroke-dashoffset:0}}
          @keyframes ttl-c{0%,70%{stroke-dashoffset:9}88%,100%{stroke-dashoffset:0}}
          @media (prefers-reduced-motion:reduce){.tt-loader *{animation:none!important;stroke-dashoffset:0!important;opacity:1!important}.tt-loader .s{display:none}}
        `}</style>
        <path className="o" d="M7 3.5h12.5L25 9v19.5H7z" stroke="currentColor" strokeWidth="1.8" />
        <path className="l" d="M11 13h7" stroke="currentColor" strokeWidth="1.6" />
        <path className="l l2" d="M11 18.5h10" stroke="currentColor" strokeWidth="1.6" opacity=".35" />
        <path className="l l3" d="M11 23.5h9" stroke="currentColor" strokeWidth="1.6" />
        <path className="s" d="M8.5 9.5h15" stroke="var(--color-primary)" strokeWidth="1" />
        <path className="b" d="M10 16v5h-1.5M22 16v5h1.5M10 16H8.5M22 16h1.5" stroke="var(--color-primary)" strokeWidth="1.8" />
        <path className="c" d="M13 18.7l2 1.8 4-3.6" stroke="var(--color-primary)" strokeWidth="1.8" />
      </svg>
      {variant === "inline" ? <span className="sr-only">{label}</span> : <span className="meta text-muted-foreground">{label}</span>}
    </span>
  );
}
