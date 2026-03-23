Subject: SDLC Discovery Engine — Multi-Layer Persistent Memory Architecture Proposal

Hi team,

Following our review of the current SDLC Discovery Engine architecture, I've designed a multi-layer persistent memory system that fundamentally changes how our AI agents operate — from stateless, one-shot analysis to context-rich, institutionally-aware reasoning.

The core problem today: every analysis run starts from zero. Agents don't know PDX's methodology, don't remember what they found last time on the same repo, and don't understand the client's strategic context. This proposal fixes all of that.

---

## Architecture Overview

The new system organises agent context into 5 distinct layers, each building on the one below. Every agent prompt is assembled from all layers at runtime.

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
│   ║   Status: ✅ BUILT                                               ║  │
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
│   ║   Status: ✅ BUILT (overlay is NEW)                              ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 2 — PROJECT CONTEXT (per-engagement)            ║  │
│   ║                                                                   ║  │
│   ║   Client brief, goals, budget, timeline, risks, stakeholders    ║  │
│   ║   ┌─────────────────────────────────────────────────────────┐   ║  │
│   ║   │  Pre-Analysis Brief Form                                │   ║  │
│   ║   │  ┌──────────┐ ┌────────┐ ┌──────┐ ┌────────────────┐  │   ║  │
│   ║   │  │Strategic │ │Budget  │ │Time- │ │ Stakeholder    │  │   ║  │
│   ║   │  │Goals     │ │Range   │ │line  │ │ Priorities     │  │   ║  │
│   ║   │  └──────────┘ └────────┘ └──────┘ └────────────────┘  │   ║  │
│   ║   │  Injected into ALL 18 agents + synthesis                │   ║  │
│   ║   └─────────────────────────────────────────────────────────┘   ║  │
│   ║   Status: 🆕 NEW                                                ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 1 — EPISODIC MEMORY (cross-run)                 ║  │
│   ║                                                                   ║  │
│   ║   Previous analysis findings for the same repository            ║  │
│   ║   ┌─────────────────────────────────────────────────────────┐   ║  │
│   ║   │  "Last analysed: 2026-01-15"                            │   ║  │
│   ║   │  "Unresolved: JWT tokens not rotated (2 runs ago)"      │   ║  │
│   ║   │  "Unresolved: No CI/CD pipeline (persistent finding)"   │   ║  │
│   ║   │  "Resolved: XSS in /api/search (fixed in last run)"    │   ║  │
│   ║   │                                                         │   ║  │
│   ║   │  Delta tracking between runs → what improved/regressed  │   ║  │
│   ║   └─────────────────────────────────────────────────────────┘   ║  │
│   ║   Status: 🆕 NEW                                                ║  │
│   ╠═══════════════════════════════════════════════════════════════════╣  │
│   ║           LAYER 0 — INSTITUTIONAL MEMORY (PDX Knowledge Base)   ║  │
│   ║                                                                   ║  │
│   ║   Methodology, lessons learned, retros, case studies, patterns  ║  │
│   ║   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   ║  │
│   ║   │  Upload      │     │  Chunk &     │     │  pgvector    │   ║  │
│   ║   │  (PDF/text/  │────▶│  Embed       │────▶│  Storage     │   ║  │
│   ║   │   Git repo)  │     │  (Gemini     │     │  (Supabase)  │   ║  │
│   ║   │              │     │   Embeddings)│     │              │   ║  │
│   ║   └──────────────┘     └──────────────┘     └──────────────┘   ║  │
│   ║          │                                         │            ║  │
│   ║          │         Semantic Retrieval               │            ║  │
│   ║          │    ┌──────────────────────────┐          │            ║  │
│   ║          └───▶│  Top-K chunks per agent  │◀─────────┘            ║  │
│   ║               │  domain (cosine sim.)    │                      ║  │
│   ║               └──────────────────────────┘                      ║  │
│   ║   Status: 🆕 NEW                                                ║  │
│   ╚═══════════════════════════════════════════════════════════════════╝  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              SYNTHESIS — Claude Opus 4.6 (1M Context)           │   │
│   │                                                                   │   │
│   │   Receives ALL layers simultaneously:                           │   │
│   │                                                                   │   │
│   │   ┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ │   │
│   │   │Layer 0  │ │Layer 1 │ │ Layer 2  │ │18 Agent│ │ FULL     │ │   │
│   │   │PDX KB   │ │Prev.   │ │ Project  │ │Reports │ │ Codebase │ │   │
│   │   │~6K tok  │ │Runs    │ │ Context  │ │~54K tok│ │~200K tok │ │   │
│   │   │         │ │~10K tok│ │ ~1K tok  │ │        │ │(unfiltr.)│ │   │
│   │   └────┬────┘ └───┬────┘ └────┬─────┘ └───┬────┘ └────┬─────┘ │   │
│   │        │           │           │           │           │        │   │
│   │        └───────────┴───────────┴───────────┴───────────┘        │   │
│   │                            │                                    │   │
│   │                   ~271K tokens total                            │   │
│   │                   (well within 1M limit)                        │   │
│   │                            │                                    │   │
│   │                   ┌────────▼────────┐                           │   │
│   │                   │  Extended       │                           │   │
│   │                   │  Thinking       │                           │   │
│   │                   │  (16K budget)   │                           │   │
│   │                   └────────┬────────┘                           │   │
│   │                            │                                    │   │
│   │                   ┌────────▼────────┐                           │   │
│   │                   │  The Verdict    │                           │   │
│   │                   │  (evidence-     │                           │   │
│   │                   │   based,        │                           │   │
│   │                   │   verified)     │                           │   │
│   │                   └─────────────────┘                           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## What Changes for Each Agent

Today, every agent gets:
```
System prompt → Research mandate → Filtered codebase slice → "Go."
```

After this upgrade, every agent gets:
```
PDX institutional knowledge (semantic retrieval, domain-matched)
  → Previous findings for this repo ("still unresolved: no rate limiting")
    → Project context (budget: $150K, timeline: 12 months, goal: cloud migration)
      → System prompt + PDX role overlay ("our BAs always use INVEST + Gherkin")
        → Research mandate (Gemini search / Claude deep expertise)
          → Recon pre-pass (verified tech stack baseline)
            → Persona-filtered codebase slice → "Go."
```

The difference is night and day. Agents now know PDX's standards, the client's constraints, and what was found last time — before they read a single line of code.

---

## The Opus 4.6 Synthesis Upgrade

The single highest-impact change. Currently, the synthesis agent (The Verdict) reads 18 agent summaries and reasons about them. It never sees the actual codebase.

With Opus 4.6's 1M context window, synthesis receives:
- All 18 agent reports (~54K tokens)
- The FULL unfiltered codebase (~200K tokens for most repos)
- PDX knowledge base chunks (~6K tokens)
- Previous analysis runs (~10K tokens)
- Project context (~1K tokens)

**Total: ~271K tokens — 27% of the 1M budget, with massive headroom.**

This means The Verdict can now:
- **Verify agent claims against actual source code** — "The security agent flagged JWT issues, and I can confirm: auth.py line 47 uses HS256 with a hardcoded secret"
- **Catch things all 18 agents missed** — it sees the full picture, not filtered slices
- **Track regression** — "This vulnerability was flagged in the January run and remains unfixed"
- **Tailor recommendations to budget** — "Given the $150K budget and 12-month timeline, PATH B is the only viable option"

---

## Effort Estimate (AI-Assisted Development)

All estimates assume AI-assisted development (Claude Code / Cursor / Copilot). Pure manual development would be roughly 3× these figures.

| Phase | Deliverable | AI-Assisted Hours | Key Work |
|-------|------------|-------------------|----------|
| **Phase 1** | **Project Context Layer** | **6–8 hrs** | New `projects` table, API endpoints, pre-analysis brief form, prompt injection into all 18 agents |
| | — Backend (DB + API) | 2 hrs | Supabase table, FastAPI endpoints, validation |
| | — Frontend (brief form) | 2–3 hrs | Collapsible form UI, state management, localStorage draft saving |
| | — Prompt injection pipeline | 1–2 hrs | Modify `run_agent_fleet()` to inject project context block |
| | — Testing & polish | 1 hr | End-to-end verification, prompt output inspection |
| **Phase 2** | **Episodic Memory** | **8–10 hrs** | Cross-run repo fingerprinting, previous findings retrieval, delta tracking |
| | — Backend (fingerprint + retrieval) | 3 hrs | Normalised URL fingerprinting, last-N query, delta generation |
| | — Prompt injection | 2 hrs | Format previous findings as agent context block, conditional injection |
| | — Delta tracking & storage | 2–3 hrs | `report_deltas` table, synthesis-generated delta summaries |
| | — Frontend (history diff view) | 1–2 hrs | Side-by-side or inline diff display for repeat analyses |
| **Phase 3** | **PDX Knowledge Base** | **12–16 hrs** | pgvector setup, embedding pipeline, semantic retrieval, admin UI |
| | — pgvector + schema setup | 1–2 hrs | Enable extension, create `knowledge_chunks` table, IVFFlat index |
| | — Ingestion pipeline (chunk + embed) | 3–4 hrs | Text chunking (1K overlap), Gemini embedding API integration, batch insert |
| | — Semantic retrieval per agent | 2–3 hrs | Domain-aware query embedding, top-K cosine similarity, result formatting |
| | — Admin UI (upload + browse + delete) | 3–4 hrs | Knowledge Base tab, file upload, source document listing, chunk preview |
| | — Auto-extract from syntheses | 2–3 hrs | Post-analysis hook to chunk synthesis findings into KB automatically |
| **Phase 4** | **Opus 4.6 Synthesis Upgrade** | **4–6 hrs** | Model swap, full codebase injection, enhanced prompt, extended thinking budget increase |
| | — Model routing + context assembly | 2 hrs | Switch synthesis to Opus 4.6, assemble all 5 layers into single prompt |
| | — Enhanced synthesis prompt | 1–2 hrs | New instructions for source code verification, evidence-based claims |
| | — Testing + cost validation | 1–2 hrs | Verify token counts, check output quality, confirm Opus pricing |
| | | | |
| **TOTAL** | **Full 5-Layer Architecture** | **30–40 hrs** | ~1 week of focused AI-assisted development |

### Recommended Build Order

```
Week 1 (Days 1-2):  Phase 1 — Project Context        [highest ROI, simplest]
Week 1 (Days 3-5):  Phase 2 — Episodic Memory         [high ROI, builds on Phase 1]
Week 2 (Days 1-4):  Phase 3 — PDX Knowledge Base      [most complex, highest long-term value]
Week 2 (Day 5):     Phase 4 — Opus 4.6 Synthesis      [quick win, dramatic quality improvement]
```

---

## Cost Impact Per Analysis Run

| Component | Current Cost | New Cost | Notes |
|-----------|-------------|----------|-------|
| 18 parallel agents (Sonnet 4.6) | ~$2–4 | ~$2–4 | Unchanged — agents stay on Sonnet |
| Synthesis (currently Sonnet) | ~$0.50–1 | ~$3–8 | Opus 4.6 + full codebase context |
| Knowledge base retrieval | — | ~$0.01 | Embedding query is negligible |
| Episodic memory retrieval | — | ~$0.00 | DB query, no AI cost |
| **Total per run** | **~$2–5** | **~$5–13** | Still trivial vs. consultant day rate |

---

## What This Enables Long-Term

1. **Institutional learning** — PDX gets smarter with every engagement. Patterns discovered in Project A automatically inform analysis of Project B.

2. **Regression tracking** — "We flagged this 3 months ago. It's still not fixed. Severity: escalated."

3. **Client-aware recommendations** — Agents don't recommend $500K transformations to a client with a $75K budget.

4. **Evidence-based synthesis** — The Verdict stops being "18 opinions summarised" and becomes "18 opinions verified against source code."

5. **Competitive moat** — No other tool has layered institutional memory. This is the difference between a generic AI scanner and a PDX-powered discovery practice.

---

Let me know if you'd like to discuss any layer in more detail or if you're ready to greenlight Phase 1.

Best,
[Your name]
