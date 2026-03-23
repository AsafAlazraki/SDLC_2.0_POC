# SDLC Discovery Engine — v2 Architecture: Persistent Memory & Live Integrations

> **Status:** Proposed | **Date:** 2026-03-23 | **Author:** PDX Engineering

---

## Problem Statement

Every analysis run currently starts from zero. Agents have no knowledge of PDX's methodology, no memory of what was flagged last time on the same repository, and no awareness of the client's strategic context, budget, or stakeholder priorities. Beyond the codebase itself, there is a wealth of client intelligence already sitting in tools the team uses every day — Google Drive, Gmail, Slack, HubSpot — none of which reaches the agents.

This proposal introduces a 5-layer persistent memory architecture combined with live integrations into the tools where real project knowledge lives.

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
│   ║   + Live pull from Google Drive, Gmail, Slack, HubSpot          ║  │
│   ║   ┌──────────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌────────────┐  ║  │
│   ║   │Strategic │ │Budget  │ │Drive │ │Slack   │ │HubSpot     │  ║  │
│   ║   │Goals     │ │Range   │ │Docs  │ │Thread  │ │Deal Notes  │  ║  │
│   ║   └──────────┘ └────────┘ └──────┘ └────────┘ └────────────┘  ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 1 — EPISODIC MEMORY (cross-run)                 ║  │
│   ║                                                                   ║  │
│   ║   Previous analysis findings for the same repository            ║  │
│   ║   ┌─────────────────────────────────────────────────────────┐   ║  │
│   ║   │  "Last analysed: 2026-01-15"                            │   ║  │
│   ║   │  "Unresolved: JWT tokens not rotated (2 runs ago)"      │   ║  │
│   ║   │  "Unresolved: No CI/CD pipeline (persistent finding)"   │   ║  │
│   ║   │  "Resolved: XSS in /api/search (fixed in last run)"    │   ║  │
│   ║   │  Delta tracking between runs → what improved/regressed  │   ║  │
│   ║   └─────────────────────────────────────────────────────────┘   ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 0 — INSTITUTIONAL MEMORY (PDX Knowledge Base)   ║  │
│   ║                                                                   ║  │
│   ║   Methodology, lessons learned, retros, case studies, patterns  ║  │
│   ║   + Auto-ingested from Google Drive (PDX shared folders)        ║  │
│   ║   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   ║  │
│   ║   │  Upload /    │     │  Chunk &     │     │  pgvector    │   ║  │
│   ║   │  Drive Sync  │────▶│  Embed       │────▶│  Storage     │   ║  │
│   ║   │  (PDF/Docs/  │     │  (Gemini     │     │  (Supabase)  │   ║  │
│   ║   │   Slides)    │     │   Embeddings)│     │              │   ║  │
│   ║   └──────────────┘     └──────────────┘     └──────────────┘   ║  │
│   ║          │                    Semantic Retrieval                 ║  │
│   ║          └──────────▶  Top-K chunks per agent domain            ║  │
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

The foundation of the entire stack. This is PDX's collective intelligence — methodology docs, SDLC playbooks, past project retrospectives, lessons learned, industry pattern libraries, and preferred vendor assessments — stored as vector embeddings and retrieved semantically at the start of every run.

At run time, each agent's domain is embedded and matched against the knowledge base. The top 5 most relevant chunks are injected into that agent's prompt before it reads a single line of code. A security agent gets PDX's past security findings and CVE patterns; the BA agent gets story templates and INVEST criteria reminders; the architect gets past migration case studies.

**Google Drive as the primary ingestion source.** Rather than requiring manual uploads, the knowledge base syncs directly from a designated PDX Google Drive folder. New documents — Slides decks, Docs, PDFs — added to the folder are automatically chunked, embedded, and indexed overnight. PDX's institutional knowledge grows passively as the team documents their work.

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

**This layer is also where live integrations feed in.** Rather than filling the brief manually, PDX can connect the tool to the systems where client context already exists.

---

### Layer 3 — Role Identity (PDX Overlay)

Each of the 18 agent personas gains a PDX-specific overlay — a short block of PDX's own standards and preferences that sits above the generic role prompt. This means agents don't just behave like a generic BA or Security Engineer; they behave like a PDX BA or a PDX Security Engineer.

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

## Live Integration Layer

Beyond the 5-layer memory stack, the most powerful upgrade is connecting the engine to the tools where client intelligence already lives. Rather than agents reasoning from the codebase alone, they can be briefed with real project history before analysis begins.

### Google Workspace (Drive, Docs, Gmail)

Google Drive is the natural home for PDX's Layer 0 knowledge base. A designated `PDX / SDLC Engine / Knowledge Base` shared Drive folder is monitored for new content. When a new doc, deck, or PDF is added, it is automatically chunked, embedded via Gemini, and indexed in Supabase pgvector. PDX's institutional memory grows without any manual curation step.

For client engagements, a per-client Drive folder can be linked at brief time. The engine reads the folder — discovery call notes, existing architecture docs, previous vendor assessments, contracts, scope documents — and surfaces the most relevant content into Layer 2 as project context. Agents arrive at the codebase already familiar with what the client said they care about.

Gmail integration surfaces the most recent email threads related to the engagement — particularly useful for picking up on concerns raised in email that never made it into a brief document. Key phrases from stakeholder emails ("we can't migrate the payment module before Q3" or "the board is worried about GDPR compliance") become first-class context that shapes every agent's recommendations.

### Slack

Slack is where the real project conversation happens. Connecting the engine to a designated client Slack channel (or a PDX internal channel) means agents can be briefed on the last 30 days of conversation before analysis.

Practically this means: concerns raised in a stand-up ("the auth service keeps falling over on Fridays"), decisions made in a thread ("we agreed to drop the mobile app scope"), and blockers mentioned in passing ("procurement won't approve AWS until the security audit is done") all flow into the project context layer. The security agent will know about the auth service problem before it reads the code. The cost analyst will know procurement is blocked before recommending a cloud migration.

A post-analysis Slack integration completes the loop: when synthesis finishes, The Verdict summary is automatically posted to the channel, tagged to relevant engineers.

### Email (General / Outlook)

For clients not on Google Workspace, direct IMAP/SMTP or Microsoft Graph API integration achieves the same result. Relevant email threads are parsed and summarised into the project context layer. The engine can also send analysis summaries directly to stakeholder inboxes at completion — no need for the client to log into the tool.

### HubSpot

HubSpot is where PDX's commercial relationship with the client lives — deal stage, contact history, previous engagement notes, proposal values, and any notes from sales or account management calls. This is high-signal context for the analysis.

A HubSpot-connected brief automatically pulls:
- **Deal notes** — what was promised in the sales process, client pain points articulated by the account team
- **Contact roles** — who the economic buyer is vs. the technical decision-maker vs. the day-to-day contact
- **Previous engagements** — if PDX has worked with this client before, historical deal notes surface as context
- **Opportunity value** — a $2M deal gets different depth of analysis than a $50K discovery

The compliance and cost agents in particular benefit from HubSpot data: knowing the commercial constraints going in produces far more grounded recommendations.

HubSpot also becomes an output target. When analysis completes, a summary note can be pushed back to the deal record — keeping the CRM current without manual data entry.

---

## What Each Agent Actually Receives

Every agent in the fleet — before reading the codebase — receives a structured briefing assembled from all connected sources:

```
[PDX Knowledge Base] Semantically matched methodology chunks + past project patterns
[Repository History] Previous findings, deltas, unresolved items for this repo
[Project Context]    Client brief + Drive docs + Gmail threads + Slack summary + HubSpot notes
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
| 5 | Google Workspace Integration (Drive sync + Gmail + Docs) | 10–14 hrs |
| 6 | Slack Integration (channel reader + post-analysis push) | 6–8 hrs |
| 7 | HubSpot Integration (deal context pull + note push) | 8–10 hrs |
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

1. **Institutional learning** — PDX gets smarter with every engagement. Patterns from Project A automatically inform Project B. The knowledge base compounds.

2. **Regression tracking** — "We flagged this 3 months ago. It's still not fixed. Severity: escalated." Clients can't pretend findings were addressed.

3. **Client-aware recommendations** — Agents can't recommend $500K transformations to a client with a $75K budget and a Q3 deadline when that context is baked in from the start.

4. **Evidence-based synthesis** — The Verdict stops being "18 opinions summarised" and becomes "18 opinions verified against source code, client history, and PDX precedent."

5. **Whole-client intelligence** — Analysis is no longer bounded by what's in the codebase. It reflects everything PDX knows about the client from every system they use.

6. **Competitive moat** — No other tool has layered institutional memory, live workspace integrations, and an 18-agent specialist fleet. This is the difference between a generic AI scanner and a PDX-powered discovery practice.

---

*SDLC Discovery Engine — PDX Engineering | https://claude.ai/code/session_01UAXouhEGComH7nBzkNgviF*
