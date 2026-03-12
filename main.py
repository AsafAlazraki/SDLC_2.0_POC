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
from database import ClientModel, PersonaModel
from google import genai
from google.genai import types
from sse_starlette.sse import EventSourceResponse
import anthropic as anthropic_sdk

import agent_engine

# ─────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────

class RepoAnalysisRequest(BaseModel):
    github_url: str
    gemini_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    client_id: Optional[int] = None
    additional_context: Optional[str] = None

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

    async def event_generator():
        collected_results = {}
        synthesis_content = ""

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

            # Stream all 15 agent results (+ synthesis)
            async for update in agent_engine.run_agent_fleet(
                gemini_api_key=gemini_key,
                anthropic_api_key=anthropic_key,
                code_context=code_context,
                client_context=client_context,
                db_persona_prompts=db_persona_prompts
            ):
                # Collect results for persistence
                if update["event"] == "agent_result":
                    result = update["data"]
                    if result.get("persona") == "synthesis":
                        synthesis_content = result.get("content", "")
                    elif result.get("status") == "success":
                        collected_results[result["persona"]] = result.get("content", "")

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

            yield {
                "event": "status",
                "data": json.dumps({"phase": "complete", "message": "All agents have reported. Discovery complete."})
            }

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)})
            }

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
            if not ENV_GEMINI_KEY:
                raise HTTPException(status_code=400, detail="Gemini API key not configured")
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
            return {"response": resp.text}
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
# Team Kickoff Pack Generator
# ─────────────────────────────────────────────

class KickoffPackRequest(BaseModel):
    synthesis_content: str
    agent_summaries: Optional[dict] = None  # key -> first 500 chars of each agent
    github_url: Optional[str] = None
    business_context: Optional[str] = None

KICKOFF_PACK_PROMPT = """You are a Senior Programme Manager and Transformation Lead with 20+ years experience standing up modernisation teams. You have just received a comprehensive AI-generated discovery report for a legacy system modernisation programme.

Your task is to produce a **Team Kickoff Pack** — a concise, actionable mobilisation brief that gets a new team productive from Day 1.

{context_section}

---
## SYNTHESIS / VERDICT FROM DISCOVERY ENGINE
{synthesis_content}

---
{agent_summaries_section}

Produce the kickoff pack with EXACTLY the following sections:

## 🎯 Executive One-Pager
3–4 sentences the CTO/sponsor can use in a steering committee. What is being modernised, why now, what is the expected outcome, and what is at stake if we don't act.

## 👥 Recommended Team Composition
Based on the technical findings, specify the exact roles needed (job titles, seniority levels, FTE vs contractor), their primary responsibilities in this programme, and any specialist skills that are non-negotiable. Format as a table: | Role | Seniority | FTE/Contract | Primary Responsibility |

## 📅 Sprint 0 Checklist
The exact tasks for the first 2 weeks before development starts. Group them by owner (Tech Lead, Architect, BA, DevOps, etc.). Be specific — e.g. "Set up GitHub repo with branch protection rules" not "set up source control".

## 🗺️ RACI Matrix (Top 10 Decisions)
Identify the 10 most important decisions this programme will face. For each: | Decision | Responsible | Accountable | Consulted | Informed |

## ⚡ Day 1 Decisions Required
The 5 decisions that MUST be made in the first week or the programme will stall. For each: state the decision, the options, the recommended path, and who must sign off.

## ⚠️ Risk Briefing for New Team Members
The top 7 risks a new joiner must understand on Day 1. For each: the risk, why it exists (based on the codebase analysis), the mitigation strategy, and the owner.

## 📊 Success Metrics & Reporting Cadence
How will this programme measure success? Define 5–8 KPIs with baseline (current state), target, and how to measure. Include recommended reporting cadence (daily standups, weekly steering, monthly executive review).

## 🔑 The 3 Things That Will Make or Break This Programme
Based on the synthesis findings, what are the 3 critical success factors? Be direct and specific."""

@app.post("/api/generate-kickoff-pack")
async def generate_kickoff_pack(request: KickoffPackRequest):
    """Use Claude to generate a team mobilisation brief from the discovery report."""
    if not ENV_ANTHROPIC_KEY:
        raise HTTPException(status_code=400, detail="Anthropic API key required (ANTHROPIC_API_KEY in .env)")

    context_section = ""
    if request.github_url:
        context_section = f"**Repository Under Analysis:** {request.github_url}\n"
    if request.business_context:
        context_section += f"\n**Business Context Provided:**\n{request.business_context}\n"

    agent_summaries_section = ""
    if request.agent_summaries:
        summaries = []
        for persona, content in request.agent_summaries.items():
            if content:
                summaries.append(f"### {persona.upper()} (excerpt)\n{content[:600]}...\n")
        if summaries:
            agent_summaries_section = "## KEY FINDINGS FROM SPECIALIST AGENTS\n" + "\n".join(summaries[:8])

    prompt = KICKOFF_PACK_PROMPT.format(
        context_section=context_section,
        synthesis_content=request.synthesis_content[:6000],
        agent_summaries_section=agent_summaries_section
    )

    try:
        client = anthropic_sdk.AsyncAnthropic(api_key=ENV_ANTHROPIC_KEY)
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            temperature=0.3,
            system="You are an expert Programme Manager producing a team mobilisation brief. Be concrete, specific, and immediately actionable. Avoid generalities. Reference the specific technical findings from the discovery report.",
            messages=[{"role": "user", "content": prompt}]
        )
        return {"content": message.content[0].text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
