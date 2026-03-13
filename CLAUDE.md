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
| POST | `/api/analyze` | Legacy text/file analysis (non-streaming) |
| POST | `/api/chat` | Q&A with individual agent `{persona_key, question, agent_report}` |
| POST | `/api/create-github-issues` | Export BA backlog to GitHub Issues `{github_url, stories:[]}` |
| GET | `/api/reports` | List past analysis runs |
| GET | `/api/reports/{id}` | Get a specific saved report |

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

The `/api/analyze-repo` endpoint returns `EventSourceResponse` (SSE). Events:
- `status` — fleet lifecycle (cloning, launched, complete)
- `agent_update` — per-agent status changes; key `"recon"` = recon phase; key `"synthesis"` = synthesis phase
- `agent_result` — completed agent report `{persona, name, emoji, status, content}`
- `error` — error event

The frontend `handleSSEEvent()` in `script.js`:
- `recon` key agent_updates → shown in the fleet status bar (no card for recon)
- All other agent_updates → update the per-agent status card spinner + sub-status
- `agent_result` → calls `renderAgentResult()` with persona-specific renderer

---

## Frontend Architecture

Single HTML page (`index.html`) with vanilla JS (`script.js`, loaded as ES module).

### Views (nav-based routing)

- `view-ingestion` — GitHub URL input + legacy file upload
- `view-report` — The main discovery dashboard with all 18 report cards (16 core + 2 OutSystems)
- `view-how-it-works` — Full deep-dive explainer page (fully redesigned, see below)
- `view-admin` — Client/persona creation
- `view-history` — Past analysis runs from Supabase

### How It Works Page (NEW — Fully Redesigned)

The page is now a comprehensive technical document with 5 sections:
1. **Hero** — stat row (16 agents, 2 models, 15 domains)
2. **Pipeline** — all 5 phases (Phase 0 recon → ingestion → filtering → parallel fleet → synthesis), with full technical detail on each
3. **The Fleet** — split two-column view (Claude agents left, Gemini agents right), each with deliverable summaries
4. **Built-in Features** — Q&A Chat, GitHub Issues, Mermaid diagrams, Jira backlog, history, client context
5. **SSE Architecture** — event type diagram, frontend handler behaviour
6. **Full Tech Stack** — all libraries grouped by layer

New CSS classes use `hiw-*` prefix. All defined at the bottom of `styles.css`.

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

## Seven Major Features (All Implemented)

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
- Injected into all 15 agent prompts as verified facts
- Agents skip discovery phase and go straight to deep domain analysis

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

| Item | Priority |
|---|---|
| Report diffing | Show delta between two runs of the same repo — what improved, what regressed |
| Chunked context strategy | For repos >1M chars, send multiple chunks and merge agent outputs |
| Persistent agent memory | Store past findings per repo in Supabase; prime agents with "last time we found X" |
| Webhook delivery | POST synthesis result to a configurable URL when analysis completes |
| Multi-repo comparison | Analyse two repos simultaneously and produce a comparison report |
| Structured logging | Replace silent try/catch in `database.py` with structured log events |

---

## Known Limitations

- **Private repos**: GitHub ingestion uses public API only — no auth token passed in `clone_github_repo()`
- **Token limits**: Large repos are handled by persona filtering, but very large repos may still hit limits for `tech_lead` (no filtering)
- **Supabase error handling**: DB functions use try/catch but errors are silent — add structured logging
- **Report diffing**: History shows past runs but doesn't diff between runs for the same repo
- **File upload analysis**: The legacy `/api/analyze` route exists but the new fleet personas are not wired to it
- **Recon on very small repos**: The 80K char sample may be the entire repo — that's fine, it still works

---

## Security Notes

- Gemini key: stored in `localStorage` with env fallback (acceptable for dev, should move to session for prod)
- Anthropic key: **backend only**, read from `.env`, never sent to frontend ✓
- GitHub token: **backend only**, read from `.env`, never sent to frontend ✓
- Supabase `publishable` key in `database.py` — low-privilege read/write key (not service role), acceptable for this app's threat model
- The app currently has no authentication — all endpoints are public
- Thinking block content (Claude's internal reasoning) is stripped before storage/display — not shown to end users
