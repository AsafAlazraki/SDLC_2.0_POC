"""
grooming_db.py — Phase 12 database helpers for the Requirements → Groomed
Backlog → Jira feature.

Lives as a separate module from database.py to keep the grooming-specific
artifact kinds + their helpers together. Imports from database.py for the
low-level project_artifacts CRUD.

Artifact kinds introduced in this phase:
  - requirements_upload : one row per CSV/Excel upload event
  - story_template      : at most one active row per project (override)
  - backlog_item        : reused for epics, features, and stories
                          (structured_data.level disambiguates)
  - jira_config         : at most one active row per project
  - jira_push_event     : one row per push-to-Jira execution

Dependencies live inline on each story's structured_data.dependencies:
  [{target_id: int, type: 'blocks'|'blocked_by', reason: str, added_by: str}]

Re-exported symbols are added to database.__all__-like namespace via
`from grooming_db import *` at the bottom of database.py.
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Dict, List, Optional

# Late import so this module is importable standalone in tests
from database import (
    supabase,
    ProjectArtifactModel,
    create_project_artifact,
    list_project_artifacts,
    update_project_artifact,
    delete_project_artifact,
    _backlog_to_row_payload,
)


BACKLOG_LEVELS = ("epic", "feature", "story")
BACKLOG_PROVENANCE = ("manual", "groomed", "ba_agent")
STORY_TYPES = ("story", "bug", "spike", "tech-debt")


# ─── Requirements uploads ─────────────────────────────────────────────────

def create_requirements_upload(
    project_id: int,
    *,
    filename: str,
    kind: str,
    row_count: int,
    columns: List[str],
    column_mapping: Dict[str, str],
    mapping_confidence: str,
    warnings: List[str],
    raw_rows: List[Dict[str, Any]],
    run_id: Optional[int] = None,
) -> Optional[dict]:
    """Persist a CSV/Excel upload event. `raw_rows` is the parsed pre-grooming
    content — stored so re-upload diff preview can compare new vs old."""
    art = ProjectArtifactModel(
        project_id=project_id,
        run_id=run_id,
        kind="requirements_upload",
        title=filename,
        content=f"{row_count} rows from {filename}",
        structured_data={
            "filename": filename,
            "kind": kind,
            "row_count": row_count,
            "columns": columns,
            "column_mapping": column_mapping,
            "mapping_confidence": mapping_confidence,
            "warnings": warnings,
            "raw_rows": raw_rows[:5000],
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
        },
    )
    return create_project_artifact(art)


def list_requirements_uploads(project_id: int) -> List[dict]:
    return list_project_artifacts(project_id, kind="requirements_upload")


def get_requirements_upload(upload_id: int) -> Optional[dict]:
    try:
        resp = (supabase.table("project_artifacts")
                .select("*").eq("id", upload_id).eq("kind", "requirements_upload")
                .limit(1).execute())
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"get_requirements_upload error: {e}")
        return None


# ─── Story template (per-project override) ─────────────────────────────────

def get_story_template_artifact(project_id: int) -> Optional[dict]:
    try:
        resp = (supabase.table("project_artifacts")
                .select("*").eq("project_id", project_id)
                .eq("kind", "story_template").eq("status", "active")
                .order("created_at", desc=True).limit(1).execute())
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"get_story_template_artifact error: {e}")
        return None


def set_story_template(project_id: int, template: List[Dict[str, Any]]) -> Optional[dict]:
    """Upsert the project's template override — archives the previous
    active row so edits are versioned."""
    existing = get_story_template_artifact(project_id)
    if existing:
        try:
            supabase.table("project_artifacts").update(
                {"status": "archived"}
            ).eq("id", existing["id"]).execute()
        except Exception as e:
            print(f"set_story_template archive error: {e}")
    prev_order = (existing or {}).get("sort_order", 0)
    return create_project_artifact(ProjectArtifactModel(
        project_id=project_id,
        kind="story_template",
        title=f"Story template v{prev_order + 1}",
        structured_data={
            "template": template,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        },
        sort_order=prev_order + 1,
    ))


# ─── Groomed backlog items (epic / feature / story) ────────────────────────

def _groomed_to_payload(item: Dict[str, Any], level: str) -> Dict[str, Any]:
    """Extend the Phase 4 backlog payload with epic/feature/story fields."""
    base = _backlog_to_row_payload(item)
    base.update({
        "level": level if level in BACKLOG_LEVELS else "story",
        "provenance": (item.get("provenance") or "groomed"),
        "upload_id": item.get("upload_id"),
        "requirement_source_id": item.get("requirement_source_id") or "",
        "parent_epic_id": item.get("parent_epic_id"),
        "parent_feature_id": item.get("parent_feature_id"),
        "dependencies": item.get("dependencies") or [],
        "mentor_prompt": item.get("mentor_prompt") or "",
        "mentor_prompt_history": item.get("mentor_prompt_history") or [],
        "odc_entities": item.get("odc_entities") or [],
        "odc_screens": item.get("odc_screens") or [],
        "definition_of_done": item.get("definition_of_done") or "",
        "risks_assumptions": item.get("risks_assumptions") or "",
        "nfr_notes": item.get("nfr_notes") or "",
        "type": (item.get("type") or "story") if (item.get("type") in STORY_TYPES) else "story",
    })
    return base


def create_groomed_item(
    project_id: int,
    level: str,
    item: Dict[str, Any],
    *,
    run_id: Optional[int] = None,
) -> Optional[dict]:
    payload = _groomed_to_payload(item, level)
    return create_project_artifact(ProjectArtifactModel(
        project_id=project_id,
        run_id=run_id,
        kind="backlog_item",
        persona_key="groomed",
        title=payload["title"],
        content=payload["story"] or None,
        structured_data=payload,
        sort_order=int(item.get("sort_order") or 0),
    ))


def list_groomed_items(project_id: int, level: Optional[str] = None) -> List[dict]:
    rows = list_project_artifacts(project_id, kind="backlog_item")
    if level is None:
        return rows
    out = []
    for r in rows:
        sd = r.get("structured_data") or {}
        row_level = sd.get("level", "story")
        if row_level == level:
            out.append(r)
    return out


def get_groomed_tree(project_id: int) -> Dict[str, Any]:
    """Epic → Feature → Story nested hierarchy for UI rendering."""
    rows = list_project_artifacts(project_id, kind="backlog_item")

    epics, features, stories = [], [], []
    for r in rows:
        sd = r.get("structured_data") or {}
        lvl = sd.get("level", "story")
        if lvl == "epic":
            epics.append(r)
        elif lvl == "feature":
            features.append(r)
        else:
            stories.append(r)

    feature_by_id = {f["id"]: {**f, "stories": []} for f in features}
    epic_by_id = {e["id"]: {**e, "features": [], "unparented_stories": []} for e in epics}
    orphans: List[dict] = []

    for s in stories:
        sd = s.get("structured_data") or {}
        pf = sd.get("parent_feature_id")
        pe = sd.get("parent_epic_id")
        if pf and pf in feature_by_id:
            feature_by_id[pf]["stories"].append(s)
        elif pe and pe in epic_by_id:
            epic_by_id[pe]["unparented_stories"].append(s)
        else:
            orphans.append(s)

    for f in features:
        sd = f.get("structured_data") or {}
        pe = sd.get("parent_epic_id")
        if pe and pe in epic_by_id:
            epic_by_id[pe]["features"].append(feature_by_id[f["id"]])

    return {
        "epics": list(epic_by_id.values()),
        "orphans": orphans,
    }


def get_dependency_graph(project_id: int) -> Dict[str, Any]:
    """Flatten every story's dependencies into a nodes+edges graph."""
    stories = list_groomed_items(project_id, level="story")
    seen = set()
    nodes, edges = [], []
    for s in stories:
        if s["id"] in seen:
            continue
        seen.add(s["id"])
        sd = s.get("structured_data") or {}
        nodes.append({
            "id": s["id"],
            "title": s.get("title") or "Untitled",
            "priority": sd.get("priority", "med"),
            "points": sd.get("points"),
            "epic_id": sd.get("parent_epic_id"),
            "feature_id": sd.get("parent_feature_id"),
        })
        for dep in (sd.get("dependencies") or []):
            tgt = dep.get("target_id")
            if tgt is None:
                continue
            edges.append({
                "from": s["id"],
                "to": tgt,
                "type": dep.get("type", "blocked_by"),
                "reason": dep.get("reason", ""),
                "added_by": dep.get("added_by", "agent"),
            })
    return {"nodes": nodes, "edges": edges}


def set_story_dependencies(story_id: int, deps: List[Dict[str, Any]]) -> Optional[dict]:
    """Replace a story's full dependency list."""
    try:
        existing = (supabase.table("project_artifacts").select("*")
                    .eq("id", story_id).single().execute().data)
    except Exception as e:
        print(f"set_story_dependencies lookup error: {e}")
        return None
    if not existing:
        return None
    sd = existing.get("structured_data") or {}
    sd["dependencies"] = deps
    return update_project_artifact(story_id, {"structured_data": sd})


def set_mentor_prompt(story_id: int, prompt: str, *, keep_history: int = 3) -> Optional[dict]:
    """Store a new Mentor prompt, preserving up to keep_history prior versions."""
    try:
        existing = (supabase.table("project_artifacts").select("*")
                    .eq("id", story_id).single().execute().data)
    except Exception as e:
        print(f"set_mentor_prompt lookup error: {e}")
        return None
    if not existing:
        return None
    sd = existing.get("structured_data") or {}
    history = list(sd.get("mentor_prompt_history") or [])
    current = (sd.get("mentor_prompt") or "").strip()
    if current and current != prompt.strip():
        history.append({
            "text": current,
            "archived_at": datetime.utcnow().isoformat() + "Z",
        })
    history = history[-keep_history:]
    sd["mentor_prompt"] = prompt
    sd["mentor_prompt_history"] = history
    return update_project_artifact(story_id, {"structured_data": sd})


# ─── Jira configuration ────────────────────────────────────────────────────

def get_jira_config(project_id: int, *, include_token: bool = False) -> Optional[dict]:
    """Return active Jira config for a project. Token stripped unless
    include_token=True (use that only for the outbound HTTP call)."""
    try:
        resp = (supabase.table("project_artifacts").select("*")
                .eq("project_id", project_id).eq("kind", "jira_config")
                .eq("status", "active").order("created_at", desc=True)
                .limit(1).execute())
        row = resp.data[0] if resp.data else None
    except Exception as e:
        print(f"get_jira_config error: {e}")
        return None
    if not row:
        return None
    sd = dict(row.get("structured_data") or {})
    raw_token = sd.get("api_token") or ""
    return {
        "id": row["id"],
        "domain": sd.get("domain", ""),
        "email": sd.get("email", ""),
        "project_key": sd.get("project_key", ""),
        "api_token": raw_token if include_token else ("***" if raw_token else ""),
        "has_token": bool(raw_token.strip()),
        "updated_at": sd.get("updated_at"),
    }


def set_jira_config(
    project_id: int,
    *,
    domain: str,
    email: str,
    api_token: str,
    project_key: str,
) -> Optional[dict]:
    """Upsert a project's Jira config. Archives the previous active row."""
    existing = get_jira_config(project_id, include_token=True)
    if existing and existing.get("id"):
        try:
            supabase.table("project_artifacts").update(
                {"status": "archived"}
            ).eq("id", existing["id"]).execute()
        except Exception as e:
            print(f"set_jira_config archive error: {e}")
    return create_project_artifact(ProjectArtifactModel(
        project_id=project_id,
        kind="jira_config",
        title=f"Jira config \u2014 {domain}",
        structured_data={
            "domain": domain.strip(),
            "email": email.strip(),
            "api_token": api_token.strip(),
            "project_key": project_key.strip().upper(),
            "updated_at": datetime.utcnow().isoformat() + "Z",
        },
    ))


def clear_jira_config(project_id: int) -> bool:
    existing = get_jira_config(project_id)
    if not existing or not existing.get("id"):
        return False
    return delete_project_artifact(existing["id"])


# ─── Jira push events ──────────────────────────────────────────────────────

def record_jira_push(
    project_id: int,
    *,
    pushed_epics: int,
    pushed_stories: int,
    created_keys: List[str],
    errors: List[Dict[str, Any]],
    jira_project_key: str,
    run_id: Optional[int] = None,
) -> Optional[dict]:
    """Log a push-to-Jira execution for history + debugging."""
    return create_project_artifact(ProjectArtifactModel(
        project_id=project_id,
        run_id=run_id,
        kind="jira_push_event",
        title=f"Pushed {pushed_stories} story(ies) + {pushed_epics} epic(s) to {jira_project_key}",
        structured_data={
            "pushed_epics": pushed_epics,
            "pushed_stories": pushed_stories,
            "created_keys": created_keys,
            "errors": errors,
            "jira_project_key": jira_project_key,
            "pushed_at": datetime.utcnow().isoformat() + "Z",
        },
    ))


def list_jira_pushes(project_id: int) -> List[dict]:
    return list_project_artifacts(project_id, kind="jira_push_event")
