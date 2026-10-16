# TenderTrap — engineering rules
- Eligibility recommendations come only from deterministic rules in src/lib/assessment/decide.ts; AI output is extraction only, so decisions stay explainable.
- Persistence is a labelled local demo store (src/lib/store.ts) until a backend is connected; all reads/writes go through its actions.
- All backend calls go through src/lib/api.ts using VITE_API_BASE_URL; if absent, show a truthful "not connected" state, never fabricated results.
- Assessments snapshot company evidence at creation so later profile edits don't rewrite history.
- Motion is CSS-only (utilities in src/styles.css) and must respect prefers-reduced-motion.
