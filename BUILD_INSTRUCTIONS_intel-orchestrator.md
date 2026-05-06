# Intel Orchestrator — Build Instructions

## Agentic Build System — Routing Document

_This file controls how AI coding agents execute the build for Intel Orchestrator v1. It references `ANCHOR_intel-orchestrator.md` by section number. The AI agent reads this file first, then loads only the anchor sections specified for the current step._

**Scope note:** This build sequence covers v1 only — manual CLI invocation, single-operator, hosted Firecrawl API, four starter brief templates, email delivery via Resend. v1.5 (scheduling, diff-against-previous-run, more templates, webhook delivery) and v2 (per-client logins, dashboard, multi-tenancy) are out of scope for this build sequence and will have their own factory chats.

**Build method note:** This build is designed for agentic engineering via Claude Code as the primary implementation vehicle. Steps assume the operator is executing them through Claude Code with the new `intel-orchestrator` repo as the working directory. The operator does not need to write code — the operator pastes step prompts and reviews each Status Report.

---

## How This File Works

**Rules:**

1. Before executing any step, **read the specified ANCHOR sections from disk** — do not rely on memory or assumptions.
2. After completing each step, **run the Validation Checklist** (ANCHOR Appendix A).
3. **Never modify `ANCHOR_intel-orchestrator.md`** — it is the immutable design anchor.
4. After each successful step, **commit to the repo** with the message format: `step-XX: [description]`.
5. Before starting any step, **read ANCHOR Section 1 (Architecture Anchors)** — mandatory for every session.
6. **After every successful step, output a Status Report and Copy-Paste Prompt** (see format below).
7. **On step failure**, output a Failure Report and wait for operator input. Do not proceed.
8. **No file outside the repo is written to.** No global npm installs, no system-wide config changes.

### Status Report Format

```
═══════════════════════════════════════════════
STATUS REPORT
═══════════════════════════════════════════════
✅ COMPLETED: Step [N] — [Step Title]
📋 VERIFIED:  [Pass/Fail] — [Brief verification summary]
💾 COMMITTED: step-[NN]: [commit message]

➡️  NEXT STEP: Step [N+1] — [Next Step Title]
🤖 MODEL:     [Model name]
📖 ANCHOR SECTIONS TO READ: [Section numbers for next step]

⚠️  NOTE: [Any warnings, e.g. "Switch to Opus for the next session" or "None"]
═══════════════════════════════════════════════
```

### Copy-Paste Prompt (Same Model)

```
📋 COPY-PASTE TO CONTINUE IN THIS CHAT:
─────────────────────────────────────────
Continue with Step [N+1]. Read BUILD_INSTRUCTIONS_intel-orchestrator.md and ANCHOR_intel-orchestrator.md Sections [X + Y] from the repo. Execute Step [N+1]: [Step Title].
─────────────────────────────────────────
```

### Copy-Paste Prompt (Different Model)

```
📋 COPY-PASTE INTO A NEW [Model Name] SESSION:
─────────────────────────────────────────
Read BUILD_INSTRUCTIONS_intel-orchestrator.md and ANCHOR_intel-orchestrator.md Section 1 + Sections [X + Y] from the repo root. Execute Step [N+1]: [Step Title].
─────────────────────────────────────────
```

### Failure Report Format

```
═══════════════════════════════════════════════
⛔ STEP FAILURE REPORT
═══════════════════════════════════════════════
❌ FAILED:    Step [N] — [Step Title]
🔍 FAILURE:   [What went wrong]
🧪 VERIFIED:  Fail — [Which verification criteria failed]
💡 DIAGNOSIS: [Root cause analysis]
🔧 SUGGESTED FIX: [What to try]

🔄 RETRY PROMPT:
─────────────────────────────────────────
Re-read BUILD_INSTRUCTIONS_intel-orchestrator.md and ANCHOR_intel-orchestrator.md Sections [X + Y]. Retry Step [N]: [Step Title]. Previous attempt failed because: [one-line reason]. Fix: [one-line fix].
─────────────────────────────────────────
═══════════════════════════════════════════════
```

---

## Model Routing

| Steps | Model | Reason |
|-------|-------|--------|
| 1, 2, 3, 4, 5, 6, 8, 9, 10, 11 | **Sonnet** | Defined engineering tasks with clear specs in the anchor |
| 7 | **Opus** | Brief template authoring — requires nuance, voice, and cross-template consistency |

**Model Switch Protocol:** Step 7 requires switching to Opus. The Status Report after Step 6 will explicitly flag the switch. The operator opens a new Claude Code session with Opus selected and pastes the Copy-Paste Prompt.

---

## Build Sequence

### Step 1: Initialise the Repo
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 3.3 + Section 9
**Dependencies:** None (first step)
**Task:**
- At the repo root, create `package.json` with the project name `intel-orchestrator`, type `module`, and the npm scripts: `intel`, `intel:list-clients`, `intel:list-templates`, `build`, `typecheck`. Each script invokes `tsx src/cli.ts` with the appropriate sub-command (use `--` argument forwarding). Use `tsx` as the TypeScript runner.
- Install runtime dependencies: `commander`, `zod`, `@mendable/firecrawl-js`, `@anthropic-ai/sdk`, `resend`, `js-yaml`, `dotenv`, `md-to-pdf`. Install dev dependencies: `typescript`, `tsx`, `@types/node`, `@types/js-yaml`.
- Create `tsconfig.json` configured for Node.js 20+, ES2022 target, strict mode on, `moduleResolution: "bundler"`, `outDir: "./dist"`, `rootDir: "./src"`.
- Create the directory structure exactly as specified in ANCHOR Section 3.3, with `.gitkeep` files in `runs/`.
- Create `.gitignore` covering: `node_modules/`, `dist/`, `.env`, `.cache/`.
- Create `.env.example` containing exactly the keys listed in ANCHOR Section 9.4 with placeholder values (no real keys).
- Create a minimal `README.md` with: project name, one-line description, prerequisites (Node 20+, three API keys), `npm install` instruction, link to ANCHOR_intel-orchestrator.md.
- **Critical:** Do NOT create any TypeScript source files yet. This step is pure scaffolding.
- **Critical:** Do NOT add a database, ORM, or any persistence layer beyond the filesystem (drift flag #1).

**Verify:**
- `package.json` lists exactly the dependencies above
- All folders from ANCHOR Section 3.3 exist
- `runs/` contains `.gitkeep`
- `.env.example` is committed; `.env` would be gitignored
- `npm install` runs without error (operator confirms)
- No `src/*.ts` files yet

**Commit:** `step-01: initialise repo structure`

---

### Step 2: Define the Type System
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 3.4 + Section 8.1
**Dependencies:** Step 1
**Task:**
- Create `src/schemas/index.ts` defining zod schemas exactly matching ANCHOR Section 3.4: `JobSchema`, `ManifestSchema`, `StageRecordSchema`, `ClientProfileSchema`. Export TypeScript types inferred from each (`Job`, `Manifest`, `StageRecord`, `ClientProfile`).
- Define an enum-like literal union for `Mode` (`'agent' | 'targeted'`), `LLMModel` (`'sonnet' | 'opus'`), and `StageStatus` (`'pending' | 'running' | 'success' | 'failed'`).
- Add a helper `parseClientProfile(rawMarkdown: string): ClientProfile` that extracts the YAML frontmatter from a `profile.md` file and validates it against `ClientProfileSchema`. Use `js-yaml` for parsing.
- Add a helper `serializeManifest(manifest: Manifest): string` and `parseManifest(rawJson: string): Manifest`. These wrap `JSON.stringify`/`JSON.parse` with zod validation.
- Add JSDoc comments on every exported symbol explaining what it represents.

**Verify:**
- `npm run typecheck` passes with no errors
- Every schema field listed in ANCHOR Section 3.4 is present
- `parseClientProfile` rejects a profile with no `client_slug`
- `parseManifest` rejects malformed JSON

**Commit:** `step-02: type system and parsers`

---

### Step 3: Build the Firecrawl Client Wrapper
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 5
**Dependencies:** Step 2
**Task:**
- Create `src/clients/firecrawl-client.ts`. Export a class `FirecrawlClient` whose constructor takes `{ apiKey: string }` and instantiates the official `@mendable/firecrawl-js` SDK.
- Expose two methods, one per supported endpoint in ANCHOR Section 5.1:
  - `runAgent(prompt: string): Promise<{ result: string; sources: { url: string; content: string }[] }>` — calls `/v2/agent` and normalises the response so each source comes back with both URL and markdown content.
  - `runBatchScrape(urls: string[]): Promise<{ url: string; content: string }[]>` — calls the batch scrape endpoint, requesting `formats: ['markdown']`. Polls until complete (the SDK handles this).
- Both methods must throw a descriptive error including the URL and HTTP status if the API call fails.
- Add a `pageCount(result): number` static helper for cost tracking — returns the number of pages/sources retrieved by either method.
- **Critical:** Do NOT call any Firecrawl endpoint outside Section 5.1 — no `/scrape`, `/crawl`, `/map`, `/search`, or `/interact` (drift flag #4).

**Verify:**
- `npm run typecheck` passes
- The class exports exactly two public methods plus the static helper
- No imports from Firecrawl beyond what's used by these methods
- Errors carry actionable messages

**Commit:** `step-03: firecrawl client wrapper`

---

### Step 4: Build the LLM Client Wrapper
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 6
**Dependencies:** Step 2
**Task:**
- Create `src/config/models.ts` exporting an object mapping `'sonnet' → process.env.LLM_MODEL_SONNET` and `'opus' → process.env.LLM_MODEL_OPUS`, with sensible defaults (`claude-sonnet-4-6`, `claude-opus-4-7`) if the env vars are unset.
- Create `src/clients/llm-client.ts`. Export a class `LLMClient` whose constructor takes `{ apiKey: string }`.
- Expose one method: `generateBrief({ systemPrompt, userMessage, model, maxOutputTokens }): Promise<{ text: string; inputTokens: number; outputTokens: number }>`. Internally calls the Anthropic Messages API with the resolved model string from `models.ts`.
- The method must enforce the `MAX_LLM_INPUT_TOKENS` env cap by counting the input length before the call (rough estimate via character-count / 4) and throwing if exceeded.
- The method must also enforce `MAX_LLM_OUTPUT_TOKENS` via the API's `max_tokens` parameter.
- Errors include the model used and a one-line reason.
- **Critical:** Do NOT add automatic model fallback. If Sonnet fails, the call fails — no silent retry on Opus (drift flag #9).

**Verify:**
- `npm run typecheck` passes
- The method respects both token caps
- No fallback logic between models

**Commit:** `step-04: llm client wrapper`

---

### Step 5: Build the PDF Renderer
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 7.1
**Dependencies:** Step 1
**Task:**
- Create `src/pdf-styles/default.css` implementing the spec in ANCHOR Section 7.1: A4 page size, 2.5cm margins, Georgia (or system serif fallback) for body, Inter (or system sans-serif fallback) for headings, accent colour `#0F4C81`, automatic page numbers in the footer, run slug in the footer-left position. Also include sensible styling for code blocks, blockquotes, tables, and lists.
- Create `src/stages/render.ts` exporting a function `renderPdf({ markdownPath, outputPath, runSlug }): Promise<void>`. Internally uses `md-to-pdf` configured with the default stylesheet and substitutes the run slug into the footer template.
- The function must throw a descriptive error if the markdown file does not exist or the PDF write fails.
- **Critical:** Only `default.css` exists in v1. Do NOT create per-template stylesheets (drift flag-adjacent — out of scope).

**Verify:**
- Calling `renderPdf` on a small test markdown file produces a valid PDF in the expected location
- The PDF footer shows the run slug
- No per-template CSS files exist

**Commit:** `step-05: pdf renderer`

---

### Step 6: Build the Email Sender
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 7.2 + Section 7.3
**Dependencies:** Step 2
**Task:**
- Create `src/clients/resend-client.ts`. Export a class `ResendClient` whose constructor takes `{ apiKey: string; fromEmail: string }`.
- Expose one method: `sendBriefEmail({ to, runSlug, briefName, pdfPath }): Promise<{ messageId: string }>`. Internally:
  - Reads the PDF file as a buffer.
  - Calls the Resend API with subject `[Intel Brief] ${briefName} — ${date}` and a plain-text body acknowledging the brief and naming the run slug.
  - Attaches the PDF.
  - Returns the message ID on success.
- Throws a descriptive error if the recipient is invalid, the PDF cannot be read, or Resend returns an error.
- **Critical:** Do NOT add link tracking, open tracking, click rewriting, or list management (drift flag #10).

**Verify:**
- `npm run typecheck` passes
- The method attaches the PDF correctly (test with a sandbox Resend key if available; otherwise, mock and verify the request payload shape)
- No tracking parameters are added to the Resend payload

**Commit:** `step-06: resend email client`

---

### Step 7: Author the Four Starter Brief Templates
**Model:** Opus
**Read from ANCHOR:** Section 1 + Section 4
**Dependencies:** Steps 1–6
**Task:**
- Create `src/prompt-templates/_coda.md` containing the fixed coda described in ANCHOR Section 6.2: instructions to the model to (a) not invent facts not in the raw content, (b) cite sources by URL inline, (c) flag gaps explicitly, (d) write in a professional, concise tone with no marketing language. The coda is plain markdown — no frontmatter.
- Create the four starter templates listed in ANCHOR Section 4.2. Each template is a single markdown file with YAML frontmatter and a body. The frontmatter contains `name` (matching the filename without extension), `description`, and `default_for` (a free-form string describing the prompts this template suits).
- The body must use the placeholders defined in ANCHOR Section 4.1 (`{{client_name}}`, `{{prompt}}`, `{{raw_content}}`, `{{date}}`) where appropriate, and must instruct the model to produce the exact section structure specified in ANCHOR Section 4.2 for that template.
- Templates to author:
  - `market-intelligence.md` — sections: Executive Summary, Key Competitor Moves, Pricing/Positioning Shifts, Market Signals, Risks, Recommended Actions.
  - `news-digest.md` — sections: Top Stories (ranked, with link and 2-sentence summary), Themes, What's Notable vs What's Noise.
  - `research-brief.md` — sections: Question Framing, Key Findings (with citations), Supporting Evidence, Gaps and Open Questions, Suggested Follow-ups.
  - `generic.md` — sections: Summary, Findings, Sources.
- **Critical:** Templates are markdown only. Do NOT define them as TypeScript string constants (drift flag #6). Each template must be self-contained — readable by the operator without consulting the anchor.
- The voice across all four templates should be consistent: direct, structured, no filler. Each template should produce a brief that an executive can read in 5 minutes and act on.

**Verify:**
- All five files exist (four templates + `_coda.md`)
- Each template's frontmatter is valid YAML
- Each template instructs the model to produce the exact sections listed in ANCHOR Section 4.2
- Placeholders are used correctly
- No TypeScript references the template content

**Commit:** `step-07: brief templates and coda`

---

### Step 8: Build the Stage Modules and Orchestrator
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 2 + Section 3 + Section 6.2
**Dependencies:** Steps 2–7
**Task:**
- Create `src/stages/crawl.ts` exporting `runCrawlStage({ job, runDir, firecrawl }): Promise<{ pageCount: number }>`. Behaviour: dispatches on `job.mode` to call `firecrawl.runAgent(job.prompt)` or `firecrawl.runBatchScrape(job.urls)`, writes one numbered markdown file per source into `${runDir}/raw/` (filename pattern `001-domain-or-slug.md`, with the source URL as a frontmatter field), returns the page count for cost tracking.
- Create `src/stages/brief.ts` exporting `runBriefStage({ job, runDir, llm, clientProfile }): Promise<{ inputTokens: number; outputTokens: number }>`. Behaviour: reads every file in `raw/`, concatenates with `## Source: [URL]` headers, loads the chosen template file and `_coda.md`, substitutes placeholders (Section 4.1) using a small substitution function (no template engine), composes the system prompt and user message per Section 6.2, calls `llm.generateBrief`, writes the response to `${runDir}/brief.md`.
- Create `src/stages/render.ts` — already created in Step 5; verify the existing implementation matches the orchestrator's expected interface (`runRenderStage({ runDir, runSlug }): Promise<void>` calling the underlying `renderPdf`).
- Create `src/stages/deliver.ts` exporting `runDeliverStage({ runDir, clientProfile, runSlug, briefName, resend }): Promise<{ messageId: string }>`. Behaviour: sends the email via `resend.sendBriefEmail`, returns the message ID.
- Create `src/orchestrator.ts` exporting `runOrchestrator({ job, clientProfile, options }): Promise<Manifest>`. Behaviour:
  - Computes `runDir = runs/${job.client_slug}/${job.run_slug}/`.
  - If the directory exists and `options.resume === false`, throws (do not silently overwrite).
  - Creates the directory and writes `job.md` (markdown rendering of the Job) if not present.
  - Initialises or reads `manifest.json`.
  - Runs each stage in order, gating on the resumability predicates from ANCHOR Section 2.6 (file existence). Updates the manifest after each stage with timings, status, and any errors.
  - Writes manifest.json at the end. Returns the final manifest.
- **Critical:** Each stage writes its artefact before the next stage runs (Constraint #4). The orchestrator must not stream stages together (drift flag #3).
- **Critical:** Manifest updates are atomic — write to a temp file, then rename — so a crash mid-write doesn't corrupt the manifest.

**Verify:**
- `npm run typecheck` passes
- Each stage module is independently importable
- The orchestrator respects `options.resume` and stage predicates
- Manifest writes are atomic
- A failed stage halts the pipeline and records the failure in manifest.json

**Commit:** `step-08: stage modules and orchestrator`

---

### Step 9: Build the CLI Entrypoint
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 8 + Section 9.4 + Section 11
**Dependencies:** Step 8
**Task:**
- Create `src/cli.ts` using `commander`. Implement the command surface defined in ANCHOR Section 8.1:
  - Default command: parses all flags, validates them, resolves arguments per Section 8.2, builds a `Job`, loads the relevant `ClientProfile`, instantiates the three clients (Firecrawl, LLM, Resend), invokes `runOrchestrator`, prints the output per Section 8.3.
  - `intel:list-clients` — reads `clients/` and prints each subfolder's slug and display name from its `profile.md`.
  - `intel:list-templates` — reads `src/prompt-templates/` and prints each template's name and description from frontmatter.
- On startup, validate that all required env vars (Section 9.4) are set; fail with a clear error listing missing vars if not.
- On startup, check the `pricing.ts` validation stamp; warn if older than 90 days.
- The `--dry-run` flag must execute Stage 1 only and skip stages 2–4.
- Resolution order for `--template`: CLI flag → client profile `default_template` → `market-intelligence` (per Section 8.2).
- All resolved arguments are printed at run start before stages execute.
- **Critical:** The CLI is the only entrypoint (Constraint #8). Do NOT add a web server, daemon, or any other invocation path.

**Verify:**
- `npm run intel -- --help` lists all flags from Section 8.1
- `npm run intel:list-clients` and `npm run intel:list-templates` work
- Missing env vars produce a clear error
- `--dry-run` stops after stage 1
- The Status/Failure Report formats match the formats defined in this BUILD_INSTRUCTIONS file

**Commit:** `step-09: cli entrypoint`

---

### Step 10: Seed Initial Client Profiles and Pricing Config
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 3.2 + Section 5.3
**Dependencies:** Step 9
**Task:**
- Create `clients/operator/profile.md` with frontmatter: `client_slug: operator`, `display_name: Operator`, `delivery_email: [PLACEHOLDER — operator fills in their own email]`, `default_template: market-intelligence`, `notes: "Self-runs and tests."`.
- Create `clients/operator/watchlist.yaml` as an empty file with a single comment: `# v1.5: scheduled runs config goes here.`
- Create `clients/real-estate-dev/profile.md` with frontmatter: `client_slug: real-estate-dev`, `display_name: [PLACEHOLDER — operator fills in real client name]`, `delivery_email: [PLACEHOLDER]`, `default_template: market-intelligence`, `notes: "First test client."`. The placeholder text must be unambiguous so the operator knows what to replace.
- Create `clients/real-estate-dev/watchlist.yaml` — same empty-with-comment as above.
- Create `src/config/pricing.ts` with current Firecrawl and Anthropic rates as constants. Include a `// Validated: 2026-05-06` comment at the top of the file. Used by the cost calculator. Document each rate with a comment linking to the source.
- The cost calculator function lives here too: `estimateCostUsd({ firecrawlPages, llmInputTokens, llmOutputTokens, model }): number`.

**Verify:**
- Both client folders exist and parse via `parseClientProfile`
- Placeholder fields are clearly marked so the operator cannot mistake them for finalised values
- `pricing.ts` carries a validation stamp
- `estimateCostUsd` returns plausible numbers for known inputs

**Commit:** `step-10: client seeds and pricing config`

---

### Step 11: End-to-End Smoke Test
**Model:** Sonnet
**Read from ANCHOR:** Section 1 + Section 2 + Section 8
**Dependencies:** Steps 1–10
**Task:**
- This step is operator-driven: the AI agent prepares the test, the operator runs it, the AI agent diagnoses any failure.
- Prepare a smoke-test prompt file: create `tests/smoke/prompt.txt` containing a real, low-stakes prompt — recommended: `"Find the top 3 commercial real estate news stories from the past week in the UK."`.
- Print the exact command the operator should run, with the operator's actual email substituted into the operator profile first:

```
npm run intel -- \
  --prompt "$(cat tests/smoke/prompt.txt)" \
  --client operator \
  --template news-digest \
  --name smoke-test
```

- Print a checklist of what the operator should observe:
  - Resolved arguments are printed before stages run.
  - Stage 1 logs source count and elapsed time.
  - Stage 2 logs token counts and elapsed time.
  - Stage 3 produces `runs/operator/[date]-smoke-test/brief.pdf`.
  - Stage 4 sends an email to the operator's address with the PDF attached.
  - `manifest.json` records all four stages as `success` with non-zero costs.
- If any stage fails, the AI agent reads the Failure Report and the run's `manifest.json` and proposes a single fix. The operator applies the fix and reruns with `--resume`.
- Once all four stages succeed, commit the smoke-test artefacts (prompt file, the resulting run folder) to the repo as part of the audit trail.
- **Critical:** Do NOT mock the APIs. The smoke test exists specifically to verify real API connectivity.

**Verify:**
- The smoke run produces all four artefacts: `job.md`, `raw/*.md`, `brief.md`, `brief.pdf`.
- The operator confirms email receipt.
- `manifest.json` shows `delivery.status: "sent"` and a non-empty `messageId`.
- Total cost in manifest is plausible (rough check: under $1 for a small run).

**Commit:** `step-11: smoke test passing`

---

## Post-MVP Steps (Do Not Execute Until v1 Is Validated)

These steps are deliberately excluded from the v1 build sequence. Each maps to ANCHOR Section 10 and will be executed in a separate factory chat with its own ANCHOR addendum.

- **Step v1.5-A:** Watchlist scheduling via GitHub Actions cron (ANCHOR Section 10, v1.5 list)
- **Step v1.5-B:** Diff-against-previous-run for the brief stage
- **Step v1.5-C:** Additional brief templates (legal-watch, regulatory-tracker, hiring-intel, supplier-watch)
- **Step v1.5-D:** Webhook delivery surface (Slack, Discord)
- **Step v1.5-E:** Adding `crawl` and `search` Firecrawl modes to the CLI
- **Step v2-A:** Per-client logins and hosted dashboard (ANCHOR Section 10, v2 list)
- **Step v2-B:** Multi-tenant billing
- **Step v2-C:** Self-host Firecrawl evaluation (commercial licence vs AGPL-compliant open-sourcing)

---

## Operator Quick Reference

### First Session (Seeding the Repo)

After creating a new empty GitHub repo named `intel-orchestrator` and cloning it locally, paste these two files into the repo root, then run:

```
Save ANCHOR_intel-orchestrator.md to the repo root.
Save BUILD_INSTRUCTIONS_intel-orchestrator.md to the repo root.
Then read BUILD_INSTRUCTIONS_intel-orchestrator.md and execute Step 1.
```

### Continuing a Build (Same Model)

Use the copy-paste prompt from the previous Status Report.

### Continuing a Build (Different Model — Step 7 only)

Open a new Claude Code session with Opus selected. Paste the copy-paste prompt from the Status Report after Step 6.

### Resuming After a Break

```
Read BUILD_INSTRUCTIONS_intel-orchestrator.md from the repo root. Identify the last completed step from the git log (look for step-XX commit messages). Then execute the next step.
```

### Recovering From a Failed Step

Use the retry prompt from the Failure Report.

### After v1 Is Built

The operator's day-to-day flow is just the CLI:

```
npm run intel -- --prompt "..." --client real-estate-dev --template market-intelligence
```

Subsequent runs commit themselves to `runs/`. The repo is the audit trail.
