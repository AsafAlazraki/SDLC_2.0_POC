import os
import json
import asyncio
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(override=True)

# Read API keys from environment
ENV_GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
ENV_ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ENV_GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import httpx
import uvicorn
import database
from database import (
    ClientModel, PersonaModel,
    ProjectModel, ProjectMaterialModel, ProjectArtifactModel,
)
from google import genai
from google.genai import types
from sse_starlette.sse import EventSourceResponse
import anthropic as anthropic_sdk

import agent_engine
import build_pack
import kickoff_pack
import materials_extractor

from uuid import uuid4

# ─────────────────────────────────────────────
# Phase 6 — Fleet session state (confidence Q&A)
# In-memory registry of active fleet runs that are waiting for user answers.
# Key = session_id (UUID), value = {event: asyncio.Event, answers: dict}
# Entries are short-lived (<5 min TTL enforced by asyncio.wait_for in the SSE gen).
# ─────────────────────────────────────────────
_fleet_sessions: dict = {}

# ─────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────

class RepoAnalysisRequest(BaseModel):
    github_url: str
    gemini_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    client_id: Optional[int] = None
    project_id: Optional[int] = None        # NEW — Phase 1 Projects
    additional_context: Optional[str] = None
    skip_personas: Optional[List[str]] = None  # Phase 5 frugal mode

class TopicAnalysisRequest(BaseModel):
    topic: str
    urls: List[str] = []
    github_url: Optional[str] = None
    gemini_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    client_id: Optional[int] = None
    project_id: Optional[int] = None        # NEW — Phase 1 Projects
    additional_context: Optional[str] = None
    skip_personas: Optional[List[str]] = None  # Phase 5 frugal mode

class ChatRequest(BaseModel):
    persona_key: str
    question: str
    agent_report: str  # The agent's original analysis content (used as context)

class GitHubStory(BaseModel):
    title: str
    story: str
    ac: List[str] = []
    points: int = 3
    priority: str = "med"

class GitHubIssuesRequest(BaseModel):
    github_url: str
    stories: List[GitHubStory]

class SaveReportRequest(BaseModel):
    github_url: str
    client_id: Optional[int] = None
    results: dict
    synthesis_content: Optional[str] = None

# Legacy schema models (kept for /api/analyze backward compat)
class BAStory(BaseModel):
    title: str = Field(description="Title of the user story")
    points: str = Field(description="Complexity estimate in story points")
    description: str = Field(description="User story format")
    ac: List[str] = Field(description="Acceptance criteria")
    notes: str = Field(description="Technical notes")

class ArchitectDesign(BaseModel):
    diagram: str = Field(description="Mermaid.js graph TD diagram string")
    description: str = Field(description="As-Is vs To-Be description")

class QARisk(BaseModel):
    risk: str = Field(description="Potential regression risk")
    mitigation: str = Field(description="Mitigation step")

class SecurityFinding(BaseModel):
    finding: str = Field(description="Security or compliance issue")
    severity: str = Field(description="High, Medium, or Low")

# ─────────────────────────────────────────────
# App Setup
# ─────────────────────────────────────────────

app = FastAPI(title="SDLC Discovery Engine")

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def index():
    return FileResponse("static/index.html")

@app.get("/download/walkthrough.webm")
def download_walkthrough():
    """Serve the recorded walkthrough video for download."""
    video_path = "walkthrough.webm"
    if not os.path.exists(video_path):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Walkthrough video not found. Run record_walkthrough.cjs to generate it.")
    return FileResponse(
        video_path,
        media_type="video/webm",
        headers={"Content-Disposition": "attachment; filename=sdlc-discovery-walkthrough.webm"}
    )

# ─────────────────────────────────────────────
# Config & Status
# ─────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    """Let the frontend know which keys are configured server-side."""
    return {
        "has_env_key": bool(ENV_GEMINI_KEY),
        "has_anthropic_env_key": bool(ENV_ANTHROPIC_KEY),
        "has_github_token": bool(ENV_GITHUB_TOKEN),
    }

# ─────────────────────────────────────────────
# Phase 6 — Fleet confidence Q&A answer endpoint
# ─────────────────────────────────────────────

class FleetAnswerPayload(BaseModel):
    """User-provided answers during the confidence Q&A pause."""
    answers: Optional[dict] = None          # {persona_key: "answer text"}
    global_answer: Optional[str] = None     # Free-text additional context
    extra_urls: Optional[List[str]] = None  # URLs to fetch and inject


@app.post("/api/fleet-answer/{session_id}")
async def fleet_answer(session_id: str, payload: FleetAnswerPayload):
    """
    Receive the user's answers to agent confidence questions and unblock the
    waiting SSE generator so the fleet can proceed with enriched context.
    """
    session = _fleet_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Fleet session not found or expired.")

    answer_data: dict = {
        "answers": payload.answers or {},
        "global_answer": payload.global_answer or "",
        "fetched_content": {},
    }

    # Fetch extra URLs if provided (best-effort, non-blocking per URL).
    if payload.extra_urls:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            for url in payload.extra_urls[:5]:  # Cap at 5 URLs
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        text = resp.text[:20_000]  # Cap per-URL content
                        answer_data["fetched_content"][url] = text
                except Exception as e:
                    answer_data["fetched_content"][url] = f"[Fetch failed: {e}]"

    session["answers"] = answer_data
    session["event"].set()
    return {"ok": True, "urls_fetched": len(answer_data["fetched_content"])}


@app.post("/api/fleet-skip/{session_id}")
async def fleet_skip(session_id: str):
    """Skip the confidence Q&A — proceed with the fleet immediately."""
    session = _fleet_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Fleet session not found or expired.")
    session["answers"] = {}
    session["event"].set()
    return {"ok": True}


# ─────────────────────────────────────────────
# Phase 7B — Specialist Agent Approval & Creation
# ─────────────────────────────────────────────

class SpecialistApprovalPayload(BaseModel):
    """Approve or reject proposed specialist agents."""
    approved_keys: List[str]  # persona_keys the user approved
    project_id: int


@app.post("/api/approve-specialists")
async def approve_specialists(payload: SpecialistApprovalPayload):
    """
    Create approved specialist agents: Flash drafts persona, Sonnet reviews,
    then persist as project-level custom agents.
    """
    gemini_key = ENV_GEMINI_KEY
    anthropic_key = ENV_ANTHROPIC_KEY
    if not gemini_key or not anthropic_key:
        raise HTTPException(status_code=400, detail="API keys required for specialist creation.")

    # Retrieve proposals from the session (stored in last run's proposals)
    # For now, proposals are passed from the frontend which cached them
    proposals_raw = (await request.json() if hasattr(request, 'json') else {}).get("proposals", [])

    created = []
    for proposal in proposals_raw:
        key = proposal.get("persona_key", "")
        if key not in payload.approved_keys:
            continue

        # Check if already exists on this project
        existing = database.get_custom_agent(payload.project_id, key)
        if existing:
            created.append({"persona_key": key, "status": "already_exists"})
            continue

        # Two-pass creation: Flash drafts, Sonnet reviews
        enriched = await agent_engine.create_specialist_persona(
            proposal, gemini_key, anthropic_key
        )

        agent_row = database.create_custom_agent(
            project_id=payload.project_id,
            persona_key=key,
            name=enriched.get("name", key),
            system_prompt=enriched.get("system_prompt", ""),
            emoji=enriched.get("emoji", "🔬"),
            model=enriched.get("model", "gemini"),
            spawned_by="system",
            reason=enriched.get("reason", ""),
            context_limit=enriched.get("context_limit", 70000),
        )
        if agent_row:
            created.append({"persona_key": key, "status": "created", "name": enriched.get("name")})
        else:
            created.append({"persona_key": key, "status": "failed"})

    return {"created": created, "total": len(created)}


@app.post("/api/approve-specialists-v2")
async def approve_specialists_v2(request_body: dict):
    """
    Simpler endpoint: receives the full proposals + approval list, creates agents.
    The frontend caches proposals from the SSE event and sends them here.
    """
    gemini_key = ENV_GEMINI_KEY
    anthropic_key = ENV_ANTHROPIC_KEY
    if not gemini_key or not anthropic_key:
        raise HTTPException(status_code=400, detail="API keys required.")

    proposals = request_body.get("proposals", [])
    approved_keys = request_body.get("approved_keys", [])
    project_id = request_body.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id required.")

    created = []
    for proposal in proposals:
        key = proposal.get("persona_key", "")
        if key not in approved_keys:
            continue

        existing = database.get_custom_agent(project_id, key)
        if existing:
            created.append({"persona_key": key, "status": "already_exists", "name": proposal.get("name")})
            continue

        enriched = await agent_engine.create_specialist_persona(
            proposal, gemini_key, anthropic_key
        )

        agent_row = database.create_custom_agent(
            project_id=project_id,
            persona_key=key,
            name=enriched.get("name", key),
            system_prompt=enriched.get("system_prompt", ""),
            emoji=enriched.get("emoji", "🔬"),
            model=enriched.get("model", "gemini"),
            spawned_by="system",
            reason=enriched.get("reason", ""),
            context_limit=enriched.get("context_limit", 70000),
        )
        if agent_row:
            created.append({"persona_key": key, "status": "created", "name": enriched.get("name")})
        else:
            created.append({"persona_key": key, "status": "failed"})

    return {"created": created, "total": len(created)}


@app.get("/api/projects/{project_id}/custom-agents")
def api_list_custom_agents(project_id: int):
    """List all spawned specialist agents for a project."""
    agents = database.list_custom_agents(project_id)
    return [
        {
            "persona_key": a.get("persona_key"),
            "name": a.get("title"),
            "emoji": (a.get("structured_data") or {}).get("emoji", "🔬"),
            "model": (a.get("structured_data") or {}).get("model", "gemini"),
            "reason": (a.get("structured_data") or {}).get("reason", ""),
            "source_project_id": (a.get("structured_data") or {}).get("source_project_id"),
            "created_at": a.get("created_at"),
        }
        for a in agents
    ]


@app.get("/api/borrowable-agents")
def api_borrowable_agents(exclude_project_id: Optional[int] = None):
    """List all custom agents across projects that can be borrowed."""
    agents = database.find_borrowable_agents(exclude_project_id)
    return [
        {
            "persona_key": a.get("persona_key"),
            "name": a.get("title"),
            "emoji": (a.get("structured_data") or {}).get("emoji", "🔬"),
            "model": (a.get("structured_data") or {}).get("model", "gemini"),
            "reason": (a.get("structured_data") or {}).get("reason", ""),
            "source_project_id": a.get("project_id"),
            "created_at": a.get("created_at"),
            "system_prompt_preview": (a.get("content") or "")[:200],
        }
        for a in agents
    ]


# ─────────────────────────────────────────────
# Client & Persona Routes
# ─────────────────────────────────────────────

@app.get("/api/clients")
def get_clients():
    return database.get_clients()

@app.post("/api/clients")
def create_client(client: ClientModel):
    return database.create_client_db(client)

@app.get("/api/personas/config")
async def get_persona_configs():
    """Return the full persona metadata for the UI profile modal."""
    return agent_engine.PERSONA_CONFIGS

@app.get("/api/personas")
def get_personas():
    return database.seed_default_personas()

@app.post("/api/personas")
def create_persona(persona: PersonaModel):
    return database.create_persona_db(persona)

# ─────────────────────────────────────────────
# Projects — first-class workspaces (Phase 1)
# ─────────────────────────────────────────────

class ProjectPatch(BaseModel):
    """Whitelisted project fields that can be patched via PATCH /api/projects/{id}."""
    parent_id: Optional[int] = None
    client_id: Optional[int] = None
    name: Optional[str] = None
    goal: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    inherits_materials: Optional[bool] = None


def _assemble_project_tree(flat: List[dict]) -> List[dict]:
    """Build a nested tree from a flat projects list, hiding the legacy holder at root level."""
    by_id = {p["id"]: {**p, "children": []} for p in flat}
    roots: List[dict] = []
    for p in by_id.values():
        parent = p.get("parent_id")
        if parent and parent in by_id:
            by_id[parent]["children"].append(p)
        else:
            roots.append(p)
    # Sort roots: legacy holder last, others alphabetical.
    def sort_key(p: dict):
        meta = p.get("metadata") or {}
        return (1 if meta.get("legacy_holder") else 0, (p.get("name") or "").lower())
    roots.sort(key=sort_key)
    for p in by_id.values():
        p["children"].sort(key=lambda c: (c.get("name") or "").lower())
    return roots


@app.get("/api/projects")
def api_list_projects(client_id: Optional[int] = None, flat: bool = False):
    """
    List projects. Default: nested tree grouped under root projects.
    ?flat=true returns a flat list (useful for dropdowns).
    ?client_id=N filters to a specific client.
    """
    rows = database.list_projects(client_id=client_id)
    if flat:
        return rows
    return _assemble_project_tree(rows)


@app.get("/api/projects/legacy")
def api_get_legacy_project():
    """Return (or lazily create) the Legacy Analyses holder project."""
    proj = database.get_legacy_project()
    if not proj:
        raise HTTPException(status_code=500, detail="Could not locate or create the Legacy Analyses project.")
    return proj


@app.get("/api/projects/{project_id}")
def api_get_project(project_id: int):
    proj = database.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    # Enrich with counts so the UI doesn't need extra round-trips.
    materials = database.list_project_materials(project_id)
    runs = database.list_project_runs(project_id)
    artifacts = database.list_project_artifacts(project_id)
    children = database.get_project_children(project_id)
    # Phase 5 — sum cost across all completed runs.
    total_cost_cents = sum(
        (r.get("token_cost_cents") or 0) for r in runs
    )
    return {
        **proj,
        "counts": {
            "materials": len(materials),
            "runs": len(runs),
            "artifacts": len(artifacts),
            "children": len(children),
        },
        "total_cost_cents": total_cost_cents,
    }


@app.post("/api/projects")
def api_create_project(project: ProjectModel):
    if not project.name or not project.name.strip():
        raise HTTPException(status_code=400, detail="Project name is required.")
    # Validate depth (parent chain) to enforce the 3-level UI cap.
    if project.parent_id:
        depth = 1
        current = database.get_project(project.parent_id)
        while current and current.get("parent_id"):
            depth += 1
            if depth >= 3:
                raise HTTPException(status_code=400,
                                    detail="Max project nesting depth is 3 (project → sub-project → leaf).")
            current = database.get_project(current["parent_id"])
    created = database.create_project(project)
    if not created:
        raise HTTPException(status_code=500, detail="Could not create project.")
    return created


@app.patch("/api/projects/{project_id}")
def api_update_project(project_id: int, patch: ProjectPatch):
    existing = database.get_project(project_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    fields = patch.model_dump(exclude_unset=True, exclude_none=False)
    # Prevent cycles: a project cannot become its own descendant.
    if "parent_id" in fields and fields["parent_id"]:
        if fields["parent_id"] == project_id:
            raise HTTPException(status_code=400, detail="A project cannot be its own parent.")
        # Walk up the proposed parent's chain and look for project_id.
        cursor = database.get_project(fields["parent_id"])
        while cursor:
            if cursor["id"] == project_id:
                raise HTTPException(status_code=400, detail="That move would create a cycle in the project tree.")
            cursor = database.get_project(cursor["parent_id"]) if cursor.get("parent_id") else None
    updated = database.update_project(project_id, fields)
    if not updated:
        raise HTTPException(status_code=500, detail="Could not update project.")
    return updated


@app.delete("/api/projects/{project_id}")
def api_delete_project(project_id: int):
    existing = database.get_project(project_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    meta = existing.get("metadata") or {}
    if meta.get("legacy_holder"):
        raise HTTPException(status_code=400, detail="The Legacy Analyses project cannot be deleted.")
    database.delete_project(project_id)
    return {"ok": True, "id": project_id, "status": "archived"}


@app.get("/api/projects/{project_id}/materials")
def api_list_materials(project_id: int, include_inherited: bool = False):
    if include_inherited:
        return database.collect_materials_for_run(project_id)
    return database.list_project_materials(project_id)


@app.post("/api/projects/{project_id}/materials")
def api_create_material(project_id: int, material: ProjectMaterialModel):
    # Force the path param to win over any project_id the client sent in the body.
    material.project_id = project_id
    if not material.kind or material.kind not in ("file", "url", "text", "image"):
        raise HTTPException(status_code=400,
                            detail="material.kind must be one of: file, url, text, image.")
    created = database.create_project_material(material)
    if not created:
        raise HTTPException(status_code=500, detail="Could not save material.")
    return created


@app.delete("/api/projects/{project_id}/materials/{material_id}")
def api_delete_material(project_id: int, material_id: int):
    # Lightweight safety: confirm the material belongs to this project before deleting.
    mats = database.list_project_materials(project_id)
    if not any(m["id"] == material_id for m in mats):
        raise HTTPException(status_code=404, detail="Material not found on this project.")
    database.delete_project_material(material_id)
    return {"ok": True, "id": material_id}


@app.post("/api/projects/{project_id}/materials/upload")
async def api_upload_materials(project_id: int, files: List[UploadFile] = File(...)):
    """
    Multipart upload entry point. Accepts one or more files. For each file we
    detect the format, extract text via materials_extractor (PDF / DOCX /
    OAP-aware ZIP / text / code), and persist a project_materials row.
    Returns the saved rows including parsed text length + extraction metadata.
    """
    # Reject if the project doesn't exist.
    proj = database.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")

    saved: List[dict] = []
    errors: List[dict] = []
    for f in files:
        try:
            payload = await f.read()
            text, meta = materials_extractor.extract_text(
                f.filename or "(unnamed)",
                f.content_type or "",
                payload,
            )
            material = ProjectMaterialModel(
                project_id=project_id,
                kind="file",
                filename=f.filename,
                mime_type=f.content_type or "application/octet-stream",
                size_bytes=len(payload),
                content_text=text or None,
                metadata=meta,
            )
            row = database.create_project_material(material)
            if row:
                saved.append(row)
            else:
                errors.append({"filename": f.filename, "error": "DB insert returned no row"})
        except Exception as e:
            errors.append({"filename": getattr(f, "filename", "?"), "error": str(e)[:200]})
        finally:
            try:
                await f.close()
            except Exception:
                pass

    return {
        "saved": saved,
        "saved_count": len(saved),
        "errors": errors,
    }


@app.get("/api/projects/{project_id}/materials/{material_id}/preview")
def api_get_material_preview(project_id: int, material_id: int):
    """Return the extracted text for a material — used by the UI's preview pane."""
    mats = database.list_project_materials(project_id)
    match = next((m for m in mats if m["id"] == material_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Material not found.")
    return {
        "id": match["id"],
        "filename": match.get("filename"),
        "kind": match.get("kind"),
        "mime_type": match.get("mime_type"),
        "size_bytes": match.get("size_bytes"),
        "metadata": match.get("metadata") or {},
        "content_text": match.get("content_text") or "",
        "content_length": len(match.get("content_text") or ""),
    }


@app.get("/api/projects/{project_id}/runs")
def api_list_project_runs(project_id: int):
    return database.list_project_runs(project_id)


@app.get("/api/projects/{project_id}/artifacts")
def api_list_project_artifacts(project_id: int,
                                kind: Optional[str] = None,
                                run_id: Optional[int] = None):
    return database.list_project_artifacts(project_id, kind=kind, run_id=run_id)


@app.post("/api/projects/{project_id}/artifacts")
def api_create_project_artifact(project_id: int, artifact: ProjectArtifactModel):
    artifact.project_id = project_id
    created = database.create_project_artifact(artifact)
    if not created:
        raise HTTPException(status_code=500, detail="Could not create artifact.")
    return created


# ─────────────────────────────────────────────
# Backlog (project_artifacts where kind='backlog_item')
# ─────────────────────────────────────────────

class BacklogItemPayload(BaseModel):
    title: Optional[str] = None
    story: Optional[str] = None
    acceptance_criteria: Optional[List[str]] = None
    points: Optional[int] = None
    priority: Optional[str] = None  # high|med|low
    status: Optional[str] = None    # backlog|todo|in_progress|done
    epic: Optional[str] = None
    source: Optional[str] = None
    assignee: Optional[str] = None
    labels: Optional[List[str]] = None
    sort_order: Optional[int] = None


class BacklogImportRequest(BaseModel):
    """Trigger BA-content → backlog import outside the standard analyze flow."""
    ba_content: Optional[str] = None
    run_id: Optional[int] = None
    dedupe_by_title: bool = True


@app.get("/api/projects/{project_id}/backlog")
def api_list_backlog(project_id: int):
    return database.list_backlog_items(project_id)


@app.post("/api/projects/{project_id}/backlog")
def api_create_backlog_item(project_id: int, payload: BacklogItemPayload):
    if not payload.title and not payload.story:
        raise HTTPException(status_code=400, detail="title or story required")
    created = database.create_backlog_item(
        project_id=project_id,
        story=payload.dict(exclude_none=True),
        run_id=None,
    )
    if not created:
        raise HTTPException(status_code=500, detail="Could not create backlog item.")
    return created


@app.patch("/api/projects/{project_id}/backlog/{item_id}")
def api_update_backlog_item(project_id: int, item_id: int, payload: BacklogItemPayload):
    """Patch any subset of a backlog item (status moves, edits, reordering, etc.)."""
    partial = payload.dict(exclude_none=True)
    if not partial:
        raise HTTPException(status_code=400, detail="No fields to update.")
    updated = database.update_backlog_item(item_id, partial)
    if not updated:
        raise HTTPException(status_code=404, detail="Backlog item not found or update failed.")
    return updated


@app.delete("/api/projects/{project_id}/backlog/{item_id}")
def api_delete_backlog_item(project_id: int, item_id: int):
    if not database.delete_backlog_item(item_id):
        raise HTTPException(status_code=500, detail="Could not delete backlog item.")
    return {"ok": True}


@app.post("/api/projects/{project_id}/backlog/import-from-ba")
def api_import_backlog_from_ba(project_id: int, payload: BacklogImportRequest):
    """
    Import the BA agent's structured stories into the project backlog. If
    `ba_content` is omitted, we look up the most recent BA artifact stored on
    this project and use its content.
    """
    ba_content = payload.ba_content
    run_id = payload.run_id

    if not ba_content:
        # Best-effort: pull the latest stored BA report artifact for this project
        try:
            artifacts = database.list_project_artifacts(project_id, kind="report")
            ba_artifacts = [a for a in artifacts if a.get("persona_key") == "ba"]
            if ba_artifacts:
                ba_artifacts.sort(
                    key=lambda a: a.get("created_at") or "", reverse=True
                )
                latest = ba_artifacts[0]
                ba_content = latest.get("content")
                run_id = run_id or latest.get("run_id")
        except Exception as e:
            print(f"[backlog] could not look up stored BA artifact: {e}")

    if not ba_content:
        raise HTTPException(
            status_code=400,
            detail="No BA content supplied and no stored BA report found for this project."
        )

    summary = database.import_backlog_from_ba(
        project_id=project_id,
        ba_content=ba_content,
        run_id=run_id,
        dedupe_by_title=payload.dedupe_by_title,
    )
    return summary


# ─────────────────────────────────────────────
# Phase 7 — Project Documents (Living Knowledge)
# ─────────────────────────────────────────────

@app.get("/api/projects/{project_id}/documents")
def api_get_project_documents(project_id: int):
    """Return all living documents for a project."""
    docs = database.get_all_project_documents(project_id)
    # Convert to a list with the doc_kind as a key
    return [
        {
            "doc_kind": kind,
            "title": doc.get("title", kind),
            "content": doc.get("content", ""),
            "structured_data": doc.get("structured_data", {}),
            "updated_at": doc.get("updated_at") or doc.get("created_at", ""),
        }
        for kind, doc in docs.items()
    ]


@app.get("/api/projects/{project_id}/documents/{doc_kind}")
def api_get_project_document(project_id: int, doc_kind: str):
    """Return a specific living document."""
    if doc_kind not in database.DOC_KINDS:
        raise HTTPException(status_code=400, detail=f"Unknown document kind: {doc_kind}")
    doc = database.get_project_document(project_id, doc_kind)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "doc_kind": doc_kind,
        "title": doc.get("title", doc_kind),
        "content": doc.get("content", ""),
        "structured_data": doc.get("structured_data", {}),
        "updated_at": doc.get("updated_at") or doc.get("created_at", ""),
    }


@app.get("/api/projects/{project_id}/memory")
def api_get_episodic_memory(project_id: int):
    """Return the episodic memory summary for a project — useful for debugging."""
    memory = database.get_episodic_memory(project_id)
    return {
        "run_count": memory.get("run_count", 0),
        "previous_runs": memory.get("previous_runs", []),
        "finding_personas": list(memory.get("previous_findings", {}).keys()),
        "synthesis_count": len(memory.get("synthesis_history", [])),
        "living_docs": list(memory.get("living_docs", {}).keys()),
    }


# ─────────────────────────────────────────────
# Project-run orchestration helpers
# (Kept near the /api/projects routes; used by analyze-repo / analyze-topic.)
# ─────────────────────────────────────────────

def _resolve_project_for_run(project_id: Optional[int]) -> Optional[int]:
    """
    If the client supplied a project_id, return it (verifying it exists).
    Otherwise fall back to the Legacy Analyses holder so runs are never orphaned.
    Returns None only if the DB migration hasn't been applied yet.
    """
    try:
        if project_id:
            proj = database.get_project(project_id)
            return proj["id"] if proj else None
        legacy = database.get_legacy_project()
        return legacy["id"] if legacy else None
    except Exception as e:
        print(f"_resolve_project_for_run: projects table may not exist yet — {e}")
        return None


def _open_project_run(project_id: Optional[int], *, kind: str,
                       input_payload: dict) -> Optional[int]:
    """Open a project_runs row and return its id (or None if disabled/failed)."""
    pid = _resolve_project_for_run(project_id)
    if not pid:
        return None
    try:
        run = database.create_project_run(database.ProjectRunModel(
            project_id=pid, kind=kind, input_payload=input_payload or {},
        ))
        return run["id"] if run else None
    except Exception as e:
        print(f"_open_project_run failed (non-fatal): {e}")
        return None


def _finalize_project_run(run_id: Optional[int], project_id: Optional[int],
                           *, status: str, results: Optional[dict] = None,
                           synthesis_content: str = "", error: Optional[str] = None,
                           usage_summary: Optional[dict] = None):
    """Mark the run finished and persist its artifacts alongside the reports row.

    Also auto-imports the BA agent's structured stories into the project backlog
    so the Backlog tab is populated immediately after a successful analysis.
    """
    if not run_id:
        return
    try:
        # Phase 5 — write accumulated cost + token usage onto the run row.
        cost_cents = None
        if usage_summary:
            cost_cents = int(round(usage_summary.get("total_cost_cents", 0)))
        database.finalize_project_run(
            run_id, status=status, error=error,
            token_cost_cents=cost_cents, usage_summary=usage_summary,
        )
        pid = _resolve_project_for_run(project_id)
        if pid and (results or synthesis_content):
            personas_meta = getattr(agent_engine, "PERSONA_CONFIGS", {}) or {}
            database.save_run_artifacts(
                run_id=run_id,
                project_id=pid,
                results=results or {},
                synthesis_content=synthesis_content or "",
                personas_meta=personas_meta,
            )

            # Phase 4 — auto-import the BA agent's structured stories as backlog items.
            # Best-effort + dedupe by title so re-runs don't duplicate work the team
            # has already moved into another column.
            ba_content = (results or {}).get("ba")
            if isinstance(ba_content, str) and ba_content.strip():
                try:
                    summary = database.import_backlog_from_ba(
                        project_id=pid, ba_content=ba_content, run_id=run_id,
                    )
                    print(f"[backlog] auto-import for project {pid}: {summary}")
                except Exception as e:
                    print(f"[backlog] auto-import failed (non-fatal): {e}")
    except Exception as e:
        print(f"_finalize_project_run failed (non-fatal): {e}")


# ─────────────────────────────────────────────
# Main Analysis Route (SSE Streaming)
# ─────────────────────────────────────────────

@app.post("/api/analyze-repo")
async def analyze_repo(request: RepoAnalysisRequest):
    """
    Kick off the 15-agent fleet on a GitHub repository.
    Returns Server-Sent Events as each persona agent completes,
    followed by the synthesis agent result.
    After all agents complete, the full report is saved to Supabase.
    """
    gemini_key = request.gemini_api_key or ENV_GEMINI_KEY
    anthropic_key = request.anthropic_api_key or ENV_ANTHROPIC_KEY

    if not gemini_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is required.")
    if not request.github_url:
        raise HTTPException(status_code=400, detail="GitHub URL is required.")

    # Open a project_run row up-front so the UI can tie events to a run.
    run_id = _open_project_run(request.project_id, kind="repo", input_payload={
        "github_url": request.github_url,
        "client_id": request.client_id,
        "additional_context": (request.additional_context or "")[:2000],
    })

    # Phase 6 — set up a fleet session so the confidence Q&A can pause/resume.
    fleet_session_id = str(uuid4())
    _fleet_sessions[fleet_session_id] = {
        "event": asyncio.Event(),
        "answers": {},
        "session_id": fleet_session_id,
    }

    async def event_generator():
        collected_results = {}
        synthesis_content = ""
        run_failed = False
        run_error = None
        run_usage_summary = None   # Phase 5 — accumulated token/cost data

        try:
            yield {
                "event": "status",
                "data": json.dumps({"phase": "cloning", "message": "Cloning repository..."})
            }

            code_context = await agent_engine.clone_github_repo(request.github_url)

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "cloned",
                    "message": f"Repository loaded ({len(code_context):,} characters of source code)"
                })
            }

            # Fetch DB persona prompts
            personas = database.get_personas()
            db_persona_prompts = ""
            for p in personas:
                db_persona_prompts += f"- {p['role_name']}: {p['system_prompt']}\n"

            # Client context
            client_context = ""
            if request.client_id:
                client_data = database.get_client(request.client_id)
                if client_data:
                    client_context = f"Client: '{client_data['name']}' ({client_data.get('description', '')})"

            # Phase 7 — inject project budget/timeline if set
            try:
                pid_for_ctx = _resolve_project_for_run(request.project_id)
                if pid_for_ctx:
                    proj_data = database.get_project(pid_for_ctx)
                    if proj_data:
                        meta = proj_data.get("metadata") or {}
                        budget = meta.get("budget_range") or proj_data.get("budget_range")
                        timeline = meta.get("timeline") or proj_data.get("timeline")
                        path_pref = meta.get("path_preference") or proj_data.get("path_preference")
                        if budget or timeline or path_pref:
                            ctx_parts = ["\n## Project Engagement Parameters"]
                            if budget:
                                ctx_parts.append(f"- **Budget range**: {budget}")
                            if timeline:
                                ctx_parts.append(f"- **Timeline**: {timeline}")
                            if path_pref:
                                ctx_parts.append(f"- **Preferred path**: {path_pref}")
                            ctx_parts.append("Tailor all recommendations to fit these constraints. Flag anything that exceeds them.")
                            client_context = (client_context + "\n" if client_context else "") + "\n".join(ctx_parts)
            except Exception:
                pass  # non-fatal — budget fields may not exist in DB yet

            # Additional business context from user
            if request.additional_context:
                client_context = (client_context + "\n\n" if client_context else "") + \
                    f"=== BUSINESS CONTEXT PROVIDED BY CLIENT TEAM ===\n{request.additional_context}\n=== END BUSINESS CONTEXT ==="

            persona_count = len(agent_engine.PERSONA_CONFIGS)
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "agents_launched",
                    "message": f"Agent fleet launched — {persona_count} autonomous personas researching...",
                    "agents": [
                        {"key": k, "name": v["name"], "emoji": v["emoji"], "status": "thinking"}
                        for k, v in agent_engine.PERSONA_CONFIGS.items()
                    ] + [{"key": "synthesis", "name": agent_engine.SYNTHESIS_CONFIG["name"],
                          "emoji": agent_engine.SYNTHESIS_CONFIG["emoji"], "status": "waiting"}]
                })
            }

            # Pull project materials (with inheritance) so the fleet sees them.
            project_materials_for_run = []
            try:
                pid_for_materials = _resolve_project_for_run(request.project_id)
                if pid_for_materials:
                    project_materials_for_run = database.collect_materials_for_run(pid_for_materials)
            except Exception as e:
                print(f"materials lookup failed (non-fatal): {e}")

            # Phase 7 — retrieve episodic memory for this project
            episodic_memory = {}
            try:
                pid_for_memory = _resolve_project_for_run(request.project_id)
                if pid_for_memory:
                    episodic_memory = database.get_episodic_memory(pid_for_memory)
                    if episodic_memory.get("run_count", 0) > 0:
                        yield {
                            "event": "status",
                            "data": json.dumps({
                                "phase": "memory_loaded",
                                "message": f"Episodic memory loaded — {episodic_memory['run_count']} previous run(s) found"
                            })
                        }
            except Exception as e:
                print(f"episodic memory lookup failed (non-fatal): {e}")

            # Phase 7B — load custom agents for this project
            custom_agents_for_run = []
            try:
                pid_for_agents = _resolve_project_for_run(request.project_id)
                if pid_for_agents:
                    custom_agents_for_run = database.list_custom_agents(pid_for_agents)
                    # Also store keys in fleet session for specialist proposal dedup
                    _fleet_sessions[fleet_session_id]["existing_custom_keys"] = [
                        a.get("persona_key") for a in custom_agents_for_run if a.get("persona_key")
                    ]
                    if custom_agents_for_run:
                        yield {
                            "event": "status",
                            "data": json.dumps({
                                "phase": "custom_agents_loaded",
                                "message": f"{len(custom_agents_for_run)} specialist agent(s) loaded for this project"
                            })
                        }
            except Exception as e:
                print(f"custom agent lookup failed (non-fatal): {e}")

            # Stream all agent results (core fleet + custom specialists + synthesis)
            async for update in agent_engine.run_agent_fleet(
                gemini_api_key=gemini_key,
                anthropic_api_key=anthropic_key,
                code_context=code_context,
                client_context=client_context,
                db_persona_prompts=db_persona_prompts,
                project_materials=project_materials_for_run,
                skip_personas=request.skip_personas,
                confidence_gate=True,
                answer_provider=_fleet_sessions[fleet_session_id],
                episodic_memory=episodic_memory,
                custom_agents=custom_agents_for_run,
            ):
                # Collect results for persistence
                if update["event"] == "agent_result":
                    result = update["data"]
                    if result.get("persona") == "synthesis":
                        synthesis_content = result.get("content", "")
                    elif result.get("status") == "success":
                        collected_results[result["persona"]] = result.get("content", "")
                elif update["event"] == "usage_summary":
                    run_usage_summary = update["data"]

                # Inject fleet_session_id into confidence events so the
                # frontend can POST answers/skip to the correct session.
                if update["event"] in ("confidence_report", "awaiting_answers"):
                    update["data"]["fleet_session_id"] = fleet_session_id

                yield {
                    "event": update["event"],
                    "data": json.dumps(update["data"])
                }

            # Save complete report to Supabase
            if collected_results:
                database.save_report(
                    github_url=request.github_url,
                    client_id=request.client_id,
                    results=collected_results,
                    synthesis_content=synthesis_content
                )

            # Phase 7 — generate/update project documents (async, non-blocking)
            if collected_results and request.project_id:
                yield {
                    "event": "status",
                    "data": json.dumps({
                        "phase": "documenting",
                        "message": "Generating project documentation (lessons learned, risk register, tech debt)..."
                    })
                }
                try:
                    doc_results = await agent_engine.generate_post_run_documents(
                        gemini_api_key=gemini_key,
                        agent_results=collected_results,
                        synthesis_content=synthesis_content,
                        episodic_memory=episodic_memory,
                        run_metadata={"run_id": run_id, "github_url": request.github_url},
                    )
                    pid_for_docs = _resolve_project_for_run(request.project_id)
                    docs_written = 0
                    for doc in doc_results:
                        kind = doc.get("doc_kind", "")
                        content = doc.get("content", "")
                        if kind and content and kind in database.DOC_KINDS:
                            database.upsert_project_document(
                                project_id=pid_for_docs,
                                doc_kind=kind,
                                content=content,
                                structured_data=doc.get("structured_data"),
                                run_id=run_id,
                            )
                            docs_written += 1
                    if docs_written:
                        yield {
                            "event": "status",
                            "data": json.dumps({
                                "phase": "documented",
                                "message": f"Project documentation updated — {docs_written} document(s) written"
                            })
                        }
                except Exception as doc_err:
                    print(f"Post-run doc generation failed (non-fatal): {doc_err}")

            yield {
                "event": "status",
                "data": json.dumps({"phase": "complete", "message": "All agents have reported. Discovery complete."})
            }

        except Exception as e:
            run_failed = True
            run_error = str(e)
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)})
            }
        finally:
            # Clean up the fleet session from the in-memory registry.
            _fleet_sessions.pop(fleet_session_id, None)
            # Tie the run result back to the project (artifacts + status).
            _finalize_project_run(
                run_id, request.project_id,
                status="failed" if run_failed else ("complete" if collected_results else "failed"),
                results=collected_results,
                synthesis_content=synthesis_content,
                error=run_error,
                usage_summary=run_usage_summary,
            )

    return EventSourceResponse(event_generator())


# ─────────────────────────────────────────────
# Topic Mode — analyse a topic + URL list (+ optional repo)
# ─────────────────────────────────────────────

def _topic_storage_id(topic: str) -> str:
    """
    Build the identifier stored in the reports.github_url column for topic-mode
    runs. Using a `topic://` scheme keeps the existing NOT NULL column valid,
    keeps the history view usable, and lets the frontend detect topic runs.
    """
    snippet = (topic or "").strip().replace("\n", " ")
    if len(snippet) > 120:
        snippet = snippet[:120] + "…"
    return f"topic://{snippet or 'untitled'}"


@app.post("/api/analyze-topic")
async def analyze_topic(request: TopicAnalysisRequest):
    """
    Topic-mode fleet run: ingest a list of URLs (+ optional GitHub repo), frame
    them against the user's topic, and stream the same 18-agent + synthesis
    pipeline as /api/analyze-repo.
    """
    gemini_key = request.gemini_api_key or ENV_GEMINI_KEY
    anthropic_key = request.anthropic_api_key or ENV_ANTHROPIC_KEY

    if not gemini_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is required.")
    if not (request.topic or "").strip():
        raise HTTPException(status_code=400, detail="Topic is required.")
    if not request.urls and not request.github_url:
        raise HTTPException(
            status_code=400,
            detail="At least one URL or a GitHub repository is required for topic analysis."
        )

    storage_id = _topic_storage_id(request.topic)

    run_id = _open_project_run(request.project_id, kind="topic", input_payload={
        "topic": request.topic,
        "urls": request.urls or [],
        "github_url": request.github_url,
        "client_id": request.client_id,
        "additional_context": (request.additional_context or "")[:2000],
    })

    # Phase 6 — fleet session for confidence Q&A
    fleet_session_id = str(uuid4())
    _fleet_sessions[fleet_session_id] = {
        "event": asyncio.Event(),
        "answers": {},
        "session_id": fleet_session_id,
    }

    async def event_generator():
        collected_results = {}
        synthesis_content = ""
        run_failed = False
        run_error = None
        run_usage_summary = None   # Phase 5

        try:
            # ── Phase 1: ingest URL sources ────────────────────────────────
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "ingesting",
                    "message": f"Fetching {len(request.urls)} source URL(s)..."
                })
            }

            url_context, ingest_summary = await agent_engine.ingest_urls(request.urls or [])

            ingest_message = (
                f"Sources ingested: {ingest_summary['successful']} of "
                f"{ingest_summary['total']} URLs "
                f"({ingest_summary.get('total_chars', 0):,} chars)"
            )
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "ingested",
                    "message": ingest_message,
                    "ingest": ingest_summary,
                })
            }

            # ── Phase 2: optional repo ─────────────────────────────────────
            repo_context = ""
            if request.github_url:
                yield {
                    "event": "status",
                    "data": json.dumps({
                        "phase": "cloning",
                        "message": f"Cloning optional reference repo: {request.github_url}"
                    })
                }
                try:
                    repo_context = await agent_engine.clone_github_repo(request.github_url)
                    yield {
                        "event": "status",
                        "data": json.dumps({
                            "phase": "cloned",
                            "message": f"Reference repo loaded ({len(repo_context):,} chars of source)"
                        })
                    }
                except Exception as repo_err:
                    # Repo is optional — log and keep going with URLs only
                    yield {
                        "event": "status",
                        "data": json.dumps({
                            "phase": "cloned",
                            "message": f"Reference repo skipped ({repo_err}); continuing with URL sources only."
                        })
                    }

            # ── Assemble combined context ───────────────────────────────────
            code_context = agent_engine.build_topic_context(
                topic=request.topic,
                url_context=url_context,
                repo_context=repo_context,
                user_notes=request.additional_context or "",
            )

            if not url_context and not repo_context:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "No usable source material could be fetched. "
                        f"Errors: {'; '.join(ingest_summary.get('errors', [])) or 'unknown'}"
                    )
                )

            # ── Persona overrides & client context (mirrors /analyze-repo) ─
            personas = database.get_personas()
            db_persona_prompts = ""
            for p in personas:
                db_persona_prompts += f"- {p['role_name']}: {p['system_prompt']}\n"

            client_context = ""
            if request.client_id:
                client_data = database.get_client(request.client_id)
                if client_data:
                    client_context = f"Client: '{client_data['name']}' ({client_data.get('description', '')})"

            if request.additional_context:
                client_context = (client_context + "\n\n" if client_context else "") + \
                    f"=== BUSINESS CONTEXT PROVIDED BY CLIENT TEAM ===\n{request.additional_context}\n=== END BUSINESS CONTEXT ==="

            # ── Phase 3: launch fleet ───────────────────────────────────────
            persona_count = len(agent_engine.PERSONA_CONFIGS)
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "agents_launched",
                    "message": f"Agent fleet launched — {persona_count} autonomous personas researching the topic...",
                    "mode": "topic",
                    "topic": request.topic,
                    "agents": [
                        {"key": k, "name": v["name"], "emoji": v["emoji"], "status": "thinking"}
                        for k, v in agent_engine.PERSONA_CONFIGS.items()
                    ] + [{"key": "synthesis", "name": agent_engine.SYNTHESIS_CONFIG["name"],
                          "emoji": agent_engine.SYNTHESIS_CONFIG["emoji"], "status": "waiting"}]
                })
            }

            # Pull project materials (with inheritance) for topic-mode runs too.
            project_materials_for_run = []
            try:
                pid_for_materials = _resolve_project_for_run(request.project_id)
                if pid_for_materials:
                    project_materials_for_run = database.collect_materials_for_run(pid_for_materials)
            except Exception as e:
                print(f"materials lookup failed (non-fatal): {e}")

            # Phase 7 — episodic memory for topic-mode
            episodic_memory = {}
            try:
                pid_for_memory = _resolve_project_for_run(request.project_id)
                if pid_for_memory:
                    episodic_memory = database.get_episodic_memory(pid_for_memory)
                    if episodic_memory.get("run_count", 0) > 0:
                        yield {
                            "event": "status",
                            "data": json.dumps({
                                "phase": "memory_loaded",
                                "message": f"Episodic memory loaded — {episodic_memory['run_count']} previous run(s) found"
                            })
                        }
            except Exception as e:
                print(f"episodic memory lookup failed (non-fatal): {e}")

            # Phase 7B — load custom agents for topic-mode
            custom_agents_for_run = []
            try:
                pid_for_agents = _resolve_project_for_run(request.project_id)
                if pid_for_agents:
                    custom_agents_for_run = database.list_custom_agents(pid_for_agents)
                    _fleet_sessions[fleet_session_id]["existing_custom_keys"] = [
                        a.get("persona_key") for a in custom_agents_for_run if a.get("persona_key")
                    ]
                    if custom_agents_for_run:
                        yield {
                            "event": "status",
                            "data": json.dumps({
                                "phase": "custom_agents_loaded",
                                "message": f"{len(custom_agents_for_run)} specialist agent(s) loaded"
                            })
                        }
            except Exception as e:
                print(f"custom agent lookup failed (non-fatal): {e}")

            async for update in agent_engine.run_agent_fleet(
                gemini_api_key=gemini_key,
                anthropic_api_key=anthropic_key,
                code_context=code_context,
                client_context=client_context,
                db_persona_prompts=db_persona_prompts,
                topic=request.topic,
                project_materials=project_materials_for_run,
                skip_personas=request.skip_personas,
                confidence_gate=True,
                answer_provider=_fleet_sessions[fleet_session_id],
                episodic_memory=episodic_memory,
                custom_agents=custom_agents_for_run,
            ):
                if update["event"] == "agent_result":
                    result = update["data"]
                    if result.get("persona") == "synthesis":
                        synthesis_content = result.get("content", "")
                    elif result.get("status") == "success":
                        collected_results[result["persona"]] = result.get("content", "")
                elif update["event"] == "usage_summary":
                    run_usage_summary = update["data"]

                # Inject fleet_session_id into confidence events
                if update["event"] in ("confidence_report", "awaiting_answers"):
                    update["data"]["fleet_session_id"] = fleet_session_id

                yield {
                    "event": update["event"],
                    "data": json.dumps(update["data"])
                }

            # ── Persist ─────────────────────────────────────────────────────
            if collected_results:
                database.save_report(
                    github_url=storage_id,
                    client_id=request.client_id,
                    results=collected_results,
                    synthesis_content=synthesis_content,
                )

            # Phase 7 — post-run documentation for topic mode
            if collected_results and request.project_id:
                yield {
                    "event": "status",
                    "data": json.dumps({
                        "phase": "documenting",
                        "message": "Generating project documentation..."
                    })
                }
                try:
                    doc_results = await agent_engine.generate_post_run_documents(
                        gemini_api_key=gemini_key,
                        agent_results=collected_results,
                        synthesis_content=synthesis_content,
                        episodic_memory=episodic_memory,
                        run_metadata={"run_id": run_id, "topic": request.topic},
                    )
                    pid_for_docs = _resolve_project_for_run(request.project_id)
                    docs_written = 0
                    for doc in doc_results:
                        kind = doc.get("doc_kind", "")
                        content = doc.get("content", "")
                        if kind and content and kind in database.DOC_KINDS:
                            database.upsert_project_document(
                                project_id=pid_for_docs,
                                doc_kind=kind,
                                content=content,
                                structured_data=doc.get("structured_data"),
                                run_id=run_id,
                            )
                            docs_written += 1
                    if docs_written:
                        yield {
                            "event": "status",
                            "data": json.dumps({
                                "phase": "documented",
                                "message": f"Project documentation updated — {docs_written} document(s) written"
                            })
                        }
                except Exception as doc_err:
                    print(f"Post-run doc generation failed (non-fatal): {doc_err}")

            yield {
                "event": "status",
                "data": json.dumps({"phase": "complete", "message": "All agents have reported. Topic discovery complete."})
            }

        except HTTPException:
            raise
        except Exception as e:
            run_failed = True
            run_error = str(e)
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)})
            }
        finally:
            _fleet_sessions.pop(fleet_session_id, None)
            _finalize_project_run(
                run_id, request.project_id,
                status="failed" if run_failed else ("complete" if collected_results else "failed"),
                results=collected_results,
                synthesis_content=synthesis_content,
                error=run_error,
                usage_summary=run_usage_summary,
            )

    return EventSourceResponse(event_generator())


# ─────────────────────────────────────────────
# Q&A Chat with Individual Agent
# ─────────────────────────────────────────────

@app.post("/api/chat")
async def chat_with_agent(request: ChatRequest):
    """Ask a follow-up question to any agent, using its original report as context."""
    persona_key = request.persona_key

    if persona_key == "synthesis":
        config = agent_engine.SYNTHESIS_CONFIG
        model_type = "anthropic"
    else:
        config = agent_engine.PERSONA_CONFIGS.get(persona_key)
        if not config:
            raise HTTPException(status_code=404, detail=f"Persona '{persona_key}' not found")
        model_type = config.get("model", "gemini")

    prompt = f"""You are the **{config['name']}**. You previously analysed a codebase and produced the report below.

--- YOUR PREVIOUS ANALYSIS ---
{request.agent_report[:10000]}
--- END OF YOUR ANALYSIS ---

A user is now asking you a follow-up question. Answer it thoroughly and specifically, drawing on your analysis above and your deep expertise. Be direct and actionable.

User's question: {request.question}"""

    try:
        if model_type == "anthropic":
            if not ENV_ANTHROPIC_KEY:
                raise HTTPException(status_code=400, detail="Anthropic API key not configured (ANTHROPIC_API_KEY in .env)")
            client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
            message = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                temperature=0.4,
                system=f"You are a world-class {config['name']}. Answer follow-up questions about your previous analysis with authority and precision.",
                messages=[{"role": "user", "content": prompt}]
            )
            return {"response": message.content[0].text}
        else:
            if not ENV_GEMINI_KEY and not ENV_ANTHROPIC_KEY:
                raise HTTPException(
                    status_code=400,
                    detail="Neither Gemini nor Anthropic API key is configured."
                )

            # Try Gemini first (has live grounding), fall back to Claude if it fails.
            gemini_err = None
            if ENV_GEMINI_KEY:
                try:
                    gemini_client = genai.Client(api_key=ENV_GEMINI_KEY)
                    grounding_tool = types.Tool(google_search=types.GoogleSearch())
                    resp = await gemini_client.aio.models.generate_content(
                        model="gemini-2.0-flash",
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            tools=[grounding_tool],
                            temperature=0.4
                        )
                    )
                    return {"response": resp.text, "via": "gemini"}
                except Exception as e:
                    gemini_err = e

            # Gemini unavailable or failed — fall back to Claude (no grounding)
            if not ENV_ANTHROPIC_KEY:
                raise HTTPException(
                    status_code=500,
                    detail=f"Gemini failed ({gemini_err}) and no Anthropic key is configured for fallback."
                )
            client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
            message = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                temperature=0.4,
                system=(
                    f"You are a world-class {config['name']}. Answer follow-up questions about your "
                    f"previous analysis with authority and precision. "
                    f"(Note: live web search was unavailable for this answer — rely on your training.)"
                ),
                messages=[{"role": "user", "content": prompt}]
            )
            return {"response": message.content[0].text, "via": "anthropic_fallback"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# GitHub Issues Export
# ─────────────────────────────────────────────

@app.post("/api/create-github-issues")
async def create_github_issues(request: GitHubIssuesRequest):
    """Create GitHub issues from the BA's structured backlog."""
    if not ENV_GITHUB_TOKEN:
        raise HTTPException(
            status_code=400,
            detail="GitHub token not configured. Add GITHUB_TOKEN to your .env file."
        )

    try:
        owner, repo, _ = agent_engine.parse_github_url(request.github_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    created = []
    failed = []

    priority_label_map = {"high": "priority: high", "med": "priority: medium", "low": "priority: low"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        for story in request.stories:
            ac_lines = "\n".join(f"- {ac}" for ac in story.ac) if story.ac else "- (see story)"
            body = f"""**User Story:** {story.story}

**Acceptance Criteria:**
{ac_lines}

---
**Story Points:** `{story.points}`  |  **Priority:** `{story.priority}`

*Generated by the SDLC Discovery Engine — AI Agent Fleet (Business Analyst persona)*"""

            label = priority_label_map.get(story.priority, "priority: medium")

            resp = await client.post(
                f"https://api.github.com/repos/{owner}/{repo}/issues",
                headers={
                    "Authorization": f"token {ENV_GITHUB_TOKEN}",
                    "Accept": "application/vnd.github.v3+json",
                },
                json={"title": story.title, "body": body, "labels": [label]},
            )

            if resp.status_code == 201:
                created.append({"title": story.title, "url": resp.json()["html_url"]})
            else:
                failed.append({"title": story.title, "error": resp.json().get("message", resp.text)})

    return {"created": created, "failed": failed, "total": len(request.stories)}


# ─────────────────────────────────────────────
# Team Kickoff Pack Generator (multi-doc, SSE-streamed)
# ─────────────────────────────────────────────

class KickoffPackRequest(BaseModel):
    synthesis_content: str
    agent_summaries: Optional[dict] = None  # persona_key -> excerpt
    github_url: Optional[str] = None
    business_context: Optional[str] = None
    topic: Optional[str] = None
    project_id: Optional[int] = None        # Phase 1 — pull project materials
    anthropic_api_key: Optional[str] = None  # rare override; .env preferred


@app.post("/api/generate-kickoff-pack")
async def generate_kickoff_pack(request: KickoffPackRequest):
    """
    Compile the discovery synthesis into an 8-document team kickoff pack and
    stream SSE progress while doing so. Solves the previous 105s perceived
    hang and produces a proper deliverable folder, not a single markdown blob.

    Streams:
      status (analyzing) -> status (compiling_spec) ->
      file_ready (one per generated doc) -> kickoff_pack_ready (zip + listing) ->
      status (complete)
    """
    anthropic_key = request.anthropic_api_key or ENV_ANTHROPIC_KEY
    if not anthropic_key:
        raise HTTPException(
            status_code=400,
            detail="Anthropic API key required (ANTHROPIC_API_KEY in .env)"
        )

    if not request.synthesis_content and not request.agent_summaries:
        raise HTTPException(
            status_code=400,
            detail="No discovery content supplied — run an analysis first."
        )

    # If a project is attached, pull its materials so the kickoff pack can
    # reference uploaded context (e.g. CMF specs, prior contracts).
    project_materials = None
    if request.project_id:
        try:
            project_materials = database.collect_materials_for_run(request.project_id)
        except Exception as e:
            print(f"[kickoff] could not collect materials for project "
                  f"{request.project_id}: {e}")

    async def event_generator():
        pack_id = kickoff_pack.new_pack_id()
        out_dir = kickoff_pack.pack_dir(pack_id)

        try:
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "analyzing",
                    "message": "Reviewing synthesis verdict and agent summaries...",
                    "pack_id": pack_id,
                })
            }

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "compiling_spec",
                    "message": "Compiling kickoff specification with Claude (extended thinking)...",
                    "pack_id": pack_id,
                })
            }

            spec = await kickoff_pack.compile_kickoff_pack_spec(
                topic=request.topic or "",
                synthesis_content=request.synthesis_content or "",
                agent_summaries=request.agent_summaries,
                anthropic_api_key=anthropic_key,
                github_url=request.github_url,
                business_context=request.business_context,
                project_materials=project_materials,
            )

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "generating_files",
                    "message": "Writing eight focused mobilisation documents...",
                    "pack_id": pack_id,
                })
            }

            # Generate files in a thread + emit one file_ready event per doc.
            written = await asyncio.to_thread(
                kickoff_pack.generate_kickoff_pack_files, spec, out_dir
            )

            for path in written:
                if path.name.startswith("_"):
                    continue
                yield {
                    "event": "file_ready",
                    "data": json.dumps({
                        "pack_id": pack_id,
                        "filename": path.name,
                        "size": path.stat().st_size if path.exists() else 0,
                        "preview_url": f"/api/kickoff-pack/{pack_id}/file/{path.name}",
                    })
                }

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "zipping",
                    "message": f"Bundling {len(written)} files...",
                    "pack_id": pack_id,
                })
            }

            zip_path = await asyncio.to_thread(kickoff_pack.zip_kickoff_pack, out_dir)
            total_size = zip_path.stat().st_size if zip_path.exists() else 0

            yield {
                "event": "kickoff_pack_ready",
                "data": json.dumps({
                    "pack_id": pack_id,
                    "file_count": len(written),
                    "total_size": total_size,
                    "download_url": f"/api/kickoff-pack/{pack_id}/download",
                    "files": kickoff_pack.list_pack_files(pack_id),
                    "topic": (spec.get("meta") or {}).get("topic", ""),
                })
            }

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "complete",
                    "message": "Kickoff pack ready for download.",
                    "pack_id": pack_id,
                })
            }

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"message": f"Kickoff pack generation failed: {e}"})
            }

    return EventSourceResponse(event_generator())


@app.get("/api/kickoff-pack/{pack_id}/download")
def download_kickoff_pack(pack_id: str):
    """Serve a previously compiled kickoff pack zip as a download."""
    safe_id = "".join(ch for ch in pack_id if ch.isalnum() or ch in ("-", "_"))
    if safe_id != pack_id or not safe_id:
        raise HTTPException(status_code=400, detail="Invalid pack id")

    zip_path = kickoff_pack.pack_zip(safe_id)
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Kickoff pack not found or expired")

    return FileResponse(
        str(zip_path),
        media_type="application/zip",
        filename=f"kickoff-pack-{safe_id}.zip",
        headers={"Content-Disposition": f'attachment; filename="kickoff-pack-{safe_id}.zip"'}
    )


@app.get("/api/kickoff-pack/{pack_id}/file/{filename}")
def preview_kickoff_pack_file(pack_id: str, filename: str):
    """Return a single file from a kickoff pack for in-browser preview."""
    safe_id = "".join(ch for ch in pack_id if ch.isalnum() or ch in ("-", "_"))
    if safe_id != pack_id or not safe_id:
        raise HTTPException(status_code=400, detail="Invalid pack id")

    safe_name = os.path.basename(filename)  # strip path traversal
    if safe_name != filename or not safe_name:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = kickoff_pack.pack_dir(safe_id) / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = "text/markdown" if safe_name.endswith(".md") else "application/octet-stream"
    return FileResponse(str(file_path), media_type=media_type, filename=safe_name)


# ─────────────────────────────────────────────
# Build Pack — compile discovery into an implementation-ready folder
# ─────────────────────────────────────────────

class BuildPackRequest(BaseModel):
    topic: str = ""
    results: dict  # persona_key -> content (raw agent markdown)
    synthesis_content: str = ""
    recon_data: Optional[dict] = None
    client_context: Optional[str] = None
    anthropic_api_key: Optional[str] = None


@app.post("/api/generate-build-pack")
async def generate_build_pack(request: BuildPackRequest):
    """
    Take a completed discovery (persona reports + synthesis) and compile it into
    a downloadable implementation pack (entities, OpenAPI, user stories, sprint
    plan, ODC import guide, migration strategy, etc.).

    Streams SSE progress:
      - analyzing_reports -> compiling_spec -> generating_files -> zipping -> complete
    Emits a final `build_pack_ready` event with:
      {pack_id, file_count, total_size, download_url}
    """
    anthropic_key = request.anthropic_api_key or ENV_ANTHROPIC_KEY
    if not anthropic_key:
        raise HTTPException(
            status_code=400,
            detail="Anthropic API key required (ANTHROPIC_API_KEY in .env) to compile a build pack."
        )

    if not request.results and not request.synthesis_content:
        raise HTTPException(
            status_code=400,
            detail="No discovery content supplied — run an analysis first."
        )

    async def event_generator():
        pack_id = build_pack.new_pack_id()
        out_dir = build_pack.pack_dir(pack_id)

        try:
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "analyzing_reports",
                    "message": f"Reviewing {len(request.results)} persona report(s) and synthesis verdict...",
                    "pack_id": pack_id,
                })
            }

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "compiling_spec",
                    "message": "Compiling structured build specification with Claude (extended thinking)...",
                    "pack_id": pack_id,
                })
            }

            spec = await build_pack.compile_build_pack_spec(
                topic=request.topic or "",
                persona_reports=request.results or {},
                synthesis_content=request.synthesis_content or "",
                recon_data=request.recon_data,
                anthropic_api_key=anthropic_key,
                client_context=request.client_context or "",
            )

            meta = spec.get("meta", {}) if isinstance(spec, dict) else {}
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "generating_files",
                    "message": f"Generating implementation artefacts for '{meta.get('project_name', 'project')}'...",
                    "pack_id": pack_id,
                })
            }

            # Blocking file generation — run in a thread so we don't block the event loop
            written = await asyncio.to_thread(
                build_pack.generate_build_pack_files, spec, out_dir
            )

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "zipping",
                    "message": f"Packaging {len(written)} files into a zip...",
                    "pack_id": pack_id,
                })
            }

            zip_path = await asyncio.to_thread(build_pack.zip_build_pack, out_dir)
            total_size = zip_path.stat().st_size if zip_path.exists() else 0

            yield {
                "event": "build_pack_ready",
                "data": json.dumps({
                    "pack_id": pack_id,
                    "file_count": len(written),
                    "total_size": total_size,
                    "download_url": f"/api/build-pack/{pack_id}/download",
                    "project_name": meta.get("project_name", ""),
                })
            }

            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "complete",
                    "message": "Build pack ready for download.",
                    "pack_id": pack_id,
                })
            }

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"message": f"Build pack generation failed: {e}"})
            }

    return EventSourceResponse(event_generator())


@app.get("/api/build-pack/{pack_id}/download")
def download_build_pack(pack_id: str):
    """Serve a previously compiled build pack zip as a download."""
    # Guard against path traversal
    safe_id = "".join(ch for ch in pack_id if ch.isalnum() or ch in ("-", "_"))
    if safe_id != pack_id or not safe_id:
        raise HTTPException(status_code=400, detail="Invalid pack id")

    zip_path = build_pack.pack_zip(safe_id)
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Build pack not found or expired")

    return FileResponse(
        str(zip_path),
        media_type="application/zip",
        filename=f"build-pack-{safe_id}.zip",
        headers={"Content-Disposition": f'attachment; filename="build-pack-{safe_id}.zip"'}
    )


# ─────────────────────────────────────────────
# Meeting Room API
# ─────────────────────────────────────────────

class MeetingOpeningsRequest(BaseModel):
    agent_reports: dict  # {persona_key: content_str}

class MeetingDebateRequest(BaseModel):
    agent_reports: dict  # {persona_key: {name, emoji, content}}

class MeetingAskRequest(BaseModel):
    question: str
    agent_reports: dict  # {persona_key: {name, emoji, content}}


@app.post("/api/meeting/openings")
async def meeting_openings(request: MeetingOpeningsRequest):
    """Generate a short spoken opening statement for each agent."""
    if not ENV_ANTHROPIC_KEY:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    summaries = {}
    for key, content in request.agent_reports.items():
        if content and len(content) > 50:
            summaries[key] = content[:1200]

    condensed = "\n\n".join(
        f'[{k}]:\n{v}' for k, v in summaries.items()
    )

    prompt = f"""You are a meeting facilitator. Each expert agent has completed a codebase analysis.
Generate a 2-3 sentence spoken opening statement for each agent — the statement they will read aloud at the start of the board meeting.

Rules:
- Each statement must start with the agent identifying themselves by role
- State the single most critical finding from their analysis
- End with the business impact in plain language
- Plain speech ONLY — no markdown, no bullet points, no headers — this will be read aloud via text-to-speech
- Each statement should sound natural when spoken

Return ONLY valid JSON: {{"architect": "I am the Solutions Architect. My analysis reveals...", "ba": "..."}}

Agent reports (truncated):
{condensed[:8000]}"""

    try:
        client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3000,
            temperature=0.7,
            system="You are a corporate communications specialist. Generate natural, spoken-word opening statements. Return valid JSON only — no markdown wrapping.",
            messages=[{"role": "user", "content": prompt}]
        )
        text = message.content[0].text.strip()
        # Strip markdown code fences if present
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0]
        openings = json.loads(text.strip())
    except Exception as e:
        # Graceful fallback: extract first sentence from each report
        openings = {}
        for key, content in summaries.items():
            cfg = agent_engine.PERSONA_CONFIGS.get(key, {})
            name = cfg.get("name", key)
            first_line = content.split('\n')[0].replace('#', '').strip()[:200]
            openings[key] = f"I am the {name}. {first_line}"

    return {"openings": openings}


@app.post("/api/meeting/debate")
async def meeting_debate(request: MeetingDebateRequest):
    """Generate an unscripted debate transcript driven by actual agent findings."""
    if not ENV_ANTHROPIC_KEY:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    # Build richer summaries so agents can make specific references, not generic platitudes
    agent_summaries = []
    for key, data in request.agent_reports.items():
        cfg = agent_engine.PERSONA_CONFIGS.get(key) or (agent_engine.SYNTHESIS_CONFIG if key == "synthesis" else {})
        name = cfg.get("name", key)
        content = data.get("content", "") if isinstance(data, dict) else str(data)
        # Give each agent 1200 chars so they have real specifics to cite
        agent_summaries.append(f"[{key}] {name}:\n{content[:1200]}")

    # Build dynamic tension points by extracting what agents actually found
    has_innovation_scout = "ai_innovation_scout" in request.agent_reports
    has_outsystems = "outsystems_architect" in request.agent_reports or "outsystems_migration" in request.agent_reports

    prompt = f"""You are the moderator of a CTO-level discovery board meeting. These {len(agent_summaries)} expert agents have each independently analysed the same codebase and now sit around the same table. They have real findings, real professional opinions, and — critically — genuine disagreements.

Your job is to generate a realistic, unscripted debate transcript (12-15 turns) where these experts challenge each other based on what they ACTUALLY found. This is not a polished keynote — it's a heated boardroom where every expert has staked their professional credibility on their analysis.

GROUND RULES FOR EVERY TURN:
1. Each speaker MUST reference a specific, concrete finding from their own report — a file name, a metric, a vulnerability, a cost figure, a user flow. No generic platitudes.
2. Agents must DIRECTLY respond to the previous speaker — not pivot to their own agenda. Real debates are reactive.
3. Disagreement must be substantive: "I disagree because [specific evidence]" not just "I see it differently."
4. Concessions are allowed and realistic: "That's a fair point about X, but what you're not accounting for is..."
5. Emotions exist but are professional: frustration at being dismissed, satisfaction when making a point land.
6. The AI Innovation Scout (if present) must challenge at least two traditional recommendations — asking "but does this need to be built at all, or does an AI tool already solve this?"
7. The OutSystems specialists (if present) must present the platform case — including its real limitations — and be challenged on build complexity, vendor lock-in, and developer experience.

TENSION ARCS TO WEAVE THROUGH (use the actual findings below to make these specific):
- ARC 1 — Speed vs Safety: Someone pushing for velocity clashes with someone demanding quality/security gates. Both have evidence.
- ARC 2 — Build vs Buy vs AI vs Low-Code: The traditionalists, the AI Innovation Scout, and the OutSystems specialists all have different answers to the same question. This is the central unresolved tension — don't let synthesis hand-wave it away.
- ARC 3 — Investment levels: One agent argues for conservative incremental improvements; another argues the codebase needs a more transformative investment. Different risk appetites, both defensible.
- ARC 4 — One genuine surprise: An unexpected alliance — two agents who seem opposed actually agree on something, or an agent concedes a point they initially dismissed.

DEBATE FORMAT:
- 2-4 sentences per turn, plain conversational speech (this is spoken aloud via TTS — no markdown, no bullet points, no headers)
- Start responses with direct address: "I hear what [name] is saying, but..." or "I have to push back on that..."
- Synthesis speaks LAST and makes binding decisions — it resolves the Build vs Buy vs Low-Code arc definitively, names the three things that must happen first, and is direct about what was NOT resolved and why.

Return ONLY a valid JSON array (no markdown wrapping, no explanation):
[{{"speaker": "security", "text": "I need to address something the performance engineer said..."}}, ...]

Available speaker keys: architect, ba, qa, security, tech_docs, data_engineering, devops, product_management, ui_ux, compliance, secops, performance_engineer, cost_analyst, api_designer, tech_lead{", ai_innovation_scout" if has_innovation_scout else ""}{", outsystems_architect, outsystems_migration" if has_outsystems else ""}, synthesis

AGENT REPORTS (use these specifics in the debate — agents must cite their own findings):
{chr(10).join(agent_summaries)}"""

    try:
        client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=5000,
            temperature=0.9,
            system="You are generating a realistic expert debate. The agents are opinionated professionals who genuinely disagree. Return a valid JSON array only — no markdown wrapping, no preamble, no trailing text.",
            messages=[{"role": "user", "content": prompt}]
        )
        text = message.content[0].text.strip()
        # Strip markdown fences if model added them
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0]
        turns = json.loads(text.strip())
    except Exception:
        turns = [
            {"speaker": "architect", "text": "I have to be direct: the architectural debt I found is not something we can patch around. This system has grown organically and the coupling between components means every change risks cascading failures. We need a clear modernisation path."},
            {"speaker": "ai_innovation_scout" if has_innovation_scout else "tech_lead", "text": "I hear the architect, but before we commit to months of refactoring, I want to challenge the assumption that we build everything ourselves. At least three of the components I identified have direct low-code or AI-native alternatives that would take weeks, not quarters."},
            {"speaker": "outsystems_architect" if has_outsystems else "tech_lead", "text": "And I'd go further — I've done the domain mapping for this application, and a significant portion of it would be a clean fit for OutSystems ODC. The entity model translates well, there are Forge components for two of the integrations, and the team could be building production features in OutSystems within four weeks of starting. That's not a sales pitch, that's a feasibility assessment based on what I actually found."},
            {"speaker": "tech_lead", "text": "I have to push back on that. OutSystems is a real option for parts of this, but the core differentiating logic here is exactly the kind of thing that hits the platform's ceiling. I've seen teams migrate to OutSystems and then spend six months building Extensions just to get back to parity. The question is which parts."},
            {"speaker": "security", "text": "I want to make sure we don't lose sight of the immediate risk. Regardless of which path we choose, the authentication gaps I found represent legal exposure today. That's not a path discussion — that's a this-sprint fix."},
            {"speaker": "outsystems_migration" if has_outsystems else "cost_analyst", "text": "I agree with security, and I'll add this: if we're seriously considering OutSystems, the migration complexity scoring I ran shows a 12-sprint programme for a full migration. That's not a quick win. The smarter approach is a selective migration — move new features to OutSystems while we stabilise the existing core."},
            {"speaker": "synthesis", "text": "Here is my binding read: security remediation is non-negotiable and starts this sprint. On the platform question — a full rewrite in any direction is off the table in the short term. The right answer is a selective strategy: AI tooling improves the existing team's velocity immediately, OutSystems gets a focused pilot on one non-core domain in the next quarter, and we reassess full migration at the six-month mark with real data. The architect's modernisation roadmap proceeds in parallel. No single platform wins today — we run the experiment."}
        ]

    enriched = []
    for t in turns:
        key = t.get("speaker", "synthesis")
        cfg = agent_engine.PERSONA_CONFIGS.get(key) or (agent_engine.SYNTHESIS_CONFIG if key == "synthesis" else {"name": key, "emoji": "🤖"})
        enriched.append({
            "speaker": key,
            "name": cfg.get("name", key),
            "emoji": cfg.get("emoji", "🤖"),
            "text": t.get("text", "")
        })

    return {"turns": enriched}


@app.post("/api/meeting/ask")
async def meeting_ask(request: MeetingAskRequest):
    """Route a question to the most relevant agent and return their spoken answer."""
    if not ENV_ANTHROPIC_KEY:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    available = {k: v.get("name", k) for k, v in request.agent_reports.items()}
    agent_list = "\n".join(f"- {k}: {name}" for k, name in available.items())

    routing_prompt = f"""Question: "{request.question}"

Available experts:
{agent_list}

Which expert is MOST relevant to answer this question? Reply with ONLY the exact agent key (e.g. "security" or "architect"). No explanation, no punctuation."""

    try:
        client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
        routing_msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20,
            temperature=0,
            messages=[{"role": "user", "content": routing_prompt}]
        )
        best_key = routing_msg.content[0].text.strip().lower().strip('"\'').strip()
        if best_key not in request.agent_reports:
            best_key = "synthesis" if "synthesis" in request.agent_reports else list(request.agent_reports.keys())[0]
    except Exception:
        best_key = "synthesis" if "synthesis" in request.agent_reports else list(request.agent_reports.keys())[0]

    agent_data = request.agent_reports.get(best_key, {})
    content = agent_data.get("content", "") if isinstance(agent_data, dict) else str(agent_data)
    cfg = agent_engine.PERSONA_CONFIGS.get(best_key) or (agent_engine.SYNTHESIS_CONFIG if best_key == "synthesis" else {"name": best_key, "emoji": "🤖", "model": "anthropic"})

    answer_prompt = f"""You are the {cfg.get('name', best_key)}. A stakeholder just asked this question during a board meeting:

"{request.question}"

Your previous analysis (context):
{content[:4000]}

Give a direct, authoritative spoken answer (3-5 sentences). Plain speech ONLY — this will be read aloud via text-to-speech. No markdown, no bullet points, no headers. Be specific and reference concrete findings from your analysis."""

    model_type = cfg.get("model", "anthropic") if best_key != "synthesis" else "anthropic"

    try:
        if model_type == "anthropic" or not ENV_GEMINI_KEY:
            client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
            msg = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=500,
                temperature=0.5,
                messages=[{"role": "user", "content": answer_prompt}]
            )
            answer = msg.content[0].text
        else:
            gemini_client = genai.Client(api_key=ENV_GEMINI_KEY)
            resp = await gemini_client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=answer_prompt,
                config=types.GenerateContentConfig(temperature=0.5)
            )
            answer = resp.text
    except Exception as e:
        answer = f"I apologise, I'm unable to answer at this time. Please check the API configuration. Error: {str(e)}"

    return {
        "agent_key": best_key,
        "name": cfg.get("name", best_key),
        "emoji": cfg.get("emoji", "🤖"),
        "answer": answer
    }


# ─────────────────────────────────────────────
# Report History
# ─────────────────────────────────────────────

@app.get("/api/reports")
def get_reports():
    """Return list of past analysis runs (metadata only, no full content)."""
    return database.get_reports()

@app.get("/api/reports/{report_id}")
def get_report(report_id: int):
    """Return a specific saved report including full agent results."""
    report = database.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


# ─────────────────────────────────────────────
# Legacy Analysis Route (kept for backward compat)
# ─────────────────────────────────────────────

@app.post("/api/analyze-files")
async def analyze_files(
    gemini_api_key: Optional[str] = Form(None),
    client_id: Optional[int] = Form(None),
    text_context: Optional[str] = Form(None),
    additional_context: Optional[str] = Form(None),
    files: List[UploadFile] = File([])
):
    """
    Upload local files/folder and run the full SSE agent fleet on them.
    Mirrors /api/analyze-repo but accepts file uploads instead of a GitHub URL.
    """
    gemini_key = gemini_api_key or ENV_GEMINI_KEY
    if not gemini_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is required.")

    file_contents = []
    if files:
        for file in files:
            if file.filename:
                try:
                    content = await file.read()
                    filename_lower = file.filename.lower()
                    ext = '.' + filename_lower.rsplit('.', 1)[-1] if '.' in filename_lower else ''
                    if ext in agent_engine.SKIP_EXTENSIONS:
                        continue
                    try:
                        decoded = content.decode('utf-8', errors='replace')
                        if '\x00' in decoded[:500]:
                            continue
                        file_contents.append(f"\n{'='*60}\nFILE: {file.filename}\n{'='*60}\n{decoded}\n")
                    except Exception:
                        continue
                except Exception:
                    continue

    code_context = ""
    if text_context:
        code_context += text_context + "\n\n"
    code_context += "".join(file_contents)

    if not code_context.strip():
        raise HTTPException(status_code=400, detail="No readable files or text provided.")

    # Truncate to same limit as GitHub ingestion
    if len(code_context) > agent_engine.MAX_TOTAL_CHARS:
        code_context = code_context[:agent_engine.MAX_TOTAL_CHARS] + f"\n\n--- TRUNCATED at {agent_engine.MAX_TOTAL_CHARS} chars ---"

    async def event_generator():
        collected_results = {}
        synthesis_content = ""
        try:
            yield {"event": "status", "data": json.dumps({"phase": "cloned", "message": f"Files loaded ({len(code_context):,} characters of source code)"})}

            personas_db = database.get_personas()
            db_persona_prompts = "".join(f"- {p['role_name']}: {p['system_prompt']}\n" for p in personas_db)

            client_context = ""
            if client_id:
                client_data = database.get_client(client_id)
                if client_data:
                    client_context = f"Client: '{client_data['name']}' ({client_data.get('description', '')})"
            if additional_context:
                client_context = (client_context + "\n\n" if client_context else "") + \
                    f"=== BUSINESS CONTEXT PROVIDED BY CLIENT TEAM ===\n{additional_context}\n=== END BUSINESS CONTEXT ==="

            persona_count = len(agent_engine.PERSONA_CONFIGS)
            yield {"event": "status", "data": json.dumps({
                "phase": "agents_launched",
                "message": f"Agent fleet launched — {persona_count} autonomous personas researching...",
                "agents": [{"key": k, "name": v["name"], "emoji": v["emoji"], "status": "thinking"} for k, v in agent_engine.PERSONA_CONFIGS.items()]
                         + [{"key": "synthesis", "name": agent_engine.SYNTHESIS_CONFIG["name"], "emoji": agent_engine.SYNTHESIS_CONFIG["emoji"], "status": "waiting"}]
            })}

            async for update in agent_engine.run_agent_fleet(
                gemini_api_key=gemini_key,
                anthropic_api_key=ENV_ANTHROPIC_KEY,
                code_context=code_context,
                client_context=client_context,
                db_persona_prompts=db_persona_prompts
            ):
                if update["event"] == "agent_result":
                    result = update["data"]
                    if result.get("persona") == "synthesis":
                        synthesis_content = result.get("content", "")
                    elif result.get("status") == "success":
                        collected_results[result["persona"]] = result.get("content", "")
                yield {"event": update["event"], "data": json.dumps(update["data"])}

            if collected_results:
                database.save_report(
                    github_url="[local upload]",
                    client_id=client_id,
                    results=collected_results,
                    synthesis_content=synthesis_content
                )

            yield {"event": "status", "data": json.dumps({"phase": "complete", "message": "All agents have reported. Discovery complete."})}

        except Exception as e:
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())


@app.post("/api/analyze")
async def analyze_data(
    apiKey: str = Form(...),
    client_id: Optional[int] = Form(None),
    text_context: Optional[str] = Form(None),
    files: List[UploadFile] = File([])
):
    apiKey = apiKey or ENV_GEMINI_KEY
    if not apiKey:
        raise HTTPException(status_code=400, detail="Gemini API Key is required.")

    file_contents = []
    multimodal_parts = []
    if files:
        for file in files:
            if file.filename:
                try:
                    content = await file.read()
                    filename_lower = file.filename.lower()
                    if filename_lower.endswith('.pdf'):
                        multimodal_parts.append(types.Part.from_bytes(data=content, mime_type='application/pdf'))
                        multimodal_parts.append(f"\n--- PDF: {file.filename} ---\n")
                    elif filename_lower.endswith(('.png', '.jpg', '.jpeg')):
                        mime = 'image/png' if filename_lower.endswith('.png') else 'image/jpeg'
                        multimodal_parts.append(types.Part.from_bytes(data=content, mime_type=mime))
                        multimodal_parts.append(f"\n--- Image: {file.filename} ---\n")
                    else:
                        file_contents.append(f"--- FILE: {file.filename} ---\n{content.decode('utf-8', errors='replace')}\n")
                except Exception as e:
                    file_contents.append(f"--- FILE: {file.filename} (Unreadable: {str(e)}) ---\n")

    if not text_context and not file_contents and not multimodal_parts:
        raise HTTPException(status_code=400, detail="No files or text provided.")

    code_context = ""
    if text_context:
        code_context += text_context + "\n\n"
    if file_contents:
        code_context += "".join(file_contents)

    personas = database.get_personas()
    db_persona_prompts = ""
    for p in personas:
        db_persona_prompts += f"- {p['role_name']}: {p['system_prompt']}\n"

    client_context = ""
    if client_id:
        client_data = database.get_client(client_id)
        if client_data:
            client_context = f"Client: '{client_data['name']}' ({client_data.get('description', '')})"

    try:
        results = await agent_engine.run_agent_fleet_all(
            gemini_api_key=apiKey,
            anthropic_api_key=ENV_ANTHROPIC_KEY,
            code_context=code_context,
            client_context=client_context,
            db_persona_prompts=db_persona_prompts
        )
        result_map = {r["persona"]: r["content"] for r in results}
        return {"status": "success", "results": result_map}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
