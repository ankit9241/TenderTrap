# TenderTrap

Evidence-first bid/no-bid intelligence for Indian contractors.

## Overview

TenderTrap helps contractors evaluate public and private tenders with deterministic eligibility analysis and clear audit trails.

- **Deterministic Decisions**: Hard rules check qualification thresholds without hallucination.
- **Evidence Verification**: Verifies criteria against snapshot company profiles and historical project evidence.
- **Explainable Results**: Step-by-step breakdown of why a tender is a BID, NO-BID, or CONDITIONAL match.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended) or [Bun](https://bun.sh/)

### Installation

```bash
bun install
# or
npm install
```

### Development

```bash
bun run dev
# or
npm run dev
```

The application will start at `http://localhost:8080`.

### Production Build

```bash
bun run build
# or
npm run build
```

### Testing

```bash
bun run test
# or
npm run test
```

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) & [TanStack Router](https://tanstack.com/router)
- **UI & Components**: React 19, Tailwind CSS v4, Radix UI, Lucide Icons
- **State & Data**: TanStack React Query
- **Validation**: Zod
