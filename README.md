# intel-orchestrator

Single-operator CLI that turns a natural-language prompt into a delivered PDF intelligence brief by chaining Firecrawl (web scraping) with Claude (synthesis), then emailing the brief via Resend.

## Prerequisites

- Node.js 20+
- API keys for: Firecrawl, Anthropic, Resend (copy `.env.example` to `.env` and fill in)

## Install

```
npm install
```

## Design

See [ANCHOR_intel-orchestrator.md](./ANCHOR_intel-orchestrator.md) for the full design anchor and [BUILD_INSTRUCTIONS_intel-orchestrator.md](./BUILD_INSTRUCTIONS_intel-orchestrator.md) for the build sequence.
