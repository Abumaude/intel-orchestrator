# Intel Orchestrator — Design Anchor Document

## Single-Source-of-Truth for Agentic Build

**Version:** 1.0
**Date:** 2026-05-06
**Build Method:** Agentic Engineering via DriftGuard

---

## 0. How to Use This Document

This is the immutable design anchor for the Intel Orchestrator project. AI agents read from it but never modify it. If an AI agent's output contradicts this document, the output is wrong.

**Structure rules:**

- Section 1 (Architecture Anchors) is loaded into every AI session as mandatory context.
- All other sections are loaded selectively — only when the Build Instructions routing file specifies them.
- Every section is self-contained. An AI agent reading Section 6 should understand it without needing Section 8.
- The Validation Checklist (Appendix A) is run after every build step.

---

## 1. Architecture Anchors (Immutable Context)

### 1.1 Product Definition

Intel Orchestrator is a single-operator command-line tool that turns a natural-language prompt into a delivered PDF intelligence brief — by chaining Firecrawl (for web crawling and scraping) with Claude (for synthesis), then emailing the brief to the operator or a configured client. v1 is operator-run with one principal user; the data model is multi-tenant-ready so v2 (per-client logins, scheduled runs, dashboard) is a graduation rather than a rewrite.

### 1.2 Immutable Constraints

| # | Constraint | Implication |
|---|-----------|-------------|
| 1 | Firecrawl is consumed only as a hosted API, not forked or self-hosted in v1 | No AGPL-3.0 obligations apply to this codebase |
| 2 | The repo is the source of truth for runs, clients, and briefs | All persistent state lives in committed markdown/JSON files, not a database |
| 3 | The pipeline is exactly four stages: Crawl → Brief → Render → Deliver | No parallel paths, no skipped stages, no reordering |
| 4 | Every stage writes its artefact to disk before the next stage runs | Failure mid-pipeline never re-bills earlier stages on resume |
| 5 | Clients are first-class even with one client | Every run, every artefact, every config is namespaced under a client slug from day 1 |
| 6 | Brief templates are markdown files, not code | Adding a new template never requires editing TypeScript |
| 7 | API keys live in environment variables, never in the repo | `.env` is gitignored; `.env.example` ships placeholders only |
| 8 | The CLI is the only entrypoint in v1 | No web UI, no scheduled triggers, no webhooks until v1.5+ |

### 1.3 Design Principles

| # | Principle | Test Question |
|---|-----------|---------------|
| 1 | Repo as truth | Can the operator reconstruct any run's full history by reading the repo alone? |
| 2 | Stage isolation | Can each pipeline stage be rerun independently without re-running the previous stage? |
| 3 | Inclusion-by-default schema | Does every artefact carry a `client_slug` even when only one client exists? |
| 4 | Cost transparency | Does every run write a `manifest.json` recording API calls, tokens, and estimated cost? |
| 5 | Operator-readable failures | When a stage fails, does the operator get a plain-English explanation pointing at the failing artefact? |
| 6 | Template additivity | Can a new brief template be added without modifying any TypeScript file? |
| 7 | Multi-tenant-ready data model | Could v2 introduce per-client logins without renaming any folder, schema field, or env var? |

### 1.4 Foundational Context

The competitive intelligence space splits into two camps: heavyweight enterprise platforms (Crayon, Klue, Kompyte) that cost £600+/month and require dedicated analyst time, and DIY alert systems (Google Alerts, Visualping, Distill) that fire raw, unsynthesised signal. Most small businesses sit unserved between these poles — they want curated, briefed intelligence but cannot afford a full platform or a part-time analyst.

Firecrawl removes the hardest part of the DIY path: reliable, JS-aware, anti-bot-resistant scraping at API-call cost. The remaining work — orchestration, multi-tenant routing, synthesis, delivery — is glue. Intel Orchestrator is that glue, opinionated for the small-operator-serving-clients use case rather than the in-house analyst use case.

The product's defensibility is not the scraping (Firecrawl owns that) and not the LLM (anyone can call Claude). It is the briefing posture: a small library of opinionated brief templates that turn raw scrapes into the executive document a non-analyst client actually wants to read. The templates are the moat.

---

## 2. The Pipeline (Core Workflow)

### 2.1 Four Stages

Every run executes exactly four stages, in order, each gated by the successful completion of the previous:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Stage 1        │     │  Stage 2        │     │  Stage 3        │     │  Stage 4        │
│  CRAWL          │ ──▶ │  BRIEF          │ ──▶ │  RENDER         │ ──▶ │  DELIVER        │
│  (Firecrawl)    │     │  (Claude)       │     │  (PDF)          │     │  (Resend)       │
│  → raw/*.md     │     │  → brief.md     │     │  → brief.pdf    │     │  → email sent   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

Each stage produces a named artefact in the run folder. The next stage reads from that artefact, not from memory.

### 2.2 Stage 1: Crawl

Stage 1 takes the operator's prompt, the resolved client slug, and the chosen crawl mode, and produces raw markdown files inside `runs/[client-slug]/[run-slug]/raw/`. Two crawl modes are supported in v1:

- **`agent` mode** (default). The prompt is passed to Firecrawl's `/agent` endpoint. Firecrawl decides which sources to visit and returns synthesised content with source URLs. One markdown file is written per source URL Firecrawl reports.
- **`targeted` mode**. The operator supplies an explicit URL list. The tool calls Firecrawl's batch scrape endpoint for those URLs. One markdown file is written per URL.

Other modes (`crawl` for whole-domain traversal, `search` for query-driven discovery, `interact` for clickthrough scraping) are out of scope for v1.

### 2.3 Stage 2: Brief

Stage 2 reads every markdown file in `raw/`, concatenates them with their source URLs as headers, loads the chosen brief template, and sends a single Claude API call composed as: system prompt = template + brief-pass instructions; user message = the operator's original prompt + the concatenated raw content. The response is written to `brief.md` in the run folder. No retries on length; the operator can rerun stage 2 with `--model opus` if the Sonnet output is judged thin.

### 2.4 Stage 3: Render

Stage 3 reads `brief.md` and produces `brief.pdf` in the same folder. The renderer is a thin wrapper around `markdown-pdf` (or equivalent) with a fixed stylesheet — clean serif body, sans-serif headings, the operator's brand colour as accent. The stylesheet lives in `src/pdf-styles/default.css` and is the only file that controls the visual output of every brief.

### 2.5 Stage 4: Deliver

Stage 4 reads `brief.pdf`, the run's `manifest.json`, and the client's `profile.md`, then sends an email via Resend with the PDF attached. The email body is a plain-text acknowledgement: subject = `[Intel Brief] [run name] — [date]`, body = a short note naming the brief and the run slug. The recipient is taken from the client's `profile.md`. The send result (success/failure, message ID) is appended to `manifest.json`.

### 2.6 Resumability Contract

Each stage has a single boolean predicate determining whether it has completed: the existence of its named artefact. Stage 1 = `raw/` non-empty. Stage 2 = `brief.md` exists. Stage 3 = `brief.pdf` exists. Stage 4 = `manifest.json` contains a `delivery.status: "sent"` entry. The CLI accepts `--resume` to skip every stage whose predicate is already true. This contract makes mid-pipeline failures cheap to recover.

### 2.7 Cost Guardrails

Every run records, in `manifest.json`, the number of Firecrawl API calls, the input/output token count for the LLM call, and an estimated cost in USD using rates baked into a config file (`src/config/pricing.ts`). The CLI enforces hard caps via env vars: `MAX_FIRECRAWL_PAGES_PER_RUN` (default 30), `MAX_LLM_INPUT_TOKENS` (default 100,000), `MAX_LLM_OUTPUT_TOKENS` (default 8,000). A run exceeding any cap fails with a Failure Report explaining which cap fired and how to override.

---

## 3. Data Model

### 3.1 Run Folder Anatomy

Every run lives at `runs/[client-slug]/[run-slug]/`. The run-slug format is `YYYY-MM-DD-[short-name]`, where `short-name` is kebab-case derived from the operator's prompt or supplied via `--name`. The folder contents:

```
runs/real-estate-dev/2026-05-06-competitor-pricing/
├── job.md           # The original prompt, mode, client slug, template choice, timestamp
├── raw/             # Firecrawl outputs, one markdown file per source
│   ├── 001-source-name.md
│   ├── 002-source-name.md
│   └── ...
├── brief.md         # The LLM-generated brief
├── brief.pdf        # The rendered PDF
└── manifest.json    # Metadata: timings, costs, delivery status, errors
```

`job.md` is written first, before stage 1 runs, and never modified afterwards. `manifest.json` is updated after each stage.

### 3.2 Client Folder Anatomy

Every client (including the operator-as-self in v1) lives at `clients/[client-slug]/`:

```
clients/real-estate-dev/
├── profile.md       # Frontmatter: name, delivery email, brief template default, notes
└── watchlist.yaml   # v1.5+ — placeholder file in v1, empty content allowed
```

`profile.md` is the multi-tenant-ready record. v1 reads delivery email and default template from it; v2 will add login credentials, plan tier, etc. without renaming the file.

### 3.3 Repo Layout (Truth Tree)

```
intel-orchestrator/
├── ANCHOR_intel-orchestrator.md
├── BUILD_INSTRUCTIONS_intel-orchestrator.md
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                       # entrypoint
│   ├── orchestrator.ts              # 4-stage pipeline coordinator
│   ├── stages/
│   │   ├── crawl.ts
│   │   ├── brief.ts
│   │   ├── render.ts
│   │   └── deliver.ts
│   ├── clients/
│   │   ├── firecrawl-client.ts
│   │   ├── llm-client.ts
│   │   └── resend-client.ts
│   ├── schemas/                     # zod schemas for Job, Manifest, ClientProfile
│   │   └── index.ts
│   ├── config/
│   │   └── pricing.ts
│   ├── pdf-styles/
│   │   └── default.css
│   └── prompt-templates/            # brief templates (markdown)
│       ├── market-intelligence.md
│       ├── news-digest.md
│       ├── research-brief.md
│       └── generic.md
├── clients/
│   └── operator/
│       ├── profile.md
│       └── watchlist.yaml
└── runs/
    └── .gitkeep
```

### 3.4 Multi-Tenant-Ready Schema (Even Though v1 Is Single-Tenant)

Every artefact, every log entry, every manifest field carries a `client_slug` from day 1. v1 has one client (`operator` for self-runs, additional named slugs as the operator runs briefs on behalf of named clients), but the schema does not have a "default client" or "no client" path. This is the inclusion-by-default principle: v2 multi-tenancy is enabled by adding new client folders, not by changing any field name.

**`Job` schema (zod):**

```typescript
{
  client_slug: string;          // required, matches clients/[slug]/
  run_slug: string;             // YYYY-MM-DD-short-name
  prompt: string;               // operator's original instruction
  mode: 'agent' | 'targeted';
  urls?: string[];              // required if mode === 'targeted'
  template: string;             // matches src/prompt-templates/[name].md
  llm_model: 'sonnet' | 'opus';
  created_at: string;           // ISO 8601
}
```

**`Manifest` schema (zod):**

```typescript
{
  job: Job;
  stages: {
    crawl: StageRecord;
    brief: StageRecord;
    render: StageRecord;
    deliver: StageRecord;
  };
  costs: {
    firecrawl_calls: number;
    llm_input_tokens: number;
    llm_output_tokens: number;
    estimated_usd: number;
  };
}

StageRecord = {
  status: 'pending' | 'running' | 'success' | 'failed';
  started_at?: string;
  ended_at?: string;
  error?: string;
  artefacts?: string[];         // relative paths
}
```

**`ClientProfile` schema (yaml frontmatter in `profile.md`):**

```yaml
---
client_slug: real-estate-dev
display_name: Acme Real Estate
delivery_email: contact@acme.example
default_template: market-intelligence
notes: |
  Free-text operator notes about this client.
---
```

---

## 4. Brief Templates

### 4.1 Template Architecture

Templates are plain markdown files in `src/prompt-templates/`. Each template contains two parts in a single file, separated by a `---` divider: a YAML frontmatter block declaring the template's name and intended use, and a markdown body that is the actual system-prompt content sent to Claude during stage 2.

The template body uses double-curly-brace placeholders that the brief stage substitutes at call time:

- `{{client_name}}` — display name from the client profile
- `{{prompt}}` — the operator's original instruction
- `{{raw_content}}` — concatenated raw markdown from stage 1, with `## Source: [URL]` headers
- `{{date}}` — the run date in human-readable format

A template that uses none of these placeholders is valid; the brief stage simply passes the body through.

### 4.2 Starter Set (v1)

Four templates ship with v1. The intent is to cover the most common operator prompts on day one without overcommitting to a long template library before real use cases reveal what's needed.

**`market-intelligence.md`** — default. The brief is structured into: Executive Summary (3 sentences), Key Competitor Moves, Pricing/Positioning Shifts, Market Signals, Risks, and Recommended Actions. This template assumes the raw content is a mix of competitor websites, pricing pages, news articles, and analyst commentary.

**`news-digest.md`** — for "round up the week's news on X" prompts. The brief is structured into: Top Stories (ranked by significance, with source link and 2-sentence summary each), Themes (cross-story patterns), and What's Notable vs What's Noise.

**`research-brief.md`** — for deep-research prompts. The brief is structured into: Question Framing, Key Findings (each with citation), Supporting Evidence, Gaps and Open Questions, and Suggested Follow-ups.

**`generic.md`** — fallback when no other template fits. Loose structure: Summary, Findings, Sources. No domain assumptions.

### 4.3 Adding New Templates

A new template is added by writing a new `[name].md` file in `src/prompt-templates/` that conforms to the frontmatter+body format. No TypeScript modification is required. The CLI's `--template` flag accepts any filename in that folder. Template names that match existing files are rejected at startup with a clear error.

---

## 5. Firecrawl Integration

### 5.1 Endpoints In Scope

v1 uses two Firecrawl endpoints:

- `POST /v2/agent` — for `agent` mode. Sends `{prompt, schema?}`, receives `{result, sources}`.
- `POST /v2/batch/scrape` — for `targeted` mode. Sends `{urls, formats: ['markdown']}`, receives one document per URL.

All other Firecrawl endpoints (`/scrape`, `/crawl`, `/map`, `/search`, `/interact`) are out of scope for v1 and must not be called.

### 5.2 Mode Selection

`agent` is the default mode. `targeted` is selected by passing `--mode targeted --urls url1.com,url2.com,...` on the CLI. There is no automatic mode selection in v1; the operator chooses explicitly.

### 5.3 Cost Posture

Firecrawl charges per page scraped. The `MAX_FIRECRAWL_PAGES_PER_RUN` env var caps a single run; on overrun, the run fails before stage 2 runs. The operator can override with `--max-pages N` per run. Estimated Firecrawl cost is logged to `manifest.json` using rates from `src/config/pricing.ts`. Pricing rates carry a 90-day validation stamp in a comment at the top of the pricing file; if the comment date is more than 90 days old, the CLI emits a warning at startup.

---

## 6. LLM Brief Pass

### 6.1 Provider and Models

v1 uses Anthropic only. Two models are supported:

- **`sonnet`** (default) — `claude-sonnet-4-6` or current Sonnet model string. Used for nearly all briefs.
- **`opus`** (override via `--model opus`) — `claude-opus-4-7` or current Opus model string. Used for high-stakes briefs where the operator wants the strongest synthesis.

The exact model string is held in `src/config/models.ts` and updated by the operator when Anthropic releases new versions. There is no automatic fallback between models; the CLI fails clearly if the configured model string is rejected by the API.

### 6.2 Prompt Composition

The brief stage builds a single Claude API call as follows:

- **System prompt** = the template body (post-substitution) + a fixed coda instructing the model to: (a) not invent facts not present in the raw content, (b) cite sources by URL inline, (c) flag gaps explicitly, (d) write in the configured tone (default: professional, concise, no marketing language).
- **User message** = `Original request: {{prompt}}\n\nRaw content:\n{{raw_content}}`

The coda is in `src/prompt-templates/_coda.md` and is appended to every template at runtime. Operators can edit the coda but should not delete it.

### 6.3 Output Contract

The model's response is written verbatim to `brief.md`. No post-processing, no JSON parsing, no schema enforcement. If the model refuses or returns an empty response, the stage fails with a Failure Report and the operator is told to inspect `raw/` and rerun.

---

## 7. PDF Rendering and Email Delivery

### 7.1 PDF Renderer

`brief.md` is converted to `brief.pdf` using a markdown-to-PDF library (recommended: `markdown-pdf` or `md-to-pdf`; final choice locked in BUILD_INSTRUCTIONS Step 5). The renderer uses a single CSS file (`src/pdf-styles/default.css`) that defines: A4 page size, 2.5cm margins, serif body (Georgia or equivalent), sans-serif headings (Inter or equivalent), the operator's brand colour as the accent (default `#0F4C81`), automatic page numbers, and a footer line with the run slug. No per-template stylesheets in v1.

### 7.2 Email Provider (Resend)

Resend is the only email provider in v1. The Resend API key lives in `RESEND_API_KEY`. The "from" address lives in `RESEND_FROM_EMAIL` (must be a verified Resend sender). The recipient is `delivery_email` from the client's profile. The email is a single transactional message — no list management, no tracking pixels.

### 7.3 Delivery Failure Behaviour

If the Resend send fails (network error, API rejection, invalid recipient), stage 4 fails with a Failure Report. The PDF remains in the run folder unchanged. The operator can rerun `--resume` to retry stage 4 only. The CLI never deletes a brief because delivery failed.

---

## 8. CLI Interface

### 8.1 Command Surface (v1)

The CLI exposes a single primary command:

```
npm run intel -- --prompt "<prompt>" --client <slug> [options]
```

Required flags:

- `--prompt` — the operator's instruction
- `--client` — client slug (must match a folder in `clients/`)

Optional flags:

- `--mode <agent|targeted>` (default: `agent`)
- `--urls <comma-separated>` (required if `--mode targeted`)
- `--template <name>` (default: client's `default_template`, falls back to `market-intelligence`)
- `--model <sonnet|opus>` (default: `sonnet`)
- `--name <short-name>` (default: derived from prompt)
- `--max-pages <N>` (override env cap)
- `--resume` (skip already-completed stages for an existing run)
- `--dry-run` (run stage 1 only, do not call LLM or send email)

Two utility commands:

- `npm run intel:list-clients` — print all client slugs
- `npm run intel:list-templates` — print all available template names

### 8.2 Argument Resolution

The CLI resolves arguments in this order: command-line flag → client profile default → environment variable → built-in default. Resolution is logged to stdout at run start so the operator can confirm the run shape before stages execute.

### 8.3 Output Behaviour

Every CLI invocation prints, in this order: a one-line run header (`> Run: client-slug / run-slug — mode: agent — template: market-intelligence`), a stage progress line per stage (`✓ Stage 1: Crawl — 12 sources, 8.2s, $0.34`), and a final summary line (`✓ Brief delivered to contact@acme.example. Manifest: runs/.../manifest.json`). On failure, the CLI prints a Failure Report identical in format to the BUILD_INSTRUCTIONS failure format.

---

## 9. Technical Architecture

### 9.1 System Components

```
┌──────────────────────────────────────────────────────────────────────┐
│                              CLI (cli.ts)                            │
│  parses flags → resolves client/template/model → invokes orchestrator│
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Orchestrator (orchestrator.ts)                   │
│  loads job, writes job.md, runs 4 stages, updates manifest.json      │
└───┬───────────────┬────────────────┬─────────────────┬───────────────┘
    │               │                │                 │
    ▼               ▼                ▼                 ▼
┌────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│ crawl  │    │  brief   │    │  render   │    │ deliver  │
│ stage  │    │  stage   │    │  stage    │    │  stage   │
└───┬────┘    └────┬─────┘    └─────┬─────┘    └─────┬────┘
    │              │                │                │
    ▼              ▼                ▼                ▼
┌────────────┐ ┌────────────┐  ┌──────────────┐ ┌────────────┐
│ Firecrawl  │ │ Anthropic  │  │ markdown-pdf │ │   Resend   │
│   client   │ │   client   │  │              │ │   client   │
└────────────┘ └────────────┘  └──────────────┘ └────────────┘
```

### 9.2 Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript (Node.js 20+) | Matches Firecrawl's primary SDK; clean async; strong types |
| CLI parsing | `commander` | Standard, well-documented, low ceremony |
| Schema validation | `zod` | Compile-time + runtime safety for Job and Manifest |
| Firecrawl SDK | `@mendable/firecrawl-js` | Official SDK |
| LLM SDK | `@anthropic-ai/sdk` | Official SDK |
| PDF rendering | `md-to-pdf` (or `markdown-pdf`) | Markdown-first, low-config; final pick in build step 5 |
| Email | `resend` (npm) | Official Resend SDK |
| YAML parsing | `js-yaml` | For client profile frontmatter |
| Config | `dotenv` | Standard |
| Persistence | Filesystem only | No DB in v1 |

### 9.3 Data Persistence Requirements

Persistence is filesystem only. All run artefacts and client profiles are committed to git. `runs/` is **not** gitignored — every run becomes part of the audit trail. The PDF binary commits alongside its markdown source. `node_modules/`, `dist/`, `.env`, and the contents of any folder named `.cache/` are gitignored.

A run folder, once created, is append-only. The CLI never deletes a run folder. Reruns with the same `--name` on the same date append a `-2`, `-3`, etc. suffix to the run slug.

### 9.4 Configuration via Environment

`.env.example` (committed, placeholder values only):

```
FIRECRAWL_API_KEY=fc-...
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=intel@yourdomain.com

MAX_FIRECRAWL_PAGES_PER_RUN=30
MAX_LLM_INPUT_TOKENS=100000
MAX_LLM_OUTPUT_TOKENS=8000

LLM_MODEL_SONNET=claude-sonnet-4-6
LLM_MODEL_OPUS=claude-opus-4-7
```

`.env` is gitignored. The CLI fails at startup with a clear error if any required key is missing.

---

## 10. MVP Scope vs Aspirational Features

### MVP (Build First — v1)

- [ ] CLI entrypoint with the flag surface defined in Section 8.1
- [ ] Job + Manifest schemas (zod)
- [ ] Firecrawl client wrapper supporting `agent` and `targeted` modes
- [ ] Anthropic LLM client wrapper supporting Sonnet and Opus
- [ ] Four-stage orchestrator with resumability
- [ ] Four starter brief templates (`market-intelligence`, `news-digest`, `research-brief`, `generic`)
- [ ] PDF renderer with single default stylesheet
- [ ] Resend email delivery
- [ ] Cost guardrails (env-var-driven hard caps, manifest cost log)
- [ ] One client folder seeded for `operator` and one for `real-estate-dev`
- [ ] End-to-end smoke test with a real prompt

### Post-MVP (v1.5)

- [ ] Scheduled runs via GitHub Actions cron driven by `clients/[slug]/watchlist.yaml`
- [ ] Diff-against-previous-run logic — the brief stage receives the previous run's brief as additional context and is asked to call out what changed
- [ ] Additional brief templates (legal-watch, regulatory-tracker, hiring-intel, supplier-watch — one added per real client request)
- [ ] Webhook delivery surface (Slack, Discord) alongside email
- [ ] `crawl` and `search` Firecrawl modes added to the CLI

### Post-MVP (v2)

- [ ] Per-client logins and a hosted dashboard (GitHub Pages, client-side JS reading the repo via the GitHub API — same pattern as capture-plugin)
- [ ] Multi-tenant billing
- [ ] Self-host Firecrawl as an option (with the AGPL implications addressed by a commercial Firecrawl licence or open-sourcing the orchestrator)

### Out of Scope (Permanently — or until reconsidered)

- Real-time scraping / live dashboards. Intel Orchestrator is batch-only by design.
- Forking Firecrawl. Even in v2, the choice is between hosted-Firecrawl-with-commercial-licence and AGPL-compliant self-host — never a closed-source fork.
- Building a competing scraper. Firecrawl owns that part of the stack.
- LLM provider pluggability beyond Anthropic. v2 may revisit; v1 is single-provider.
- A web UI for operators. The CLI is the interface. v2's hosted dashboard is for clients viewing briefs, not for operators triggering runs.

---

## 11. Drift Flags

Common failure modes the AI agent must actively resist during the build:

| # | Drift | What it looks like | Why it's wrong |
|---|-------|---------------------|----------------|
| 1 | Adding a database in v1 | Pulling in Postgres, SQLite, or any ORM | Constraint #2: repo is the source of truth |
| 2 | Skipping the PDF stage | Sending the markdown brief in the email body instead of as a PDF attachment | Stage 4 contract: PDF attached |
| 3 | Combining stages for "efficiency" | Doing crawl + brief in one streaming call | Constraint #4: every stage writes its artefact before the next runs |
| 4 | Inventing a fifth crawl mode | Adding `crawl` or `search` mode in v1 | Section 5.1: only `agent` and `targeted` in v1 |
| 5 | Hardcoding a single client | Removing the `client_slug` field "since there's only one client" | Constraint #5 + Principle #7: multi-tenant-ready from day 1 |
| 6 | Putting brief templates in TypeScript | Defining template strings in code | Constraint #6: templates are markdown files |
| 7 | Bypassing cost guardrails | Removing `MAX_*` env caps because "they're annoying for testing" | Section 2.7: guardrails prevent runaway billing |
| 8 | Modifying the ANCHOR | Editing this file because "the build revealed a better design" | Anchor immutability rule. If the design needs to change, that is a v2 conversation, not a build-time rewrite |
| 9 | Auto-resolving model string updates | Adding logic to "find the latest Sonnet" by querying Anthropic | Section 6.1: model string is operator-controlled |
| 10 | Adding tracking to emails | Resend tracking pixels, link rewriting, open tracking | Section 7.2: transactional, no tracking |

---

## Appendix A: Validation Checklist

Run this checklist after every build step. Every item must pass.

```
[ ] 1. REPO AS TRUTH: Is every persistent piece of state written to a committed file? If not → fix.
[ ] 2. STAGE ISOLATION: Can each stage be rerun independently with --resume? If not → fix.
[ ] 3. INCLUSION-BY-DEFAULT SCHEMA: Does every artefact carry a client_slug? If not → fix.
[ ] 4. COST TRANSPARENCY: Is API usage logged to manifest.json? If not → fix.
[ ] 5. OPERATOR-READABLE FAILURES: Does every failure path produce a Failure Report? If not → fix.
[ ] 6. TEMPLATE ADDITIVITY: Could a new template be added without touching .ts files? If not → fix.
[ ] 7. MULTI-TENANT-READY DATA MODEL: Could v2 add per-client logins without renaming any folder or field? If not → fix.
[ ] 8. OUTPUT MATCHES ANCHOR: Does the implementation contradict any section of this document? If yes → revert.
[ ] 9. NO FEATURE CREEP: Does the implementation add anything not specified in this document? If yes → remove.
[ ] 10. NO DRIFT FLAG TRIGGERED: Does the change match any item in Section 11? If yes → revert.
```

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| Operator | The person running the Intel Orchestrator CLI. In v1, the operator and the principal user are the same person. |
| Client | A person or organisation a brief is produced for. In v1, the operator is also the only "client" who receives the brief; in practice the operator forwards it to the real client. v2 introduces per-client logins. |
| Run | One end-to-end execution of the four-stage pipeline, producing one brief. |
| Run slug | `YYYY-MM-DD-[short-name]`, the folder name uniquely identifying a run within a client. |
| Client slug | The kebab-case identifier matching `clients/[slug]/`. |
| Template | A markdown file in `src/prompt-templates/` that becomes part of the system prompt for the brief stage. |
| Stage | One of the four pipeline phases: Crawl, Brief, Render, Deliver. |
| Manifest | The `manifest.json` file in a run folder recording stage status, costs, and delivery outcome. |
| Job | The immutable `job.md` file in a run folder recording the original prompt and run parameters. |
| Resume | Restarting a run, skipping any stage whose artefact already exists. |
| Brief | The synthesised intelligence document produced by stage 2 and rendered to PDF in stage 3. |
| Coda | The fixed instruction block appended to every brief template at runtime, defining tone and citation rules. |
| Drift | Behaviour that contradicts the anchor — the failure mode this document exists to prevent. |
