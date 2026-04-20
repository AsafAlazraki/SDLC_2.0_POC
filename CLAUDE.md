# SDLC Discovery Engine — AI Handover Document

> **For any AI agent picking this up**: Read this fully before making any changes. This file is kept up-to-date with every edit session and contains the definitive source of truth for the project's architecture, state, and intentions.

---

## Project Purpose

This is an **AI-powered SDLC Discovery Engine**. It takes a public GitHub repository URL and dispatches a fleet of 15 specialised AI personas to analyse the codebase from every professional angle simultaneously (architecture, security, QA, cost, performance, UX, compliance, etc.). After the fleet completes, a 16th **Synthesis Agent ("The Verdict")** reads all reports, resolves contradictions, and produces a unified CTO-level master action plan.

The output is a structured, multi-section discovery report that a development team or CTO can use to plan a modernisation programme.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| AI — Strategy/Synthesis | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) with Extended Thinking |
| AI — Research/Grounded | Google Gemini 2.0 Flash (`gemini-2.0-flash`) with live Google Search grounding |
| Database | Supabase (PostgreSQL) |
| Streaming | SSE (Server-Sent Events) via `sse-starlette` |
| Frontend | Vanilla JS, HTML, CSS (no framework), Mermaid.js v10 |
| Repo Ingestion | GitHub REST API (public repos, no auth required) |

---

## File Structure

```
SDLC_2.0_POC/
├── CLAUDE.md              ← This file. Always update after sessions.
├── .env                   ← API keys (never commit real keys)
├── main.py                ← FastAPI app, all API routes
├── agent_engine.py        ← Persona definitions, agent runner, synthesis, recon
├── database.py            ← Supabase client, all DB functions
├── requirements.txt       ← Python dependencies
├── static/
│   ├── index.html         ← Single-page app shell (includes full How It Works page)
│   ├── script.js          ← All frontend JS (vanilla, module type)
│   ├── avatars.js         ← SVG avatar generator for all 19 agents (ES module)
│   └── styles.css         ← CSS with glassmorphism design system + hiw-* classes
└── test_*.py              ← Various test files (not production)
```

---

## Environment Variables (`.env`)

```dotenv
GEMINI_API_KEY=your_gemini_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here   # Required for Claude agents + synthesis
GITHUB_TOKEN=your_github_token_here          # Required for GitHub Issues export feature
```

**Key management pattern:**
- Gemini key: env var with UI override (user can paste in sidebar, stored in localStorage)
- Anthropic key: **env var ONLY** — moved to backend for security, never sent to frontend
- GitHub token: **env var ONLY** — never exposed to frontend

---

## Supabase Database Schema

### Required Tables (must exist in Supabase dashboard)

```sql
-- Clients table
CREATE TABLE clients (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Personas table (DB-stored custom personas, separate from hardcoded fleet)
CREATE TABLE personas (
    id BIGSERIAL PRIMARY KEY,
    role_name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    output_schema TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reports table (for analysis history persistence)
CREATE TABLE reports (
    id BIGSERIAL PRIMARY KEY,
    github_url TEXT NOT NULL,
    client_id BIGINT REFERENCES clients(id),
    analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    results JSONB NOT NULL,
    synthesis_content TEXT
);
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Serves `index.html` |
| GET | `/api/config` | Returns `{has_env_key, has_anthropic_env_key, has_github_token}` |
| GET | `/api/clients` | List all clients |
| POST | `/api/clients` | Create a client `{name, description}` |
| GET | `/api/personas` | Seed + return DB personas |
| POST | `/api/personas` | Create a custom DB persona `{role_name, system_prompt}` |
| GET | `/api/personas/config` | Return full PERSONA_CONFIGS (for modal display) |
| POST | `/api/analyze-repo` | Main analysis: SSE stream of agent results |
| POST | `/api/analyze-topic` | Topic-mode analysis: SSE stream (topic + URLs + optional repo) |
| POST | `/api/analyze` | Legacy text/file analysis (non-streaming) |
| POST | `/api/chat` | Q&A with individual agent `{persona_key, question, agent_report}` |
| POST | `/api/create-github-issues` | Export BA backlog to GitHub Issues `{github_url, stories:[]}` |
| GET | `/api/reports` | List past analysis runs |
| GET | `/api/reports/{id}` | Get a specific saved report |
| POST | `/api/fleet-answer/{session_id}` | Phase 6: Submit user answers during confidence Q&A pause |
| POST | `/api/fleet-skip/{session_id}` | Phase 6: Skip Q&A and proceed with fleet |
| POST | `/api/approve-specialists-v2` | Phase 7B: Create approved specialist agents `{proposals, approved_keys, project_id}` |
| GET | `/api/projects/{id}/documents` | Phase 7A: List all living documents for a project |
| GET | `/api/projects/{id}/documents/{doc_kind}` | Phase 7A: Get a specific living document |
| GET | `/api/projects/{id}/memory` | Phase 7A: Debug endpoint — episodic memory summary |
| GET | `/api/projects/{id}/custom-agents` | Phase 7B: List spawned specialist agents |
| GET | `/api/borrowable-agents` | Phase 7B: List all custom agents across projects (for borrowing) |
| GET | `/api/projects/{id}/runs` | List runs for a project |
| GET | `/api/projects/{id}/artifacts` | List artifacts for a project |
| POST | `/api/projects/{id}/artifacts` | Create an artifact |
| GET | `/api/projects/{id}/backlog` | Phase 4: List backlog items |
| POST | `/api/projects/{id}/backlog` | Phase 4: Create a backlog item |
| PATCH | `/api/projects/{id}/backlog/{item_id}` | Phase 4: Update a backlog item |
| DELETE | `/api/projects/{id}/backlog/{item_id}` | Phase 4: Delete a backlog item |
| POST | `/api/projects/{id}/backlog/import-from-ba` | Phase 4: Auto-import BA stories |

---

## Agent Fleet Architecture

### Phase 0 — Reconnaissance Pre-Pass (NEW)

Before the 15 agents launch, `run_recon_agent()` makes a fast, cheap Gemini call on the first 80K chars of the codebase. It returns structured JSON:

```json
{
  "primary_language": "Python 3.11",
  "frameworks": ["FastAPI", "Supabase"],
  "databases": ["PostgreSQL via Supabase"],
  "architecture_style": "Modular Monolith",
  "deployment_model": "Unknown",
  "entry_points": ["main.py:app"],
  "auth_mechanism": "API key (env-only)",
  "test_framework": "None found",
  "ci_cd": "None found",
  "estimated_complexity": "Medium",
  "notable_patterns": ["SSE streaming", "Agent-based architecture"],
  "red_flags": ["No rate limiting on public endpoints"],
  "raw_summary": "..."
}
```

`format_recon_for_prompt()` renders this as a `## Codebase Reconnaissance Summary` markdown block that is injected into `db_persona_prompts` for every agent. Agents skip stack discovery and go straight to deep domain analysis.

The recon result is also yielded as an `agent_update` event with key `"recon"` and the raw JSON in `data.recon`. The frontend shows its progress in the fleet status bar.

### The 18 Parallel Personas

| Key | Name | Model | Primary Domain | Context Limit |
|---|---|---|---|---|
| `architect` | Solutions Architect | Claude | System architecture, modernisation roadmap | 80K chars |
| `ba` | Business Analyst | Claude | User stories, backlog, business value | 60K chars |
| `qa` | QA Lead | Gemini | Testing strategy, risk register | 80K chars |
| `security` | Security Engineer | Gemini | OWASP audit, CVE scan, remediation | 100K chars |
| `tech_docs` | Technical Writer | Claude | Docs audit, ADRs, runbooks | 60K chars |
| `data_engineering` | Data Engineer | Gemini | Data model, migration, quality | 80K chars |
| `devops` | DevOps/SRE | Gemini | CI/CD, IaC, observability | 80K chars |
| `product_management` | Product Manager | Claude | ROI, KPIs, feature roadmap | 50K chars |
| `ui_ux` | UI/UX Designer | Claude | UX audit, accessibility, design system | 70K chars |
| `compliance` | Compliance & Privacy | Gemini | GDPR, SOC2, data flows | 70K chars |
| `secops` | DevSecOps | Gemini | SAST/DAST/SCA, secrets, zero trust | 100K chars |
| `performance_engineer` | Performance Engineer | Gemini | APM, bottlenecks, load testing | 80K chars |
| `cost_analyst` | Cost Optimisation Analyst | Gemini | FinOps, cloud cost, waste reduction | 50K chars |
| `api_designer` | API Designer | Claude | REST audit, OpenAPI spec, DX | 80K chars |
| `tech_lead` | Tech Lead | Claude | Codebase health, tech debt, team topology | 60K chars |
| `ai_innovation_scout` | AI Innovation Scout | Gemini | AI/low-code opportunities, 3 strategic paths | 70K chars |
| `outsystems_architect` | OutSystems Solution Architect | Gemini | Domain modelling, ODC vs O11, Forge audit, architecture blueprint | 80K chars |
| `outsystems_migration` | OutSystems Migration Strategist | Gemini | Migration roadmap, complexity scoring, commercial model, data migration | 80K chars |

### Forward-Thinking Technology Mandate (All Agents)

Both the Gemini and Anthropic research mandates now include an explicit forward-thinking directive. Every agent must:
- Consider AI-native tools, low-code platforms, and automation alongside traditional approaches
- Provide tiered recommendations: Traditional / AI-Augmented / AI-Native where relevant
- Cite specific modern tools (Cursor, Copilot, Retool, n8n, Modal, v0.dev, Bolt.new) with honest trade-off analysis
- Challenge "we need to build this" assumptions by asking if a SaaS, API, or AI agent already solves it

### The 19th Agent — Synthesis ("The Verdict")

After all 18 parallel agents complete, `run_synthesis_agent()` runs sequentially with **Claude Sonnet 4.6 + Extended Thinking**.

- **Extended Thinking**: 8,000-token private reasoning budget (`thinking={"type":"enabled","budget_tokens":8000}`)
- **Output budget**: 10,000 tokens (`max_tokens = 8000 + 10000 = 18000`)
- **Temperature**: 1 (required when extended thinking is enabled)
- Thinking blocks are stripped from the response before storing — only the final text is shown
- Produces: Executive Summary, Consensus Findings (3+ agents), Contradictions Resolved, Blind Spots, **Three Strategic Paths Forward** (Conservative/Balanced/Transformative), Critical Path (sprint/quarter/long-term), Top 10 Risks, Quick Wins, Success Metrics, The Bottom Line

### Three Strategic Paths

The Synthesis agent produces three distinct investment paths for every analysis:
- **PATH A — Conservative**: <$75K, 6 months, existing team, AI tools at the edges only
- **PATH B — Balanced**: $75K–$250K, 12 months, AI-augmented workflows, low-code for non-core features
- **PATH C — Transformative**: $250K+, 18-24 months, AI-native rebuild, greenfield for differentiating components

### OutSystems / ODC Specialist Sub-Fleet

Two dedicated Gemini agents (with live Google Search grounding) run alongside the main 16-agent fleet and assess the codebase specifically through the OutSystems platform lens. They are not a replacement for the AI Innovation Scout — they are a more focused, platform-specific deep-dive:

**`outsystems_architect` — OutSystems Solution Architect**
- Maps all entities, services, integrations, timers, and workflows to their OutSystems equivalents
- Audits the Forge marketplace for existing components that replace custom-built features
- Produces a full 4-Layer Guided Framework architecture blueprint (Foundation / Core Widgets / Core Services / End User)
- Assesses ODC vs O11 fit with a definitive recommendation
- Identifies what would require C# Extensions and what the application would lose by moving to OutSystems
- Delivers an honest **Feasibility Rating**: Excellent Fit / Good Fit / Partial Fit / Poor Fit

**`outsystems_migration` — OutSystems Migration Strategist**
- Delivers a **Migration Verdict**: Full Migration / Selective Migration / Integration Only / Do Not Migrate
- Scores every major component for migration complexity (Low/Medium/High/Very High)
- Produces a phased 12-sprint migration roadmap with go/no-go checkpoints
- Analyses the commercial model: licencing costs, build effort, break-even analysis
- Designs the data migration strategy (Bootstrap approach vs ETL, zero-downtime cutover)
- Identifies team upskilling requirements, OutSystems certification paths, and relevant partners
- Produces a 5-item risk register with mitigations

**Debate integration**: Both OutSystems agents participate in the boardroom debate. The `outsystems_architect` presents the platform case; the `outsystems_migration` challenges on timelines and cost. They are directly challenged by the `tech_lead` on vendor lock-in and by the `cost_analyst` on ROI. The `ai_innovation_scout` challenges on whether a low-code platform is the right low-code choice vs pure AI tooling. Synthesis resolves — or declares genuinely unresolved — the Build vs Buy vs AI vs Low-Code arc.

### Persona-Aware Context Filtering (NEW)

`filter_context_for_persona(persona_key, raw_context)` in `agent_engine.py`:

1. Splits the raw codebase into individual file blocks using the `====FILE: path====` separator
2. Scores each file against that persona's `PERSONA_PRIORITY_PATHS` (positive score) and `PERSONA_SKIP_PATHS` (score -1 = exclude)
3. Sorts files by score descending (most relevant first)
4. Fills up to `PERSONA_CONTEXT_LIMITS[persona_key]` characters
5. Appends a footer noting how many files were included vs excluded

Priority hints are path fragments (e.g., `"auth"`, `"middleware"`, `"dockerfile"`). A file path matching multiple hints accumulates score multiplicatively.

### Rate Limit Safeguards (NEW — 5-Layer Defence)

All constants are at the top of `agent_engine.py`:

```python
ANTHROPIC_SEMAPHORE: Optional[asyncio.Semaphore] = None  # lazily initialised
ANTHROPIC_MAX_CONTEXT_CHARS = 60_000    # fallback if persona limit not found
GEMINI_MAX_CONTEXT_CHARS = 800_000
ANTHROPIC_MAX_RETRIES = 3
ANTHROPIC_RETRY_BASE_DELAY = 15         # 15s → 30s → 60s
ANTHROPIC_LAUNCH_STAGGER = 4            # seconds between successive Claude agent launches
```

| Layer | Mechanism |
|---|---|
| **Semaphore** | `asyncio.Semaphore(2)` — max 2 concurrent Anthropic calls at any time |
| **Staggered launch** | Anthropic agents wrapped in `staggered_agent(delay=i*4)` — one launches every 4s |
| **Retry + backoff** | 429 or 529 → sleep 15s/30s/60s, retry up to 3 times |
| **Context truncation** | Per-persona context limits applied before API call |
| **Gemini fallback** | After max retries exhausted, agent calls `call_gemini(reason="rate_limit_fallback")` |

Both `run_single_agent` and `run_synthesis_agent` have this retry logic.

### Research Mandate System

Injected at runtime into every agent's prompt in `run_single_agent`:
- **Gemini agents**: Explicit mandate to use live Google Search grounding — searches LinkedIn, GitHub, Stack Overflow, CVE databases, ThoughtWorks Radar
- **Anthropic agents**: Deep expertise mandate to reference named patterns (Strangler Fig, CQRS, DDD), standards bodies (NIST, OWASP, ISO 27001, WCAG 2.2)

### Streaming Architecture

The `/api/analyze-repo` and `/api/analyze-topic` endpoints return `EventSourceResponse` (SSE). Events:
- `status` — fleet lifecycle phases: `cloning`, `cloned`, `memory_loaded`, `custom_agents_loaded`, `confidence_check`, `agents_launched`, `agents_launching`, `documenting`, `documented`, `complete`
- `agent_update` — per-agent status changes; key `"recon"` = recon phase; key `"synthesis"` = synthesis phase
- `agent_result` — completed agent report `{persona, name, emoji, status, content, usage}`
- `confidence_report` — Phase 6: all agents' self-assessments `{probes, has_questions, questions, fleet_session_id}`
- `awaiting_answers` — Phase 6: fleet paused, waiting for user input `{session_id, questions, message, fleet_session_id}`
- `specialist_proposals` — Phase 7B: proposed specialist agents `{proposals[], message}`
- `usage_summary` — Phase 5: aggregated token counts + cost `{total_input_tokens, total_output_tokens, total_cost_usd}`
- `error` — error event

The frontend `handleSSEEvent()` in `script.js`:
- `recon` key agent_updates → shown in the fleet status bar (no card for recon)
- All other agent_updates → update the per-agent status card spinner + sub-status
- `agent_result` → calls `renderAgentResult()` with persona-specific renderer
- `confidence_report` → calls `renderConfidenceReport()` — shows agent cards sorted by urgency
- `awaiting_answers` → calls `showConfidenceQA()` — shows Q&A form with submit/skip
- `specialist_proposals` → calls `renderSpecialistProposals()` — shows proposal cards with approve/dismiss
- `usage_summary` → shows cost in fleet status bar

---

## Frontend Architecture

Single HTML page (`index.html`) with vanilla JS (`script.js`, loaded as ES module).

### Views (nav-based routing)

- `view-ingestion` — GitHub URL input + legacy file upload
- `view-report` — The main discovery dashboard with all 18 report cards (16 core + 2 OutSystems)
- `view-how-it-works` — Full deep-dive explainer page (fully redesigned, see below)
- `view-admin` — Client/persona creation
- `view-history` — Past analysis runs from Supabase

### How It Works Page

The page is a comprehensive technical document with 10 sections:
1. **Hero** — stat row (19+ agents, 2 models, 18 domains, 3 paths, 6 living docs, ∞ cross-run memory)
2. **Pipeline** — all 8 phases (Phase 0 recon → ingestion → episodic memory loading → filtering → confidence pre-flight → parallel fleet → synthesis → living documentation generation → dynamic agent spawning), with full technical detail on each
3. **Forward-Thinking Mandate** — AI Coding Tools, Low-Code Platforms, AI Automation, AI-Native Infrastructure, plus 3-tier recommendation system (Traditional / AI-Augmented / AI-Native)
4. **The Fleet** — Interactive avatar gallery (6 grouped categories) with clickable agent cards. Each card shows the SVG avatar, name, model badge, context limit, and brief description. Clicking opens a detail modal with the agent's full identity, mission, investigation checklist, deliverables, and research mandate (parsed from `system_prompt`). The previous text-based listing is preserved under a collapsible "Full Agent Reference" `<details>` element.
5. **Unscripted Debate** — Debate rules, 4 conflict arcs (Speed vs Safety, Build vs Buy vs AI vs Low-Code, Investment appetite, Unexpected alliance), synthesis closes the debate
6. **Memory & Learning** — Run-over-run learning, living documents, self-evolving fleet, confidence-driven quality. Includes "How Memory Flows" visualization (Cold Start → Building Knowledge → Deep Intelligence)
7. **Built-in Features** — 14 feature cards: Three Strategic Paths, Expert Debate, Q&A Chat, GitHub Issues, Architecture Diagrams, Jira Backlog, History, Client Context, Recon Pre-Pass, Confidence Pre-flight, Episodic Memory, Living Documentation, Dynamic Agent Spawning, Budget-Aware Recommendations
8. **SSE Streaming Architecture** — event type diagram with 8 event types (status, agent_update, agent_result, confidence_report, awaiting_answers, specialist_proposals, usage_summary, error), frontend handler behaviour for each
9. **Full Tech Stack** — all libraries grouped by layer, including new persistence (Episodic Memory, Living Documents, Custom Agent Persistence)
10. Agent Detail Modal (interactive overlay accessed from fleet gallery)

New CSS classes use `hiw-*` prefix (gallery: `hiw-avatar-gallery`, `hiw-avatar-card`, `hiw-gallery-group`). Agent detail modal uses `agent-detail-*` prefix. All defined in `styles.css`.

### Agent Detail Modal

The `agent-detail-overlay` / `agent-detail-modal` system provides deep exploration of each agent:
- **Trigger**: Click any avatar card in the How It Works gallery
- **Data source**: `state.personaConfigs[key].system_prompt` — parsed at display time by `parseSystemPrompt()`
- **Parser splits on headers**: `**Your Mission**`, `**Your Deep Investigation Checklist**`, `**Your Deliverables:**`, `**Your Homework**`
- **Sections displayed**: Identity & Expertise, Mission, Investigation Checklist, Deliverables, Research Mandate
- **Markdown conversion**: `promptSectionToHTML()` converts bold, headers, lists to styled HTML
- **Close**: Click overlay background, X button, or Escape key

### Key JS State Object

```javascript
const state = {
    geminiKey: localStorage.getItem('gemini_api_key') || '',
    activeClient: null,
    personaConfigs: {},
    reportContents: {}  // Stores each agent's raw content for Q&A chat context
};
```

### Special Report Renderers

- **BA (`ba`)**: Parses structured stories into a Jira-like kanban board (`renderJiraBacklog`)
- **Architect (`architect`)**: Parses 3-phase roadmap into a visual grid (`renderModernisationRoadmap`) + extracts and renders Mermaid.js diagram (`extractAndRenderMermaid`)
- **All others**: `simpleMarkdown()` — a lightweight markdown-to-HTML converter

### Agent Count

`const total = 19` in `script.js` — 18 parallel personas (15 core + AI Innovation Scout + 2 OutSystems specialists) + 1 synthesis agent. Progress bar tracks this.

---

## Fourteen Major Features (All Implemented)

### 1. Synthesis Agent — "The Verdict" (Extended Thinking enabled)
- 19th agent, runs after all 18 parallel agents complete
- Claude Sonnet 4.6, extended thinking with 8K reasoning budget, 10K output budget
- Produces 9 structured sections from Executive Summary to The Bottom Line
- Displayed with special gold/amber styling in a `verdict-card`

### 2. Agent Q&A Chat
- Every report card has an "Ask" button
- Opens a chat modal pre-seeded with that agent's identity and report content as context
- Sends `POST /api/chat` — the agent answers from the perspective of its analysis
- Supports Gemini (with search grounding) and Anthropic agents

### 3. GitHub Issues Export
- BA report card has "Export to GitHub Issues" button
- Parses structured stories from BA content using the same regex as the Jira board
- Sends `POST /api/create-github-issues` using GITHUB_TOKEN from .env
- Creates labelled issues in the analysed repository with story/AC/points in the body

### 4. Report Persistence & History
- Every completed analysis is automatically saved to the `reports` Supabase table
- History view shows past runs with repo URL, date, client
- Clicking a history item re-renders all 18 report cards from saved data

### 5. Cross-Agent Contradiction Resolution (via Synthesis)
- The Synthesis agent is explicitly tasked with identifying where agents disagreed
- Extended thinking allows deep reasoning through each contradiction
- Each contradiction is named, resolved, and the reasoning is explained

### 6. Persona-Aware Context Filtering
- Each of the 18 parallel agents receives a relevance-scored slice of the codebase
- Files are sorted by domain relevance, not by file system order
- Dramatically improves analysis quality on large repos

### 7. Reconnaissance Pre-Pass
- Fast Gemini call before fleet launch, produces structured JSON baseline
- Injected into all 18 agent prompts as verified facts
- Agents skip discovery phase and go straight to deep domain analysis

### 8. Interactive Avatar Gallery & Agent Explorer
- How It Works page shows all 19 agents as clickable SVG avatar cards
- Each card displays the character avatar, name, model badge, context limit, and brief description
- Clicking opens a detail modal with the agent's full identity, mission, investigation checklist, deliverables, and research mandate
- Content is parsed at display time from the agent's `system_prompt` via `parseSystemPrompt()`
- Gallery is grouped into 6 categories: Core Engineering, Quality & Security, Business & Product, Operations & Governance, Innovation & Platform, The Verdict
- The full text-based agent reference is preserved under a collapsible `<details>` element

### 9. Interactive Backlog (Phase 4)
- BA agent's structured stories auto-import into a Kanban board on analysis completion
- 4-column board: Backlog → To Do → In Progress → Done
- HTML5 drag-and-drop between columns with optimistic UI updates + server rollback on failure
- Full CRUD: create, edit (modal with title/story/AC/points/priority/epic), delete stories
- Priority colour coding (high=red, med=amber, low=green) with story point badges
- `renderBacklogTab()` pipeline: `renderBacklog()` → `renderBacklogColumn()` → `renderBacklogItem()`
- Server-side: `database.py` has `create_backlog_item()`, `update_backlog_item()`, `import_backlog_from_ba()` using `project_artifacts` table with `kind='backlog_item'`

### 10. Prompt Caching & Cost Accounting (Phase 5)
- **Anthropic prompt caching**: System messages restructured as list of content blocks with `cache_control: {"type": "ephemeral"}` on shared prefix (recon + materials + research mandate). Agents 2-7 in sequence get ~90% cache hits.
- **Usage extraction**: `_extract_anthropic_usage(message)` and `_extract_gemini_usage(response)` pull token counts from API responses. `aggregate_usage()` combines across all agents.
- **Cost computation**: Per-million-token pricing model (`COST_PER_MTOK` dict) calculates `total_cost_usd` from input/output/cache tokens.
- **DB persistence**: `usage_summary` stored on `project_runs` table; `token_cost_cents` derived and stored.
- **Live display**: `usage_summary` SSE event → fleet status bar shows cost; project detail view shows cumulative cost chip.
- **Frugal mode**: Checkbox toggle skips OutSystems agents (`skip_personas: ['outsystems_architect', 'outsystems_migration']`), saving ~20% Gemini tokens. Progress bar adjusts dynamically (17 vs 19 total).

### 11. Agent Confidence Pre-flight Check (Phase 6)
- **Confidence probe**: Before the main fleet runs, `run_confidence_probe()` sends each agent a fast, cheap structured-JSON self-assessment using 15K chars of context. Returns `{confidence: high|medium|low, gaps, questions_for_user, research_needed, consult_agents, preliminary_findings}`.
- **Cross-agent briefing**: `build_cross_agent_briefing()` compiles HIGH-confidence agents' preliminary findings into a shared prompt block injected into LOW/MEDIUM agents' prompts.
- **User Q&A pause**: If agents have questions, the fleet yields an `awaiting_answers` SSE event and pauses (up to 5 minutes) via `asyncio.Event`. The frontend shows a Q&A panel with per-agent questions, answer inputs, URL textarea, and global answer field.
- **Fleet session mechanism**: `_fleet_sessions` dict in `main.py` maps `session_id → {event, answers}`. `POST /api/fleet-answer/{id}` receives answers + fetches extra URLs (capped at 5, 20K chars each). `POST /api/fleet-skip/{id}` proceeds immediately.
- **Frontend**: Confidence cards sorted by urgency (low first), colour-coded badges (green/amber/red), Q&A form with submit/skip buttons. Panel resets between runs.

### 12. Episodic Memory & Living Documentation (Phase 7A)
- **Episodic memory**: `database.get_episodic_memory(project_id)` retrieves previous runs, per-agent findings (truncated to 2K chars), synthesis history (last 3 runs), and all living documents. `format_episodic_memory()` renders into a structured prompt block injected into every agent.
- **Memory scope**: Tied to **projects** — everything analysed under one project shares memory, even across multiple repos.
- **Living documents**: 6 document types generated/updated after every run by Gemini Flash (free tier):
  - **Run Summary** — per-run snapshot (not living)
  - **Lessons Learned** — cumulative, grouped by theme
  - **Decision Log** — architectural decisions with trade-offs and status
  - **Risk Register** — risks with severity/likelihood/status tracking (new → acknowledged → mitigating → mitigated → closed)
  - **Technical Debt Inventory** — itemised debt with category/severity/effort/status
  - **Agent Knowledge Notes** — per-agent learnings about this specific codebase
- **Incremental updates**: Each run reads existing docs, produces updates via `generate_post_run_documents()`, merges into master docs via `upsert_project_document()`. Documents compound over time.
- **Storage**: Uses existing `project_artifacts` table with `kind='doc_*'` values. Living docs have one active row per project; run summaries create new rows.
- **Frontend**: "📋 Documents" tab in project detail view. Collapsible cards with colour-coded borders, markdown rendering, refresh button.
- **Budget/timeline injection**: Optional `budget_range`, `timeline`, `path_preference` fields in project metadata. When set, injected into client context so agents tailor PATH A/B/C recommendations to constraints.

### 13. Dynamic Agent Spawning (Phase 7B)
- **Gap analysis**: After synthesis, `analyse_for_specialists()` reviews confidence probes + agent reports to identify knowledge gaps. Proposes up to 3 specialist agents via `specialist_proposals` SSE event.
- **System proposes, user approves (Option D)**: Frontend shows specialist proposal cards with checkboxes, emoji, name, reason, and investigation areas. User selects which to create.
- **Two-pass persona creation**: Gemini Flash drafts the specialist's system prompt (free tier), then Sonnet reviews and refines it (~$0.02-0.05). `create_specialist_persona()` handles both passes.
- **Persistent project agents**: Created specialists are stored as `project_artifacts` with `kind='custom_agent'`. They persist across runs and are automatically loaded into the fleet on future runs.
- **Borrowable across projects**: `GET /api/borrowable-agents` lists all custom agents across projects. A project can see and borrow specialists created for other projects.
- **Fleet merging**: `run_agent_fleet()` accepts `custom_agents` parameter. Custom agents are merged into `PERSONA_CONFIGS` at runtime with their own context limits. They run alongside the core fleet.
- **Re-run model (Option B)**: Current run completes normally. If specialists are created, user re-runs with the expanded fleet — all agents benefit from the specialist's presence.

### 14. Budget-Aware Recommendations (Phase 7A)
- Projects can have optional `budget_range`, `timeline`, `path_preference` metadata fields
- When present, injected into client context: "Budget range: $75K-$250K, Timeline: 12 months"
- Agents told to "tailor all recommendations to fit these constraints" and "flag anything that exceeds them"
- PATH A/B/C recommendations become budget-scoped rather than generic

---

## Running Locally

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Fill in .env
cp .env.example .env  # then edit with your keys

# 3. Start the server
python main.py
# or: uvicorn main:app --reload --port 8000

# 4. Open in browser
open http://localhost:8000
```

---

## Branch & Git Conventions

- Feature branch: `claude/fix-console-warnings-api-WdA6X`
- All AI-driven commits go to the branch above
- Commit messages use present tense, imperative mood
- Every commit URL includes `https://claude.ai/code/session_01UAXouhEGComH7nBzkNgviF`

---

## Memory Architecture (6-Layer Model)

The system implements a layered memory architecture inspired by the v2 Architecture Proposal. Not all layers are fully built — the status column shows what's live vs decided vs deferred.

| Layer | Name | Status | Description |
|---|---|---|---|
| **0** | Institutional Memory | **Partial** | Project materials (uploaded files/URLs) injected as raw text. pgvector/semantic search deferred until volume demands it. |
| **1** | Episodic Memory | **✅ Live** | `get_episodic_memory()` retrieves previous runs, per-agent findings, synthesis history, and living docs. Injected into every agent's prompt via `format_episodic_memory()`. |
| **2** | Project Context | **✅ Live** | Business context form, budget/timeline fields, client metadata. All injected into agent prompts. |
| **3** | Role Identity | **✅ Live** | 18 hardcoded personas + dynamically spawned specialists (Phase 7B). Persona Designer available in admin UI. |
| **4** | Working Memory | **✅ Live** | GitHub API ingestion, recon pre-pass, persona-aware context filtering. Unchanged. |
| **5** | Autonomous Research | **Deferred** | Run-time research via Gemini search grounding covers this for now. Scheduled research (daily/weekly/monthly) deferred. |

### Run Pipeline (Full Sequence)

1. **Episodic memory load** — previous findings, living docs, synthesis history retrieved from DB
2. **Custom agents load** — project-level specialist agents merged into fleet
3. **Repository/topic ingestion** — GitHub API clone or URL fetch
4. **Recon pre-pass** — fast Gemini call produces structured JSON baseline
5. **Project materials render** — uploaded files/URLs assembled into prompt block
6. **Budget/timeline injection** — optional engagement parameters added to client context
7. **Confidence probes** — fast self-assessment per agent (15K char sample)
8. **Cross-agent briefing** — high-confidence agents' findings shared with struggling agents
9. **User Q&A** (optional) — if agents have questions, fleet pauses for user input
10. **Parallel fleet launch** — 18 core + N custom agents run simultaneously
11. **Synthesis** — Claude Sonnet 4.6 (or Opus if escalated) reads all reports
12. **Specialist gap analysis** — system proposes new specialist agents if gaps detected
13. **Post-run documentation** — Gemini Flash (free tier) generates/updates 6 living documents
14. **Artifact persistence** — reports, synthesis, backlog items saved to Supabase

### Key Architecture Decisions (from Q&A session)

| Decision | Rationale |
|---|---|
| Memory tied to projects, not repos | A project can span multiple repos; all runs share one memory |
| Incremental doc updates, not fresh per run | Documents compound knowledge — risk registers track status across runs |
| Gemini Flash free tier for housekeeping | Doc generation, persona drafting, research summarisation — $0 cost |
| Sonnet reviews specialist personas | Quality gate: Flash drafts cheaply, Sonnet refines (two-pass) |
| Option B for specialist timing | Run completes, then specialists created and re-run offered (cleaner, all agents benefit) |
| Option D for spawn approval | System proposes, user approves — no autonomous agent creation |
| Brute-force materials over semantic search | Works up to ~20 docs; pgvector triggered when volume exceeds threshold |
| No scheduled research yet | Run-time Gemini search grounding sufficient; revisit when project volume grows |
| Situational Opus escalation | Not a permanent upgrade — escalate when confidence is low or contradictions are heavy |

---

## Recommended Future Integrations

### MCP Servers (High Value)

| MCP | Value |
|---|---|
| **GitHub MCP** | Beyond Issues export — create PRs, milestones, project boards, labels directly from BA backlog. Also enables private repo analysis via token |
| **Jira MCP** | Export BA stories directly to Jira sprints with epic mapping, component assignment, and story point estimation |
| **Linear MCP** | Export to Linear cycles/projects — preferred by engineering-led teams |
| **Slack MCP** | Post synthesis summary to a channel when analysis completes; tag relevant engineers |
| **Confluence MCP** | Export Tech Docs agent output as a live Confluence space with proper page hierarchy |
| **Notion MCP** | Export full report as a structured Notion database with relations between agents |
| **Playwright/Browser MCP** | Take screenshots of the rendered report for PDF export or sharing |

### API Integrations (Next Sprint)

| Integration | Value |
|---|---|
| **GitHub Actions trigger** | After analysis, trigger a CI/CD pipeline that runs the Security agent's recommended Semgrep rules |
| **Snyk API** | Feed the dependency list from SecOps agent directly into Snyk for live CVE scanning |
| **OpenAI o1 / o3** | Use for synthesis as an alternative to Claude when extended thinking isn't available |
| **Datadog/New Relic** | Pull real APM data for the Performance agent to analyse alongside the codebase |
| **Private repo support** | Accept a GitHub PAT in the sidebar; pass as `Authorization: token` header in `clone_github_repo()` |

### Architecture Improvements (Backlog)

| Item | Priority | Status |
|---|---|---|
| ~~Persistent agent memory~~ | ~~High~~ | ✅ **Done** (Phase 7A — episodic memory + living docs) |
| ~~Report diffing~~ | ~~High~~ | ✅ **Partially done** — agents now receive previous findings and track deltas in risk register/tech debt docs |
| Inter-agent communication mid-run | High | **Decided** — agents can flag critical findings to each other mid-run when the latency cost is worth it. Not yet implemented. |
| Tier 2 artefact generation | High | **Decided** — conversational "build that" command generating code/config/docs into local project folders. Not yet implemented. |
| Omnivorous input pipeline | Medium | **Decided** — PDFs, images (vision), spreadsheets, video/audio transcripts, zips, .osp files, code folders. Partial support exists; full pipeline not yet built. |
| Situational Opus escalation | Medium | **Decided** — escalate synthesis to Opus 4.6 + full codebase when confidence scores are low or agents heavily contradict. Not yet implemented. |
| Scheduled domain research (Layer 5) | Medium | **Deferred** — run-time research via Gemini search grounding sufficient for now. Revisit when project volume grows. |
| Semantic search (pgvector) | Low | **Deferred** — brute-force materials injection works well up to ~20 docs. Trigger: when Layer 5 research or materials exceed 50 entries per domain. |
| Chunked context strategy | Medium | For repos >1M chars, send multiple chunks and merge agent outputs |
| Webhook delivery | Low | POST synthesis result to a configurable URL when analysis completes |
| Multi-repo comparison | Low | Analyse two repos simultaneously and produce a comparison report |
| Structured logging | Low | Replace silent try/catch in `database.py` with structured log events |
| How It Works page overhaul | High | **Decided** — needs major update to explain new features (confidence, memory, spawning, docs) |

---

## Known Limitations

- **Private repos**: GitHub ingestion uses public API only — no auth token passed in `clone_github_repo()`
- **Token limits**: Large repos are handled by persona filtering, but very large repos may still hit limits for `tech_lead` (no filtering)
- **Supabase error handling**: DB functions use try/catch but errors are silent — add structured logging
- **File upload analysis**: The legacy `/api/analyze` route exists but the new fleet personas are not wired to it
- **Recon on very small repos**: The 80K char sample may be the entire repo — that's fine, it still works
- **Custom agent borrowing**: Agents can be listed across projects but aren't yet auto-recommended when a new project has similar gaps
- **Budget/timeline fields**: Stored in project `metadata` JSONB — not separate DB columns. Works but means no direct SQL filtering by budget range
- **Post-run doc generation**: Uses Gemini Flash free tier — subject to rate limits under heavy load (15 RPM). Falls back gracefully (non-fatal)
- **Specialist persona quality**: Two-pass creation (Flash draft → Sonnet review) is good but not manually curated. May need human refinement for highly specialised domains
- **Inter-agent mid-run communication**: Architecture decided but not yet implemented. Agents still run fully in parallel with synthesis handling cross-cutting concerns

---

## Security Notes

- Gemini key: stored in `localStorage` with env fallback (acceptable for dev, should move to session for prod)
- Anthropic key: **backend only**, read from `.env`, never sent to frontend ✓
- GitHub token: **backend only**, read from `.env`, never sent to frontend ✓
- Supabase `publishable` key in `database.py` — low-privilege read/write key (not service role), acceptable for this app's threat model
- The app currently has no authentication — all endpoints are public
- Thinking block content (Claude's internal reasoning) is stripped before storage/display — not shown to end users
