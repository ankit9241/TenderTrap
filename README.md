# TenderTrap

Evidence-first bid/no-bid intelligence for Indian contractors.

## Overview

TenderTrap helps contractors evaluate public and private tenders with deterministic eligibility analysis and clear audit trails.

- **Deterministic Decisions**: Hard rules check qualification thresholds without hallucination. Recommendations (`PROCEED`, `INVESTIGATE`, `SKIP`) come strictly from deterministic logic; LLM is used exclusively for extraction.
- **Evidence Verification**: Verifies criteria against snapshotted company profiles and historical project evidence. `UNKNOWN` criteria require evidence and never count as `MET`.
- **Document Type Classification**: Distinguishes single tender notices from general conditions of contract (`GCC`), administrative circulars, corrigenda, and mixed compilations.
- **Explainable Audit Trails**: Step-by-step breakdown with clause citations, verified page excerpts, and human review flags for low-confidence or title-only clauses.

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) & [TanStack Router](https://tanstack.com/router)
- **UI & Components**: React 19, CSS motion (prefers-reduced-motion compliant), Radix UI, Lucide Icons
- **PDF & OCR Pipeline**: `unpdf`, `pdfjs-dist`, and Tesseract.js fallback for scanned/raster PDFs
- **LLM Extraction**: Ollama (`gemma3:latest`) with strict structured JSON schema output
- **Validation**: Zod
- **Testing**: Vitest (102 tests)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or [Node.js](https://nodejs.org/) (v20+)
- [Ollama](https://ollama.ai/) with `gemma3:latest` installed and running (`ollama run gemma3:latest`)

### Installation

```bash
bun install
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key environment variables:
- `PORT`: Local server port (defaults to `8080`)
- `VITE_API_BASE_URL`: Base URL for the frontend API client (e.g. `http://localhost:8080`)
- `LLM_PROVIDER`: Model provider (`ollama`)
- `OLLAMA_BASE_URL`: Base URL for Ollama (`http://127.0.0.1:11434`)
- `OLLAMA_MODEL`: Extraction model (`gemma3:latest`)
- `MONGODB_URI`: Optional MongoDB Atlas connection string for persistent storage

### Development

```bash
bun run dev
```

The application will start at `http://localhost:8080`.

### Production Build

```bash
bun run build
```

Preview the production build:

```bash
bun run preview
```

### Testing

Run the test suite (102 automated tests):

```bash
bun run test
```

## Known Limitations

- **Scanned OCR Page Cap**: Image-only/scanned documents are processed up to a default safety limit of 15 pages (`DEFAULT_MAX_OCR_PAGES = 15`) to prevent worker timeouts and memory exhaustion. Unprocessed pages are explicitly tracked and surfaced with a visible coverage warning banner; full document coverage is never falsely implied.
- **Storage & Isolation**: By default, persistence runs in a labeled client demo store (`localStorage`) with optional MongoDB backend connectivity. Multi-tenant isolation and user authentication are not yet enabled.
- **Document Scopes**: Evaluates documents uploaded by the user; does not poll live GeM or CPPP government tender portals automatically.
