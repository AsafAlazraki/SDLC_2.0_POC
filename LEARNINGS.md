# Learnings — SDLC Discovery Engine

> A running log of insights, decisions, dead-ends, and things-to-remember from building the engine. Add to the top of each section as new learnings emerge.

---

## Why this file exists

CLAUDE.md is the **architecture spec** — what the system *is* now. This file is the **journey** — what we tried, why we picked this path over alternatives, and what surprised us. New sessions should skim this before refactoring anything labelled "we already tried that."

---

## Architecture Learnings

### Closed-loop UX: parsing structured output back from synthesis (Phase 9 polish)

After Phase 9 routed flags into synthesis, the user only saw flags going in — they had to read the verdict to find the resolutions. Closing the loop meant parsing structured output back from a free-text LLM response, which is fragile by default.

Three matching passes, in increasing tolerance:
1. **Exact src+tgt match**: original flag's `from_agent` and `target_key` both match the resolution's parsed source/target after alias normalisation. Catches well-formatted output.
2. **Target-only match**: synthesis sometimes drops the source agent (writes "Performance must address..." instead of "[Security → Performance]"). If only one flag has that target, claim it.
3. **Fuzzy text match**: synthesis may paraphrase the original flag entirely. Last resort: ≥4-word overlap between ruling text and original flag message.

Lessons:
- **Always echo the input as a baseline.** The parser starts by returning all original flags with `resolved=False`. Even if synthesis omitted the section entirely, the panel still shows the flags — just with UNRESOLVED badges. Never lose data.
- **Fuzzy matching needs a floor.** First version of pass 3 matched on any overlap. With short flags ("PII in logs") that gave false positives — every other ruling matched. Setting a 4-word floor cut false positives to ~0% in test runs.
- **Tolerate header level drift.** Models inconsistently emit `### Cross-Domain Flag Resolutions` vs `## Cross-Domain Flag Resolutions` vs `#### ...`. The header regex matches all three.
- **Parsing structured output is the quickest way to add UX polish.** No additional API call. No prompt engineering complexity. Just tighter integration of what the model already produces.

The "RESOLVED" green badge on each flag is genuinely satisfying to see in the UI — it makes the inter-agent communication feature feel like a real conversation rather than a one-way reporting protocol.

### Inter-agent communication without doubling fleet cost (Phase 9)

The original "decided but not built" item was inter-agent mid-run communication — the architect Q&A landed on "agents flag critical findings to each other when latency cost is worth it." When I sat down to actually build it, the design space split into 3:

1. **True mid-run**: agents check a shared bulletin board during execution. **Rejected** — single-shot LLM API calls don't pause for shared state. Would require multi-pass agents (literally 2× cost).
2. **Two-pass with consultation round**: all agents run, then targeted "consultation" calls fire on flagged topics. **Rejected for v1** — adds 5-10 extra API calls, 30-60s latency, and complicates retry/error handling for marginal gain over option 3.
3. **One-pass with synthesis injection**: agents emit flags as a structured report section; flags get parsed and routed into synthesis as binding items. **Picked.**

Why option 3 is right for v1:
- **Zero additional API calls.** Flag parsing is sync regex.
- **Zero additional latency.** Parser runs in <1ms after fleet completes.
- **Synthesis was already the forum** for cross-cutting decisions. Forcing it to *explicitly* address each flag (new mandatory `### Cross-Domain Flag Resolutions` output section) is the smallest change with the biggest behaviour shift.
- **The frontend gets a tangible artefact**: a flag panel between fleet completion and synthesis showing "Security flagged Performance about X." Users see inter-agent communication happening, even though it's mediated through a shared verdict.

What I learned about prompting agents to emit structured flags:

- **Quality > quantity threshold matters.** First draft asked for "any" cross-domain flags. Agents emitted 5-7 each, most of them noise ("Security says you should also have monitoring" — Performance already knows). Restricted to 0-3, with explicit "do not invent flags to look thorough" — quality jumped immediately.
- **Whitelist target tokens.** Without a fixed vocabulary, agents wrote `[PERFORMANCE]`, `[PERFORMANCE ENGINEER]`, `[PERF]`, `[PERFORMANCE/SCALABILITY]`, etc. The alias map handles the messy reality, but the prompt also lists the canonical 17 tokens to nudge agents toward consistency.
- **"Do not flag yourself"** is a real instruction I had to add. Models will absolutely emit `[SECURITY] watch out for SQL injection` in the Security Engineer's own report.

Surprise: the cleanest signal that this is working will be when synthesis quality measurably improves on runs where flags were raised. We don't have that metric yet — worth adding later.

### Image vision: cheap, structured, async-only (Phase 8b)

Adding image vision to the materials pipeline turned out to be 90% plumbing and 10% prompt engineering.

1. **Async dispatch only.** Vision is the only async branch in the extractor. Rather than turn the whole module async, I added `extract_text_async()` as a sibling that delegates to sync `extract_text()` for everything except images. Existing sync callers (tests, batch tools, kickoff_pack) didn't need changes.

2. **Structured prompt > free-form description.** First draft asked Gemini to "describe this image." Output was inconsistent — sometimes a paragraph, sometimes a list, sometimes hallucinated context. Switched to a structured 5-section prompt (What this is / Visible content / Inferred purpose / Notable details / Open questions) and output became reliable across mixed inputs (wireframes, ER diagrams, screenshots, error dialogs).

3. **SVGs are not images.** Gemini-vision rejects SVGs because they're XML. I added a special-case route to the text decoder for `.svg` / `image/svg+xml`. The XML source is also more useful than a vision summary would be — agents can read the actual element tree.

4. **Graceful degradation in 3 dimensions.** No Gemini key → metadata-only. SDK missing → metadata-only. API error → metadata-only with error captured. Verified during dev when our test key got auto-flagged as leaked — extractor returned cleanly, no crash, error in metadata. The upload endpoint still saved the row.

5. **Provenance header on the summary.** Agents downstream see `[Vision summary of image: login_wireframe.png — image/png]` before the actual text. They can cite the image by filename in their reports. Without this, the summary read as if it came from a person, not an image — confusing context.

Cost: ~$0.0001 per image at Flash rates. Effectively free. The biggest cost is latency — adds ~2-3s per image to the upload endpoint.

### Situational Opus escalation (Phase 8)

We had a "decided but not built" item to escalate synthesis from Sonnet to Opus when confidence was low. Built it. Three lessons:

1. **Use a single decision function, not scattered conditionals.** `should_escalate_to_opus(probe_results)` is the only place that decides. Easy to test (5 unit cases cover all paths), easy to tune (constants live next to the function), easy to reason about (no branching at the call site).

2. **Three thresholds, not one.** A single threshold like "30% low confidence" is fragile — a 3-agent fleet with one low-confidence agent shouldn't escalate, but a 19-agent fleet with 4 low-confidence agents should. Combined: count threshold (4+) OR ratio threshold (30%+) OR no-anchors guard (zero high-confidence in fleet of 5+). Each catches a real failure mode the others miss.

3. **Pay 5× cost? Pay for breathing room too.** Opus runs use 16K thinking + 12K output (vs Sonnet's 8K + 10K). The marginal cost of a bigger output budget is rounding error compared to the model premium. Don't half-ass the escalation — if you trigger Opus, give it room to actually use Opus.

The escalation reason gets surfaced as both an SSE event AND a banner on the synthesis card. Users always know why we paid more. Never silently spend money.

### Memory architecture (6 layers, but not equally built)

We adopted a 6-layer memory model from the v2 PDF proposal but **deliberately did not build all of it**. Key principle: build what we need now, defer what's premature.

| Layer | What we built | What we deferred and why |
|---|---|---|
| L0 Institutional | Brute-force materials injection | pgvector / semantic search — works fine up to ~20 docs per project. Trigger to revisit: 50+ docs |
| L1 Episodic | Full implementation: per-project, last 5 runs, living docs | None — this is the highest-leverage layer |
| L2 Project Context | Business context form, budget/timeline, client metadata | None |
| L3 Role Identity | 18 hardcoded + dynamic specialists | Persona evaluation/scoring system — manual review for now |
| L4 Working Memory | GitHub ingestion, recon, persona-aware filtering | None |
| L5 Autonomous Research | Run-time Gemini search grounding | Scheduled (daily/weekly) research — revisit when project volume grows |

**Why "tied to projects, not repos"**: A single project may span multiple repos (frontend, backend, mobile). One memory track per project is what users actually want.

### Living documents: incremental, not snapshot

First instinct was to regenerate all docs from scratch each run. **Wrong.** Documents are most valuable when they *track change* — risks added, tech debt closed, decisions revisited. We pass the previous doc version into the prompt and ask Gemini Flash to merge updates incrementally.

This compounds: by run 5, the risk register has 15+ items with status history (`new → acknowledged → mitigating → mitigated → closed`). That's institutional memory you cannot get from re-analysing.

### Dynamic agent spawning: System Proposes, User Approves (Option D)

We considered four spawning models:
- **A** — Fully autonomous (engine creates agents without asking). Rejected — quality risk and user surprise.
- **B** — User requests, system creates. Rejected — defeats the "discovery" framing.
- **C** — System suggests, system creates after threshold. Rejected — same quality risk as A.
- **D** — **System proposes, user approves with one click.** Picked. Best balance of intelligence and control.

User retains veto. System retains initiative. Specialists persist per project, borrowable across projects.

### Two-pass persona generation (Flash drafts, Sonnet reviews)

Persona quality matters — a bad specialist persona produces bad analysis forever. Single-pass generation with either model alone is mediocre:
- **Flash alone**: Fast and cheap but persona depth is shallow, investigation checklists generic
- **Sonnet alone**: Excellent quality but ~$0.10-0.15 per persona, slow

Two-pass: Flash drafts the structure (free tier), Sonnet reviews and refines (~$0.02-0.05). Best of both. The review prompt explicitly asks Sonnet to add named patterns, standards bodies, and concrete deliverable formats.

### Re-run model (Option B for specialist timing)

When a specialist is approved, the **current run does not retroactively use them**. Instead, the run completes normally and the user is offered a re-run with the expanded fleet. Why:
- Cleaner UX — no half-complete reports
- All agents benefit from cross-agent briefing with the new specialists
- Separates "current run" from "investment in future runs"

### Cost optimisation: Free tier for housekeeping

Three tasks were moved to Gemini Flash free tier:
1. **Living document generation** (one call after every run)
2. **Specialist persona drafts** (first pass before Sonnet review)
3. **Recon pre-pass** (was already Flash, kept it)

Combined savings: ~$0.30-0.50 per run. Multiplied across hundreds of runs = real money. Trade-off: Flash free tier rate-limits at 15 RPM. We added graceful degradation — if the Flash call fails, the run still succeeds, just without that doc/persona.

### Confidence pre-flight: cheaper than getting analysis wrong

Initial concern: "isn't a confidence check just an extra API call we don't need?" Counter-argument: agents that lack context produce confident-sounding but generic reports. The cost of 18 cheap probes is far less than 18 deep analyses that go nowhere.

Reality after building it: agents are honest about gaps when asked structurally. The Q&A pause feels natural in the UI — users want to give the engine more context once they see what it's missing. Skip-button is essential for the "I'm in a hurry" mode.

**Cross-agent briefing** turned out to be the biggest unlock — high-confidence agents' preliminary findings dramatically improve the depth of low-confidence agents' final reports. This is the senior-engineer-helps-junior pattern, in code.

---

## Implementation Learnings

### SSE pause/resume via asyncio.Event

The trickiest engineering problem in Phase 6 was pausing an SSE stream mid-flight to wait for user input, then resuming. The solution:

```python
_fleet_sessions: Dict[str, Dict] = {}  # session_id → {event, answers}

# In the SSE generator
session = {"event": asyncio.Event(), "answers": None}
_fleet_sessions[fleet_session_id] = session

# Yield the awaiting_answers event
yield {"event": "awaiting_answers", "data": json.dumps({...})}

# Wait for user answers (or timeout)
try:
    await asyncio.wait_for(session["event"].wait(), timeout=300)
    user_answers = session["answers"]
except asyncio.TimeoutError:
    user_answers = None  # proceed without
```

The `POST /api/fleet-answer/{id}` endpoint just sets `session["answers"]` and calls `session["event"].set()`. The SSE generator wakes up, reads the answers, and continues. SSE connection stays alive the whole time — no reconnect, no race conditions.

**Lesson**: SSE is more flexible than WebSocket for this use case because it's request-response oriented but can hold the response open indefinitely. WebSockets would have required state management on both sides.

### Per-persona context filtering changed everything

Before filtering: Security Engineer was wading through CSS variables. UX Designer was reading database migrations. Quality was mediocre across the board.

After filtering: each agent gets a relevance-scored slice. Files matching the persona's `PERSONA_PRIORITY_PATHS` get positive scores; files matching `PERSONA_SKIP_PATHS` get -1 (excluded). Sorted descending, filled up to per-persona context limit.

**Single biggest quality improvement in the engine.** Took ~150 lines of code. Impact ratio is wild.

### Anthropic prompt caching: 90% cache hits with proper structure

Initially we sent each agent's full system prompt as a single string. Cache hit rate: 0%.

After restructuring system message as a list of content blocks with `cache_control: {"type": "ephemeral"}` on the shared prefix (recon + materials + research mandate), agents 2-7 in sequence get **~90% cache hits**. Cost reduction is massive on multi-agent runs.

**Lesson**: The cache prefix must be byte-identical across calls. Any dynamic content (timestamps, agent-specific intro) must come *after* the cached blocks.

### Rate limit safeguards (5-layer defence)

Anthropic Tier 1 = 30K input tokens/min. With 7 Claude agents launching simultaneously at 60K context each = instant rate limit hell.

The 5 layers (semaphore + stagger + retry/backoff + truncation + Gemini fallback) work *together* — removing any one causes failures. Most important: **graceful Gemini fallback**. Users see a completed report regardless of Anthropic availability. The engine is more reliable than any single API.

### Recon pre-pass: small change, huge effect

Before recon: every agent's first 30% of output was rediscovering "this is Python with FastAPI..." Wasted tokens, wasted time.

After recon: a single $0.001 Flash call upfront, results injected into all 18 prompts. Agents skip discovery entirely and go straight to deep domain analysis.

**Lesson**: Cheap shared context is dramatically more valuable than expensive duplicated context.

---

## UX & Frontend Learnings

### Vanilla JS scaled further than expected

We never adopted React/Vue/Svelte. The single `script.js` file is now ~4,000 lines and still maintainable because:
- Clear function naming (`renderConfidenceReport`, `showSpecialistProposals`)
- ES module structure with named imports from `avatars.js`
- State object lives in one place (`state = {...}`)
- Each render function is self-contained — no shared mutation gotchas

**Inflection point if reached**: when we want hot-reload during development, or when component reuse becomes painful. Not there yet.

### Glassmorphism + dark theme + neon accents = visual hierarchy

The design language reads as "futuristic intelligence" without being cluttered. Three colours do almost all the work:
- `--primary` (cyan) — interactive elements, primary state
- `--success` (green) — completion, high confidence
- Custom purples/pinks — specialist features (memory, spawning) to visually mark "this is the smart layer"

Confidence cards use red/amber/green for confidence levels. This ranks the cards visually before the user reads them.

### `<details>` for "show me everything" sections

The full text-based agent reference is hidden behind a `<details>` element. Power users open it; casual users see the avatar gallery and stop there. Zero JS, native browser behaviour. Use this pattern more.

### Agent Detail Modal: dynamic parsing of system prompts

Rather than hardcoding agent details twice (once in Python, once in HTML), the modal *parses the agent's `system_prompt`* at display time using `parseSystemPrompt()`. Sections are split on known headers (`**Your Mission**`, `**Your Deep Investigation Checklist**`, etc.) and rendered as styled HTML.

**Benefit**: when we change an agent's persona prompt in `agent_engine.py`, the How It Works modal updates automatically. Single source of truth.

---

## Process Learnings

### Layer-by-layer Q&A for architecture decisions

When designing Phase 7, we had a 30-page PDF proposal and a working system that didn't quite match. Instead of adopting the PDF wholesale, we walked through it **one layer at a time** with 26 questions. For each question, the user gave a directional answer ("yes but not mandatory", "free tier does most", "follow your gut").

Result: we built what we needed without wasting time on layers that don't yet justify the complexity (semantic search, scheduled research). The decision log in CLAUDE.md captures every choice and why.

**Lesson**: When facing a big architecture document, don't ask "should we adopt this?" Ask "let's walk through this one decision at a time."

### "Decided but not implemented" is a valid state

Several items are marked **Decided** in the architecture backlog but not built:
- Inter-agent mid-run communication
- Tier 2 artefact generation ("build that" command)
- Situational Opus escalation
- Omnivorous input pipeline (full)

These have agreed designs and known triggers. When we hit the trigger, the design is ready. Don't build until the trigger fires.

### Document the "why we didn't" alongside the "what we did"

CLAUDE.md tracks current state. This file tracks alternatives considered. Both matter. New sessions otherwise re-litigate decisions, waste time on dead ends, or worse, undo intentional choices.

---

## Surprises (Things We Didn't Expect)

1. **Cross-agent briefing improves quality more than user Q&A.** We expected user answers to be the big lift. Actually, having high-confidence agents whisper their preliminary findings to struggling agents was the bigger unlock.

2. **The "Specialist Proposal" UI is delightful.** Users light up when the engine says "I noticed you have an event-driven architecture but no Event Sourcing specialist — should I create one?" It feels like the engine is *thinking*.

3. **Living documents become the most-used artefact.** We thought the synthesis would be the main output. Users actually return to the Risk Register and Lessons Learned more often. Snapshots are forgettable; living memory is sticky.

4. **Frugal Mode (skip OutSystems agents) is rarely used.** Designed as a cost control. Users tend to want the full picture. Useful as an option, but not the default.

5. **Two-pass persona generation produces personas indistinguishable from hand-crafted ones.** We expected to need manual review. We don't (yet).

6. **The 18-agent fleet is the right number, not too many.** Ablation: removing any single agent leaves a noticeable gap in synthesis. Adding a 19th (the AI Innovation Scout) was justified by "build vs. buy vs. AI" being a recurring user question. The OutSystems sub-fleet is platform-specific and properly scoped to projects considering ODC.

---

## Things to Watch For (Open Questions)

- **When does episodic memory bloat?** Currently capped at last 5 runs + agent findings truncated to 2K chars. At what point does this become noise rather than signal? Probably need a "compaction" pass that consolidates old runs into living docs only.
- **Custom agent quality drift.** We've never reviewed a created specialist after the fact to see if it's actually adding value. Need a "specialist effectiveness" metric — maybe based on how often its findings appear in synthesis consensus.
- **Cross-project agent borrowing UX.** Currently surfaced via `/api/borrowable-agents` but no automatic recommendation. When should the system say "Project A has a GraphQL Specialist that would help here"?
- **Document size limits.** Living docs grow over time. At what size do they need to be paginated, archived, or summarised? Probably not soon, but worth watching.
- **Confidence pre-flight latency.** 18 fast probes still adds 30-60s before the main fleet launches. Acceptable when probes catch real gaps; annoying when they don't. Worth measuring "probe-led improvements" vs "probe overhead" over time.

---

## How To Add To This File

When you finish a meaningful piece of work:
1. Add a section under the relevant heading (Architecture / Implementation / UX / Process / Surprises / Open Questions)
2. Be specific — include code snippets, numbers, names. Not "we improved performance" but "filtering changed first-token latency from 8s → 2s."
3. Capture the *alternative you didn't pick* and why. Future-you will thank you.
4. If something surprised you, write it down. Surprises are the highest-signal entries.
