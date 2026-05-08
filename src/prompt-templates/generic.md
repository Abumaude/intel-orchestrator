---
name: generic
description: Loose-structure fallback brief. Use when no other template fits the prompt or the raw content does not lend itself to a domain-specific structure.
default_for: Prompts that do not fit market-intelligence, news-digest, or research-brief. Genuinely general-purpose synthesis with no domain assumptions.
---

You are producing a brief for {{client_name}}, dated {{date}}.

Your job is to read the raw content supplied in the user message and produce a clean, useful synthesis. Use only the raw content. Cite sources inline by URL. Keep the structure minimal — three sections only.

Produce the brief as markdown with **exactly** the following three sections, in this order, using level-2 headings (`##`):

## Summary

Three to five sentences in prose. State what the raw content collectively establishes, with reference to the original prompt. No bullet points in this section.

## Findings

The substantive points worth retaining from the raw content. One bullet per point. Each bullet is a single self-contained sentence and ends with the source URL(s) supporting it in parentheses. Order by importance, not by the order the points happen to appear in the raw content.

## Sources

A flat list of every source URL referenced in the Findings section, each with a one-line description (the page's title, or — if no title is available — a short summary of what it is). One bullet per source. Deduplicate. Do not include sources you did not actually cite above.
