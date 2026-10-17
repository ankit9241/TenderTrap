import { useSyncExternalStore } from "react";
import type { Assessment, CompanyProfile, ReviewState } from "@/types/tender";
import { demoCompany } from "@/data/demo";

/**
 * Local demo store (browser localStorage). Clearly a development store —
 * replace with the backend API when persistence is connected.
 */
import { sampleTendernoticeAssessment } from "@/data/tenderNoticeAssessment";

interface State {
  assessments: Assessment[];
  company: CompanyProfile;
}

const KEY = "tendertrap.v1";
const initial: State = { assessments: [sampleTendernoticeAssessment], company: demoCompany };
let state: State = initial;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      state = {
        ...initial,
        ...parsed,
        assessments:
          parsed.assessments && parsed.assessments.length > 0
            ? parsed.assessments
            : [sampleTendernoticeAssessment],
      };
    }
  } catch {
    state = initial;
  }
}

function set(next: State) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — keep in memory */
  }
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      load();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      load();
      return select(state);
    },
    () => select(initial),
  );
}

export function useHydratedStore() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export const actions = {
  addAssessment(a: Assessment) {
    set({ ...state, assessments: [a, ...state.assessments] });
  },
  removeAssessment(id: string) {
    set({ ...state, assessments: state.assessments.filter((a) => a.id !== id) });
  },
  review(assessmentId: string, reqId: string, review: ReviewState) {
    const now = new Date().toISOString();
    set({
      ...state,
      assessments: state.assessments.map((a) =>
        a.id !== assessmentId
          ? a
          : {
              ...a,
              updatedAt: now,
              requirements: a.requirements.map((r) =>
                r.id === reqId ? { ...r, review, reviewedAt: review === "pending" ? undefined : now } : r,
              ),
            },
      ),
    });
  },
  saveCompany(company: CompanyProfile) {
    set({ ...state, company: { ...company, updatedAt: new Date().toISOString() } });
  },
};

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function useAssessment(id: string) {
  return useStore((s) => s.assessments.find((a) => a.id === id));
}
