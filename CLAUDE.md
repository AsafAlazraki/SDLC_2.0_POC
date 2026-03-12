# SDLC Discovery Engine — AI Handover Document

> **For any AI agent picking this up**: Read this fully before making any changes. This file is kept up-to-date with every edit session and contains the definitive source of truth for the project's architecture, state, and intentions.

---

## Project Purpose

This is an **AI-powered SDLC Discovery Engine**. It takes a public GitHub repository URL and dispatches a fleet of 15+ specialised AI personas to analyse the codebase from every professional angle simultaneously (architecture, security, QA, cost, performance, UX, compliance, etc.). After the fleet completes, a 16th **Synthesis Agent ("The Verdict")** reads all reports, resolves contradictions, and produces a unified CTO-level master action plan.

The output is a structured, multi-section discovery report that a development team or CTO can use to plan a modernisation programme.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| AI — Strategy/Synthesis | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
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
├── agent_engine.py        ← Persona definitions, agent runner, synthesis
├── database.py            ← Supabase client, all DB functions
├── requirements.txt       ← Python dependencies
├── static/
│   ├── index.html         ← Single-page app shell
│   ├── script.js          ← All frontend JS (vanilla, module type)
│   └── styles.css         ← CSS with glassmorphism design system
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
- Anthropic key: **env var ONLY** — was previously a frontend input, moved to backend for security
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

### The 15 Parallel Personas

| Key | Name | Model | Primary Domain |
|---|---|---|---|
| `architect` | Solutions Architect | Claude | System architecture, modernisation roadmap |
| `ba` | Business Analyst | Claude | User stories, backlog, business value |
| `qa` | QA Lead | Gemini | Testing strategy, risk register |
| `security` | Security Engineer | Gemini | OWASP audit, CVE scan, remediation |
| `tech_docs` | Technical Writer | Claude | Docs audit, ADRs, runbooks |
| `data_engineering` | Data Engineer | Gemini | Data model, migration, quality |
| `devops` | DevOps/SRE | Gemini | CI/CD, IaC, observability |
| `product_management` | Product Manager | Claude | ROI, KPIs, feature roadmap |
| `ui_ux` | UI/UX Designer | Claude | UX audit, accessibility, design system |
| `compliance` | Compliance & Privacy | Gemini | GDPR, SOC2, data flows |
| `secops` | DevSecOps | Gemini | SAST/DAST/SCA, secrets, zero trust |
| `performance_engineer` | Performance Engineer | Gemini | APM, bottlenecks, load testing |
| `cost_analyst` | Cost Optimisation Analyst | Gemini | FinOps, cloud cost, waste reduction |
| `api_designer` | API Designer | Claude | REST audit, OpenAPI spec, DX |
| `tech_lead` | Tech Lead | Claude | Codebase health, tech debt, team topology |

### The 16th Agent — Synthesis

After all 15 complete, `run_synthesis_agent()` runs sequentially with **Claude Sonnet 4.6**. It receives all 15 reports concatenated, resolves contradictions between agents, identifies consensus findings, fills blind spots, and produces "The Verdict" — a CTO-level master action plan.

### Research Mandate System

Injected at runtime into every agent's prompt (in `run_single_agent`):
- **Gemini agents**: Explicit mandate to use live Google Search grounding — searches LinkedIn, GitHub, Stack Overflow, tech blogs, official docs, CVE databases
- **Anthropic agents**: Deep expertise mandate to reference named patterns, standards bodies (NIST, OWASP), and real-world tech company engineering knowledge

### Streaming Architecture

The `/api/analyze-repo` endpoint returns `EventSourceResponse` (SSE). Events:
- `status` — fleet status updates (cloning, launched, complete)
- `agent_update` — per-agent status changes (thinking, sub_status messages)
- `agent_result` — completed agent report `{persona, name, emoji, status, content}`
- `error` — error event

The synthesis agent emits its own `agent_update` and `agent_result` events as agent key `"synthesis"`.

---

## Frontend Architecture

Single HTML page (`index.html`) with vanilla JS (`script.js`, loaded as ES module).

### Views (nav-based routing)

- `view-ingestion` — GitHub URL input + legacy file upload
- `view-report` — The main discovery dashboard with all 16 report cards
- `view-how-it-works` — Explainer page
- `view-admin` — Client/persona creation
- `view-history` — Past analysis runs from Supabase

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

`const total = 16` in `script.js` — 15 parallel personas + 1 synthesis agent. Progress bar tracks this.

---

## Five Major Features (All Implemented)

### 1. Synthesis Agent — "The Verdict"
- 16th agent, runs after the 15 complete
- Uses Claude Sonnet 4.6 with max_tokens=8192
- Produces: Executive Summary, Consensus Findings, Contradictions Resolved, Blind Spots, Critical Path (sprint/quarter/long-term), Top 10 Risks, Quick Wins, Success Metrics, The Bottom Line
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
- History view (`view-history`) shows past runs with repo URL, date, client
- Clicking a history item re-renders all 16 report cards from saved data

### 5. Cross-Agent Contradiction Resolution (via Synthesis)
- The Synthesis agent is explicitly tasked with identifying where agents disagreed
- It resolves e.g. Performance recommending aggressive caching vs Security flagging it as a risk vector
- Each contradiction is named, resolved, and the reasoning is explained

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

## Known Limitations & Future Work

- **Private repos**: The GitHub ingestion only works with public repos (no auth token for cloning)
- **Token limits**: Large repos (>1M chars) are truncated at 1M chars — consider chunking strategy
- **Anthropic agents fallback**: If Anthropic key is missing, Anthropic-assigned personas fall back to Gemini
- **Report diffing**: History shows past runs but doesn't yet diff between runs for the same repo
- **File upload analysis**: The legacy `/api/analyze` route exists but the new fleet personas should be wired to it
- **Supabase error handling**: DB functions use try/catch but errors are silent — add structured logging

---

## Security Notes

- Gemini key: stored in `localStorage` with env fallback (acceptable for dev, should move to session for prod)
- Anthropic key: **backend only**, read from `.env`, never sent to frontend ✓
- GitHub token: **backend only**, read from `.env`, never sent to frontend ✓
- Supabase `publishable` key in `database.py` — this is a low-privilege read/write key (not service role), acceptable for this app's threat model
- The app currently has no authentication — all endpoints are public
