"""
Build Pack Generation
─────────────────────
Turn completed discovery reports into a downloadable bundle of implementation
artefacts: entity JSON+SQL DDL, OpenAPI specs, user stories, Mermaid diagrams,
migration scripts, ODC import guides, etc.

Flow:
  1. `compile_build_pack_spec()` — one (or more) Claude Sonnet 4.6 calls with
     extended thinking distil the persona reports + synthesis into a single
     structured JSON spec matching BUILD_PACK_SCHEMA.
  2. `generate_build_pack_files()` — pure-Python file generator converts the
     spec into ~30 files across 13 directories.
  3. `zip_build_pack()` — zips the directory for download.

The output is designed to give an OutSystems Developer Cloud (ODC) team (or
any modernisation team) a 10x head start on actually building the planned
solution. It is NOT a one-click-import OML package — see the ODC_IMPORT_GUIDE
inside every pack for what the dev still has to do by hand.
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

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover — fallback only
    yaml = None  # type: ignore

logger = logging.getLogger(__name__)

BUILD_PACK_ROOT = Path("build_packs")
BUILD_PACK_ROOT.mkdir(exist_ok=True)

# Generation budget — one Claude call with extended thinking producing the whole spec.
BUILD_PACK_THINKING_BUDGET = 10_000
BUILD_PACK_OUTPUT_BUDGET = 14_000
BUILD_PACK_MODEL = "claude-sonnet-4-6"

# If a single generation attempt fails JSON parse, retry with a tighter reminder.
BUILD_PACK_MAX_RETRIES = 2


# ═════════════════════════════════════════════════════════════════════════════
# Spec Schema (documentation only — enforced via prompt)
# ═════════════════════════════════════════════════════════════════════════════

BUILD_PACK_SCHEMA_HINT = """
{
  "meta": {
    "topic": "string",
    "target_platform": "string e.g. OutSystems Developer Cloud",
    "current_platform": "string or null e.g. OutSystems 11",
    "recommended_path": "Conservative|Balanced|Transformative",
    "summary": "1-2 sentence description of what this pack builds"
  },
  "executive_summary_md": "markdown — executive summary drawn from synthesis",
  "requirements": {
    "epics": [{"name": "str", "description": "str", "priority": "high|med|low"}],
    "user_stories": [{
      "epic": "str (matches epics.name)",
      "title": "str",
      "story": "As a <role> I want <capability> so that <outcome>",
      "acceptance_criteria": ["str"],
      "points": 1,
      "priority": "high|med|low",
      "dependencies": ["other story title"]
    }],
    "personas": [{"name": "str", "description": "str", "roles": ["str"]}]
  },
  "architecture": {
    "layers": [{
      "name": "Foundation|Core Widgets|Core Services|End User",
      "description": "str",
      "modules": [{
        "name": "str",
        "type": "library|service|app|extension",
        "description": "str",
        "depends_on": ["other module name"]
      }]
    }],
    "integration_patterns": ["str"],
    "forge_components": [{
      "name": "str",
      "url": "https://...",
      "purpose": "str",
      "replaces": "str (what custom build this avoids)"
    }]
  },
  "data_model": {
    "entities": [{
      "name": "str (PascalCase)",
      "description": "str",
      "module": "str",
      "is_static": false,
      "attributes": [{
        "name": "str (PascalCase)",
        "type": "Long Integer|Integer|Text|DateTime|Date|Time|Boolean|Decimal|Currency|Email|PhoneNumber|Entity Identifier",
        "length": 0,
        "mandatory": true,
        "is_identifier": false,
        "is_auto_number": false,
        "default": "str or null",
        "description": "str"
      }],
      "indexes": [{"name": "str", "attributes": ["str"], "unique": false}],
      "static_records": []
    }],
    "relationships": [{
      "from_entity": "str",
      "from_attribute": "str",
      "to_entity": "str",
      "type": "many-to-one|one-to-one",
      "on_delete": "Cascade|Protect|Ignore"
    }]
  },
  "service_actions": [{
    "name": "str (PascalCase verb phrase)",
    "module": "str",
    "description": "str",
    "inputs": [{"name": "str", "type": "str", "mandatory": true, "description": "str"}],
    "outputs": [{"name": "str", "type": "str", "description": "str"}],
    "exposed_as_rest": false,
    "rest_method": "GET|POST|PUT|DELETE or null",
    "rest_path": "/path or null",
    "business_rules": ["str"],
    "called_by": ["screen or action name"]
  }],
  "integrations": {
    "consumed_apis": [{
      "name": "str",
      "base_url": "str",
      "description": "str",
      "auth": "None|ApiKey|OAuth2|Basic",
      "endpoints": [{
        "method": "GET|POST|PUT|DELETE",
        "path": "/path",
        "description": "str",
        "request_schema": {},
        "response_schema": {}
      }]
    }],
    "exposed_apis": []
  },
  "screens": [{
    "name": "str (PascalCase)",
    "module": "str",
    "route": "/path",
    "type": "list|detail|form|dashboard|wizard|modal",
    "description": "str",
    "role_access": ["str"],
    "widgets": ["str"],
    "actions_triggered": ["service action name"],
    "wireframe_md": "markdown description of layout, sections, widgets"
  }],
  "navigation_flow": [{
    "from": "screen name",
    "to": "screen name",
    "trigger": "str (button, link, flow)",
    "condition": "str or null"
  }],
  "security": {
    "roles": [{"name": "str", "description": "str", "permissions": ["str"]}],
    "auth_approach": "str",
    "data_classification": [{
      "entity": "str",
      "classification": "Public|Internal|Confidential|Restricted",
      "rationale": "str"
    }],
    "compliance_requirements": ["str"]
  },
  "quality": {
    "test_strategy_md": "markdown",
    "test_scenarios": [{
      "name": "str",
      "type": "unit|integration|e2e|performance|security",
      "description": "str",
      "steps": ["str"],
      "expected": "str"
    }],
    "risk_register": [{"risk": "str", "severity": "high|med|low", "mitigation": "str"}]
  },
  "operations": {
    "environments": [{
      "name": "Dev|Test|Staging|Prod",
      "purpose": "str",
      "scaling": "str",
      "data_refresh": "str"
    }],
    "ci_cd_md": "markdown describing the ODC/CI pipeline",
    "observability_md": "markdown describing monitoring, alerting, logging"
  },
  "migration": {
    "applicable": true,
    "strategy": "Strangler Fig|Big Bang|Parallel Run|Phased Coexistence",
    "phases": [{
      "name": "str",
      "sprint_range": "S1-S2",
      "scope": "str",
      "go_no_go_criteria": "str"
    }],
    "data_migration_approach_md": "markdown",
    "data_migration_sql": "multi-statement SQL or empty string",
    "cutover_checklist": ["str"]
  },
  "commercial": {
    "licencing_estimate_md": "markdown with ballpark numbers",
    "build_effort_md": "markdown with team shape + sprint count",
    "roi_model_md": "markdown"
  },
  "sprint_plan": [{
    "sprint": 1,
    "name": "str",
    "goals": ["str"],
    "story_titles": ["str"],
    "demo_criteria": "str"
  }]
}
"""


# ═════════════════════════════════════════════════════════════════════════════
# Spec Compilation — one Claude call with extended thinking
# ═════════════════════════════════════════════════════════════════════════════

def _truncate_reports_for_prompt(persona_reports: Dict[str, str], max_chars: int = 120_000) -> str:
    """
    Concatenate all persona reports into a single block, truncating per-report
    if the total would exceed max_chars. Preserves header labels so Claude can
    still tell who said what.
    """
    if not persona_reports:
        return ""

    # Budget per report — bias toward planners (architect, ba, api_designer, outsystems_*)
    planner_keys = {
        "architect", "ba", "api_designer", "data_engineering",
        "outsystems_architect", "outsystems_migration", "ui_ux",
    }
    reserve = max_chars
    per_planner = int(max_chars * 0.08)       # ~9.6K chars each for planners
    per_other = int(max_chars * 0.035)        # ~4.2K chars each for others

    chunks: List[str] = []
    for key, content in persona_reports.items():
        cap = per_planner if key in planner_keys else per_other
        clipped = content[:cap]
        if len(content) > cap:
            clipped += f"\n\n[... report truncated from {len(content):,} to {cap:,} chars for pack compilation ...]"
        chunks.append(f"=== REPORT: {key} ===\n{clipped}\n=== END REPORT: {key} ===\n")

    combined = "\n".join(chunks)
    if len(combined) > max_chars:
        combined = combined[:max_chars] + f"\n\n[... combined reports truncated at {max_chars:,} chars ...]"
    return combined


async def compile_build_pack_spec(
    topic: str,
    persona_reports: Dict[str, str],
    synthesis_content: str,
    recon_data: Optional[Dict[str, Any]],
    anthropic_api_key: str,
    client_context: str = "",
) -> Dict[str, Any]:
    """
    Compile persona reports + synthesis into a single structured build pack spec.

    Uses Claude Sonnet 4.6 with extended thinking (10K budget, 14K output).
    Returns a dict matching BUILD_PACK_SCHEMA_HINT.
    """
    if not anthropic_api_key:
        raise RuntimeError("Anthropic API key required for build pack compilation.")

    reports_block = _truncate_reports_for_prompt(persona_reports)
    recon_block = ""
    if recon_data and recon_data.get("_recon_success"):
        recon_block = "\n## Recon Summary\n" + json.dumps(recon_data, indent=2)[:4000]

    system = (
        "You are the Build Pack Compiler. Your sole job is to read the full "
        "discovery output from a 15+ agent fleet (including a synthesis verdict) "
        "and distil it into a single structured JSON spec that can be mechanically "
        "converted into implementation artefacts (entity DDL, OpenAPI specs, user "
        "stories, screen wireframes, sprint plans, migration scripts, etc.).\n\n"
        "You MUST return a single valid JSON object matching the schema the user "
        "provides. No prose, no markdown fences, no explanation — just the JSON."
    )

    prompt = f"""# Build Pack Compilation Task

## Topic
{topic}

## Client Context
{client_context or "(none provided)"}
{recon_block}

## Synthesis — The Verdict
{synthesis_content[:30_000] if synthesis_content else "(synthesis not available)"}

## All Persona Reports
{reports_block}

---

# Your Job

Read every report above. Distil the COMBINED plan (giving priority to the
synthesis verdict's recommended path and the OutSystems-specific agents where
relevant) into a single JSON object that an automated file generator will turn
into a downloadable build pack.

Be concrete. Where the reports were general, make specific decisions. Where
they disagreed, follow the synthesis verdict. Where they were silent, use your
own expert judgement consistent with the target platform.

The output will be converted into ~30 files across 13 directories — entities
become SQL DDL and JSON, service actions become OpenAPI, screens become
wireframe markdown, stories become Jira-ready JSON, migration plans become
SQL and checklists. Your structured output MUST be precise enough for that
conversion to produce useful, specific artefacts. Generic placeholders are
a failure — every entity, action, screen, and story must reflect the specific
problem domain of the topic above.

## Output Schema

Return ONLY a single valid JSON object matching this schema shape. Arrays can
be empty where truly not applicable, but for the primary topic above every
section should be populated with real domain-specific content.

```json
{BUILD_PACK_SCHEMA_HINT}
```

Return ONLY the JSON object. No markdown fences, no explanation.
"""

    client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)

    last_error: Optional[Exception] = None
    for attempt in range(1, BUILD_PACK_MAX_RETRIES + 1):
        try:
            message = await client.messages.create(
                model=BUILD_PACK_MODEL,
                max_tokens=BUILD_PACK_THINKING_BUDGET + BUILD_PACK_OUTPUT_BUDGET,
                temperature=1,  # required for extended thinking
                thinking={"type": "enabled", "budget_tokens": BUILD_PACK_THINKING_BUDGET},
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )

            # Drop thinking blocks, keep only final text
            text = ""
            for block in message.content:
                if getattr(block, "type", None) == "text":
                    text += block.text

            text = text.strip()
            # Strip code fences if Claude added them despite instructions
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
            text = text.strip()

            spec = json.loads(text)
            spec.setdefault("meta", {})
            spec["meta"].setdefault("topic", topic)
            spec["meta"]["generated_at"] = datetime.now(timezone.utc).isoformat()
            return spec

        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(f"Build pack spec JSON parse failed on attempt {attempt}: {e}")
            if attempt >= BUILD_PACK_MAX_RETRIES:
                raise RuntimeError(
                    f"Claude returned unparseable JSON after {BUILD_PACK_MAX_RETRIES} attempts: {e}"
                )
        except anthropic.APIStatusError as e:
            last_error = e
            logger.warning(f"Anthropic API error on attempt {attempt}: {e}")
            if attempt >= BUILD_PACK_MAX_RETRIES:
                raise
            await asyncio.sleep(10 * attempt)

    raise RuntimeError(f"Build pack compilation failed: {last_error}")


# ═════════════════════════════════════════════════════════════════════════════
# File Generation — pure Python, no LLM
# ═════════════════════════════════════════════════════════════════════════════

def _safe_name(s: str) -> str:
    """Turn an arbitrary label into a safe filename fragment."""
    if not s:
        return "unnamed"
    cleaned = re.sub(r'[^A-Za-z0-9_\-]+', '_', str(s)).strip('_')
    return cleaned[:80] or "unnamed"


def _yaml_dump(obj: Any) -> str:
    """YAML dump with a pure-JSON fallback if pyyaml is missing."""
    if yaml is None:
        return json.dumps(obj, indent=2, default=str)
    return yaml.safe_dump(obj, sort_keys=False, default_flow_style=False, allow_unicode=True)


def _write(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


# ── Individual section generators ───────────────────────────────────────────

def _write_readme(root: Path, spec: Dict[str, Any]) -> List[Path]:
    meta = spec.get("meta", {})
    topic = meta.get("topic", "")
    target = meta.get("target_platform", "target platform")
    current = meta.get("current_platform", "")
    path_choice = meta.get("recommended_path", "Balanced")
    summary = meta.get("summary", "")

    content = f"""# Build Pack — {topic}

**Target Platform:** {target}
{"**Migrating From:** " + current if current else ""}
**Recommended Path:** {path_choice}
**Generated:** {meta.get('generated_at', '')}

{summary}

---

## What's in this pack

This bundle contains everything a delivery team needs to start implementation:

| Folder | Contents | Who reads this |
|---|---|---|
| `00_EXECUTIVE_SUMMARY/` | Synthesis verdict, 3 strategic paths | CTO, sponsor |
| `01_REQUIREMENTS/` | Epics, user stories, personas | BA, PM, dev team |
| `02_ARCHITECTURE/` | 4-layer module blueprint, diagrams, Forge shortlist | Architect, lead devs |
| `03_DATA_MODEL/` | Entity definitions, SQL DDL, ER diagram, static data | Data engineer, backend devs |
| `04_SERVICE_ACTIONS/` | Action specs, OpenAPI, business rules | Backend devs, API consumers |
| `05_INTEGRATIONS/` | Consumed & exposed APIs (OpenAPI), integration map | Integration engineer |
| `06_UX/` | Screen inventory, wireframes, nav flow, RBAC | UX designer, frontend devs |
| `07_SECURITY/` | Roles, data classification, compliance checklist | Security, compliance |
| `08_QUALITY/` | Test plan, scenarios, risk register | QA lead |
| `09_OPERATIONS/` | Environments, CI/CD, observability | DevOps, SRE |
| `10_MIGRATION/` | Strategy, phases, data migration SQL, cutover | Migration lead |
| `11_COMMERCIAL/` | Licencing, effort, ROI | Sponsor, finance |
| `99_ODC_IMPORT_GUIDE/` | Step-by-step assembly in ODC Studio | ODC developer |

---

## Honest disclaimer

This pack is a **10x head-start**, not a one-click-import solution. A human
developer on the target platform still:

1. Creates the modules in ODC Studio / Service Studio
2. Defines entities using the `03_DATA_MODEL/entities.json` as a checklist
3. Builds service actions using the `04_SERVICE_ACTIONS/actions.json` specs
4. Assembles screens using the wireframes in `06_UX/`
5. Wires the navigation per `06_UX/navigation-flow.mmd`
6. Imports Forge components listed in `02_ARCHITECTURE/forge-shortlist.md`
7. Follows the step-by-step walkthrough in `99_ODC_IMPORT_GUIDE/`

SQL files in `03_DATA_MODEL/schema.sql` and `10_MIGRATION/data-migration.sql`
are directly runnable against PostgreSQL / SQL Server for staging data
preparation. OpenAPI specs in `04_SERVICE_ACTIONS/` and `05_INTEGRATIONS/`
are directly importable into ODC's "Consume REST API" flow.

---

## Build order (recommended)

1. Read `00_EXECUTIVE_SUMMARY/synthesis.md` and align with sponsor
2. Walk `02_ARCHITECTURE/blueprint.md` with the architect + tech lead
3. Import Forge components from `02_ARCHITECTURE/forge-shortlist.md`
4. Create modules per `02_ARCHITECTURE/modules.yaml` (Foundation → Core → End User)
5. Create entities per `03_DATA_MODEL/entities.json` (one module at a time)
6. Build service actions per `04_SERVICE_ACTIONS/actions.json`
7. Wire integrations per `05_INTEGRATIONS/consumed-apis.yaml`
8. Build screens per `06_UX/screen-inventory.md` + wireframes
9. Apply security per `07_SECURITY/`
10. Execute test plan per `08_QUALITY/`
11. Follow migration plan per `10_MIGRATION/` (if applicable)
12. Deploy per `09_OPERATIONS/`

Sprint-by-sprint plan is in `01_REQUIREMENTS/sprint-plan.md`.
"""
    return [_write(root / "README.md", content)]


def _write_executive_summary(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "00_EXECUTIVE_SUMMARY"
    exec_md = spec.get("executive_summary_md", "_(no synthesis content available)_")
    return [_write(out / "synthesis.md", f"# Executive Summary\n\n{exec_md}\n")]


def _write_requirements(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "01_REQUIREMENTS"
    req = spec.get("requirements", {}) or {}
    written: List[Path] = []

    # Epics + stories — markdown
    lines = ["# Requirements", ""]
    for epic in req.get("epics", []) or []:
        lines.append(f"## Epic: {epic.get('name', 'Unnamed Epic')}")
        lines.append(f"_Priority: {epic.get('priority', 'med')}_\n")
        lines.append(epic.get("description", ""))
        lines.append("")

        stories = [s for s in (req.get("user_stories") or []) if s.get("epic") == epic.get("name")]
        if stories:
            lines.append("### Stories")
            for s in stories:
                lines.append(f"\n**{s.get('title', '')}** — `{s.get('points', '?')}pt` _{s.get('priority', 'med')}_\n")
                lines.append(f"> {s.get('story', '')}\n")
                acs = s.get("acceptance_criteria") or []
                if acs:
                    lines.append("**Acceptance Criteria:**")
                    for ac in acs:
                        lines.append(f"- {ac}")
                deps = s.get("dependencies") or []
                if deps:
                    lines.append(f"\n_Depends on:_ {', '.join(deps)}")
                lines.append("")
        lines.append("---\n")

    # Orphan stories (no matching epic)
    orphans = [s for s in (req.get("user_stories") or []) if not any(
        e.get("name") == s.get("epic") for e in (req.get("epics") or [])
    )]
    if orphans:
        lines.append("## Unallocated Stories\n")
        for s in orphans:
            lines.append(f"- **{s.get('title', '')}** ({s.get('points', '?')}pt): {s.get('story', '')}")

    written.append(_write(out / "user-stories.md", "\n".join(lines)))
    written.append(_write(out / "user-stories.json", json.dumps(req, indent=2)))

    # Personas
    personas_lines = ["# Personas & Roles", ""]
    for p in req.get("personas") or []:
        personas_lines.append(f"## {p.get('name', 'Unnamed')}")
        personas_lines.append(p.get("description", ""))
        roles = p.get("roles") or []
        if roles:
            personas_lines.append(f"\n**Roles:** {', '.join(roles)}")
        personas_lines.append("")
    written.append(_write(out / "personas-and-roles.md", "\n".join(personas_lines)))

    # Sprint plan lives in requirements area
    sprint_plan = spec.get("sprint_plan") or []
    if sprint_plan:
        sp_lines = ["# Sprint Plan", ""]
        for s in sprint_plan:
            sp_lines.append(f"## Sprint {s.get('sprint', '?')} — {s.get('name', '')}")
            sp_lines.append("**Goals:**")
            for g in s.get("goals") or []:
                sp_lines.append(f"- {g}")
            titles = s.get("story_titles") or []
            if titles:
                sp_lines.append("\n**Stories in this sprint:**")
                for t in titles:
                    sp_lines.append(f"- {t}")
            demo = s.get("demo_criteria")
            if demo:
                sp_lines.append(f"\n**Demo criteria:** {demo}")
            sp_lines.append("\n---\n")
        written.append(_write(out / "sprint-plan.md", "\n".join(sp_lines)))

    return written


def _write_architecture(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "02_ARCHITECTURE"
    arch = spec.get("architecture", {}) or {}
    written: List[Path] = []

    # Blueprint markdown
    lines = ["# 4-Layer Architecture Blueprint", ""]
    for layer in arch.get("layers") or []:
        lines.append(f"## Layer: {layer.get('name', 'Unnamed Layer')}")
        lines.append(layer.get("description", ""))
        lines.append("")
        for mod in layer.get("modules") or []:
            lines.append(f"### Module: `{mod.get('name', '')}` _({mod.get('type', 'module')})_")
            lines.append(mod.get("description", ""))
            deps = mod.get("depends_on") or []
            if deps:
                lines.append(f"\n**Depends on:** {', '.join(f'`{d}`' for d in deps)}")
            lines.append("")
        lines.append("---\n")

    patterns = arch.get("integration_patterns") or []
    if patterns:
        lines.append("## Integration Patterns")
        for p in patterns:
            lines.append(f"- {p}")
    written.append(_write(out / "blueprint.md", "\n".join(lines)))

    # Modules YAML
    modules_yaml = {"layers": arch.get("layers") or []}
    written.append(_write(out / "modules.yaml", _yaml_dump(modules_yaml)))

    # Architecture diagram — Mermaid: module dependency graph
    diagram_lines = ["graph TD"]
    module_ids: Dict[str, str] = {}
    idx = 0
    for layer in arch.get("layers") or []:
        layer_name = layer.get("name", "Layer")
        for mod in layer.get("modules") or []:
            mid = f"M{idx}"
            idx += 1
            module_ids[mod.get("name", mid)] = mid
            diagram_lines.append(f'    {mid}["<b>{mod.get("name", "Module")}</b><br/><i>{layer_name}</i>"]')
    for layer in arch.get("layers") or []:
        for mod in layer.get("modules") or []:
            src = module_ids.get(mod.get("name", ""))
            if not src:
                continue
            for dep in mod.get("depends_on") or []:
                tgt = module_ids.get(dep)
                if tgt:
                    diagram_lines.append(f"    {src} --> {tgt}")
    written.append(_write(out / "architecture-diagram.mmd", "\n".join(diagram_lines)))

    # Forge shortlist — md + json
    forge = arch.get("forge_components") or []
    forge_lines = ["# Forge Component Shortlist", ""]
    if forge:
        forge_lines.append("| Component | URL | Purpose | Replaces |")
        forge_lines.append("|---|---|---|---|")
        for f in forge:
            forge_lines.append(
                f"| {f.get('name', '')} | {f.get('url', '')} | {f.get('purpose', '')} | {f.get('replaces', '')} |"
            )
    else:
        forge_lines.append("_No Forge components recommended for this build._")
    written.append(_write(out / "forge-shortlist.md", "\n".join(forge_lines)))
    written.append(_write(out / "forge-shortlist.json", json.dumps(forge, indent=2)))

    return written


def _sql_type(attr_type: str, length: Optional[int] = None) -> str:
    """Map OutSystems/logical types to generic SQL types."""
    t = (attr_type or "").strip().lower()
    length = length or 0
    if t in ("text", "string"):
        return f"VARCHAR({length})" if length else "TEXT"
    if t in ("long integer", "bigint"):
        return "BIGINT"
    if t in ("integer", "int"):
        return "INTEGER"
    if t == "boolean":
        return "BOOLEAN"
    if t in ("datetime", "timestamp"):
        return "TIMESTAMP"
    if t == "date":
        return "DATE"
    if t == "time":
        return "TIME"
    if t in ("decimal", "currency"):
        return "DECIMAL(18,4)"
    if t in ("email", "phonenumber", "phone number"):
        return f"VARCHAR({length or 255})"
    if t in ("entity identifier",):
        return "BIGINT"
    return "TEXT"


def _write_data_model(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "03_DATA_MODEL"
    dm = spec.get("data_model", {}) or {}
    entities = dm.get("entities") or []
    relationships = dm.get("relationships") or []
    written: List[Path] = []

    # entities.json
    written.append(_write(out / "entities.json", json.dumps(dm, indent=2)))

    # entities.md
    md = ["# Data Model", ""]
    for e in entities:
        md.append(f"## Entity: `{e.get('name', 'Unnamed')}`")
        md.append(f"_Module:_ `{e.get('module', '')}` _Static:_ {e.get('is_static', False)}")
        md.append(e.get("description", ""))
        md.append("")
        attrs = e.get("attributes") or []
        if attrs:
            md.append("| Attribute | Type | Mandatory | Identifier | Description |")
            md.append("|---|---|---|---|---|")
            for a in attrs:
                md.append(
                    f"| `{a.get('name','')}` | {a.get('type','')}"
                    f"{'('+str(a.get('length'))+')' if a.get('length') else ''} "
                    f"| {'✓' if a.get('mandatory') else ''} "
                    f"| {'✓' if a.get('is_identifier') else ''} "
                    f"| {a.get('description','')} |"
                )
        idxs = e.get("indexes") or []
        if idxs:
            md.append("\n**Indexes:**")
            for i in idxs:
                md.append(f"- `{i.get('name','')}` on ({', '.join(i.get('attributes') or [])}) {'UNIQUE' if i.get('unique') else ''}")
        statics = e.get("static_records") or []
        if statics and e.get("is_static"):
            md.append(f"\n**Static records:** {len(statics)} defined (see `static-data.json`)")
        md.append("\n---\n")
    written.append(_write(out / "entities.md", "\n".join(md)))

    # schema.sql
    sql_lines = ["-- Generated SQL DDL — run against a staging database or use as reference for ODC entity creation.", ""]
    for e in entities:
        table = _safe_name(e.get("name", "unnamed"))
        sql_lines.append(f"-- {e.get('description','').strip()}")
        sql_lines.append(f"CREATE TABLE {table} (")
        attr_sqls: List[str] = []
        id_attrs: List[str] = []
        for a in e.get("attributes") or []:
            col = _safe_name(a.get("name", "col"))
            sql_type = _sql_type(a.get("type"), a.get("length"))
            pieces = [f"    {col} {sql_type}"]
            if a.get("is_identifier"):
                id_attrs.append(col)
                if a.get("is_auto_number"):
                    pieces.append("GENERATED BY DEFAULT AS IDENTITY")
            if a.get("mandatory") and not a.get("is_identifier"):
                pieces.append("NOT NULL")
            if a.get("default"):
                pieces.append(f"DEFAULT {a['default']!r}")
            attr_sqls.append(" ".join(pieces))
        if id_attrs:
            attr_sqls.append(f"    PRIMARY KEY ({', '.join(id_attrs)})")
        sql_lines.append(",\n".join(attr_sqls))
        sql_lines.append(");")
        for i in e.get("indexes") or []:
            iname = _safe_name(i.get("name", f"idx_{table}"))
            cols = ", ".join(_safe_name(c) for c in (i.get("attributes") or []))
            unique = "UNIQUE " if i.get("unique") else ""
            sql_lines.append(f"CREATE {unique}INDEX {iname} ON {table} ({cols});")
        sql_lines.append("")
    # FKs
    for r in relationships:
        from_t = _safe_name(r.get("from_entity", ""))
        from_a = _safe_name(r.get("from_attribute", ""))
        to_t = _safe_name(r.get("to_entity", ""))
        action = (r.get("on_delete") or "").upper()
        on_delete_clause = f" ON DELETE {action}" if action in ("CASCADE", "RESTRICT", "SET NULL") else ""
        sql_lines.append(
            f"ALTER TABLE {from_t} ADD CONSTRAINT fk_{from_t}_{from_a} "
            f"FOREIGN KEY ({from_a}) REFERENCES {to_t}(id){on_delete_clause};"
        )
    written.append(_write(out / "schema.sql", "\n".join(sql_lines) + "\n"))

    # ER diagram
    er_lines = ["erDiagram"]
    for e in entities:
        name = _safe_name(e.get("name", "Entity"))
        er_lines.append(f"    {name} {{")
        for a in e.get("attributes") or []:
            t = _safe_name(a.get("type", "text"))
            col = _safe_name(a.get("name", "attr"))
            marker = " PK" if a.get("is_identifier") else ""
            er_lines.append(f"        {t} {col}{marker}")
        er_lines.append("    }")
    for r in relationships:
        f = _safe_name(r.get("from_entity", ""))
        t = _safe_name(r.get("to_entity", ""))
        rel_type = r.get("type", "many-to-one")
        symbol = "}o--||" if rel_type == "many-to-one" else "||--||"
        er_lines.append(f"    {f} {symbol} {t} : {r.get('from_attribute', 'fk')}")
    written.append(_write(out / "er-diagram.mmd", "\n".join(er_lines)))

    # Static data
    static_data = {
        e.get("name"): e.get("static_records") or []
        for e in entities if e.get("is_static")
    }
    written.append(_write(out / "static-data.json", json.dumps(static_data, indent=2)))

    return written


def _write_service_actions(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "04_SERVICE_ACTIONS"
    actions = spec.get("service_actions") or []
    written: List[Path] = []

    written.append(_write(out / "actions.json", json.dumps(actions, indent=2)))

    md = ["# Service Actions", ""]
    for a in actions:
        md.append(f"## `{a.get('name','')}` — {a.get('module','')}")
        md.append(a.get("description", ""))
        md.append("\n**Inputs:**")
        for i in a.get("inputs") or []:
            m = " _mandatory_" if i.get("mandatory") else ""
            md.append(f"- `{i.get('name','')}` : {i.get('type','')}{m} — {i.get('description','')}")
        md.append("\n**Outputs:**")
        for o in a.get("outputs") or []:
            md.append(f"- `{o.get('name','')}` : {o.get('type','')} — {o.get('description','')}")
        if a.get("business_rules"):
            md.append("\n**Business rules:**")
            for r in a["business_rules"]:
                md.append(f"- {r}")
        if a.get("exposed_as_rest"):
            md.append(f"\n**Exposed REST:** `{a.get('rest_method')} {a.get('rest_path')}`")
        md.append("\n---\n")
    written.append(_write(out / "actions.md", "\n".join(md)))

    # OpenAPI for exposed actions
    openapi: Dict[str, Any] = {
        "openapi": "3.1.0",
        "info": {
            "title": spec.get("meta", {}).get("topic", "Generated API") + " — Service Actions",
            "version": "0.1.0",
            "description": "Auto-generated from Build Pack service actions marked exposed_as_rest.",
        },
        "paths": {},
    }
    for a in actions:
        if not a.get("exposed_as_rest"):
            continue
        method = (a.get("rest_method") or "POST").lower()
        path = a.get("rest_path") or f"/{_safe_name(a.get('name','')).lower()}"
        path_obj = openapi["paths"].setdefault(path, {})
        path_obj[method] = {
            "summary": a.get("name", ""),
            "description": a.get("description", ""),
            "requestBody": {
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                i.get("name", "param"): {"type": _openapi_type(i.get("type", ""))}
                                for i in (a.get("inputs") or [])
                            },
                            "required": [i.get("name") for i in (a.get("inputs") or []) if i.get("mandatory")],
                        }
                    }
                }
            } if (a.get("inputs") or []) else None,
            "responses": {
                "200": {
                    "description": "Success",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    o.get("name", "result"): {"type": _openapi_type(o.get("type", ""))}
                                    for o in (a.get("outputs") or [])
                                }
                            }
                        }
                    }
                }
            }
        }
        if not path_obj[method]["requestBody"]:
            del path_obj[method]["requestBody"]
    written.append(_write(out / "openapi.yaml", _yaml_dump(openapi)))

    return written


def _openapi_type(t: str) -> str:
    tl = (t or "").strip().lower()
    if tl in ("integer", "long integer", "int", "bigint"):
        return "integer"
    if tl in ("decimal", "currency", "float", "double"):
        return "number"
    if tl == "boolean":
        return "boolean"
    return "string"


def _write_integrations(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "05_INTEGRATIONS"
    ints = spec.get("integrations") or {}
    written: List[Path] = []

    def api_to_openapi(api: Dict[str, Any]) -> Dict[str, Any]:
        doc = {
            "openapi": "3.1.0",
            "info": {
                "title": api.get("name", "External API"),
                "version": "0.1.0",
                "description": api.get("description", ""),
            },
            "servers": [{"url": api.get("base_url", "https://example.com")}],
            "paths": {},
        }
        for ep in api.get("endpoints") or []:
            method = (ep.get("method") or "GET").lower()
            path = ep.get("path") or "/"
            doc["paths"].setdefault(path, {})[method] = {
                "summary": ep.get("description", ""),
                "description": ep.get("description", ""),
                "requestBody": {"content": {"application/json": {"schema": ep.get("request_schema") or {}}}}
                if ep.get("request_schema") else None,
                "responses": {
                    "200": {
                        "description": "Success",
                        "content": {"application/json": {"schema": ep.get("response_schema") or {}}},
                    }
                },
            }
            if not doc["paths"][path][method]["requestBody"]:
                del doc["paths"][path][method]["requestBody"]
        if api.get("auth") and api["auth"] != "None":
            doc["components"] = {
                "securitySchemes": {
                    "default": {"type": "apiKey", "in": "header", "name": "Authorization"}
                }
            }
            doc["security"] = [{"default": []}]
        return doc

    consumed = ints.get("consumed_apis") or []
    if consumed:
        combined = {"apis": [api_to_openapi(a) for a in consumed]}
        written.append(_write(out / "consumed-apis.yaml", _yaml_dump(combined)))
    else:
        written.append(_write(out / "consumed-apis.yaml", "# No consumed APIs defined for this build.\n"))

    exposed = ints.get("exposed_apis") or []
    if exposed:
        combined = {"apis": [api_to_openapi(a) for a in exposed]}
        written.append(_write(out / "exposed-apis.yaml", _yaml_dump(combined)))
    else:
        written.append(_write(out / "exposed-apis.yaml", "# No exposed APIs defined for this build.\n"))

    # Integration map
    map_lines = ["# Integration Map", ""]
    if consumed:
        map_lines.append("## Consumed APIs\n")
        for a in consumed:
            map_lines.append(f"### {a.get('name')}")
            map_lines.append(f"_Base URL:_ `{a.get('base_url','')}` _Auth:_ {a.get('auth','None')}\n")
            map_lines.append(a.get("description", ""))
            for ep in a.get("endpoints") or []:
                map_lines.append(f"- `{ep.get('method','GET')} {ep.get('path','/')}` — {ep.get('description','')}")
            map_lines.append("")
    if exposed:
        map_lines.append("## Exposed APIs\n")
        for a in exposed:
            map_lines.append(f"### {a.get('name')}")
            map_lines.append(f"_Base URL:_ `{a.get('base_url','')}`\n")
            for ep in a.get("endpoints") or []:
                map_lines.append(f"- `{ep.get('method','GET')} {ep.get('path','/')}`")
    written.append(_write(out / "integration-map.md", "\n".join(map_lines)))

    # Mermaid integration diagram
    mmd = ["graph LR", "    APP[(ODC Application)]"]
    for i, a in enumerate(consumed):
        nid = f"CA{i}"
        mmd.append(f'    {nid}["{a.get("name","External API")}<br/>{a.get("base_url","")}"]')
        mmd.append(f"    APP --> {nid}")
    for i, a in enumerate(exposed):
        nid = f"EA{i}"
        mmd.append(f'    {nid}["{a.get("name","Consumer")}"]')
        mmd.append(f"    {nid} --> APP")
    written.append(_write(out / "integration-map.mmd", "\n".join(mmd)))

    return written


def _write_ux(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "06_UX"
    screens = spec.get("screens") or []
    nav = spec.get("navigation_flow") or []
    written: List[Path] = []

    written.append(_write(out / "screens.json", json.dumps(screens, indent=2)))

    inv = ["# Screen Inventory", ""]
    inv.append("| Screen | Module | Route | Type | Roles |")
    inv.append("|---|---|---|---|---|")
    for s in screens:
        inv.append(
            f"| `{s.get('name','')}` | `{s.get('module','')}` | `{s.get('route','')}` "
            f"| {s.get('type','')} | {', '.join(s.get('role_access') or [])} |"
        )
    written.append(_write(out / "screen-inventory.md", "\n".join(inv)))

    wf = ["# Screen Wireframes (text-form)", ""]
    for s in screens:
        wf.append(f"## `{s.get('name','')}` ({s.get('type','screen')})")
        wf.append(f"_Route:_ `{s.get('route','')}` _Module:_ `{s.get('module','')}`")
        wf.append(f"_Role access:_ {', '.join(s.get('role_access') or []) or 'all'}")
        wf.append("")
        wf.append(s.get("description", ""))
        wf.append("")
        if s.get("widgets"):
            wf.append("**Widgets:** " + ", ".join(s["widgets"]))
        if s.get("actions_triggered"):
            wf.append("**Actions triggered:** " + ", ".join(s["actions_triggered"]))
        wf.append("\n**Wireframe:**")
        wf.append(s.get("wireframe_md") or "_(no wireframe provided)_")
        wf.append("\n---\n")
    written.append(_write(out / "wireframes.md", "\n".join(wf)))

    # Navigation flow
    mmd = ["flowchart TD"]
    screen_ids: Dict[str, str] = {}
    for i, s in enumerate(screens):
        sid = f"S{i}"
        screen_ids[s.get("name", "")] = sid
        mmd.append(f'    {sid}(["{s.get("name","")}"])')
    for edge in nav:
        src = screen_ids.get(edge.get("from", ""))
        tgt = screen_ids.get(edge.get("to", ""))
        if src and tgt:
            label = edge.get("trigger", "")
            if edge.get("condition"):
                label = f"{label} (if {edge['condition']})"
            mmd.append(f'    {src} -- "{label}" --> {tgt}')
    written.append(_write(out / "navigation-flow.mmd", "\n".join(mmd)))

    # RBAC
    sec = spec.get("security", {}) or {}
    roles = sec.get("roles") or []
    rbac = ["# Roles & Permissions", ""]
    for r in roles:
        rbac.append(f"## {r.get('name','')}")
        rbac.append(r.get("description", ""))
        for p in r.get("permissions") or []:
            rbac.append(f"- {p}")
        rbac.append("")
    written.append(_write(out / "roles-permissions.md", "\n".join(rbac)))

    return written


def _write_security(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "07_SECURITY"
    sec = spec.get("security", {}) or {}
    written: List[Path] = []

    lines = ["# Security Requirements", ""]
    lines.append(f"**Auth approach:** {sec.get('auth_approach','(not specified)')}")
    lines.append("\n## Roles\n")
    for r in sec.get("roles") or []:
        lines.append(f"- **{r.get('name','')}** — {r.get('description','')}")
    written.append(_write(out / "security-requirements.md", "\n".join(lines)))

    dc = ["# Data Classification", ""]
    dc.append("| Entity | Classification | Rationale |")
    dc.append("|---|---|---|")
    for d in sec.get("data_classification") or []:
        dc.append(f"| {d.get('entity','')} | {d.get('classification','')} | {d.get('rationale','')} |")
    written.append(_write(out / "data-classification.md", "\n".join(dc)))

    cc = ["# Compliance Checklist", ""]
    for req in sec.get("compliance_requirements") or []:
        cc.append(f"- [ ] {req}")
    written.append(_write(out / "compliance-checklist.md", "\n".join(cc)))

    return written


def _write_quality(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "08_QUALITY"
    q = spec.get("quality", {}) or {}
    written: List[Path] = []

    written.append(_write(out / "test-plan.md", f"# Test Plan\n\n{q.get('test_strategy_md','_(not provided)_')}\n"))

    ts = ["# Test Scenarios", ""]
    for s in q.get("test_scenarios") or []:
        ts.append(f"## {s.get('name','')} _{s.get('type','')}_")
        ts.append(s.get("description", ""))
        if s.get("steps"):
            ts.append("\n**Steps:**")
            for i, step in enumerate(s["steps"], 1):
                ts.append(f"{i}. {step}")
        if s.get("expected"):
            ts.append(f"\n**Expected:** {s['expected']}")
        ts.append("\n---\n")
    written.append(_write(out / "test-scenarios.md", "\n".join(ts)))

    rr = ["# Risk Register", "", "| Risk | Severity | Mitigation |", "|---|---|---|"]
    for r in q.get("risk_register") or []:
        rr.append(f"| {r.get('risk','')} | {r.get('severity','med')} | {r.get('mitigation','')} |")
    written.append(_write(out / "risk-register.md", "\n".join(rr)))

    return written


def _write_operations(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "09_OPERATIONS"
    ops = spec.get("operations", {}) or {}
    written: List[Path] = []

    envs = ops.get("environments") or []
    env_md = ["# Environments", ""]
    env_md.append("| Name | Purpose | Scaling | Data Refresh |")
    env_md.append("|---|---|---|---|")
    for e in envs:
        env_md.append(
            f"| {e.get('name','')} | {e.get('purpose','')} "
            f"| {e.get('scaling','')} | {e.get('data_refresh','')} |"
        )
    written.append(_write(out / "environments.md", "\n".join(env_md)))

    written.append(_write(out / "ci-cd-plan.md", f"# CI/CD Plan\n\n{ops.get('ci_cd_md','_(not provided)_')}\n"))
    written.append(_write(out / "observability-plan.md", f"# Observability\n\n{ops.get('observability_md','_(not provided)_')}\n"))

    return written


def _write_migration(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "10_MIGRATION"
    mig = spec.get("migration", {}) or {}
    written: List[Path] = []

    if not mig.get("applicable"):
        written.append(_write(
            out / "README.md",
            "# Migration\n\n_No migration is applicable for this build — it is a greenfield implementation._\n"
        ))
        return written

    lines = [f"# Migration Strategy — {mig.get('strategy','(unspecified)')}", ""]
    lines.append("## Phases")
    for p in mig.get("phases") or []:
        lines.append(f"\n### {p.get('name','Phase')} — sprints {p.get('sprint_range','?')}")
        lines.append(f"**Scope:** {p.get('scope','')}")
        lines.append(f"**Go/no-go:** {p.get('go_no_go_criteria','')}")
    lines.append("\n## Data Migration Approach\n")
    lines.append(mig.get("data_migration_approach_md", "_(not provided)_"))
    written.append(_write(out / "migration-strategy.md", "\n".join(lines)))

    sql = mig.get("data_migration_sql") or "-- No data migration SQL generated.\n"
    written.append(_write(out / "data-migration.sql", sql))

    cc = ["# Cutover Checklist", ""]
    for item in mig.get("cutover_checklist") or []:
        cc.append(f"- [ ] {item}")
    written.append(_write(out / "cutover-checklist.md", "\n".join(cc)))

    return written


def _write_commercial(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "11_COMMERCIAL"
    c = spec.get("commercial", {}) or {}
    return [
        _write(out / "licencing-estimate.md", f"# Licencing Estimate\n\n{c.get('licencing_estimate_md','_(not provided)_')}\n"),
        _write(out / "build-effort.md", f"# Build Effort\n\n{c.get('build_effort_md','_(not provided)_')}\n"),
        _write(out / "roi-model.md", f"# ROI Model\n\n{c.get('roi_model_md','_(not provided)_')}\n"),
    ]


def _write_odc_import_guide(root: Path, spec: Dict[str, Any]) -> List[Path]:
    out = root / "99_ODC_IMPORT_GUIDE"
    meta = spec.get("meta", {})
    entities = (spec.get("data_model") or {}).get("entities") or []
    actions = spec.get("service_actions") or []
    screens = spec.get("screens") or []
    modules: List[str] = []
    for layer in (spec.get("architecture") or {}).get("layers") or []:
        for mod in layer.get("modules") or []:
            modules.append(f"`{mod.get('name','')}` ({layer.get('name','')}) — {mod.get('type','')}")

    lines = [
        f"# {meta.get('target_platform', 'Target Platform')} Import Guide",
        "",
        "This guide walks an ODC developer through turning the artefacts in this",
        "pack into a working application inside ODC Studio. There is no one-click",
        "import — but if you follow these steps in order, you should have a working",
        "skeleton in a few days rather than a few weeks.",
        "",
        "---",
        "",
        "## Step 1 — Create the modules",
        "",
        "Create the following modules in ODC Studio in this order (Foundation → Core → End User):",
        "",
    ]
    for m in modules or ["_(no modules defined)_"]:
        lines.append(f"- {m}")
    lines += [
        "",
        "Module definitions (including dependencies) are in `../02_ARCHITECTURE/modules.yaml`.",
        "",
        "## Step 2 — Import Forge components",
        "",
        "See `../02_ARCHITECTURE/forge-shortlist.md`. Install each component into your ODC factory",
        "before proceeding so entity references resolve correctly.",
        "",
        "## Step 3 — Create entities",
        "",
        f"There are **{len(entities)}** entities to create. For each one:",
        "",
        "1. Open the module named in the entity's `module` field",
        "2. Create an Entity with the name and attributes listed in `../03_DATA_MODEL/entities.json`",
        "3. Set the identifier attribute (marked `is_identifier: true`)",
        "4. Create indexes as listed",
        "5. Import static records (for `is_static: true` entities) from `../03_DATA_MODEL/static-data.json`",
        "",
        "The SQL DDL in `../03_DATA_MODEL/schema.sql` is for staging DB reference — not a direct ODC import.",
        "",
        "## Step 4 — Create service actions",
        "",
        f"There are **{len(actions)}** service actions to create. For each one:",
        "",
        "1. Open the module named in the action's `module` field",
        "2. Create a Service Action with inputs, outputs, and description per `../04_SERVICE_ACTIONS/actions.json`",
        "3. Implement the business rules listed in the `business_rules` array",
        "4. For actions marked `exposed_as_rest: true`, expose as REST with the `rest_method` + `rest_path`",
        "",
        "## Step 5 — Wire integrations",
        "",
        "Use ODC's **Consume REST API** feature and upload the OpenAPI YAMLs from",
        "`../05_INTEGRATIONS/consumed-apis.yaml`. ODC will generate stub actions for each endpoint.",
        "",
        "## Step 6 — Build screens",
        "",
        f"There are **{len(screens)}** screens to build. For each one:",
        "",
        "1. Open the module named in the screen's `module` field",
        "2. Create a screen using the layout described in `../06_UX/wireframes.md`",
        "3. Set the role access per `../06_UX/roles-permissions.md`",
        "4. Wire the navigation per `../06_UX/navigation-flow.mmd`",
        "",
        "## Step 7 — Apply security",
        "",
        "Configure roles, authentication, and data classification per `../07_SECURITY/`.",
        "",
        "## Step 8 — Run the test plan",
        "",
        "Execute the scenarios in `../08_QUALITY/test-scenarios.md` before cut-over.",
        "",
        "## Step 9 — Migrate data (if applicable)",
        "",
        "Run `../10_MIGRATION/data-migration.sql` against your staging DB, then use the approach",
        "in `migration-strategy.md` to load into ODC entities.",
        "",
        "## Step 10 — Go live",
        "",
        "Work through `../10_MIGRATION/cutover-checklist.md`.",
    ]

    warnings = [
        "# Import Warnings & Assumptions",
        "",
        "- **OpenAPI specs** were auto-generated from action definitions. Validate request/response",
        "  shapes against your actual data types before consuming.",
        "- **SQL DDL** uses generic SQL and may need type adjustments for SQL Server / PostgreSQL /",
        "  the ODC database engine.",
        "- **Mermaid diagrams** render in any markdown viewer that supports Mermaid, or via",
        "  https://mermaid.live — they are reference artefacts, not executable.",
        "- **Forge component URLs** are recommendations; verify compatibility with your ODC version.",
        "- **Sprint plan** is indicative; adjust to team capacity after a planning session.",
    ]

    return [
        _write(out / "README.md", "\n".join(lines)),
        _write(out / "IMPORT_WARNINGS.md", "\n".join(warnings)),
    ]


# ── Top-level orchestrator ──────────────────────────────────────────────────

def generate_build_pack_files(spec: Dict[str, Any], output_dir: Path) -> List[Path]:
    """Convert a compiled spec into the full directory of files."""
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    written: List[Path] = []
    for fn in (
        _write_readme,
        _write_executive_summary,
        _write_requirements,
        _write_architecture,
        _write_data_model,
        _write_service_actions,
        _write_integrations,
        _write_ux,
        _write_security,
        _write_quality,
        _write_operations,
        _write_migration,
        _write_commercial,
        _write_odc_import_guide,
    ):
        try:
            written.extend(fn(output_dir, spec) or [])
        except Exception as e:
            logger.exception(f"Section writer {fn.__name__} failed: {e}")
            err_path = output_dir / f"_GENERATION_ERROR_{fn.__name__}.txt"
            err_path.write_text(f"{type(e).__name__}: {e}\n", encoding="utf-8")
            written.append(err_path)

    # Also save the raw spec for audit
    _write(output_dir / "_spec.json", json.dumps(spec, indent=2))

    return written


def zip_build_pack(output_dir: Path) -> Path:
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
    return BUILD_PACK_ROOT / pack_id


def pack_zip(pack_id: str) -> Path:
    return BUILD_PACK_ROOT / f"{pack_id}.zip"
