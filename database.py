import os
from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import BaseModel
from typing import Any, Optional, List, Dict

load_dotenv()

url: str = os.getenv("SUPABASE_URL", "")
key: str = os.getenv("SUPABASE_KEY", "")

# Initialize Supabase client
supabase: Client = create_client(url, key)

# --- Pydantic Models for DB Communication ---

class ClientModel(BaseModel):
    id: Optional[int] = None
    name: str
    description: Optional[str] = None
    created_at: Optional[str] = None

class PersonaModel(BaseModel):
    id: Optional[int] = None
    role_name: str
    system_prompt: str
    output_schema: Optional[str] = None # JSON string if we need dynamic schema parsing later
    created_at: Optional[str] = None

class ProjectModel(BaseModel):
    id: Optional[int] = None
    parent_id: Optional[int] = None
    client_id: Optional[int] = None
    name: str
    goal: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = "active"
    inherits_materials: Optional[bool] = True
    metadata: Optional[Dict[str, Any]] = None

class ProjectMaterialModel(BaseModel):
    id: Optional[int] = None
    project_id: int
    kind: str  # file | url | text | image
    filename: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = 0
    content_text: Optional[str] = None
    storage_path: Optional[str] = None
    source_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class ProjectRunModel(BaseModel):
    id: Optional[int] = None
    project_id: int
    kind: str  # 'topic' | 'repo'
    input_payload: Optional[Dict[str, Any]] = None
    status: Optional[str] = "running"
    token_cost_cents: Optional[int] = 0
    usage_summary: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    legacy_report_id: Optional[int] = None

class ProjectArtifactModel(BaseModel):
    id: Optional[int] = None
    project_id: int
    run_id: Optional[int] = None
    kind: str  # report | synthesis | build_pack | kickoff | backlog_item | diagram | note
    persona_key: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    structured_data: Optional[Dict[str, Any]] = None
    storage_path: Optional[str] = None
    status: Optional[str] = "active"
    sort_order: Optional[int] = 0

# --- DB Helper Functions ---

# --- Clients ---
def get_clients():
    response = supabase.table("clients").select("*").execute()
    return response.data

def get_client(client_id: int):
    response = supabase.table("clients").select("*").eq("id", client_id).execute()
    return response.data[0] if response.data else None

def create_client_db(client: ClientModel):
    response = supabase.table("clients").insert({"name": client.name, "description": client.description}).execute()
    return response.data[0] if response.data else None

# --- Personas ---
def get_personas():
    response = supabase.table("personas").select("*").execute()
    return response.data

def create_persona_db(persona: PersonaModel):
    response = supabase.table("personas").insert({
        "role_name": persona.role_name, 
        "system_prompt": persona.system_prompt
    }).execute()
    return response.data[0] if response.data else None

# --- Reports ---

def save_report(github_url: str, client_id, results: dict, synthesis_content: str = "") -> dict:
    """Save a completed analysis run to the reports table."""
    try:
        data = {"github_url": github_url, "results": results, "synthesis_content": synthesis_content}
        if client_id:
            data["client_id"] = client_id
        response = supabase.table("reports").insert(data).execute()
        return response.data[0] if response.data else {}
    except Exception as e:
        print(f"Report save error (non-fatal): {e}")
        return {}

def get_reports() -> list:
    """List past analysis runs — metadata only (no full results payload)."""
    try:
        response = (
            supabase.table("reports")
            .select("id, github_url, client_id, analyzed_at")
            .order("analyzed_at", desc=True)
            .limit(50)
            .execute()
        )
        return response.data or []
    except Exception as e:
        print(f"Get reports error: {e}")
        return []

def get_report(report_id: int) -> dict:
    """Return a specific saved report including full results."""
    try:
        response = supabase.table("reports").select("*").eq("id", report_id).execute()
        return response.data[0] if response.data else None
    except Exception as e:
        print(f"Get report error: {e}")
        return None


def seed_default_personas():
    """Seed the database with the comprehensive personas if any are missing"""
    existing_personas = get_personas()
    existing_roles = {p['role_name'] for p in (existing_personas or [])}
    
    defaults = [
        {"role_name": "Business Analyst", "system_prompt": "Extract user stories with acceptance criteria and estimated points. Format as As a [User], I want to [Action], so that [Value]."},
        {"role_name": "Architect", "system_prompt": "Explain As-Is vs To-Be and provide ONLY raw mermaid.js 'graph TD' syntax for the To-Be system context. Do NOT wrap in markdown blocks."},
        {"role_name": "QA Lead", "system_prompt": "Identify regression risks and mitigation strategies based on the provided legacy code."},
        {"role_name": "Security Officer", "system_prompt": "Flag hardcoded credentials, obsolete practices, and compliance gaps."},
        {"role_name": "Data Engineer", "system_prompt": "Analyze the codebase for data models, schema structures, and data flows. Provide insights on data migration, database modernization, and identify potential data quality or integrity risks."},
        {"role_name": "DevOps Engineer", "system_prompt": "Evaluate deployment processes, configurations, and environment dependencies. Recommend a CI/CD pipeline strategy, containerization approach, and infrastructure-as-code improvements."},
        {"role_name": "Product Manager", "system_prompt": "Extract the core business value of the system. Identify key performance indicators (KPIs) and draft a suggested feature roadmap for modernization."},
        {"role_name": "UI/UX Designer", "system_prompt": "Assess frontend code or UI descriptions. Identify accessibility gaps, user journey bottlenecks, and provide recommendations for a modernized, responsive, and intuitive user interface."},
        {"role_name": "Compliance Officer", "system_prompt": "Inspect the system for handling of Personally Identifiable Information (PII) or sensitive data. Flag potential GDPR/HIPAA compliance risks and suggest data privacy controls."}
    ]
    
    missing_defaults = [d for d in defaults if d['role_name'] not in existing_roles]
    
    if missing_defaults:
        supabase.table("personas").insert(missing_defaults).execute()
        return get_personas()

    return existing_personas


# ─────────────────────────────────────────────────────────────
# Projects — first-class workspaces (Phase 1)
# ─────────────────────────────────────────────────────────────

def _strip_none(d: dict) -> dict:
    """Supabase drivers don't like explicit None for auto-defaulting columns."""
    return {k: v for k, v in d.items() if v is not None}


def list_projects(client_id: Optional[int] = None) -> List[dict]:
    """Return every project (flat list); caller assembles the tree via parent_id."""
    try:
        q = supabase.table("projects").select("*").eq("status", "active").order("created_at")
        if client_id:
            q = q.eq("client_id", client_id)
        return q.execute().data or []
    except Exception as e:
        print(f"list_projects error: {e}")
        return []


def get_project(project_id: int) -> Optional[dict]:
    try:
        resp = supabase.table("projects").select("*").eq("id", project_id).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"get_project error: {e}")
        return None


def create_project(project: ProjectModel) -> Optional[dict]:
    payload = _strip_none({
        "parent_id": project.parent_id,
        "client_id": project.client_id,
        "name": project.name,
        "goal": project.goal,
        "description": project.description,
        "status": project.status or "active",
        "inherits_materials": project.inherits_materials if project.inherits_materials is not None else True,
        "metadata": project.metadata or {},
    })
    try:
        resp = supabase.table("projects").insert(payload).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"create_project error: {e}")
        return None


def update_project(project_id: int, fields: Dict[str, Any]) -> Optional[dict]:
    """Patch a project. Whitelisted fields only — no writing to id/created_at."""
    allowed = {"parent_id", "client_id", "name", "goal", "description",
               "status", "inherits_materials", "metadata",
               "budget_range", "timeline", "path_preference"}
    payload = {k: v for k, v in fields.items() if k in allowed}
    if not payload:
        return get_project(project_id)
    payload["updated_at"] = "now()"
    try:
        resp = supabase.table("projects").update(payload).eq("id", project_id).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"update_project error: {e}")
        return None


def delete_project(project_id: int) -> bool:
    """Soft-delete (status='archived'). Hard deletes happen via DB cascade only."""
    try:
        supabase.table("projects").update({"status": "archived"}).eq("id", project_id).execute()
        return True
    except Exception as e:
        print(f"delete_project error: {e}")
        return False


def get_project_children(parent_id: int) -> List[dict]:
    try:
        resp = (supabase.table("projects")
                .select("*")
                .eq("parent_id", parent_id)
                .eq("status", "active")
                .order("created_at")
                .execute())
        return resp.data or []
    except Exception as e:
        print(f"get_project_children error: {e}")
        return []


def get_legacy_project() -> Optional[dict]:
    """Return the auto-seeded Legacy Analyses project, creating it if the seed row was missed."""
    try:
        resp = (supabase.table("projects")
                .select("*")
                .eq("status", "active")
                .limit(50)
                .execute())
        for row in (resp.data or []):
            meta = row.get("metadata") or {}
            if meta.get("legacy_holder") is True:
                return row
        # Not found — create it.
        return create_project(ProjectModel(
            name="Legacy Analyses",
            goal="Analyses produced before Projects existed.",
            description="Auto-generated holder for reports that existed before Projects workspaces.",
            metadata={"auto_seeded": True, "legacy_holder": True},
        ))
    except Exception as e:
        print(f"get_legacy_project error: {e}")
        return None


# ── Materials ───────────────────────────────────────────────

def list_project_materials(project_id: int) -> List[dict]:
    try:
        resp = (supabase.table("project_materials")
                .select("*")
                .eq("project_id", project_id)
                .order("created_at")
                .execute())
        return resp.data or []
    except Exception as e:
        print(f"list_project_materials error: {e}")
        return []


def create_project_material(material: ProjectMaterialModel) -> Optional[dict]:
    payload = _strip_none({
        "project_id": material.project_id,
        "kind": material.kind,
        "filename": material.filename,
        "mime_type": material.mime_type,
        "size_bytes": material.size_bytes or 0,
        "content_text": material.content_text,
        "storage_path": material.storage_path,
        "source_url": material.source_url,
        "metadata": material.metadata or {},
    })
    try:
        resp = supabase.table("project_materials").insert(payload).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"create_project_material error: {e}")
        return None


def delete_project_material(material_id: int) -> bool:
    try:
        supabase.table("project_materials").delete().eq("id", material_id).execute()
        return True
    except Exception as e:
        print(f"delete_project_material error: {e}")
        return False


def collect_materials_for_run(project_id: int) -> List[dict]:
    """
    Walk up the parent chain collecting materials, honouring each
    level's `inherits_materials` flag. Returns materials newest-first
    from self, then parent, then grandparent (up to 3 levels — UI cap).
    """
    out: List[dict] = []
    seen_ids: set = set()
    current_id = project_id
    depth = 0
    while current_id and depth < 4:
        proj = get_project(current_id)
        if not proj:
            break
        # Always pull self's materials; only climb if inherits is on.
        for m in list_project_materials(current_id):
            if m["id"] not in seen_ids:
                out.append(m)
                seen_ids.add(m["id"])
        if depth > 0 and not (proj.get("inherits_materials", True)):
            break
        current_id = proj.get("parent_id")
        depth += 1
    return out


# ── Runs ────────────────────────────────────────────────────

def create_project_run(run: ProjectRunModel) -> Optional[dict]:
    payload = _strip_none({
        "project_id": run.project_id,
        "kind": run.kind,
        "input_payload": run.input_payload or {},
        "status": run.status or "running",
        "token_cost_cents": run.token_cost_cents or 0,
        "usage_summary": run.usage_summary or {},
        "legacy_report_id": run.legacy_report_id,
    })
    try:
        resp = supabase.table("project_runs").insert(payload).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"create_project_run error: {e}")
        return None


def finalize_project_run(run_id: int, *, status: str, error: Optional[str] = None,
                         token_cost_cents: Optional[int] = None,
                         usage_summary: Optional[Dict[str, Any]] = None) -> Optional[dict]:
    payload = {"status": status, "finished_at": "now()"}
    if error:
        payload["error"] = error
    if token_cost_cents is not None:
        payload["token_cost_cents"] = token_cost_cents
    if usage_summary is not None:
        payload["usage_summary"] = usage_summary
    try:
        resp = supabase.table("project_runs").update(payload).eq("id", run_id).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"finalize_project_run error: {e}")
        return None


def list_project_runs(project_id: int) -> List[dict]:
    try:
        resp = (supabase.table("project_runs")
                .select("*")
                .eq("project_id", project_id)
                .order("started_at", desc=True)
                .execute())
        return resp.data or []
    except Exception as e:
        print(f"list_project_runs error: {e}")
        return []


# ── Artifacts ───────────────────────────────────────────────

def create_project_artifact(artifact: ProjectArtifactModel) -> Optional[dict]:
    payload = _strip_none({
        "project_id": artifact.project_id,
        "run_id": artifact.run_id,
        "kind": artifact.kind,
        "persona_key": artifact.persona_key,
        "title": artifact.title,
        "content": artifact.content,
        "structured_data": artifact.structured_data,
        "storage_path": artifact.storage_path,
        "status": artifact.status or "active",
        "sort_order": artifact.sort_order or 0,
    })
    try:
        resp = supabase.table("project_artifacts").insert(payload).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"create_project_artifact error: {e}")
        return None


def list_project_artifacts(project_id: int, kind: Optional[str] = None,
                            run_id: Optional[int] = None) -> List[dict]:
    try:
        q = (supabase.table("project_artifacts")
             .select("*")
             .eq("project_id", project_id)
             .eq("status", "active")
             .order("sort_order")
             .order("created_at"))
        if kind:
            q = q.eq("kind", kind)
        if run_id:
            q = q.eq("run_id", run_id)
        return q.execute().data or []
    except Exception as e:
        print(f"list_project_artifacts error: {e}")
        return []


def update_project_artifact(artifact_id: int, fields: Dict[str, Any]) -> Optional[dict]:
    allowed = {"title", "content", "structured_data", "status", "sort_order"}
    payload = {k: v for k, v in fields.items() if k in allowed}
    if not payload:
        return None
    payload["updated_at"] = "now()"
    try:
        resp = supabase.table("project_artifacts").update(payload).eq("id", artifact_id).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"update_project_artifact error: {e}")
        return None


def delete_project_artifact(artifact_id: int) -> bool:
    try:
        supabase.table("project_artifacts").update({"status": "deleted"}).eq("id", artifact_id).execute()
        return True
    except Exception as e:
        print(f"delete_project_artifact error: {e}")
        return False


# ── Backlog (project_artifacts where kind='backlog_item') ───
#
# Backlog items are stored as project_artifacts with:
#   kind = 'backlog_item'
#   title = story title (also kept in structured_data.title for redundancy)
#   content = the user-story prose ("As a … I want … so that …")
#   structured_data = full payload:
#     {
#       "title", "story", "acceptance_criteria": [...], "points",
#       "priority": "high|med|low",
#       "epic", "status": "backlog|todo|in_progress|done",
#       "source": "ba_agent|manual|imported",
#       "assignee": str|null,
#       "labels": [..]
#     }
#   sort_order = display order within a column

import re as _backlog_re

BACKLOG_STATUSES = ("backlog", "todo", "in_progress", "done")
BACKLOG_SOURCES = ("ba_agent", "manual", "imported")


def _backlog_to_row_payload(story: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise a free-form story dict into the structured_data we store."""
    raw_status = (story.get("status") or "backlog").lower().replace(" ", "_")
    if raw_status not in BACKLOG_STATUSES:
        raw_status = "backlog"
    raw_priority = (story.get("priority") or "med").lower()
    if raw_priority not in ("high", "med", "low"):
        raw_priority = "med"
    ac = story.get("acceptance_criteria") or story.get("ac") or []
    if isinstance(ac, str):
        # Split on bullets / newlines for tolerance
        ac = [line.lstrip("-*• ").strip()
              for line in ac.splitlines() if line.strip()]
    points = story.get("points")
    try:
        points = int(points) if points is not None else None
    except (ValueError, TypeError):
        points = None
    return {
        "title": (story.get("title") or "").strip() or "Untitled story",
        "story": (story.get("story") or "").strip(),
        "acceptance_criteria": [str(a).strip() for a in ac if str(a).strip()],
        "points": points,
        "priority": raw_priority,
        "status": raw_status,
        "epic": (story.get("epic") or "").strip() or None,
        "source": (story.get("source") or "manual"),
        "assignee": story.get("assignee"),
        "labels": story.get("labels") or [],
    }


def list_backlog_items(project_id: int) -> List[dict]:
    """Return active backlog items for a project, ordered by status + sort_order."""
    return list_project_artifacts(project_id, kind="backlog_item")


def create_backlog_item(project_id: int, story: Dict[str, Any],
                        run_id: Optional[int] = None) -> Optional[dict]:
    payload = _backlog_to_row_payload(story)
    art = ProjectArtifactModel(
        project_id=project_id,
        run_id=run_id,
        kind="backlog_item",
        persona_key="ba" if payload["source"] == "ba_agent" else None,
        title=payload["title"],
        content=payload["story"] or None,
        structured_data=payload,
        sort_order=int(story.get("sort_order") or 0),
    )
    return create_project_artifact(art)


def update_backlog_item(artifact_id: int, partial: Dict[str, Any]) -> Optional[dict]:
    """
    Patch a backlog item. Accepts any subset of the story payload — we merge into
    structured_data and re-derive title/content if those changed.
    """
    try:
        existing = (supabase.table("project_artifacts")
                    .select("*")
                    .eq("id", artifact_id)
                    .single()
                    .execute().data)
    except Exception as e:
        print(f"update_backlog_item lookup error: {e}")
        return None
    if not existing:
        return None

    sd = existing.get("structured_data") or {}
    merged = {**sd, **partial}
    normalised = _backlog_to_row_payload(merged)

    fields: Dict[str, Any] = {
        "structured_data": normalised,
        "title": normalised["title"],
        "content": normalised["story"] or None,
    }
    if "sort_order" in partial:
        try:
            fields["sort_order"] = int(partial["sort_order"])
        except (ValueError, TypeError):
            pass
    return update_project_artifact(artifact_id, fields)


def delete_backlog_item(artifact_id: int) -> bool:
    return delete_project_artifact(artifact_id)


# ── BA agent → backlog auto-import ──────────────────────────

# Regex mirrors static/script.js renderJiraBacklog so the BA persona's structured
# output works out of the box with no agent prompt change.
_BA_STORY_REGEX = _backlog_re.compile(
    r"\*\*Title\*\*:\s*(.*?)\n"
    r"\*\*Story Points\*\*:\s*(\d+)\n"
    r"\*\*User Story\*\*:\s*(.*?)\n"
    r"\*\*Acceptance Criteria\*\*:\s*([\s\S]*?)(?=\n\*\*Title\*\*|\n---|\Z)",
    _backlog_re.MULTILINE,
)


def parse_ba_stories(ba_content: str) -> List[Dict[str, Any]]:
    """Pull out structured stories from a BA agent markdown report."""
    stories: List[Dict[str, Any]] = []
    if not ba_content:
        return stories
    for m in _BA_STORY_REGEX.finditer(ba_content):
        try:
            points = int(m.group(2).strip())
        except ValueError:
            points = None
        priority = "high" if (points or 0) > 8 else "med" if (points or 0) > 3 else "low"
        # AC block: bulleted lines
        ac_block = m.group(4).strip()
        ac_lines = [
            ln.lstrip("-*• ").strip()
            for ln in ac_block.splitlines() if ln.strip()
        ]
        stories.append({
            "title": m.group(1).strip(),
            "story": m.group(3).strip(),
            "acceptance_criteria": ac_lines,
            "points": points,
            "priority": priority,
            "status": "backlog",
            "source": "ba_agent",
        })
    return stories


def import_backlog_from_ba(project_id: int, ba_content: str,
                            run_id: Optional[int] = None,
                            *, dedupe_by_title: bool = True) -> Dict[str, Any]:
    """
    Parse BA agent output and persist its stories as backlog items.
    Returns {parsed, imported, skipped_existing}.
    """
    stories = parse_ba_stories(ba_content or "")
    if not stories:
        return {"parsed": 0, "imported": 0, "skipped_existing": 0}

    existing_titles = set()
    if dedupe_by_title:
        for item in list_backlog_items(project_id):
            t = (item.get("title") or "").strip().lower()
            if t:
                existing_titles.add(t)

    imported = 0
    skipped = 0
    for i, s in enumerate(stories):
        if dedupe_by_title and s["title"].lower() in existing_titles:
            skipped += 1
            continue
        s["sort_order"] = i
        if create_backlog_item(project_id, s, run_id=run_id):
            imported += 1
            existing_titles.add(s["title"].lower())
    return {"parsed": len(stories), "imported": imported, "skipped_existing": skipped}


# ── Project Documents (Living Knowledge) ─────────────────────
#
# Living documents stored as project_artifacts with special `kind` values.
# Unlike one-shot report artifacts, these are updated incrementally
# across runs — each run adds to them, never replaces from scratch.
#
# Document kinds:
#   doc_run_summary     — one per run (snapshot, not living)
#   doc_lessons_learned — one per project (living, appended each run)
#   doc_decision_log    — one per project (living)
#   doc_risk_register   — one per project (living)
#   doc_tech_debt       — one per project (living)
#   doc_agent_notes     — one per project (living)

DOC_KINDS = (
    "doc_run_summary", "doc_lessons_learned", "doc_decision_log",
    "doc_risk_register", "doc_tech_debt", "doc_agent_notes",
)

LIVING_DOC_KINDS = (
    "doc_lessons_learned", "doc_decision_log",
    "doc_risk_register", "doc_tech_debt", "doc_agent_notes",
)


def get_project_document(project_id: int, doc_kind: str) -> Optional[dict]:
    """Get the current version of a living project document."""
    try:
        resp = (supabase.table("project_artifacts")
                .select("*")
                .eq("project_id", project_id)
                .eq("kind", doc_kind)
                .eq("status", "active")
                .order("created_at", desc=True)
                .limit(1)
                .execute())
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"get_project_document error: {e}")
        return None


def get_all_project_documents(project_id: int) -> Dict[str, dict]:
    """Get all living documents for a project, keyed by doc_kind."""
    docs: Dict[str, dict] = {}
    for kind in DOC_KINDS:
        doc = get_project_document(project_id, kind)
        if doc:
            docs[kind] = doc
    return docs


def upsert_project_document(
    project_id: int,
    doc_kind: str,
    content: str,
    structured_data: Optional[Dict[str, Any]] = None,
    run_id: Optional[int] = None,
    title: Optional[str] = None,
) -> Optional[dict]:
    """
    Create or update a living project document. For living docs (lessons,
    risks, etc.) we find the existing artifact and update it. For per-run
    docs (run_summary) we always create a new one.
    """
    _titles = {
        "doc_run_summary": "Run Summary",
        "doc_lessons_learned": "Lessons Learned",
        "doc_decision_log": "Decision Log",
        "doc_risk_register": "Risk Register",
        "doc_tech_debt": "Technical Debt Inventory",
        "doc_agent_notes": "Agent Knowledge Notes",
    }
    display_title = title or _titles.get(doc_kind, doc_kind)

    # Per-run docs always create new
    if doc_kind == "doc_run_summary":
        return create_project_artifact(ProjectArtifactModel(
            project_id=project_id,
            run_id=run_id,
            kind=doc_kind,
            title=display_title,
            content=content,
            structured_data=structured_data or {},
        ))

    # Living docs: update existing or create
    existing = get_project_document(project_id, doc_kind)
    if existing:
        return update_project_artifact(existing["id"], {
            "content": content,
            "structured_data": structured_data or existing.get("structured_data", {}),
            "title": display_title,
        })
    else:
        return create_project_artifact(ProjectArtifactModel(
            project_id=project_id,
            run_id=run_id,
            kind=doc_kind,
            title=display_title,
            content=content,
            structured_data=structured_data or {},
        ))


# ── Episodic Memory (Cross-Run Learning) ─────────────────────

def get_episodic_memory(project_id: int, max_runs: int = 5) -> Dict[str, Any]:
    """
    Retrieve previous findings for a project to brief agents on history.
    Returns a dict with:
      - previous_runs: list of {run_id, started_at, kind, input_payload}
      - previous_findings: dict of persona_key → latest content (truncated)
      - synthesis_history: list of past synthesis summaries
      - living_docs: current state of all living documents
    """
    memory: Dict[str, Any] = {
        "previous_runs": [],
        "previous_findings": {},
        "synthesis_history": [],
        "living_docs": {},
        "run_count": 0,
    }
    try:
        # Get past runs for this project
        runs = list_project_runs(project_id)
        completed_runs = [r for r in runs if r.get("status") == "complete"]
        memory["run_count"] = len(completed_runs)

        if not completed_runs:
            return memory

        # Take the most recent N runs
        recent_runs = completed_runs[:max_runs]
        memory["previous_runs"] = [
            {
                "run_id": r["id"],
                "started_at": r.get("started_at", ""),
                "kind": r.get("kind", ""),
                "input_payload": r.get("input_payload", {}),
            }
            for r in recent_runs
        ]

        # Get latest report artifacts per persona (from the most recent run)
        latest_run_id = recent_runs[0]["id"]
        latest_reports = list_project_artifacts(project_id, kind="report", run_id=latest_run_id)
        for report in latest_reports:
            persona = report.get("persona_key")
            content = report.get("content") or ""
            if persona and content:
                # Truncate to 2000 chars per agent for memory injection
                memory["previous_findings"][persona] = content[:2000]

        # Get synthesis history (last 3 runs)
        for run in recent_runs[:3]:
            syn_artifacts = list_project_artifacts(project_id, kind="synthesis", run_id=run["id"])
            for syn in syn_artifacts:
                content = syn.get("content") or ""
                if content:
                    memory["synthesis_history"].append({
                        "run_id": run["id"],
                        "date": run.get("started_at", ""),
                        "summary": content[:3000],
                    })

        # Get current living documents
        memory["living_docs"] = get_all_project_documents(project_id)

    except Exception as e:
        print(f"get_episodic_memory error (non-fatal): {e}")

    return memory


# ── Custom Agents (Dynamic Spawning — Phase 7B) ──────────────
#
# Spawned specialist agents are stored as project_artifacts with:
#   kind = 'custom_agent'
#   persona_key = generated key like 'specialist_kubernetes_helm'
#   title = human-readable agent name
#   content = system_prompt (the persona definition)
#   structured_data = {
#     "name": str, "emoji": str, "model": "gemini"|"anthropic",
#     "spawned_by": "system"|persona_key, "reason": str,
#     "context_limit": int, "source_project_id": int,
#     "approved_at": iso_timestamp, "run_count": int,
#   }

def list_custom_agents(project_id: int) -> List[dict]:
    """Return all spawned specialist agents for a project."""
    return list_project_artifacts(project_id, kind="custom_agent")


def get_custom_agent(project_id: int, persona_key: str) -> Optional[dict]:
    """Lookup a specific custom agent by persona_key."""
    try:
        resp = (supabase.table("project_artifacts")
                .select("*")
                .eq("project_id", project_id)
                .eq("kind", "custom_agent")
                .eq("persona_key", persona_key)
                .eq("status", "active")
                .limit(1)
                .execute())
        return resp.data[0] if resp.data else None
    except Exception as e:
        print(f"get_custom_agent error: {e}")
        return None


def create_custom_agent(
    project_id: int,
    persona_key: str,
    name: str,
    system_prompt: str,
    emoji: str = "🔬",
    model: str = "gemini",
    spawned_by: str = "system",
    reason: str = "",
    context_limit: int = 70_000,
    run_id: Optional[int] = None,
) -> Optional[dict]:
    """Persist a newly spawned specialist agent."""
    return create_project_artifact(ProjectArtifactModel(
        project_id=project_id,
        run_id=run_id,
        kind="custom_agent",
        persona_key=persona_key,
        title=name,
        content=system_prompt,
        structured_data={
            "name": name,
            "emoji": emoji,
            "model": model,
            "spawned_by": spawned_by,
            "reason": reason,
            "context_limit": context_limit,
            "source_project_id": project_id,
            "run_count": 0,
        },
    ))


def find_borrowable_agents(exclude_project_id: Optional[int] = None) -> List[dict]:
    """
    Find all custom agents across all projects that could be borrowed.
    Returns a flat list; the caller filters by relevance.
    """
    try:
        q = (supabase.table("project_artifacts")
             .select("*")
             .eq("kind", "custom_agent")
             .eq("status", "active")
             .order("created_at", desc=True)
             .limit(100))
        rows = q.execute().data or []
        if exclude_project_id:
            rows = [r for r in rows if r.get("project_id") != exclude_project_id]
        return rows
    except Exception as e:
        print(f"find_borrowable_agents error: {e}")
        return []


def save_run_artifacts(run_id: int, project_id: int,
                       results: Dict[str, Any],
                       synthesis_content: str = "",
                       personas_meta: Optional[Dict[str, Any]] = None) -> int:
    """
    Convenience helper: persist a completed agent-fleet run as artifacts.
    Returns the count of rows written.
    """
    written = 0
    personas_meta = personas_meta or {}
    for persona_key, content in (results or {}).items():
        if not content:
            continue
        meta = personas_meta.get(persona_key, {})
        art = ProjectArtifactModel(
            project_id=project_id,
            run_id=run_id,
            kind="report",
            persona_key=persona_key,
            title=meta.get("name") or persona_key.replace("_", " ").title(),
            content=content if isinstance(content, str) else None,
            structured_data=content if not isinstance(content, str) else None,
        )
        if create_project_artifact(art):
            written += 1
    if synthesis_content:
        syn = ProjectArtifactModel(
            project_id=project_id,
            run_id=run_id,
            kind="synthesis",
            persona_key="synthesis",
            title="The Verdict",
            content=synthesis_content,
        )
        if create_project_artifact(syn):
            written += 1
    return written
