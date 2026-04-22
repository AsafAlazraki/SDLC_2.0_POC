"""
grooming_engine.py — turn a parsed requirements list into a groomed backlog
(Epic → Feature → Story hierarchy, with dependencies, Mentor prompts,
critical path, and multi-dev schedule).

Five sequential stages:
  1. Intake    — validate + sanitise the normalised requirements
  2. Cluster   — group requirements into Epics → Features (one Sonnet call)
  3. Draft     — BA agent drafts stories per feature
  4. Enrich    — 5 agents (PM, Architect, Tech Lead, OS Architect, OS Migration)
                 contribute patches concurrently; merged centrally
  5. Sequence  — compute dependency graph, critical path, Mentor prompts,
                 multi-dev schedule

The pipeline yields SSE-style events (dicts with {event, data}) so
/api/groom endpoints can stream live progress to the UI.

Model selection respects the bidirectional fallback from agent_engine.py —
if no Anthropic key, all Sonnet calls route to Gemini (lossy but works).
If no Gemini key, all Gemini calls route to Sonnet.

Episodic memory + fleet findings integration:
- If the project has prior groomed stories, they're passed into Cluster
  as "prior work to preserve or evolve"
- If the project has run the main 18-agent fleet, its OutSystems Architect
  blueprint (entities, services, screens) is passed into the Mentor prompt
  generator so each story's prompt is grounded in actual platform context
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import asdict
from typing import Any, Dict, List, Optional, AsyncGenerator, Tuple

import anthropic

from agent_engine import (
    ANTHROPIC_MAX_RETRIES,
    ANTHROPIC_RETRY_BASE_DELAY,
    _run_prompt_on_anthropic,
    get_anthropic_semaphore,
    logger as _engine_logger,
)
from requirements_parser import NormalisedRequirement

try:
    from google import genai as _genai  # type: ignore
    from google.genai import types as _genai_types  # type: ignore
except ImportError:
    _genai = None  # type: ignore
    _genai_types = None  # type: ignore

logger = logging.getLogger(__name__)


# ─── Agent identities — local to this module, distinct from PERSONA_CONFIGS ─
#
# These are the 6 grooming agents. They're simplified role descriptors used
# inside the single-turn enrichment calls, not full fleet personas. Keeping
# them here rather than in agent_engine.PERSONA_CONFIGS because their
# responsibilities are narrow (backlog refinement) vs the fleet agents' deep
# domain audits.

GROOMING_AGENTS = {
    "ba":          {"name": "Business Analyst",       "emoji": "📋", "stage": "draft"},
    "pm":          {"name": "Product Manager",         "emoji": "🎯", "stage": "enrich"},
    "architect":   {"name": "Solutions Architect",     "emoji": "🏗️", "stage": "enrich"},
    "tech_lead":   {"name": "Tech Lead",               "emoji": "🏆", "stage": "enrich"},
    "os_architect":{"name": "OutSystems Architect",    "emoji": "🟣", "stage": "enrich"},
    "os_migration":{"name": "OutSystems Migration",    "emoji": "🔄", "stage": "enrich"},
}

STAGE_ORDER = ["intake", "cluster", "draft", "enrich", "sequence"]


# ─── Prompt templates ──────────────────────────────────────────────────────

_CLUSTER_PROMPT = """You are a senior Business Analyst receiving a raw customer requirements dump. Your job is to cluster these into an Epic → Feature → Requirement hierarchy.

CUSTOMER REQUIREMENTS ({count} items):
{requirements_block}

{prior_context}
{fleet_context}

Produce a JSON structure clustering the requirements. Rules:
- 3-8 Epics (high-level themes like "Authentication & Access", "Reporting & Analytics", "Data Migration")
- Each Epic has 2-6 Features (cohesive capability groups like "SSO Integration", "Role-based Access")
- Every requirement maps to EXACTLY ONE feature (by its id)
- If a requirement is cross-cutting, put it in the most dominant feature and note the cross-cutting nature in its description
- Keep requirement IDs exactly as given

Return VALID JSON ONLY (no prose, no code fences), matching:

{{
  "epics": [
    {{
      "epic_key": "EPIC-001",
      "title": "Short epic title",
      "description": "1-2 sentence epic theme",
      "rationale": "Why this clustering makes sense",
      "features": [
        {{
          "feature_key": "FEAT-001",
          "title": "Short feature title",
          "description": "1-2 sentence capability summary",
          "requirement_ids": ["R001", "R004", "R007"]
        }}
      ]
    }}
  ],
  "orphan_requirement_ids": []
}}
"""


_DRAFT_PROMPT = """You are the Business Analyst on a shift-left discovery panel. You have a feature from a clustered backlog and the requirements that fall under it. Draft 2-6 user stories that fully deliver this feature.

EPIC: {epic_title} — {epic_description}

FEATURE: {feature_title} — {feature_description}

REQUIREMENTS IN THIS FEATURE:
{requirements_block}

{prior_context}

For each story produce EXACTLY these fields (we populate the rest in a later stage):
- title: 5-10 word imperative summary
- story: Classic connextra format — "As a [persona], I want [action], so that [value]."
- acceptance_criteria: 3-5 Given/When/Then scenarios as a markdown list. At least one negative path.
- story_points: Fibonacci (1, 2, 3, 5, 8, 13). >13 means the story is too big — split it.
- priority: Must / Should / Could / Won't (MoSCoW)
- type: story / bug / spike / tech-debt
- requirement_source_ids: array of customer requirement IDs this story delivers

Return VALID JSON ONLY, matching:

{{
  "stories": [
    {{
      "title": "...",
      "story": "...",
      "acceptance_criteria": "- **Given** ... **When** ... **Then** ...\\n- **Given** ... **When** ... **Then** ...",
      "story_points": "5",
      "priority": "Must",
      "type": "story",
      "requirement_source_ids": ["R001", "R002"]
    }}
  ]
}}
"""


_ENRICH_PROMPTS = {
    "pm": """You are the Product Manager reviewing a drafted story. Refine it for strategic impact. Return JSON with these fields only:
{
  "priority_override": "Must|Should|Could|Won't|null",   // null = keep BA's priority
  "priority_rationale": "1 sentence why",
  "success_metric": "1-sentence measurable success criterion",
  "business_outcome": "1 sentence on which business outcome this serves"
}""",

    "architect": """You are the Solutions Architect reviewing a drafted story. Add technical shape. Return JSON:
{
  "nfr_notes": "2-4 sentences on performance/security/scalability considerations specific to THIS story",
  "technical_approach": "1-2 sentences — preferred implementation shape",
  "risks_assumptions": "Any architectural risk or assumption to surface"
}""",

    "tech_lead": """You are the Tech Lead analysing a batch of drafted stories in a feature. Your job: identify DEPENDENCIES between them, plus flag any story that should be split.

You will receive: feature title, the array of story titles+summaries, and each story's index (0-based).

Return JSON:
{
  "dependencies": [
    {
      "from_index": 2,
      "to_index": 0,
      "type": "blocked_by",
      "reason": "1 sentence why"
    }
  ],
  "split_suggestions": [
    { "index": 4, "reason": "Too large — split on auth vs. profile" }
  ]
}
Only include real dependencies. A dependency is: "Story A cannot be started (or cannot be completed) until Story B is done."
""",

    "os_architect": """You are the OutSystems Architect reviewing a drafted story. Identify which OutSystems concepts it touches.

OUTSYSTEMS BLUEPRINT (if available):
{os_blueprint}

Return JSON:
{{
  "odc_entities": ["User", "Role"],      // entities the story reads or writes
  "odc_screens": ["LoginScreen"],         // screens/blocks it adds or modifies
  "forge_opportunities": ["ForgeComponent/reason"],   // Forge components that could help
  "platform_notes": "1-2 sentences on how to shape this in ODC — reactive pattern, service action, etc."
}}""",

    "os_migration": """You are the OutSystems Migration Strategist. For this story, identify any migration-phase implications (what must be built early vs late, what depends on legacy-system parity, etc).

Return JSON:
{
  "migration_phase": "early|mid|late|any",
  "migration_risks": "1-2 sentences on migration-specific risks",
  "legacy_dependencies": "What this story depends on in the legacy system that must be preserved during cut-over"
}""",
}


_MENTOR_PROMPT_TEMPLATE = """You are generating a developer-facing prompt that will be pasted into ODC Mentor 2.0 (OutSystems' AI coding assistant). The prompt should let the developer scaffold this story in ODC Studio with minimal manual wiring.

Produce a Markdown-formatted prompt following this structure. Be specific. Reference entities, screens, and services by name when known.

# Story: {title}

## Goal
{story}

## Platform Context
{platform_context}

## Implementation Approach
{technical_approach}

## Acceptance Criteria
{acceptance_criteria}

## Non-Functional Requirements
{nfr_notes}

## Suggested ODC Structure
- Entities touched: {entities}
- Screens/Blocks: {screens}
- Forge components to consider: {forge}

## Deliverables expected from Mentor
1. Entity/attribute scaffolding
2. Service action skeletons with input/output
3. UI block structure for the affected screens
4. Sample client-side action flow
5. Unit test stubs for the service actions

Return the prompt text only — no extra commentary, no code fences."""


# ─── Helpers ──────────────────────────────────────────────────────────────

def _extract_json(raw: str) -> Optional[Any]:
    """Strip common LLM JSON mistakes (code fences, leading prose) and parse."""
    if not raw:
        return None
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE)
    # Sometimes models add trailing prose after the JSON; grab the first JSON object/array.
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
    return None


def _requirements_block(reqs: List[NormalisedRequirement], cap: int = 120) -> str:
    """Render requirements for LLM consumption. Cap at `cap` rows to stay
    within context — we chunk in the caller if larger."""
    lines = []
    for r in reqs[:cap]:
        rid = r.id or f"auto-{r.row_index + 1}"
        prio = f" [{r.priority}]" if r.priority else ""
        src = f" (src: {r.source})" if r.source else ""
        lines.append(f"- **{rid}**{prio} {r.description}{src}")
        if r.notes:
            lines.append(f"    notes: {r.notes[:200]}")
    if len(reqs) > cap:
        lines.append(f"... and {len(reqs) - cap} more (truncated for context)")
    return "\n".join(lines)


async def _sonnet_call(
    prompt: str,
    anthropic_api_key: str,
    *,
    max_tokens: int = 4096,
    system: str = "You are a disciplined backlog grooming agent. Return valid JSON only when asked.",
) -> Tuple[str, Dict[str, Any]]:
    """Thin wrapper around agent_engine._run_prompt_on_anthropic with retries
    + the shared semaphore. Returns (text, usage) or raises on exhaustion."""
    semaphore = get_anthropic_semaphore()
    last_err = None
    for attempt in range(1, ANTHROPIC_MAX_RETRIES + 1):
        try:
            async with semaphore:
                return await _run_prompt_on_anthropic(
                    prompt, anthropic_api_key,
                    max_tokens=max_tokens, temperature=0.2, system=system,
                )
        except anthropic.RateLimitError as e:
            last_err = e
            if attempt < ANTHROPIC_MAX_RETRIES:
                await asyncio.sleep(ANTHROPIC_RETRY_BASE_DELAY * (2 ** (attempt - 1)))
            else:
                raise
        except anthropic.APIStatusError as e:
            if e.status_code == 529 and attempt < ANTHROPIC_MAX_RETRIES:
                last_err = e
                await asyncio.sleep(ANTHROPIC_RETRY_BASE_DELAY * (2 ** (attempt - 1)))
            else:
                raise
    if last_err:
        raise last_err
    raise RuntimeError("sonnet_call: all retries exhausted")


# ─── Stage 1 — Intake ─────────────────────────────────────────────────────

def stage_intake(reqs: List[NormalisedRequirement]) -> Tuple[List[NormalisedRequirement], List[str]]:
    """Filter out rows with no description, dedupe on id, return clean list."""
    warnings: List[str] = []
    seen_ids = set()
    clean: List[NormalisedRequirement] = []
    for r in reqs:
        if not (r.description or "").strip():
            continue
        rid = (r.id or "").strip() or f"auto-{r.row_index + 1}"
        if rid in seen_ids:
            warnings.append(f"Duplicate requirement id '{rid}' — dropped later row.")
            continue
        seen_ids.add(rid)
        r.id = rid
        clean.append(r)
    if not clean:
        warnings.append("No usable requirements after intake (all rows had empty descriptions).")
    return clean, warnings


# ─── Stage 2 — Cluster ────────────────────────────────────────────────────

async def stage_cluster(
    reqs: List[NormalisedRequirement],
    anthropic_api_key: str,
    *,
    prior_groomed_summary: str = "",
    fleet_findings_summary: str = "",
) -> Dict[str, Any]:
    """Return the clustered Epic→Feature→requirement_ids tree.

    Strategy for large inputs: we cap the prompt at ~200 requirements worth
    of detail. On a 700+ row upload this means most rows are summarised only
    by count, with the LLM clustering on the visible sample and any patterns
    from the IDs/priority columns. For truly large uploads the caller should
    chunk before calling us — this is a v1 simplification.
    """
    logger.info(f"[cluster] starting with {len(reqs)} requirements")
    prompt = _CLUSTER_PROMPT.format(
        count=len(reqs),
        requirements_block=_requirements_block(reqs, cap=200),
        prior_context=(
            f"PRIOR GROOMING ON THIS PROJECT — preserve epic themes where sensible, flag new ones:\n{prior_groomed_summary}\n"
            if prior_groomed_summary else ""
        ),
        fleet_context=(
            f"RELEVANT FLEET FINDINGS — treat as authoritative context:\n{fleet_findings_summary}\n"
            if fleet_findings_summary else ""
        ),
    )
    logger.info(f"[cluster] prompt size: {len(prompt):,} chars")

    try:
        text, _usage = await _sonnet_call(prompt, anthropic_api_key, max_tokens=10_000)
    except Exception as e:
        logger.exception(f"[cluster] Sonnet call failed: {e}")
        return {"epics": [], "orphan_requirement_ids": [r.id for r in reqs], "_error": str(e)}

    logger.info(f"[cluster] got {len(text):,} chars of response")
    parsed = _extract_json(text)

    if not isinstance(parsed, dict) or "epics" not in parsed:
        logger.warning(
            f"[cluster] malformed JSON. First 600 chars of response:\n{text[:600]}\n"
            f"Last 300 chars:\n{text[-300:]}"
        )
        # One retry with a corrective nudge — common model mistakes are a
        # stray preamble ("Here is the JSON:") or a trailing explanation.
        retry_prompt = (
            prompt
            + "\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY a single JSON object starting with { and ending with }. No prose, no code fences, no explanation."
        )
        try:
            text2, _ = await _sonnet_call(retry_prompt, anthropic_api_key, max_tokens=10_000)
            parsed2 = _extract_json(text2)
            if isinstance(parsed2, dict) and "epics" in parsed2:
                logger.info("[cluster] retry succeeded")
                return parsed2
            logger.warning(f"[cluster] retry also failed. Response head: {text2[:400]}")
        except Exception as e:
            logger.warning(f"[cluster] retry raised: {e}")
        return {"epics": [], "orphan_requirement_ids": [r.id for r in reqs]}

    epic_count = len(parsed.get("epics") or [])
    feature_count = sum(len(e.get("features") or []) for e in (parsed.get("epics") or []))
    logger.info(f"[cluster] success: {epic_count} epic(s), {feature_count} feature(s)")
    return parsed


# ─── Stage 3 — Draft ──────────────────────────────────────────────────────

async def stage_draft_feature(
    *,
    epic: Dict[str, Any],
    feature: Dict[str, Any],
    requirements: List[NormalisedRequirement],
    anthropic_api_key: str,
    prior_stories_summary: str = "",
) -> List[Dict[str, Any]]:
    """Draft 2-6 stories for one feature. Returns stories list (unmerged)."""
    prompt = _DRAFT_PROMPT.format(
        epic_title=epic.get("title", ""),
        epic_description=epic.get("description", ""),
        feature_title=feature.get("title", ""),
        feature_description=feature.get("description", ""),
        requirements_block=_requirements_block(requirements),
        prior_context=(
            f"PRIOR STORIES FROM THIS PROJECT — style guide, do not duplicate:\n{prior_stories_summary}\n"
            if prior_stories_summary else ""
        ),
    )
    text, _usage = await _sonnet_call(prompt, anthropic_api_key, max_tokens=3500)
    parsed = _extract_json(text)
    if not isinstance(parsed, dict) or "stories" not in parsed:
        logger.warning(f"Draft stage returned malformed JSON for feature '{feature.get('title')}': {text[:300]}")
        return []
    return parsed.get("stories") or []


# ─── Stage 4 — Enrich ─────────────────────────────────────────────────────

async def _enrich_single_agent(
    agent_key: str,
    *,
    feature: Dict[str, Any],
    stories: List[Dict[str, Any]],
    anthropic_api_key: str,
    os_blueprint: str = "",
) -> Dict[str, Any]:
    """Run one enrichment agent over the full story set for a feature.

    Returns a dict keyed by agent — shape varies per agent. Tech Lead returns
    one response for the whole batch (dependencies are cross-story). Others
    return one response per story.
    """
    prompt_template = _ENRICH_PROMPTS[agent_key]

    if agent_key == "tech_lead":
        # Cross-story analysis — single call
        stories_summary = "\n".join(
            f"  {i}. {s.get('title', '(untitled)')} — {s.get('story', '')[:120]}"
            for i, s in enumerate(stories)
        )
        prompt = (
            f"{prompt_template}\n\n"
            f"FEATURE: {feature.get('title', '')}\n\n"
            f"STORIES IN THIS FEATURE:\n{stories_summary}\n"
        )
        text, _usage = await _sonnet_call(prompt, anthropic_api_key, max_tokens=1500)
        parsed = _extract_json(text)
        return {"agent": agent_key, "batch_result": parsed if isinstance(parsed, dict) else {}}

    # Per-story enrichment — one call per story (bounded concurrency inside _sonnet_call's semaphore)
    if agent_key == "os_architect":
        formatted = prompt_template.format(os_blueprint=os_blueprint or "(no blueprint available — use general ODC patterns)")
    else:
        formatted = prompt_template

    async def _enrich_one(story: Dict[str, Any]) -> Dict[str, Any]:
        story_block = (
            f"STORY: {story.get('title', '')}\n"
            f"Details: {story.get('story', '')}\n"
            f"Acceptance: {story.get('acceptance_criteria', '')[:600]}\n"
            f"Priority: {story.get('priority', '')}, Points: {story.get('story_points', '')}"
        )
        prompt = f"{formatted}\n\n{story_block}"
        try:
            text, _usage = await _sonnet_call(prompt, anthropic_api_key, max_tokens=900)
            parsed = _extract_json(text)
            return parsed if isinstance(parsed, dict) else {}
        except Exception as e:
            logger.warning(f"{agent_key} enrich failed for story '{story.get('title')}': {e}")
            return {}

    per_story = await asyncio.gather(*[_enrich_one(s) for s in stories])
    return {"agent": agent_key, "per_story_results": per_story}


async def stage_enrich_feature(
    *,
    feature: Dict[str, Any],
    stories: List[Dict[str, Any]],
    anthropic_api_key: str,
    os_blueprint: str = "",
) -> List[Dict[str, Any]]:
    """Run all 5 enrichment agents concurrently over the feature's stories.
    Merge their patches into the story list and return enriched stories."""
    agents = ["pm", "architect", "tech_lead", "os_architect", "os_migration"]
    tasks = [
        _enrich_single_agent(
            a, feature=feature, stories=stories,
            anthropic_api_key=anthropic_api_key, os_blueprint=os_blueprint,
        )
        for a in agents
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    enriched = [dict(s) for s in stories]   # copy so we don't mutate input

    for res in results:
        if isinstance(res, Exception):
            logger.warning(f"enrich gather exception: {res}")
            continue
        a = res.get("agent")
        if a == "tech_lead":
            batch = res.get("batch_result") or {}
            for dep in (batch.get("dependencies") or []):
                try:
                    fi = int(dep.get("from_index", -1))
                    ti = int(dep.get("to_index", -1))
                except (ValueError, TypeError):
                    continue
                if 0 <= fi < len(enriched) and 0 <= ti < len(enriched) and fi != ti:
                    enriched[fi].setdefault("dependencies", []).append({
                        "target_index": ti,   # will be resolved to DB ID after persistence
                        "type": dep.get("type", "blocked_by"),
                        "reason": dep.get("reason", ""),
                        "added_by": "tech_lead",
                    })
            # split_suggestions are informational for now
            split_notes = batch.get("split_suggestions") or []
            for sug in split_notes:
                try:
                    idx = int(sug.get("index", -1))
                except (ValueError, TypeError):
                    continue
                if 0 <= idx < len(enriched):
                    enriched[idx].setdefault("split_suggestions", []).append(sug.get("reason", ""))
            continue

        per = res.get("per_story_results") or []
        for i, patch in enumerate(per):
            if i >= len(enriched) or not isinstance(patch, dict):
                continue
            s = enriched[i]
            if a == "pm":
                if patch.get("priority_override"):
                    s["priority"] = patch["priority_override"]
                s.setdefault("_enrichment_notes", {})["pm"] = {
                    "priority_rationale": patch.get("priority_rationale", ""),
                    "success_metric": patch.get("success_metric", ""),
                    "business_outcome": patch.get("business_outcome", ""),
                }
            elif a == "architect":
                s["nfr_notes"] = patch.get("nfr_notes", "") or s.get("nfr_notes", "")
                s.setdefault("_enrichment_notes", {})["architect"] = {
                    "technical_approach": patch.get("technical_approach", ""),
                }
                if patch.get("risks_assumptions"):
                    s["risks_assumptions"] = (
                        (s.get("risks_assumptions", "") + "\n\n" if s.get("risks_assumptions") else "")
                        + patch["risks_assumptions"]
                    )
            elif a == "os_architect":
                s["odc_entities"] = patch.get("odc_entities", []) or s.get("odc_entities", [])
                s["odc_screens"] = patch.get("odc_screens", []) or s.get("odc_screens", [])
                s.setdefault("_enrichment_notes", {})["os_architect"] = {
                    "forge_opportunities": patch.get("forge_opportunities", []),
                    "platform_notes": patch.get("platform_notes", ""),
                }
            elif a == "os_migration":
                s.setdefault("_enrichment_notes", {})["os_migration"] = {
                    "migration_phase": patch.get("migration_phase", "any"),
                    "migration_risks": patch.get("migration_risks", ""),
                    "legacy_dependencies": patch.get("legacy_dependencies", ""),
                }
                if patch.get("migration_risks"):
                    s["risks_assumptions"] = (
                        (s.get("risks_assumptions", "") + "\n\n" if s.get("risks_assumptions") else "")
                        + f"Migration: {patch['migration_risks']}"
                    )
    return enriched


# ─── Stage 5 — Sequence ───────────────────────────────────────────────────

async def stage_mentor_prompt(
    *,
    story: Dict[str, Any],
    os_blueprint: str = "",
    anthropic_api_key: str,
) -> str:
    """Generate an ODC Mentor 2.0 prompt for a story. Returns the prompt text.

    Strategy: we could ask the model to write the full prompt, but the template
    is deterministic enough that we can assemble it in Python with fields we
    already have. Only the `platform_context` paragraph needs LLM composition.
    """
    platform_context = os_blueprint.strip() if os_blueprint else (
        "No project-specific OutSystems blueprint available — apply standard ODC best practices."
    )
    technical_approach = ""
    notes = (story.get("_enrichment_notes") or {}).get("architect") or {}
    if notes.get("technical_approach"):
        technical_approach = notes["technical_approach"]
    else:
        technical_approach = "Use reactive web app patterns with service actions for data access. Keep UI logic in Client Actions."

    os_notes = (story.get("_enrichment_notes") or {}).get("os_architect") or {}
    forge = os_notes.get("forge_opportunities") or []
    forge_line = ", ".join(forge) if forge else "None identified"

    prompt = _MENTOR_PROMPT_TEMPLATE.format(
        title=story.get("title", "Untitled"),
        story=story.get("story", ""),
        platform_context=platform_context,
        technical_approach=technical_approach,
        acceptance_criteria=story.get("acceptance_criteria", ""),
        nfr_notes=story.get("nfr_notes", "") or "(none specified)",
        entities=", ".join(story.get("odc_entities", [])) or "(none)",
        screens=", ".join(story.get("odc_screens", [])) or "(none)",
        forge=forge_line,
    )
    return prompt


def compute_critical_path(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[int]:
    """Longest path through the dependency DAG. Nodes are story dicts with
    {id, points, ...}; edges are {from, to, type}.

    Returns list of story IDs on the critical path, in topological order.
    Edge semantics: from "blocked_by" to — so 'from' must finish before 'to' starts.
    """
    if not nodes:
        return []

    # Build adjacency: predecessors[node_id] = list of ids that block it
    preds: Dict[int, List[int]] = {n["id"]: [] for n in nodes}
    for e in edges:
        f, t = e.get("from"), e.get("to")
        if f in preds and t in preds:
            # blocked_by means the story blocks the 'from' until 'to' completes
            # For critical path we want the longest chain of work — 'to' must come after 'from'
            if e.get("type") == "blocked_by":
                preds[f].append(t)
            else:   # "blocks"
                preds[t].append(f)

    # Detect cycles (disallow)
    visited, onstack = set(), set()

    def has_cycle(n):
        if n in onstack:
            return True
        if n in visited:
            return False
        visited.add(n)
        onstack.add(n)
        for p in preds.get(n, []):
            if has_cycle(p):
                return True
        onstack.discard(n)
        return False

    for n in preds:
        if has_cycle(n):
            logger.warning("Dependency cycle detected — critical path unavailable.")
            return []

    # DP over topological order: earliest_finish[n] = points[n] + max(earliest_finish[p] for p in preds)
    points_of = {n["id"]: (int(n.get("points") or 3) if str(n.get("points") or "").isdigit() else 3) for n in nodes}
    finish: Dict[int, int] = {}
    predecessor_of: Dict[int, Optional[int]] = {}

    def compute(n):
        if n in finish:
            return finish[n]
        best = 0
        best_p = None
        for p in preds.get(n, []):
            f = compute(p)
            if f > best:
                best = f
                best_p = p
        finish[n] = best + points_of.get(n, 3)
        predecessor_of[n] = best_p
        return finish[n]

    for n in preds:
        compute(n)

    if not finish:
        return []
    last = max(finish, key=finish.get)
    path: List[int] = []
    cur: Optional[int] = last
    while cur is not None:
        path.append(cur)
        cur = predecessor_of.get(cur)
    path.reverse()
    return path


def multi_dev_schedule(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    *,
    dev_count: int = 3,
    sprint_capacity: int = 13,
) -> Dict[str, Any]:
    """Greedy topological schedule — assign ready stories to available devs.

    Returns:
      {
        "assignments": [{"dev": 1, "story_id": ..., "sprint": 1, "start_points": 0, "end_points": 5}],
        "sprints": [{"sprint": 1, "stories_per_dev": {"1": [...], "2": [...]}}],
        "predicted_total_points": total,
        "predicted_sprint_count": N,
      }
    """
    if not nodes:
        return {"assignments": [], "sprints": [], "predicted_total_points": 0, "predicted_sprint_count": 0}

    # Build blockers: story X is ready when all its blockers are done
    blockers: Dict[int, set] = {n["id"]: set() for n in nodes}
    for e in edges:
        # blocked_by means 'from' is blocked by 'to' — so 'to' must finish first
        if e.get("type") == "blocked_by":
            if e.get("from") in blockers and e.get("to") in blockers:
                blockers[e["from"]].add(e["to"])
        else:  # blocks
            if e.get("to") in blockers and e.get("from") in blockers:
                blockers[e["to"]].add(e["from"])

    remaining = {n["id"]: n for n in nodes}
    points_of = {n["id"]: (int(n.get("points") or 3) if str(n.get("points") or "").isdigit() else 3) for n in nodes}
    dev_load = {d: 0 for d in range(1, dev_count + 1)}
    finish_of: Dict[int, int] = {}   # story_id -> completion time (in points)
    assignments: List[Dict[str, Any]] = []
    done: set = set()

    while remaining:
        ready = [
            nid for nid, blk in blockers.items()
            if nid in remaining and not (blk - done)
        ]
        if not ready:
            # Stuck — there's a cycle or orphan. Bail.
            break
        # Sort ready by priority (Must > Should > Could > Won't) then points desc
        priority_rank = {"Must": 0, "Should": 1, "Could": 2, "Won't": 3}
        ready.sort(key=lambda nid: (
            priority_rank.get((remaining[nid].get("priority") or "Should").capitalize(), 2),
            -points_of.get(nid, 3),
        ))
        # Assign each ready story to the dev who can start it earliest.
        # A story's earliest-start = max(dev's current load, max(blocker finish times)).
        # We pick the dev minimising that earliest-start — not just the dev with lowest load.
        for nid in ready:
            blocker_finishes = [finish_of[b] for b in blockers[nid] if b in finish_of]
            earliest = max(blocker_finishes) if blocker_finishes else 0

            best_dev, best_start = None, None
            for d, load in dev_load.items():
                candidate_start = max(load, earliest)
                if best_start is None or candidate_start < best_start:
                    best_dev, best_start = d, candidate_start
            pts = points_of.get(nid, 3)
            start = best_start
            end = start + pts
            sprint_num = (start // sprint_capacity) + 1
            assignments.append({
                "dev": best_dev,
                "story_id": nid,
                "title": remaining[nid].get("title", ""),
                "sprint": sprint_num,
                "start_points": start,
                "end_points": end,
                "points": pts,
                "blocked_until": earliest,   # useful for UI to show idle gaps
            })
            dev_load[best_dev] = end
            finish_of[nid] = end
            done.add(nid)
            del remaining[nid]

    total_points = sum(points_of.values())
    sprint_count = max((a["sprint"] for a in assignments), default=0)
    return {
        "assignments": assignments,
        "dev_load": dev_load,
        "predicted_total_points": total_points,
        "predicted_sprint_count": sprint_count,
    }


# ─── Orchestrator ─────────────────────────────────────────────────────────

async def run_grooming(
    *,
    project_id: int,
    upload_id: int,
    requirements: List[NormalisedRequirement],
    anthropic_api_key: str,
    gemini_api_key: str = "",
    prior_groomed_summary: str = "",
    fleet_findings_summary: str = "",
    os_blueprint: str = "",
    dev_count: int = 3,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Top-level async generator. Yields SSE-style events through the 5 stages.

    Events:
      {"event": "grooming_started", "data": {stage_plan, total_requirements}}
      {"event": "grooming_stage",   "data": {stage, status, message, progress}}
      {"event": "grooming_epics",   "data": {epics: [...]}}   # after cluster
      {"event": "grooming_stories", "data": {stories: [...]}} # after each feature draft
      {"event": "grooming_enriched","data": {stories: [...]}} # after enrich of each feature
      {"event": "grooming_sequence","data": {critical_path, dep_graph, multi_dev_schedule}}
      {"event": "grooming_complete","data": {epic_count, feature_count, story_count}}
      {"event": "grooming_error",   "data": {stage, message}}

    This function does NOT persist to the database — it's pure pipeline output.
    The caller (/api/projects/{id}/groom endpoint) persists each event's
    payload via grooming_db helpers and forwards events to the browser.
    """
    yield {
        "event": "grooming_started",
        "data": {
            "stages": STAGE_ORDER,
            "total_requirements": len(requirements),
            "agents": list(GROOMING_AGENTS.keys()),
        },
    }

    # Stage 1 — Intake
    yield {"event": "grooming_stage", "data": {"stage": "intake", "status": "running", "message": "Validating and deduping requirements..."}}
    clean_reqs, intake_warnings = stage_intake(requirements)
    if not clean_reqs:
        yield {"event": "grooming_error", "data": {"stage": "intake", "message": "No usable requirements found — intake aborted."}}
        return
    yield {"event": "grooming_stage", "data": {"stage": "intake", "status": "complete", "message": f"{len(clean_reqs)} requirements ready for grooming.", "warnings": intake_warnings}}

    # Stage 2 — Cluster
    yield {"event": "grooming_stage", "data": {"stage": "cluster", "status": "running", "message": "Clustering into Epics \u2192 Features (Claude Sonnet 4.6)..."}}
    try:
        cluster_result = await stage_cluster(
            clean_reqs, anthropic_api_key,
            prior_groomed_summary=prior_groomed_summary,
            fleet_findings_summary=fleet_findings_summary,
        )
    except Exception as e:
        yield {"event": "grooming_error", "data": {"stage": "cluster", "message": str(e)}}
        return
    epics = cluster_result.get("epics", [])
    yield {"event": "grooming_epics", "data": {"epics": epics, "orphan_ids": cluster_result.get("orphan_requirement_ids", [])}}
    yield {"event": "grooming_stage", "data": {"stage": "cluster", "status": "complete", "message": f"{len(epics)} epic(s), {sum(len(e.get('features', [])) for e in epics)} feature(s)."}}

    # Stage 3 — Draft (BA per feature)
    yield {"event": "grooming_stage", "data": {"stage": "draft", "status": "running", "message": "Drafting user stories (BA agent)..."}}
    req_by_id = {r.id: r for r in clean_reqs}
    enriched_epics: List[Dict[str, Any]] = []
    total_features = sum(len(e.get("features", [])) for e in epics) or 1
    feature_counter = 0
    for epic in epics:
        epic_out = {**epic, "features": []}
        for feature in (epic.get("features") or []):
            feature_counter += 1
            feat_reqs = [req_by_id[rid] for rid in (feature.get("requirement_ids") or []) if rid in req_by_id]
            if not feat_reqs:
                continue
            try:
                stories = await stage_draft_feature(
                    epic=epic, feature=feature,
                    requirements=feat_reqs,
                    anthropic_api_key=anthropic_api_key,
                )
            except Exception as e:
                yield {"event": "grooming_error", "data": {"stage": "draft", "message": f"{feature.get('title')}: {e}"}}
                stories = []
            yield {
                "event": "grooming_stories",
                "data": {
                    "epic_key": epic.get("epic_key"),
                    "feature_key": feature.get("feature_key"),
                    "feature_title": feature.get("title"),
                    "stories": stories,
                    "progress": {"current": feature_counter, "total": total_features},
                },
            }

            # Stage 4 — Enrich this feature's stories
            try:
                enriched = await stage_enrich_feature(
                    feature=feature, stories=stories,
                    anthropic_api_key=anthropic_api_key,
                    os_blueprint=os_blueprint,
                )
            except Exception as e:
                yield {"event": "grooming_error", "data": {"stage": "enrich", "message": f"{feature.get('title')}: {e}"}}
                enriched = stories
            # Stage 5 — Mentor prompt per story (pure template, no LLM)
            for s in enriched:
                try:
                    s["mentor_prompt"] = await stage_mentor_prompt(
                        story=s, os_blueprint=os_blueprint,
                        anthropic_api_key=anthropic_api_key,
                    )
                except Exception as e:
                    logger.warning(f"mentor prompt gen failed: {e}")
                    s["mentor_prompt"] = ""
            feature_out = {**feature, "stories": enriched}
            epic_out["features"].append(feature_out)
            yield {
                "event": "grooming_enriched",
                "data": {
                    "epic_key": epic.get("epic_key"),
                    "feature_key": feature.get("feature_key"),
                    "stories": enriched,
                },
            }
        enriched_epics.append(epic_out)

    yield {"event": "grooming_stage", "data": {"stage": "draft", "status": "complete", "message": f"Drafting done across {feature_counter} feature(s)."}}
    yield {"event": "grooming_stage", "data": {"stage": "enrich", "status": "complete", "message": "All features enriched."}}

    # Stage 5 — Sequence: flatten, build graph, compute critical path + schedule
    yield {"event": "grooming_stage", "data": {"stage": "sequence", "status": "running", "message": "Computing dependencies, critical path, multi-dev schedule..."}}
    all_stories: List[Dict[str, Any]] = []
    for e in enriched_epics:
        for f in e.get("features", []):
            for s in f.get("stories", []):
                all_stories.append({
                    **s,
                    "epic_key": e.get("epic_key"),
                    "feature_key": f.get("feature_key"),
                })

    # Build synthetic nodes/edges using index IDs (the DB IDs aren't known yet)
    synth_nodes = [
        {"id": i, "title": s.get("title"), "priority": s.get("priority"), "points": s.get("story_points"), "epic_key": s.get("epic_key"), "feature_key": s.get("feature_key")}
        for i, s in enumerate(all_stories)
    ]
    synth_edges: List[Dict[str, Any]] = []
    # Resolve intra-feature target_index dependencies into global indices
    global_offset = 0
    for e in enriched_epics:
        for f in e.get("features", []):
            stories_in_feature = f.get("stories", [])
            for local_i, s in enumerate(stories_in_feature):
                for dep in (s.get("dependencies") or []):
                    t = dep.get("target_index")
                    if isinstance(t, int) and 0 <= t < len(stories_in_feature):
                        synth_edges.append({
                            "from": global_offset + local_i,
                            "to": global_offset + t,
                            "type": dep.get("type", "blocked_by"),
                            "reason": dep.get("reason", ""),
                            "added_by": dep.get("added_by", "tech_lead"),
                        })
            global_offset += len(stories_in_feature)

    critical_path = compute_critical_path(synth_nodes, synth_edges)
    schedule = multi_dev_schedule(synth_nodes, synth_edges, dev_count=dev_count)

    yield {
        "event": "grooming_sequence",
        "data": {
            "critical_path_indices": critical_path,
            "dependency_graph": {"nodes": synth_nodes, "edges": synth_edges},
            "multi_dev_schedule": schedule,
        },
    }
    yield {"event": "grooming_stage", "data": {"stage": "sequence", "status": "complete", "message": f"Critical path: {len(critical_path)} stories. Est. {schedule['predicted_sprint_count']} sprint(s) across {dev_count} dev(s)."}}

    yield {
        "event": "grooming_complete",
        "data": {
            "epic_count": len(enriched_epics),
            "feature_count": sum(len(e.get("features", [])) for e in enriched_epics),
            "story_count": len(all_stories),
            "critical_path_length": len(critical_path),
            "predicted_sprint_count": schedule["predicted_sprint_count"],
            "enriched_epics": enriched_epics,   # full nested tree for persistence
        },
    }
