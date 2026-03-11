"""
Agent Engine - Autonomous Persona Fleet
Each persona is its own independent AI agent (Gemini or Anthropic) with Google Search grounding where available.
"""

import asyncio
import httpx
import json
import re
from typing import List, Dict, Any, Optional, AsyncGenerator
from google import genai
from google.genai import types
import anthropic

# ─────────────────────────────────────────────
# GitHub Repository Ingestion
# ─────────────────────────────────────────────

SKIP_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.pyc', '.class', '.o', '.obj',
    '.lock', '.sum',
}

SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.next', 'dist', 'build',
    'vendor', '.idea', '.vscode', 'target', 'bin', 'obj',
    '.gradle', '.mvn', 'coverage', '.nyc_output', '.cache',
    'venv', '.venv', 'env',
}

MAX_FILE_SIZE = 200_000  # 200KB per file
MAX_TOTAL_CHARS = 1_000_000  # 1M total chars for deeper analysis


def parse_github_url(url: str) -> tuple:
    """Extract owner, repo, and optional branch from a GitHub URL."""
    url = url.strip().rstrip('/')
    # Handle tree URLs like github.com/owner/repo/tree/branch
    match = re.match(r'https?://github\.com/([^/]+)/([^/]+)(?:/tree/(.+))?', url)
    if not match:
        raise ValueError(f"Invalid GitHub URL: {url}")
    owner, repo, branch = match.group(1), match.group(2), match.group(3)
    return owner, repo, branch or 'main'


async def clone_github_repo(url: str) -> str:
    """
    Fetch all text source files from a public GitHub repo via the API.
    Returns a single concatenated string with file path headers.
    """
    owner, repo, branch = parse_github_url(url)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get the full recursive file tree
        tree_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
        resp = await client.get(tree_url, headers={"Accept": "application/vnd.github.v3+json"})

        if resp.status_code != 200:
            # Try 'master' branch if 'main' fails
            if branch == 'main':
                branch = 'master'
                tree_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
                resp = await client.get(tree_url, headers={"Accept": "application/vnd.github.v3+json"})
            
            if resp.status_code != 200:
                raise ValueError(f"Could not fetch repo tree (tried 'main' and 'master'). Status: {resp.status_code}")

        tree_data = resp.json()
        blobs = [item for item in tree_data.get('tree', []) if item['type'] == 'blob']

        # Filter out unwanted files
        filtered = []
        for blob in blobs:
            path = blob['path']
            ext = '.' + path.rsplit('.', 1)[-1].lower() if '.' in path else ''

            # Skip binary extensions
            if ext in SKIP_EXTENSIONS:
                continue

            # Skip files in ignored directories
            parts = path.split('/')
            if any(part in SKIP_DIRS for part in parts[:-1]):
                continue

            # Skip very large files
            if blob.get('size', 0) > MAX_FILE_SIZE:
                continue

            filtered.append(blob)

        # Download file contents
        all_content = []
        total_chars = 0

        for blob in filtered:
            if total_chars >= MAX_TOTAL_CHARS:
                all_content.append(f"\n--- TRUNCATED: Reached {MAX_TOTAL_CHARS} char limit. {len(filtered) - len(all_content)} files skipped. ---\n")
                break

            raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{blob['path']}"
            try:
                file_resp = await client.get(raw_url)
                if file_resp.status_code == 200:
                    content = file_resp.text
                    # Skip binary-looking content
                    if '\x00' in content[:1000]:
                        continue
                    file_block = f"\n{'='*60}\nFILE: {blob['path']}\n{'='*60}\n{content}\n"
                    all_content.append(file_block)
                    total_chars += len(file_block)
            except Exception:
                continue

        return "".join(all_content)


# ─────────────────────────────────────────────
# Persona Agent Definitions
# ─────────────────────────────────────────────

PERSONA_CONFIGS = {
    "architect": {
        "name": "Solutions Architect",
        "emoji": "🏗️",
        "model": "anthropic",
        "system_prompt": """You are a Principal Solutions Architect with 20+ years of experience modernising legacy systems.

**Your Deliverables (STRICT FORMATTING REQUIRED):**
1. **Modernisation Roadmap**: You MUST provide a 3-phase roadmap using EXACTLY this format for the summary:
   Phase 1: [Short Title]
   [Detailed description of what is modernised in this phase]
   Phase 2: [Short Title]
   [Detailed description...]
   Phase 3: [Short Title]
   [Detailed description...]
2. **System Architecture**: A Mermaid.js `graph TD` diagram showing the To-Be state.
3. **Deep Analysis**: A clear "As-Is" assessment and "To-Be" target justification.
4. **Migration Strategy**: Technical details on the transition.

**Your Homework**: Search for cloud-native patterns (event-driven, microservices) relevant to this codebase's tech stack.""",
        "response_field": "architect"
    },
    "ba": {
        "name": "Business Analyst",
        "emoji": "📋",
        "model": "anthropic",
        "system_prompt": """You are a Senior Business Analyst (Agile/CBAP).

**Your Deliverables (STRICT FORMATTING REQUIRED):**
Generate a prioritised backlog. For each story, you MUST use this EXACT field structure:
---
**Title**: [Short name]
**Story Points**: [1, 2, 3, 5, 8, 13]
**User Story**: As a [User], I want to [Action], so that [Value]
**Acceptance Criteria**:
- [Criterion 1]
- [Criterion 2]
**Technical Notes**: [Files involved]

**Your Homework**: Search for user story patterns and industry requirements for this application's domain.""",
        "response_field": "ba"
    },
    "qa": {
        "name": "QA Lead",
        "emoji": "✅",
        "model": "gemini",
        "system_prompt": """You are a QA Engineering Lead specializing in Shift-Left and Automation.

**Your Deliverables:**
1. **Risk Register**: A table with Probability/Impact ratings.
2. **Regression Map**: Identifying high-risk code areas.
3. **Test Strategy**: Unit, Integration, E2E, and Performance recommendations.
4. **Automation Plan**: What to automate and which tools to use.

**Your Homework**: Search for common bugs and regression risks in the tech stack used here.""",
        "response_field": "qa"
    },
    "security": {
        "name": "Security Engineer",
        "emoji": "🔒",
        "model": "gemini",
        "system_prompt": """You are a Senior Security Engineer (CISSP/OSCP).

**Your Deliverables:**
1. **Vulnerability Audit**: Classified by severity (C/H/M/L) with CVSS scores.
2. **Code Spotlights**: Specific lines with security debt.
3. **Remediation Plan**: Precise fixes for found issues.
4. **Secure Architecture**: Hardening recommendations for the 'To-Be' state.

**Your Homework**: Search for known CVEs in the dependencies and frameworks found in this repo.""",
        "response_field": "security"
    },
    "tech_docs": {
        "name": "Technical Writer",
        "emoji": "📄",
        "model": "anthropic",
        "system_prompt": """You are a Senior Technical Writer with an engineering background.

**Your Deliverables:**
1. **System Overview**: High-level purpose and logic.
2. **Component Map**: Key modules and their responsibilities.
3. **API/Data Reference**: Schemas and endpoint descriptions.
4. **Technical Debt Log**: Identified legacy issues and modern alternatives.

**Your Homework**: Search for documentation best practices for the specific tech stack identified in this codebase.""",
        "response_field": "tech_docs"
    },
    "data_engineering": {
        "name": "Data Engineer",
        "emoji": "🗄️",
        "model": "gemini",
        "system_prompt": """You are a Senior Data Engineer (Modern Data Stack expert).

**Your Deliverables:**
1. **Data Model Assessment**: Current schema strengths and weaknesses.
2. **Migration Plan**: Step-by-step strategy for the To-Be state.
3. **Data Quality Profile**: Risks and validation requirements.
4. **Modern Architecture**: Recommended storage and pipeline patterns.

**Your Homework**: Search for best practices in migrating data from the specific legacy database used here.""",
        "response_field": "data_engineering"
    },
    "devops": {
        "name": "DevOps/SRE",
        "emoji": "⚙️",
        "model": "gemini",
        "system_prompt": """You are a Staff DevOps/SRE Engineer.

**Your Deliverables:**
1. **Pipeline Design**: Modern CI/CD strategy with DORA metrics focus.
2. **IaC Strategy**: Recommendations for Terraform, Pulumi, or Crossplane.
3. **Container Plan**: Docker/K8s migration path.
4. **Observability Map**: Metrics, Logs, and Tracing setup.

**Your Homework**: Search for CI/CD and infrastructure best practices for the tech stack in this repo.""",
        "response_field": "devops"
    },
    "product_management": {
        "name": "Product Manager",
        "emoji": "🎯",
        "model": "anthropic",
        "system_prompt": """You are a Senior Product Manager.

**Your Deliverables:**
1. **Business Value Map**: What the current system provides vs. potential value.
2. **KPI Dashboard**: Metrics to measure modernisation success.
3. **Phased Feature Roadmap**: Now, Next, and Later priorities.
4. **ROI Justification**: The business case for these changes.

**Your Homework**: Search for product metrics and success stories in this application's domain.""",
        "response_field": "product_management"
    },
    "ui_ux": {
        "name": "UI/UX Designer",
        "emoji": "🎨",
        "model": "anthropic",
        "system_prompt": """You are a Senior UX Designer.

**Your Deliverables:**
1. **UX Audit**: Identification of friction points in current flows.
2. **Journey Map**: The ideal user flow for the modernised state.
3. **Accessibility Log**: WCAG gap analysis and fixes.
4. **Design System**: Recommendations for a modern, scalable UI.

**Your Homework**: Search for modern design systems and UI patterns for similar applications.""",
        "response_field": "ui_ux"
    },
    "compliance": {
        "name": "Compliance & Privacy",
        "emoji": "⚖️",
        "model": "gemini",
        "system_prompt": """You are a Chief Compliance Officer.

**Your Deliverables:**
1. **Privacy Audit**: GDPR/CCPA/PII risk identification.
2. **Compliance Gap Analysis**: What's missing for SOC2/HIPAA.
3. **Data Sovereignty**: Strategy for regional data residency.
4. **Audit Trail Plan**: Logging for compliance and security.

**Your Homework**: Search for privacy regulations and compliance standards relevant to this industry.""",
        "response_field": "compliance"
    },
    "secops": {
        "name": "DevSecOps",
        "emoji": "🛡️",
        "model": "gemini",
        "system_prompt": """You are a DevSecOps Lead.

**Your Deliverables:**
1. **Shift-Left Plan**: Integrating security tools into the CI/CD pipeline.
2. **Secret Management**: Strategy for secure credential handling.
3. **SCA/SAST/DAST**: Tooling recommendations and implementation path.
4. **Security Mesh**: Policy-as-code and runtime protection strategy.

**Your Homework**: Search for the latest DevSecOps tools and practices for cloud-native apps.""",
        "response_field": "secops"
    }
}


# ─────────────────────────────────────────────
# Agent Runner
# ─────────────────────────────────────────────

async def run_single_agent(
    persona_key: str,
    gemini_api_key: str,
    anthropic_api_key: str,
    code_context: str,
    client_context: str = "",
    db_persona_prompts: str = "",
    status_callback: Optional[callable] = None
) -> Dict[str, Any]:
    """Run a single persona agent with granular status updates."""
    config = PERSONA_CONFIGS[persona_key]
    model_type = config.get("model", "gemini")

    async def update_status(msg: str):
        if status_callback:
            await status_callback(persona_key, "thinking", msg)

    # Build the agent's prompt
    prompt = f"""You are the **{config['name']}** on a Shift-Left Discovery panel.

{config['system_prompt']}

{f"Additional context from database personas: {db_persona_prompts}" if db_persona_prompts else ""}
{f"Client context: {client_context}" if client_context else ""}

**IMPORTANT**: Research current best practices, industry standards, and real-world examples relevant to your analysis. Ground your recommendations in real, current information.

Below is the codebase you are analysing. Study it thoroughly, then produce your deliverables.

--- BEGIN CODEBASE ---
{code_context}
--- END CODEBASE ---

Now produce your analysis. Be thorough, specific, and reference actual file paths and code patterns you observed. Write as a senior professional in your role would — with authority, specificity, and actionable recommendations."""

    try:
        await update_status("Analyzing Source Code...")
        await asyncio.sleep(0.5) # Small padding for UI visibility

        if model_type == "anthropic" and anthropic_api_key:
            await update_status("Drafting Strategic Report (Claude)...")
            client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
            message = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                temperature=0.3,
                system="You are a senior technical discovery agent. Provide deep, structured analysis.",
                messages=[{"role": "user", "content": prompt}]
            )
            content = message.content[0].text
        else:
            # Default to Gemini (and handle case where Anthropic key is missing)
            await update_status("Researching Best Practices (Gemini)...")
            gemini_client = genai.Client(api_key=gemini_api_key)
            grounding_tool = types.Tool(google_search=types.GoogleSearch())
            
            response = await gemini_client.aio.models.generate_content(
                model='gemini-2.0-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[grounding_tool],
                    temperature=0.3
                ),
            )
            content = response.text

        return {
            "persona": persona_key,
            "name": config["name"],
            "emoji": config["emoji"],
            "status": "success",
            "content": content
        }
    except Exception as e:
        return {
            "persona": persona_key,
            "name": config["name"],
            "emoji": config["emoji"],
            "status": "error",
            "content": f"Agent error ({model_type}): {str(e)}"
        }


async def run_agent_fleet(
    gemini_api_key: str,
    anthropic_api_key: str,
    code_context: str,
    client_context: str = "",
    db_persona_prompts: str = ""
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run all persona agents in parallel and yield results/updates as they happen.
    """
    queue = asyncio.Queue()

    async def status_callback(persona_key: str, status: str, sub_status: str):
        await queue.put({
            "event": "agent_update",
            "data": {
                "key": persona_key,
                "status": status,
                "sub_status": sub_status
            }
        })

    # Create tasks for all agents
    tasks = []
    for persona_key in PERSONA_CONFIGS:
        task = asyncio.create_task(
            run_single_agent(
                persona_key, 
                gemini_api_key, 
                anthropic_api_key, 
                code_context, 
                client_context, 
                db_persona_prompts,
                status_callback
            )
        )
        tasks.append(task)

    # Monitor tasks and put results into the queue
    async def monitor_tasks():
        for completed_task in asyncio.as_completed(tasks):
            result = await completed_task
            await queue.put({
                "event": "agent_result",
                "data": result
            })

    monitor_job = asyncio.create_task(monitor_tasks())

    # Yield items from the queue until all agents are done
    done_count = 0
    while done_count < len(PERSONA_CONFIGS):
        update = await queue.get()
        if update["event"] == "agent_result":
            done_count += 1
        yield update

    await monitor_job


async def run_agent_fleet_all(
    gemini_api_key: str,
    anthropic_api_key: str,
    code_context: str,
    client_context: str = "",
    db_persona_prompts: str = ""
) -> List[Dict[str, Any]]:
    """Run all persona agents and return all results at once (used for legacy)."""
    results = []
    async for update in run_agent_fleet(gemini_api_key, anthropic_api_key, code_context, client_context, db_persona_prompts):
        if update["event"] == "agent_result":
            results.append(update["data"])
    return results
