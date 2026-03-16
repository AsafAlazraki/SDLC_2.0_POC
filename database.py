import os
from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import BaseModel
from typing import Optional

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
