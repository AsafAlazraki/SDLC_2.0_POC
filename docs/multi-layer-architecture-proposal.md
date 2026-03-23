# SDLC Discovery Engine — Multi-Layer Persistent Memory Architecture

> **Status:** Proposed | **Date:** 2026-03-23 | **Author:** PDX Engineering

---

## Problem Statement

Every analysis run currently starts from zero. Agents have no knowledge of:

- **PDX's methodology** — standards, playbooks, or preferred patterns
- **Previous findings** — what was flagged last time on the same repository
- **Client context** — budget, timeline, strategic goals, or stakeholder priorities

The result is generic, stateless analysis. This proposal introduces a 5-layer persistent memory architecture that transforms agents from one-shot tools into institutionally-aware reasoning systems.

---

## Architecture Overview

Agent prompts are assembled at runtime from 5 distinct layers, each building on the one below.

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
│   ║   Status: ✅ BUILT (PDX overlay is NEW)                         ║  │
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

## Before & After: What Each Agent Receives

**Today — stateless:**
```
System prompt → Research mandate → Filtered codebase slice → "Go."
```

**After this upgrade — context-rich:**
```
PDX institutional knowledge (semantic retrieval, domain-matched)
  → Previous findings for this repo ("still unresolved: no rate limiting")
    → Project context (budget: $150K, timeline: 12 months, goal: cloud migration)
      → System prompt + PDX role overlay ("our BAs always use INVEST + Gherkin")
        → Research mandate (Gemini search / Claude deep expertise)
          → Recon pre-pass (verified tech stack baseline)
            → Persona-filtered codebase slice → "Go."
```

Agents now know PDX's standards, the client's constraints, and what was found last time — before they read a single line of code.

---

## Layer-by-Layer Detail

### Layer 0 — Institutional Memory (PDX Knowledge Base)

**What it stores:**
- PDX methodology docs and SDLC playbooks
- Past project retrospectives and lessons learned
- Industry pattern libraries curated by PDX
- Preferred vendor and tool assessments

**Technology:** pgvector extension in Supabase (available as a native extension)

**New DB table:**
```sql
CREATE TABLE knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding VECTOR(1536),       -- Gemini text-embedding-004 (1536 dims)
    source_doc TEXT,              -- "pdx-ba-playbook.pdf", "client-retro-2025-q4"
    domain TEXT,                  -- "security", "architecture", "ba", "all"
    chunk_index INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops);
```

**Ingestion pipeline:**
- `POST /api/knowledge` — accepts text or PDF body, domain tag, source name
- Backend: chunk into 1,000-char overlapping segments → embed via Gemini text-embedding-004 → store
- PDX team uploads retrospective docs, playbooks, and case studies via admin UI

**Retrieval:**
- At run start: embed each agent's `persona_key + domain description` → cosine similarity query → top 5 chunks
- Rendered as `## PDX Knowledge Base\n[retrieved chunks]` block
- ~2–3K chars per agent (negligible cost, high signal)

---

### Layer 1 — Episodic Memory (Cross-Run Learning)

**What it stores:** Previous analysis findings for the same repository

**Source:** Existing `reports` table. Requires one new column:
```sql
ALTER TABLE reports ADD COLUMN repo_fingerprint TEXT; -- normalised github_url
```

**Retrieval:** On new analysis of `github.com/org/repo`:
- Fetch last 2 completed reports for same fingerprint
- Extract synthesis content and key findings per agent
- Render as a `## Repository History` block injected into all agent prompts

**Example injection:**
```
## Repository History
Last analysed: 2026-01-15. Key unresolved findings:
- Security: JWT tokens not rotated (flagged 2 runs ago)
- DevOps: No CI/CD pipeline (persistent finding)
Confirm if resolved or still present.
```

**Delta tracking — new `report_deltas` table:**
```sql
CREATE TABLE report_deltas (
    id BIGSERIAL PRIMARY KEY,
    repo_fingerprint TEXT,
    from_report_id BIGINT,
    to_report_id BIGINT,
    delta_summary TEXT,     -- generated by synthesis
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Layer 2 — Project Context (Per-Engagement)

**New `projects` table:**
```sql
CREATE TABLE projects (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT REFERENCES clients(id),
    name TEXT NOT NULL,
    strategic_goals TEXT,
    budget_range TEXT,           -- "<$75K", "$75K-$250K", "$250K+"
    timeline TEXT,               -- "6 months", "12 months", "18-24 months"
    key_risks TEXT,
    stakeholders TEXT,
    commercial_constraints TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Frontend:** Pre-analysis brief form shown before "Analyse Repo". Fields:
- Project name, strategic goals (textarea)
- Budget range (dropdown: Conservative / Balanced / Transformative — maps directly to the 3 strategic paths)
- Timeline, key risks, stakeholder priorities, commercial constraints

**Example injection into all 18 agents + synthesis:**
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

### Layer 3 — Role Identity (Enhancement to Existing)

**Current state:** `PERSONA_CONFIGS` hardcoded in `agent_engine.py`

**Enhancement:** Add a `pdx_overlay` field per persona — PDX-specific guidance that sits above the generic role prompt. Stored in the existing `personas` DB table and retrieved at runtime.

**Example overlay for BA:**
```
PDX BA standard: all stories use INVEST criteria. Acceptance criteria always in
Gherkin (Given/When/Then). We never write stories without a measurable success
metric. Reference PDX BA Playbook v3.
```

---

### Layer 4 — Working Memory (Already Built)

No changes. This is the existing codebase ingestion + recon pre-pass + persona-filtered context slice pipeline.

---

## The Opus 4.6 Synthesis Upgrade

The single highest-impact change. Currently the synthesis agent (The Verdict) reads 18 agent summaries and reasons from those alone — it never sees the actual codebase.

With Opus 4.6's 1M context window, synthesis receives everything:

| Component | Tokens |
|-----------|--------|
| Layer 0 — PDX Knowledge Base chunks | ~6K |
| Layer 1 — Previous analysis runs | ~10K |
| Layer 2 — Project context brief | ~1K |
| Layer 3 — Synthesis identity prompt | ~2K |
| All 18 agent reports | ~54K |
| Full unfiltered codebase | ~200K |
| **Total** | **~273K (27% of 1M budget)** |

**What this unlocks:**

- **Verify agent claims against source code** — "The security agent flagged JWT issues, and I can confirm: `auth.py` line 47 uses HS256 with a hardcoded secret"
- **Catch things all 18 agents missed** — synthesis sees the full picture, not filtered slices
- **Track regression** — "This vulnerability was flagged in January and remains unfixed"
- **Tailor to budget** — "Given the $150K budget and 12-month timeline, PATH B is the only viable option"

**Model routing:**
```python
SYNTHESIS_MODEL = "claude-opus-4-6"           # 1M context, highest reasoning
PERSONA_MODEL_ANTHROPIC = "claude-sonnet-4-6"  # Agents stay on Sonnet (cost control)
```

---

## Implementation Plan

### Phase 1 — Project Context Layer
**Effort:** 6–8 hrs (AI-assisted) | **Priority:** Highest ROI, simplest to build

| Task | Hours |
|------|-------|
| Supabase `projects` table + FastAPI endpoints | 2 |
| Pre-analysis brief form (frontend) | 2–3 |
| Prompt injection into `run_agent_fleet()` | 1–2 |
| End-to-end testing + prompt output verification | 1 |

### Phase 2 — Episodic Memory
**Effort:** 8–10 hrs (AI-assisted) | **Priority:** High ROI, builds on Phase 1

| Task | Hours |
|------|-------|
| Repo fingerprinting + last-N query + retrieval | 3 |
| Format previous findings as context block | 2 |
| `report_deltas` table + delta generation | 2–3 |
| Frontend: history diff view | 1–2 |

### Phase 3 — PDX Knowledge Base
**Effort:** 12–16 hrs (AI-assisted) | **Priority:** Most complex, highest long-term value

| Task | Hours |
|------|-------|
| Enable pgvector, create `knowledge_chunks` table + IVFFlat index | 1–2 |
| Ingestion pipeline (chunk → embed → store) | 3–4 |
| Semantic retrieval per agent domain | 2–3 |
| Admin UI: upload, browse, delete knowledge docs | 3–4 |
| Auto-extract hook: chunk synthesis findings into KB post-analysis | 2–3 |

### Phase 4 — Opus 4.6 Synthesis Upgrade
**Effort:** 4–6 hrs (AI-assisted) | **Priority:** Quick win, dramatic quality improvement

| Task | Hours |
|------|-------|
| Switch synthesis model, assemble all 5 layers into single prompt | 2 |
| Update synthesis prompt for source code verification + evidence-based claims | 1–2 |
| Token count verification + cost validation + output quality check | 1–2 |

### Recommended Build Order

```
Week 1, Days 1–2:  Phase 1 — Project Context        [highest ROI, simplest]
Week 1, Days 3–5:  Phase 2 — Episodic Memory         [high ROI, builds on Phase 1]
Week 2, Days 1–4:  Phase 3 — PDX Knowledge Base      [most complex, highest long-term value]
Week 2, Day 5:     Phase 4 — Opus 4.6 Synthesis      [quick win, dramatic quality boost]
─────────────────────────────────────────────────────────────────────────────────
TOTAL:             ~30–40 hrs AI-assisted development (~1 focused week)
```

> All estimates assume AI-assisted development (Claude Code / Cursor / Copilot). Pure manual development would be approximately 3× these figures.

---

## Files to Modify

| File | Changes |
|------|---------|
| `agent_engine.py` | Layer 0 retrieval, Layer 1 episodic injection, Layer 2 project context injection, synthesis model upgrade, full codebase passed to synthesis |
| `database.py` | New tables: `projects`, `knowledge_chunks`, `report_deltas`. New functions: `save_project`, `get_project`, `get_knowledge_chunks_for_domain`, `get_previous_reports_for_repo` |
| `main.py` | New endpoints: `GET/POST /api/projects`, `GET/POST /api/knowledge`, `GET /api/reports/{id}/diff` |
| `static/index.html` | Pre-analysis brief form, Knowledge Base admin tab |
| `static/script.js` | Brief form state, project context submission, KB admin UI |
| `requirements.txt` | No new dependencies (pgvector via Supabase REST, embeddings via existing Gemini client) |

---

## Cost Impact Per Analysis Run

| Component | Current | New | Notes |
|-----------|---------|-----|-------|
| 18 parallel agents (Sonnet 4.6) | ~$2–4 | ~$2–4 | Unchanged — agents stay on Sonnet |
| Synthesis (Sonnet → Opus 4.6) | ~$0.50–1 | ~$3–8 | Opus pricing + full codebase context |
| Knowledge base retrieval | — | ~$0.01 | Embedding query is negligible |
| Episodic memory retrieval | — | ~$0.00 | DB query only, no AI cost |
| **Total per run** | **~$2–5** | **~$5–13** | Still trivial vs. consultant day rate |

---

## Long-Term Strategic Value

1. **Institutional learning** — PDX gets smarter with every engagement. Patterns discovered in Project A automatically inform analysis of Project B.

2. **Regression tracking** — "We flagged this 3 months ago. It's still not fixed. Severity: escalated."

3. **Client-aware recommendations** — Agents stop recommending $500K transformations to clients with $75K budgets.

4. **Evidence-based synthesis** — The Verdict stops being "18 opinions summarised" and becomes "18 opinions verified against source code."

5. **Competitive moat** — No other tool has layered institutional memory. This is the difference between a generic AI scanner and a PDX-powered discovery practice.

---

## New DB Schema Summary

```sql
-- Layer 0: Institutional Memory
CREATE TABLE knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding VECTOR(1536),
    source_doc TEXT,
    domain TEXT,
    chunk_index INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops);

-- Layer 1: Episodic Memory (additive to existing reports table)
ALTER TABLE reports ADD COLUMN repo_fingerprint TEXT;

CREATE TABLE report_deltas (
    id BIGSERIAL PRIMARY KEY,
    repo_fingerprint TEXT,
    from_report_id BIGINT,
    to_report_id BIGINT,
    delta_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Layer 2: Project Context
CREATE TABLE projects (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT REFERENCES clients(id),
    name TEXT NOT NULL,
    strategic_goals TEXT,
    budget_range TEXT,
    timeline TEXT,
    key_risks TEXT,
    stakeholders TEXT,
    commercial_constraints TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

*SDLC Discovery Engine — PDX Engineering | https://claude.ai/code/session_01UAXouhEGComH7nBzkNgviF*
