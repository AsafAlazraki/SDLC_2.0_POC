# SDLC Discovery Engine — v2 Architecture: Persistent Memory & Live Integrations

> **Status:** Proposed | **Date:** 2026-03-23 | **Author:** PDX Engineering

---

## Problem Statement

Every analysis run currently starts from zero. Agents have no knowledge of PDX's methodology, no memory of what was flagged last time on the same repository, and no awareness of the client's strategic context, budget, or stakeholder priorities. Beyond the codebase itself, there is a wealth of institutional knowledge already sitting in tools the team uses every day — Google Drive, Gmail, Slack, HubSpot — none of which currently reaches the agents.

This proposal introduces a 5-layer persistent memory architecture where Layer 0 — the PDX Knowledge Base — is fed continuously from all of those sources, making it the living brain of the entire system.

---

## Architecture Overview

Agent prompts are assembled at runtime from 5 distinct layers, each building on the one below. Every agent in the 18-strong fleet — and the Opus 4.6 Synthesis agent — receives the full stack before analysing a single line of code.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   ╔═══════════════════════════════════════════════════════════════════╗  │
│   ║           LAYER 4 — WORKING MEMORY (per-run)                    ║  │
│   ║                                                                   ║  │
│   ║   GitHub codebase (persona-filtered) + Recon pre-pass JSON      ║  │
│   ║   ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐     ║  │
│   ║   │ Codebase    │  │ Recon JSON   │  │ Persona-Filtered  │     ║  │
│   ║   │ Ingestion   │──│ (Gemini      │──│ Context           │     ║  │
│   ║   │ (GitHub API)│  │  Flash)      │  │ (priority scoring)│     ║  │
│   ║   └─────────────┘  └──────────────┘  └───────────────────┘     ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 3 — ROLE IDENTITY (per-agent)                   ║  │
│   ║                                                                   ║  │
│   ║   PERSONA_CONFIGS + Research Mandate + PDX Role Overlay         ║  │
│   ║   ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐     ║  │
│   ║   │ System      │  │ Research     │  │ PDX Overlay       │     ║  │
│   ║   │ Prompt      │──│ Mandate      │──│ (per-role style   │     ║  │
│   ║   │ (18 agents) │  │ (Gemini/     │  │  guide from DB)   │     ║  │
│   ║   │             │  │  Claude)     │  │                   │     ║  │
│   ║   └─────────────┘  └──────────────┘  └───────────────────┘     ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 2 — PROJECT CONTEXT (per-engagement)            ║  │
│   ║                                                                   ║  │
│   ║   Client brief, goals, budget, timeline, risks, stakeholders    ║  │
│   ║   ┌──────────┐  ┌────────┐  ┌──────────┐  ┌────────────────┐  ║  │
│   ║   │Strategic │  │Budget  │  │Timeline  │  │Stakeholder     │  ║  │
│   ║   │Goals     │  │Range   │  │          │  │Priorities      │  ║  │
│   ║   └──────────┘  └────────┘  └──────────┘  └────────────────┘  ║  │
│   ║   Injected into ALL 18 agents + synthesis before analysis       ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 1 — EPISODIC MEMORY (cross-run)                 ║  │
│   ║                                                                   ║  │
│   ║   Previous analysis findings for the same repository            ║  │
│   ║   ┌─────────────────────────────────────────────────────────┐   ║  │
│   ║   │  "Last analysed: 2026-01-15"                            │   ║  │
│   ║   │  "Unresolved: JWT tokens not rotated (2 runs ago)"      │   ║  │
│   ║   │  "Unresolved: No CI/CD pipeline (persistent finding)"   │   ║  │
│   ║   │  "Resolved: XSS in /api/search (confirmed fixed)"       │   ║  │
│   ║   │  Delta tracking between runs → what improved/regressed  │   ║  │
│   ║   └─────────────────────────────────────────────────────────┘   ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║     LAYER 0 — INSTITUTIONAL MEMORY (PDX Knowledge Base)        ║  │
│   ║                                                                   ║  │
│   ║   The living brain. Fed continuously from all connected sources  ║  │
│   ║                                                                   ║  │
│   ║  ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐  ║  │
│   ║  │ Google   │ │ Gmail  │ │ Slack  │ │HubSpot  │ │ Manual   │  ║  │
│   ║  │ Drive    │ │Threads │ │Channel │ │Deal     │ │ Upload   │  ║  │
│   ║  │(Docs/    │ │        │ │History │ │Notes    │ │(PDF/text)│  ║  │
│   ║  │ Slides/  │ │        │ │        │ │         │ │          │  ║  │
│   ║  │ PDFs)    │ │        │ │        │ │         │ │          │  ║  │
│   ║  └────┬─────┘ └───┬────┘ └───┬────┘ └────┬────┘ └────┬─────┘  ║  │
│   ║       │           │          │           │           │         ║  │
│   ║       └───────────┴──────────┴───────────┴───────────┘         ║  │
│   ║                              │                                  ║  │
│   ║                   ┌──────────▼──────────┐                       ║  │
│   ║                   │   Chunk & Embed     │                       ║  │
│   ║                   │  (Gemini Embeddings)│                       ║  │
│   ║                   └──────────┬──────────┘                       ║  │
│   ║                              │                                  ║  │
│   ║                   ┌──────────▼──────────┐                       ║  │
│   ║                   │  pgvector Storage   │                       ║  │
│   ║                   │    (Supabase)       │                       ║  │
│   ║                   └──────────┬──────────┘                       ║  │
│   ║                              │                                  ║  │
│   ║                   Semantic Retrieval at run time                ║  │
│   ║                   Top-K chunks per agent domain                 ║  │
│   ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              SYNTHESIS — Claude Opus 4.6 (1M Context)           │   │
│   │                                                                   │   │
│   │   ┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ │   │
│   │   │Layer 0  │ │Layer 1 │ │ Layer 2  │ │18 Agent│ │ FULL     │ │   │
│   │   │PDX KB   │ │Prev.   │ │ Project  │ │Reports │ │ Codebase │ │   │
│   │   │~6K tok  │ │Runs    │ │ Context  │ │~54K tok│ │~200K tok │ │   │
│   │   │         │ │~10K tok│ │ ~1K tok  │ │        │ │(unfiltr.)│ │   │
│   │   └─────────┘ └────────┘ └──────────┘ └────────┘ └──────────┘ │   │
│   │                       ~271K tokens total                        │   │
│   │                   (well within 1M context limit)                │   │
│   │                                                                   │   │
│   │              Extended Thinking (16K budget)                     │   │
│   │                            ▼                                    │   │
│   │                    The Verdict                                   │   │
│   │              (evidence-based, source-verified)                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer-by-Layer Detail

### Layer 0 — Institutional Memory (PDX Knowledge Base)

The foundation of the entire stack and the most important layer to get right. This is PDX's collective intelligence — stored as vector embeddings in Supabase pgvector and retrieved semantically at the start of every run.

At run time, each agent's domain is embedded and matched against the knowledge base. The top 5 most relevant chunks are injected into that agent's prompt before it reads a single line of code. A security agent gets PDX's past security findings and CVE patterns; the BA agent gets story templates and INVEST criteria; the architect gets past migration case studies and lessons learned.

**What makes this layer powerful is not manual uploads — it's continuous ingestion from the tools the team already uses.**

#### Google Workspace (Drive, Docs, Gmail)

Google Drive is the primary ingestion source for PDX's institutional knowledge. A designated `PDX / SDLC Engine / Knowledge Base` shared Drive folder is monitored for new content. When any document — a Slides deck, a Doc, a PDF — is added or updated, it is automatically chunked, embedded via Gemini, and indexed. PDX's institutional memory grows passively as the team documents their work. No separate upload step, no manual curation.

Client-specific Drive folders can also be connected. The engine reads discovery call notes, existing architecture docs, previous vendor assessments, scope documents, and contracts from the client's own folder — and indexes them tagged to that client. When agents run for that client's repository, they are semantically matched against that client's prior documents as well as PDX's general methodology.

Gmail integration feeds email threads directly into the knowledge base. Concerns raised by stakeholders in email — "we can't migrate the payment module before Q3", "the board is worried about GDPR" — become retrievable context. An agent analysing security for that client will surface those concerns without anyone needing to paste them into a brief.

#### Slack

Slack is where the live project conversation happens. Connecting to a designated project or client channel means the last 30–60 days of conversation is indexed into the knowledge base. Decisions made in threads, blockers mentioned in passing, concerns raised in stand-ups — all of it becomes retrievable.

Practically: the security agent will know the auth service has been falling over on Fridays before it reads the code. The cost analyst will know procurement has blocked AWS approval before recommending a cloud migration. The context that lives in Slack is often the most current and honest signal about what's actually going wrong.

A post-analysis Slack integration completes the loop: when synthesis finishes, The Verdict summary is automatically posted to the channel, tagged to relevant engineers. The discovery report goes to the people who need it, where they already work.

#### HubSpot

HubSpot holds PDX's commercial relationship with every client — deal stage, contact history, previous engagement notes, proposal values, and account management call notes. This is high-signal institutional context, particularly for the cost analyst, compliance agent, and synthesis.

The engine pulls deal notes (what was promised, what the client articulated as pain), contact roles (who the economic buyer is vs. the technical decision-maker), previous engagement history (if PDX has worked with this client before), and opportunity value (a $2M deal warrants different analytical depth than a $50K discovery).

When analysis completes, a summary note is pushed back to the deal record — keeping the CRM current without manual data entry from the PDX team.

#### Manual Upload

For content that doesn't live in any of the above — regulatory documents, bespoke frameworks, one-off retros — a manual upload path is available in the admin UI. Any text or PDF can be tagged by domain and source and ingested directly.

---

### Layer 1 — Episodic Memory (Cross-Run Learning)

Every analysis run is persisted. When the same repository is analysed again, agents are briefed on what was found before — specifically what was flagged, what was resolved, and what remains outstanding. Delta tracking records what improved or regressed between runs.

Example injection into every agent prompt:
```
## Repository History
Last analysed: 2026-01-15. Key unresolved findings:
- Security: JWT tokens not rotated (flagged 2 runs ago — escalating)
- DevOps: No CI/CD pipeline (persistent across 3 runs)
Resolved since last run:
- XSS vulnerability in /api/search (confirmed fixed)
Confirm current status of unresolved items.
```

Agents are no longer reporting blindly. They're auditing against a known baseline.

---

### Layer 2 — Project Context (Per-Engagement)

Every engagement has a strategic context that changes what good advice looks like. A $75K budget with a 6-month timeline requires completely different recommendations than a $500K budget with an 18-month mandate. This layer captures that context in a pre-analysis brief and injects it into all 18 agents and synthesis before the fleet launches.

Fields: project name, strategic goals, budget range (mapped to PATH A/B/C), timeline, key risks, stakeholder priorities, commercial constraints.

Example injection:
```
## Project Context (PDX Engagement Brief)
- Client: Acme Corp (Financial Services, 500 staff)
- Strategic Goal: Migrate legacy PHP monolith to cloud-native by Q4 2026
- Budget: $75K–$250K (PATH B range)
- Timeline: 12 months
- Key Risks: Regulatory approval, team upskilling, data migration
- Stakeholders: CTO (sponsor), VP Eng (delivery owner), Compliance (blocker)
```

---

### Layer 3 — Role Identity (PDX Overlay)

Each of the 18 agent personas gains a PDX-specific overlay — a short block of PDX's own standards and preferences that sits above the generic role prompt. Agents don't behave like a generic BA or Security Engineer; they behave like a PDX BA or a PDX Security Engineer.

Example overlay for the BA persona:
```
PDX BA standard: all stories use INVEST criteria. Acceptance criteria always
in Gherkin (Given/When/Then). We never write stories without a measurable
success metric. Reference PDX BA Playbook v3.
```

---

### Layer 4 — Working Memory (Per-Run Codebase)

The existing codebase ingestion pipeline: GitHub API ingestion, Gemini Flash reconnaissance pre-pass, and persona-aware context filtering. No changes to this layer.

---

## The Opus 4.6 Synthesis Upgrade

The single highest-impact change in this architecture. Currently, The Verdict reads 18 agent summaries and reasons from those alone — it never sees the actual codebase.

With Claude Opus 4.6's 1M context window, synthesis receives everything simultaneously:

| Component | Approx. Tokens |
|-----------|---------------|
| PDX Knowledge Base chunks (Layer 0) | ~6K |
| Previous analysis runs (Layer 1) | ~10K |
| Project context brief (Layer 2) | ~1K |
| Synthesis identity prompt (Layer 3) | ~2K |
| All 18 agent reports | ~54K |
| Full unfiltered codebase | ~200K |
| **Total** | **~273K (27% of 1M budget)** |

What this unlocks:

- **Source code verification** — "The security agent flagged JWT issues, confirmed: `auth.py` line 47 uses HS256 with a hardcoded secret"
- **Blind spot detection** — synthesis sees the complete picture, not persona-filtered slices
- **Regression tracking** — "This vulnerability was flagged in January and remains unfixed across 3 runs"
- **Budget-aware recommendations** — "Given the $150K budget and 12-month timeline, PATH B is the only viable option — PATH C recommendations from the architect are out of scope"

The 18 parallel agents remain on Claude Sonnet 4.6 for cost control. Only synthesis is upgraded to Opus.

---

## What Each Agent Actually Receives

Every agent in the fleet — before reading the codebase — receives a structured briefing assembled from all connected sources:

```
[PDX Knowledge Base] Semantically matched methodology chunks, past project patterns,
                     Drive docs, Gmail context, Slack history, HubSpot notes — all
                     indexed in one vector store, retrieved by domain relevance
[Repository History] Previous findings, deltas, unresolved items for this repo
[Project Context]    Client brief: budget, timeline, goals, risks, stakeholders
[Role Identity]      Agent system prompt + PDX role overlay (our standards, our style)
[Research Mandate]   Gemini: live search grounding / Claude: deep expertise references
[Recon Pre-pass]     Verified tech stack baseline (language, framework, architecture)
[Codebase Slice]     Persona-filtered, relevance-scored codebase extract
```

The difference is not incremental. An agent briefed this way doesn't start with a blank slate — it starts with institutional knowledge, client history, previous findings, and strategic constraints already loaded. Analysis goes straight to depth.

---

## Build Effort (AI-Assisted Development)

| Phase | Deliverable | Est. Hours |
|-------|-------------|-----------|
| 1 | Project Context Layer (DB + brief form + prompt injection) | 6–8 hrs |
| 2 | Episodic Memory (cross-run fingerprinting + delta tracking) | 8–10 hrs |
| 3 | PDX Knowledge Base (pgvector + embeddings + admin UI) | 12–16 hrs |
| 4 | Opus 4.6 Synthesis Upgrade (model swap + full codebase) | 4–6 hrs |
| 5 | Google Workspace Integration (Drive sync + Gmail ingestion) | 10–14 hrs |
| 6 | Slack Integration (channel indexing + post-analysis push) | 6–8 hrs |
| 7 | HubSpot Integration (deal context ingestion + note push) | 8–10 hrs |
| **Total** | **Full v2 Architecture** | **54–72 hrs (~2 weeks)** |

> All estimates assume AI-assisted development (Claude Code / Cursor / Copilot). Pure manual development is approximately 3× these figures.

---

## Per-Run API Cost

| Component | Cost | Notes |
|-----------|------|-------|
| 18 parallel agents (Sonnet 4.6) | ~$2–4 | Unchanged |
| Synthesis (Opus 4.6 + full codebase) | ~$3–8 | Significant upgrade in quality |
| Knowledge base retrieval (embeddings) | ~$0.01 | Negligible |
| Integration pulls (Drive, Slack, HubSpot) | ~$0.00 | API calls only, no AI cost |
| **Total per run** | **~$5–12** | Trivial vs. consultant day rate |

---

## Long-Term Strategic Value

1. **Institutional learning** — PDX gets smarter with every engagement. Patterns from Project A automatically inform Project B. The knowledge base compounds with every doc, email, and Slack message.

2. **Regression tracking** — "We flagged this 3 months ago. It's still not fixed. Severity: escalated." Clients can't pretend findings were addressed.

3. **Client-aware recommendations** — Agents can't recommend $500K transformations to a client with a $75K budget and a Q3 deadline when that context is baked in from the start.

4. **Evidence-based synthesis** — The Verdict stops being "18 opinions summarised" and becomes "18 opinions verified against source code, client history, and PDX precedent."

5. **Whole-organisation intelligence** — Analysis is no longer bounded by what's in the codebase. It reflects everything PDX knows about the client across every system they use.

6. **Competitive moat** — No other tool has layered institutional memory fed from live workspace integrations, backed by an 18-agent specialist fleet. This is the difference between a generic AI scanner and a PDX-powered discovery practice.

---

*SDLC Discovery Engine — PDX Engineering | https://claude.ai/code/session_01UAXouhEGComH7nBzkNgviF*
