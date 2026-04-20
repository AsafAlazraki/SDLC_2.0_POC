"""
Kickoff Pack Generation
───────────────────────
Turn the discovery synthesis into a full mobilisation document set — eight
focused markdown files instead of one wall-of-text blob, plus a zip and
inspectable individual files.

Solves two problems at once:
  (a) The 105s perceived hang on the existing endpoint — we now stream SSE
      progress phases so the UI can show "compiling exec summary..." etc.
  (b) Output as a proper deliverable — one file per audience (sponsor,
      tech lead, BA, DevOps), not one giant markdown the team has to ctrl-F.

Flow mirrors build_pack.py:
  1. compile_kickoff_pack_spec() — single Claude call (extended thinking) returns
     structured JSON.
  2. generate_kickoff_pack_files() — pure-Python file generator converts the
     spec into the eight numbered markdown documents + a README index.
  3. zip_kickoff_pack() — bundles them for download.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import anthropic

logger = logging.getLogger(__name__)

KICKOFF_PACK_ROOT = Path("kickoff_packs")
KICKOFF_PACK_ROOT.mkdir(exist_ok=True)

KICKOFF_THINKING_BUDGET = 6_000
KICKOFF_OUTPUT_BUDGET = 10_000
KICKOFF_MODEL = "claude-sonnet-4-6"
KICKOFF_MAX_RETRIES = 2


# ═════════════════════════════════════════════════════════════════════════════
# Spec Schema (documentation only — enforced via prompt)
# ═════════════════════════════════════════════════════════════════════════════

KICKOFF_SCHEMA_HINT = """
{
  "meta": {
    "topic": "string — short label for the programme",
    "github_url": "string or null",
    "summary": "1-sentence what-we-are-mobilising-for"
  },
  "executive_one_pager": {
    "headline": "string — single bold statement of the change",
    "body_md": "markdown 3-4 sentences for sponsor / steering committee"
  },
  "team_composition": [
    {
      "role": "Job title (e.g. Solutions Architect)",
      "seniority": "Junior|Mid|Senior|Principal",
      "engagement": "FTE|Contractor|Vendor",
      "headcount": 1,
      "responsibility": "Plain-English primary responsibility on this programme",
      "non_negotiable_skills": ["specific skill 1", "specific skill 2"]
    }
  ],
  "sprint_zero": [
    {
      "owner": "Tech Lead|Architect|BA|PM|DevOps|Security|Data Eng|UX",
      "tasks": ["Specific actionable task — e.g. 'Set up GitHub repo with branch protection on main + signed commits'"]
    }
  ],
  "raci_decisions": [
    {
      "decision": "The decision that must be made",
      "responsible": "Role name(s)",
      "accountable": "Single role name",
      "consulted": "Role name(s) or '-'",
      "informed": "Role name(s) or '-'",
      "deadline": "e.g. 'Sprint 0' or 'End of Month 1'"
    }
  ],
  "day_one_decisions": [
    {
      "decision": "The thing to decide",
      "options": ["Option A", "Option B", "Option C"],
      "recommendation": "Which option, with one-line justification",
      "sign_off": "Who must sign off (role)",
      "if_we_dont": "What stalls if not decided in week 1"
    }
  ],
  "risk_briefing": [
    {
      "risk": "Risk title",
      "severity": "high|medium|low",
      "why": "Why it exists — reference the codebase finding",
      "mitigation": "Concrete mitigation",
      "owner": "Role name",
      "early_warning_signal": "What to watch for"
    }
  ],
  "success_metrics": [
    {
      "kpi": "Metric name",
      "baseline": "Current measurement (or 'Unknown — measure in Sprint 1')",
      "target": "Target value + horizon (e.g. '<200ms p95 by end of Q2')",
      "measurement": "How / which tool measures it"
    }
  ],
  "reporting_cadence": {
    "daily": "What happens daily and who attends",
    "weekly": "What happens weekly",
    "monthly": "Executive review cadence"
  },
  "critical_success_factors": [
    {"factor": "Single sentence", "why": "Why this is the make-or-break"}
  ]
}
"""


# ═════════════════════════════════════════════════════════════════════════════
# Spec Compilation — one Claude call with extended thinking
# ═════════════════════════════════════════════════════════════════════════════

def _compress_agent_summaries(agent_summaries: Optional[Dict[str, str]],
                               *, per_agent: int = 700, max_total: int = 12_000) -> str:
    """Render agent_summaries dict into a budget-bounded prompt fragment."""
    if not agent_summaries:
        return ""
    parts = []
    used = 0
    for key, content in agent_summaries.items():
        if not content:
            continue
        clipped = (content or "").strip()[:per_agent]
        block = f"### {key}\n{clipped}\n"
        if used + len(block) > max_total:
            parts.append(f"\n[... {len(agent_summaries) - len(parts)} more agent summaries truncated for budget ...]")
            break
        parts.append(block)
        used += len(block)
    return "## Specialist Agent Summaries (excerpts)\n\n" + "\n".join(parts)


async def compile_kickoff_pack_spec(
    topic: str,
    synthesis_content: str,
    agent_summaries: Optional[Dict[str, str]],
    anthropic_api_key: str,
    github_url: Optional[str] = None,
    business_context: Optional[str] = None,
    project_materials: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Distil discovery output → structured kickoff spec via one Claude call.

    Returns a dict matching KICKOFF_SCHEMA_HINT.
    """
    if not anthropic_api_key:
        raise RuntimeError("Anthropic API key required for kickoff pack compilation.")

    materials_block = ""
    if project_materials:
        try:
            import materials_extractor as _mx
            materials_block = _mx.materials_to_prompt_block(
                project_materials, max_total_chars=20_000)
        except Exception as e:
            logger.warning(f"Could not render project materials block in kickoff: {e}")

    context_section = ""
    if github_url:
        context_section += f"**Repository under analysis:** {github_url}\n"
    if business_context:
        context_section += f"\n**Business context provided by sponsor:**\n{business_context}\n"

    summaries_section = _compress_agent_summaries(agent_summaries)

    system = (
        "You are a Senior Programme Manager and Transformation Lead with 20+ years "
        "experience standing up modernisation teams. You have just received a "
        "comprehensive AI-generated discovery report. Your job is to compile a "
        "Team Kickoff Pack as a single structured JSON object.\n\n"
        "Be concrete, specific, and immediately actionable. Avoid generalities. "
        "Reference the specific technical findings from the discovery report. "
        "Generic placeholders are a failure — every role, decision, risk, and KPI "
        "must reflect this specific programme.\n\n"
        "Return ONLY a single valid JSON object matching the schema. No prose, "
        "no markdown fences, no explanation."
    )

    prompt = f"""# Kickoff Pack Compilation

## Topic
{topic or "(general modernisation programme)"}

{context_section}
{materials_block}

## Synthesis / Verdict from Discovery Engine
{(synthesis_content or "(synthesis not available — work from agent summaries below)")[:18_000]}

{summaries_section}

---

# Your Job

Read the synthesis verdict above. Distil it into a structured JSON object that
will be mechanically converted into eight focused mobilisation documents:

  00_EXEC_ONE_PAGER.md         — sponsor / steering committee
  10_TEAM_COMPOSITION.md       — HR / programme manager hiring brief
  20_SPRINT_0_CHECKLIST.md     — first-2-weeks task list grouped by owner
  30_RACI.md                   — top-10 decisions matrix
  40_DAY_1_DECISIONS.md        — 5 must-decide-this-week calls
  50_RISK_BRIEFING.md          — top-7 risks new joiners must know
  60_SUCCESS_METRICS.md        — KPIs + reporting cadence
  70_CRITICAL_SUCCESS_FACTORS.md — 3 make-or-break factors

Quality bar:
- Every team_composition row must specify seniority + engagement + non-negotiable skills
- Sprint Zero tasks must be specific verbs ("Set up GitHub repo with branch protection")
  not generic nouns ("Set up source control")
- Day-1 decisions must state what stalls if the call is delayed
- Risks must reference a finding from the discovery (not generic project risks)
- KPIs must include baseline + target + measurement tool
- Critical success factors must be 3 (not 5, not 10) and each one must come with
  a one-line "why this matters most" rationale

## Output Schema

Return ONLY a single valid JSON object matching this shape:

```json
{KICKOFF_SCHEMA_HINT}
```

Return ONLY the JSON object. No markdown fences, no explanation.
"""

    client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)

    last_error: Optional[Exception] = None
    for attempt in range(1, KICKOFF_MAX_RETRIES + 1):
        try:
            message = await client.messages.create(
                model=KICKOFF_MODEL,
                max_tokens=KICKOFF_THINKING_BUDGET + KICKOFF_OUTPUT_BUDGET,
                temperature=1,
                thinking={"type": "enabled", "budget_tokens": KICKOFF_THINKING_BUDGET},
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )

            text = ""
            for block in message.content:
                if getattr(block, "type", None) == "text":
                    text += block.text

            text = text.strip()
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
            text = text.strip()

            spec = json.loads(text)
            spec.setdefault("meta", {})
            spec["meta"].setdefault("topic", topic)
            spec["meta"].setdefault("github_url", github_url)
            spec["meta"]["generated_at"] = datetime.now(timezone.utc).isoformat()
            return spec

        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(f"Kickoff pack spec JSON parse failed on attempt {attempt}: {e}")
            if attempt >= KICKOFF_MAX_RETRIES:
                raise RuntimeError(
                    f"Claude returned unparseable JSON after {KICKOFF_MAX_RETRIES} attempts: {e}"
                )
        except anthropic.APIStatusError as e:
            last_error = e
            logger.warning(f"Anthropic API error on attempt {attempt}: {e}")
            if attempt >= KICKOFF_MAX_RETRIES:
                raise
            await asyncio.sleep(8 * attempt)

    raise RuntimeError(f"Kickoff pack compilation failed: {last_error}")


# ═════════════════════════════════════════════════════════════════════════════
# File Generation — pure Python, no LLM
# ═════════════════════════════════════════════════════════════════════════════

def _write(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def _md_table(headers: List[str], rows: List[List[str]]) -> str:
    """Render a markdown table from headers + rows. Empty rows → friendly note."""
    if not rows:
        return "_(no rows defined)_\n"
    sep = "|" + "|".join("---" for _ in headers) + "|"
    out = ["| " + " | ".join(headers) + " |", sep]
    for r in rows:
        cells = [str(c).replace("|", "\\|").replace("\n", " ").strip() or "—"
                 for c in r]
        # Pad if row is short
        while len(cells) < len(headers):
            cells.append("—")
        out.append("| " + " | ".join(cells[:len(headers)]) + " |")
    return "\n".join(out) + "\n"


def _write_readme(root: Path, spec: Dict[str, Any]) -> Path:
    meta = spec.get("meta", {})
    topic = meta.get("topic", "modernisation programme")
    summary = meta.get("summary", "")
    gh = meta.get("github_url")

    lines = [
        f"# Team Kickoff Pack — {topic}",
        "",
        f"_Generated:_ {meta.get('generated_at', '')}",
    ]
    if gh:
        lines.append(f"_Repository:_ {gh}")
    if summary:
        lines += ["", summary]
    lines += [
        "",
        "---",
        "",
        "## Who reads what",
        "",
        "| File | Audience | Time to read |",
        "|---|---|---|",
        "| `00_EXEC_ONE_PAGER.md` | CTO, sponsor, steering committee | 2 min |",
        "| `10_TEAM_COMPOSITION.md` | Programme manager, HR, recruitment | 5 min |",
        "| `20_SPRINT_0_CHECKLIST.md` | Tech Lead, Architect, BA, DevOps, Security | 10 min |",
        "| `30_RACI.md` | Programme manager, all leads | 5 min |",
        "| `40_DAY_1_DECISIONS.md` | Sponsor + tech leadership (must read week 1) | 5 min |",
        "| `50_RISK_BRIEFING.md` | Every new joiner on Day 1 | 10 min |",
        "| `60_SUCCESS_METRICS.md` | Programme manager, sponsor, leads | 5 min |",
        "| `70_CRITICAL_SUCCESS_FACTORS.md` | Everyone | 2 min |",
        "",
        "---",
        "",
        "## How to use this pack",
        "",
        "1. **Sponsor read-out** — open `00_EXEC_ONE_PAGER.md` in the next steering committee.",
        "2. **Hiring kick-off** — give `10_TEAM_COMPOSITION.md` to recruitment / HR today.",
        "3. **First standup** — walk the team through `20_SPRINT_0_CHECKLIST.md`.",
        "4. **First retro** — review `40_DAY_1_DECISIONS.md` and confirm sign-offs are in.",
        "5. **Day-1 onboarding pack** — every new joiner reads `50_RISK_BRIEFING.md` + `70_CRITICAL_SUCCESS_FACTORS.md`.",
        "6. **Programme reporting** — set up dashboards from `60_SUCCESS_METRICS.md` in Sprint 1.",
        "",
        "Files are deliberately numbered so they sort in the order a team typically",
        "reads them. The synthesis verdict from the discovery engine drove every section.",
    ]
    return _write(root / "README.md", "\n".join(lines) + "\n")


def _write_executive_one_pager(root: Path, spec: Dict[str, Any]) -> Path:
    meta = spec.get("meta", {})
    eop = spec.get("executive_one_pager") or {}
    headline = eop.get("headline", "Modernisation programme — Day 0 brief")
    body = eop.get("body_md", "_(executive summary not provided)_")

    lines = [
        "# Executive One-Pager",
        "",
        f"**{headline}**",
        "",
        body,
        "",
        "---",
        "",
        f"_Programme:_ {meta.get('topic', '—')}",
    ]
    if meta.get("github_url"):
        lines.append(f"_Repository:_ {meta['github_url']}")
    lines.append(f"_Generated:_ {meta.get('generated_at', '')}")
    return _write(root / "00_EXEC_ONE_PAGER.md", "\n".join(lines) + "\n")


def _write_team_composition(root: Path, spec: Dict[str, Any]) -> Path:
    team = spec.get("team_composition") or []
    lines = ["# Recommended Team Composition", ""]
    if not team:
        lines.append("_(no team composition recommended — discovery did not surface enough role context)_")
        return _write(root / "10_TEAM_COMPOSITION.md", "\n".join(lines) + "\n")

    headers = ["Role", "Seniority", "Engagement", "FTE", "Primary Responsibility"]
    rows = [
        [
            t.get("role", ""),
            t.get("seniority", ""),
            t.get("engagement", ""),
            str(t.get("headcount", 1)),
            t.get("responsibility", ""),
        ]
        for t in team
    ]
    lines.append(_md_table(headers, rows))
    lines.append("")
    lines.append("## Non-negotiable skills (per role)")
    lines.append("")
    for t in team:
        skills = t.get("non_negotiable_skills") or []
        if not skills:
            continue
        lines.append(f"### {t.get('role','(role)')} _({t.get('seniority','')})_")
        for sk in skills:
            lines.append(f"- {sk}")
        lines.append("")
    return _write(root / "10_TEAM_COMPOSITION.md", "\n".join(lines) + "\n")


def _write_sprint_zero(root: Path, spec: Dict[str, Any]) -> Path:
    sz = spec.get("sprint_zero") or []
    lines = [
        "# Sprint 0 Checklist",
        "",
        "_Two weeks before development starts. Group by owner. Check off as you go._",
        "",
    ]
    if not sz:
        lines.append("_(no sprint-0 tasks defined)_")
        return _write(root / "20_SPRINT_0_CHECKLIST.md", "\n".join(lines) + "\n")
    for group in sz:
        owner = group.get("owner", "Unassigned")
        lines.append(f"## {owner}")
        lines.append("")
        for task in group.get("tasks") or []:
            lines.append(f"- [ ] {task}")
        lines.append("")
    return _write(root / "20_SPRINT_0_CHECKLIST.md", "\n".join(lines) + "\n")


def _write_raci(root: Path, spec: Dict[str, Any]) -> Path:
    raci = spec.get("raci_decisions") or []
    lines = [
        "# RACI Matrix — Top Decisions",
        "",
        "_R = Responsible (does the work) · A = Accountable (owns the outcome) · C = Consulted · I = Informed_",
        "",
    ]
    if not raci:
        lines.append("_(no RACI decisions defined)_")
        return _write(root / "30_RACI.md", "\n".join(lines) + "\n")

    headers = ["Decision", "R", "A", "C", "I", "Deadline"]
    rows = [
        [
            d.get("decision", ""),
            d.get("responsible", ""),
            d.get("accountable", ""),
            d.get("consulted", ""),
            d.get("informed", ""),
            d.get("deadline", ""),
        ]
        for d in raci
    ]
    lines.append(_md_table(headers, rows))
    return _write(root / "30_RACI.md", "\n".join(lines) + "\n")


def _write_day_one_decisions(root: Path, spec: Dict[str, Any]) -> Path:
    decisions = spec.get("day_one_decisions") or []
    lines = [
        "# Day 1 Decisions",
        "",
        "_The calls that must be made in Week 1 — or the programme stalls. Sign-off owner named for each._",
        "",
    ]
    if not decisions:
        lines.append("_(no Day-1 decisions identified)_")
        return _write(root / "40_DAY_1_DECISIONS.md", "\n".join(lines) + "\n")

    for i, d in enumerate(decisions, 1):
        lines.append(f"## {i}. {d.get('decision', '')}")
        lines.append("")
        opts = d.get("options") or []
        if opts:
            lines.append("**Options:**")
            for o in opts:
                lines.append(f"- {o}")
        rec = d.get("recommendation")
        if rec:
            lines.append(f"\n**Recommendation:** {rec}")
        signoff = d.get("sign_off")
        if signoff:
            lines.append(f"\n**Sign-off owner:** {signoff}")
        ifnot = d.get("if_we_dont")
        if ifnot:
            lines.append(f"\n**If we don't decide in week 1:** {ifnot}")
        lines.append("\n---\n")
    return _write(root / "40_DAY_1_DECISIONS.md", "\n".join(lines) + "\n")


def _write_risk_briefing(root: Path, spec: Dict[str, Any]) -> Path:
    risks = spec.get("risk_briefing") or []
    lines = [
        "# Risk Briefing for New Team Members",
        "",
        "_Read on Day 1. Each risk references a specific discovery finding._",
        "",
    ]
    if not risks:
        lines.append("_(no risk briefing items)_")
        return _write(root / "50_RISK_BRIEFING.md", "\n".join(lines) + "\n")

    for i, r in enumerate(risks, 1):
        sev = (r.get("severity") or "medium").lower()
        marker = {"high": "🔴", "medium": "🟠", "low": "🟡"}.get(sev, "🟠")
        lines.append(f"## {i}. {marker} {r.get('risk', '(risk)')}  _({sev})_")
        lines.append("")
        if r.get("why"):
            lines.append(f"**Why it exists:** {r['why']}")
        if r.get("mitigation"):
            lines.append(f"\n**Mitigation:** {r['mitigation']}")
        if r.get("owner"):
            lines.append(f"\n**Owner:** {r['owner']}")
        if r.get("early_warning_signal"):
            lines.append(f"\n**Early warning signal:** {r['early_warning_signal']}")
        lines.append("\n---\n")
    return _write(root / "50_RISK_BRIEFING.md", "\n".join(lines) + "\n")


def _write_success_metrics(root: Path, spec: Dict[str, Any]) -> Path:
    kpis = spec.get("success_metrics") or []
    cadence = spec.get("reporting_cadence") or {}
    lines = ["# Success Metrics & Reporting Cadence", ""]
    if kpis:
        lines.append("## KPIs")
        lines.append("")
        rows = [
            [k.get("kpi", ""), k.get("baseline", ""), k.get("target", ""), k.get("measurement", "")]
            for k in kpis
        ]
        lines.append(_md_table(["KPI", "Baseline", "Target", "How measured"], rows))
        lines.append("")
    else:
        lines.append("_(no KPIs defined)_\n")

    lines.append("## Reporting Cadence")
    lines.append("")
    if cadence:
        if cadence.get("daily"):
            lines.append(f"**Daily:** {cadence['daily']}")
            lines.append("")
        if cadence.get("weekly"):
            lines.append(f"**Weekly:** {cadence['weekly']}")
            lines.append("")
        if cadence.get("monthly"):
            lines.append(f"**Monthly:** {cadence['monthly']}")
            lines.append("")
    else:
        lines.append("_(no reporting cadence specified)_")
    return _write(root / "60_SUCCESS_METRICS.md", "\n".join(lines) + "\n")


def _write_critical_success_factors(root: Path, spec: Dict[str, Any]) -> Path:
    csfs = spec.get("critical_success_factors") or []
    lines = [
        "# The Three Things That Will Make or Break This Programme",
        "",
        "_Three — not five, not ten. If the team focuses on nothing else, focus on these._",
        "",
    ]
    if not csfs:
        lines.append("_(no critical success factors identified)_")
        return _write(root / "70_CRITICAL_SUCCESS_FACTORS.md", "\n".join(lines) + "\n")

    for i, c in enumerate(csfs[:3], 1):
        # Tolerant of either {"factor","why"} dict or bare string
        if isinstance(c, str):
            lines.append(f"## {i}. {c}")
            lines.append("")
            continue
        factor = c.get("factor", "(factor)")
        why = c.get("why", "")
        lines.append(f"## {i}. {factor}")
        if why:
            lines.append("")
            lines.append(f"_Why this matters most:_ {why}")
        lines.append("")
    return _write(root / "70_CRITICAL_SUCCESS_FACTORS.md", "\n".join(lines) + "\n")


# ── Top-level orchestrator ──────────────────────────────────────────────────

# (writer_fn, file_label_for_status_event)
SECTION_WRITERS = [
    (_write_readme,                     "README.md"),
    (_write_executive_one_pager,        "00_EXEC_ONE_PAGER.md"),
    (_write_team_composition,           "10_TEAM_COMPOSITION.md"),
    (_write_sprint_zero,                "20_SPRINT_0_CHECKLIST.md"),
    (_write_raci,                       "30_RACI.md"),
    (_write_day_one_decisions,          "40_DAY_1_DECISIONS.md"),
    (_write_risk_briefing,              "50_RISK_BRIEFING.md"),
    (_write_success_metrics,            "60_SUCCESS_METRICS.md"),
    (_write_critical_success_factors,   "70_CRITICAL_SUCCESS_FACTORS.md"),
]


def generate_kickoff_pack_files(spec: Dict[str, Any], output_dir: Path) -> List[Path]:
    """Convert a compiled spec into the kickoff document set."""
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    written: List[Path] = []
    for fn, _label in SECTION_WRITERS:
        try:
            written.append(fn(output_dir, spec))
        except Exception as e:
            logger.exception(f"Kickoff section writer {fn.__name__} failed: {e}")
            err_path = output_dir / f"_GENERATION_ERROR_{fn.__name__}.txt"
            err_path.write_text(f"{type(e).__name__}: {e}\n", encoding="utf-8")
            written.append(err_path)

    # Save the raw spec for audit + so the UI preview can reload structured form
    _write(output_dir / "_spec.json", json.dumps(spec, indent=2))
    return written


def zip_kickoff_pack(output_dir: Path) -> Path:
    """Zip output_dir to <output_dir>.zip and return the zip path."""
    zip_path = output_dir.with_suffix(".zip")
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(output_dir):
            for fname in files:
                full = Path(root) / fname
                rel = full.relative_to(output_dir.parent)
                zf.write(full, rel)
    return zip_path


def new_pack_id() -> str:
    return uuid.uuid4().hex[:16]


def pack_dir(pack_id: str) -> Path:
    return KICKOFF_PACK_ROOT / pack_id


def pack_zip(pack_id: str) -> Path:
    return KICKOFF_PACK_ROOT / f"{pack_id}.zip"


def list_pack_files(pack_id: str) -> List[Dict[str, Any]]:
    """Return metadata for each file in the pack directory."""
    d = pack_dir(pack_id)
    if not d.exists():
        return []
    out = []
    for p in sorted(d.iterdir()):
        if not p.is_file():
            continue
        stat = p.stat()
        out.append({
            "filename": p.name,
            "size": stat.st_size,
            "preview_url": f"/api/kickoff-pack/{pack_id}/file/{p.name}",
        })
    return out
