import os
import json
import asyncio
from dotenv import load_dotenv

# Load environment variables from .env file
print(f"DEBUG: Loading .env from {os.getcwd()}")
load_dotenv(override=True)

# Read API keys from environment
ENV_GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
ENV_ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
print(f"DEBUG: ENV_GEMINI_KEY exists: {bool(ENV_GEMINI_KEY)}")
print(f"DEBUG: ENV_ANTHROPIC_KEY exists: {bool(ENV_ANTHROPIC_KEY)}")
if ENV_GEMINI_KEY:
    print(f"DEBUG: ENV_GEMINI_KEY start: {ENV_GEMINI_KEY[:5]}...")
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import uvicorn
import database
from database import ClientModel, PersonaModel
from google import genai
from google.genai import types
from sse_starlette.sse import EventSourceResponse

import agent_engine

# Define Output Schemas for the AI Engine (kept for legacy /api/analyze)
class BAStory(BaseModel):
    title: str = Field(description="Title of the user story")
    points: str = Field(description="Complexity estimate in story points")
    description: str = Field(description="User story format: As a [User], I want to [Action], so that [Value]")
    ac: List[str] = Field(description="Acceptance criteria")
    notes: str = Field(description="Technical notes and references to legacy code")

class ArchitectDesign(BaseModel):
    diagram: str = Field(description="Mermaid.js graph TD diagram string mapping To-Be architecture. Only the graph code, no markdown block wrappers.")
    description: str = Field(description="Description of the 'As-Is' vs 'To-Be' architecture")

class QARisk(BaseModel):
    risk: str = Field(description="Potential regression risk")
    mitigation: str = Field(description="Mitigation step")

class SecurityFinding(BaseModel):
    finding: str = Field(description="Security or compliance issue")
    severity: str = Field(description="High, Medium, or Low")

class DiscoveryResponse(BaseModel):
    ba: List[BAStory]
    architect: ArchitectDesign
    qa: List[QARisk]
    security: List[SecurityFinding]
    tech_docs: str = Field(description="Comprehensive technical documentation covering system architecture, APIs, data models, and any other relevant legacy system details.")
    data_engineering: str = Field(description="Insights from the Data Engineer persona focusing on data models, data quality, and migration strategies.")
    devops: str = Field(description="Insights from the DevOps Engineer persona focusing on CI/CD pipelines, deployment, and infrastructure.")
    product_management: str = Field(description="Insights from the Product Manager persona focusing on business value, KPIs, and roadmap.")
    ui_ux: str = Field(description="Insights from the UI/UX Designer persona focusing on user journey and accessibility.")
    compliance: str = Field(description="Insights from the Compliance Officer persona focusing on data privacy, PII, and regulatory risks.")

app = FastAPI(title="SDLC Discovery Engine")

# Ensure static directory exists
os.makedirs("static", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def index():
    return FileResponse("static/index.html")

# --- API Routes for Database ---

@app.get("/api/personas/config")
async def get_persona_configs():
    """Return the detailed persona metadata for the UI viewer."""
    from agent_engine import PERSONA_CONFIGS
    # We strip some sensitive fields if needed, but for internal use it's fine
    return PERSONA_CONFIGS

@app.get("/api/clients")
def get_clients():
    return database.get_clients()

@app.post("/api/clients")
def create_client(client: ClientModel):
    return database.create_client_db(client)

@app.get("/api/config")
def get_config():
    """Let the frontend know if keys are pre-configured via env var."""
    return {
        "has_env_key": bool(ENV_GEMINI_KEY),
        "has_anthropic_env_key": bool(ENV_ANTHROPIC_KEY)
    }

@app.get("/api/personas")
def get_personas():
    return database.seed_default_personas()

@app.post("/api/personas")
def create_persona(persona: PersonaModel):
    return database.create_persona_db(persona)

# --- GitHub Repo Analysis Route (SSE Streaming) ---

class RepoAnalysisRequest(BaseModel):
    github_url: str
    gemini_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    client_id: Optional[int] = None

@app.post("/api/analyze-repo")
async def analyze_repo(request: RepoAnalysisRequest):
    """
    Kick off agent fleet analysis on a GitHub repository.
    Returns Server-Sent Events as each persona agent completes.
    """
    gemini_key = request.gemini_api_key or ENV_GEMINI_KEY
    anthropic_key = request.anthropic_api_key or ENV_ANTHROPIC_KEY
    
    if not gemini_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is required.")
    if not request.github_url:
        raise HTTPException(status_code=400, detail="GitHub URL is required.")

    async def event_generator():
        try:
            # Phase 1: Clone the repo
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

            # Fetch persona prompts from DB
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

            # Phase 2: Launch the agent fleet
            yield {
                "event": "status",
                "data": json.dumps({
                    "phase": "agents_launched",
                    "message": "Agent fleet launched — 10 autonomous personas are thinking...",
                    "agents": [
                        {"key": k, "name": v["name"], "emoji": v["emoji"], "status": "thinking"}
                        for k, v in agent_engine.PERSONA_CONFIGS.items()
                    ]
                })
            }

            # Stream results as each agent completes
            async for update in agent_engine.run_agent_fleet(
                gemini_api_key=gemini_key,
                anthropic_api_key=anthropic_key,
                code_context=code_context,
                client_context=client_context,
                db_persona_prompts=db_persona_prompts
            ):
                # We yield either partial updates (thinking) or final results
                yield {
                    "event": update["event"],
                    "data": json.dumps(update["data"])
                }

            # Phase 3: Complete
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


# --- Legacy Analysis Route (kept for backward compat) ---

@app.post("/api/analyze")
async def analyze_data(
    apiKey: str = Form(...),
    client_id: Optional[int] = Form(None),
    text_context: Optional[str] = Form(None),
    files: List[UploadFile] = File([]) 
):
    apiKey = apiKey or ENV_GEMINI_KEY
    if not apiKey:
        raise HTTPException(status_code=400, detail="Gemini API Key is required. Set GEMINI_API_KEY env var or provide in the UI.")
        
    # Read files
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
                        multimodal_parts.append(f"\n--- The above attached PDF file corresponds to: {file.filename} ---\n")
                    elif filename_lower.endswith(('.png', '.jpg', '.jpeg')):
                        mime = 'image/png' if filename_lower.endswith('.png') else 'image/jpeg'
                        multimodal_parts.append(types.Part.from_bytes(data=content, mime_type=mime))
                        multimodal_parts.append(f"\n--- The above attached Image file corresponds to: {file.filename} ---\n")
                    else:
                        file_contents.append(f"--- FILE: {file.filename} ---\n{content.decode('utf-8', errors='replace')}\n")
                except Exception as e:
                    file_contents.append(f"--- FILE: {file.filename} (Unreadable: {str(e)}) ---\n")

    if not text_context and not file_contents and not multimodal_parts:
        raise HTTPException(status_code=400, detail="No files or text provided to analyze.")

    # Build code context for agent fleet
    code_context = ""
    if text_context:
        code_context += text_context + "\n\n"
    if file_contents:
        code_context += "".join(file_contents)

    # Fetch dynamic personas
    personas = database.get_personas()
    db_persona_prompts = ""
    for p in personas:
        db_persona_prompts += f"- {p['role_name']}: {p['system_prompt']}\n"
    
    # Client Context
    client_context = ""
    if client_id:
        client_data = database.get_client(client_id)
        if client_data:
            client_context = f"Client: '{client_data['name']}' ({client_data.get('description', '')})"

    try:
        # Use the agent fleet
        results = await agent_engine.run_agent_fleet_all(
            gemini_api_key=apiKey,
            anthropic_api_key=ENV_ANTHROPIC_KEY, # Pass env key for legacy
            code_context=code_context,
            client_context=client_context,
            db_persona_prompts=db_persona_prompts
        )

        # Transform results into the expected format
        result_map = {r["persona"]: r["content"] for r in results}
        
        return {
            "status": "success",
            "results": result_map
        }
        
    except Exception as e:
        print(f"Error during analysis: {e}")
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
