"""
Smoke test for build_pack.py — exercises all 14 section writers + zip pipeline
without invoking the Claude API. Uses a pre-baked spec modelled on the real
'OutSystems 11 Case Management Framework → ODC' topic the user plans to run.

Run: python test_build_pack_smoke.py
Exits non-zero if any writer blows up, produces zero files, or the zip is empty.
"""

from __future__ import annotations
import json
import sys
import zipfile
from pathlib import Path

import build_pack


SPEC = {
    "meta": {
        "topic": "Rebuild OutSystems 11 Case Management Framework into ODC",
        "target_platform": "OutSystems Developer Cloud (ODC)",
        "current_platform": "OutSystems 11 Case Management Framework",
        "recommended_path": "Balanced",
        "summary": "Selective rebuild of the OS11 CMF onto ODC using Forge components where possible, keeping domain logic native and migrating data via Bootstrap pattern.",
    },
    "executive_summary_md": (
        "## Executive Summary\n\n"
        "Migrate the Case Management Framework from OS11 to ODC in a **12-sprint phased rollout**. "
        "Reuse Forge where feasible (Case, SLA, Attachments). Rebuild the workflow engine natively in ODC "
        "using Business Process Technology patterns. Data migrated via Bootstrap action per entity.\n\n"
        "**Budget**: $180K · **Team**: 1 Architect + 3 Devs + 1 BA + 1 QA · **Duration**: 6 months."
    ),
    "requirements": {
        "epics": [
            {"name": "Case Lifecycle", "description": "Open, assign, progress, close cases.", "priority": "high"},
            {"name": "SLA Management", "description": "SLA tracking, breach alerts, escalation.", "priority": "high"},
            {"name": "Attachments & Comments", "description": "File uploads, threaded comments per case.", "priority": "med"},
        ],
        "user_stories": [
            {
                "epic": "Case Lifecycle",
                "title": "Agent opens a new case",
                "story": "As an agent I want to open a new case so that I can track customer issues.",
                "acceptance_criteria": [
                    "Form validates required fields",
                    "Case number auto-generated",
                    "Confirmation email sent",
                ],
                "points": 3,
                "priority": "high",
                "dependencies": [],
            },
            {
                "epic": "SLA Management",
                "title": "Breach alerts triggered at 80% SLA",
                "story": "As a team lead I want to be alerted at 80% SLA consumption so that I can intervene.",
                "acceptance_criteria": [
                    "Alert fires at 80%",
                    "Escalates to manager at 100%",
                    "Log entry written to AuditLog",
                ],
                "points": 5,
                "priority": "high",
                "dependencies": ["Agent opens a new case"],
            },
        ],
        "personas": [
            {"name": "Agent", "description": "Front-line support staff.", "roles": ["Agent"]},
            {"name": "Team Lead", "description": "Supervises a pool of agents.", "roles": ["TeamLead", "Agent"]},
        ],
    },
    "architecture": {
        "layers": [
            {
                "name": "Foundation",
                "description": "Theme, shared UI widgets, config.",
                "modules": [
                    {"name": "CMF_Theme", "type": "library", "description": "Shared theme tokens.", "depends_on": []},
                ],
            },
            {
                "name": "Core Services",
                "description": "Business logic and persistence.",
                "modules": [
                    {"name": "CMF_Case_CS", "type": "service", "description": "Case entity + lifecycle service actions.", "depends_on": ["CMF_Theme"]},
                    {"name": "CMF_SLA_CS", "type": "service", "description": "SLA tracking + escalation.", "depends_on": ["CMF_Case_CS"]},
                ],
            },
            {
                "name": "End User",
                "description": "Consumer-facing ODC app.",
                "modules": [
                    {"name": "CMF_Agent_App", "type": "app", "description": "Agent-facing web app.", "depends_on": ["CMF_Case_CS", "CMF_SLA_CS"]},
                ],
            },
        ],
        "integration_patterns": ["Forge marketplace reuse", "Async Light BPT for SLA timers", "REST integration with CRM"],
        "forge_components": [
            {"name": "Silk UI Web", "url": "https://www.outsystems.com/forge/silk-ui", "purpose": "UI widgets", "replaces": "custom grid + filter widgets"},
            {"name": "Ultimate PDF", "url": "https://www.outsystems.com/forge/ultimate-pdf", "purpose": "Case PDF export", "replaces": "custom PDF extension"},
        ],
    },
    "data_model": {
        "entities": [
            {
                "name": "Case",
                "description": "A customer case.",
                "module": "CMF_Case_CS",
                "is_static": False,
                "attributes": [
                    {"name": "Id", "type": "Long Integer", "length": 0, "mandatory": True, "is_identifier": True, "is_auto_number": True, "default": None, "description": "PK"},
                    {"name": "CaseNumber", "type": "Text", "length": 20, "mandatory": True, "is_identifier": False, "is_auto_number": False, "default": None, "description": "Human-readable ID"},
                    {"name": "Title", "type": "Text", "length": 200, "mandatory": True, "is_identifier": False, "is_auto_number": False, "default": None, "description": "Short title"},
                    {"name": "StatusId", "type": "Long Integer", "length": 0, "mandatory": True, "is_identifier": False, "is_auto_number": False, "default": None, "description": "FK to CaseStatus"},
                    {"name": "OpenedAt", "type": "DateTime", "length": 0, "mandatory": True, "is_identifier": False, "is_auto_number": False, "default": "CurrDateTime()", "description": "When opened"},
                ],
                "indexes": [{"name": "IX_Case_CaseNumber", "attributes": ["CaseNumber"], "unique": True}],
                "static_records": [],
            },
            {
                "name": "CaseStatus",
                "description": "Case status enum.",
                "module": "CMF_Case_CS",
                "is_static": True,
                "attributes": [
                    {"name": "Id", "type": "Long Integer", "length": 0, "mandatory": True, "is_identifier": True, "is_auto_number": True, "default": None, "description": "PK"},
                    {"name": "Label", "type": "Text", "length": 50, "mandatory": True, "is_identifier": False, "is_auto_number": False, "default": None, "description": "Display label"},
                ],
                "indexes": [],
                "static_records": [
                    {"Id": 1, "Label": "Open"},
                    {"Id": 2, "Label": "InProgress"},
                    {"Id": 3, "Label": "Closed"},
                ],
            },
        ],
        "relationships": [
            {"from_entity": "Case", "from_attribute": "StatusId", "to_entity": "CaseStatus", "type": "many-to-one", "on_delete": "Protect"},
        ],
    },
    "service_actions": [
        {
            "name": "OpenCase",
            "module": "CMF_Case_CS",
            "description": "Create a new case with default status Open.",
            "inputs": [
                {"name": "Title", "type": "Text", "mandatory": True, "description": "Case title"},
                {"name": "OpenedByUserId", "type": "Long Integer", "mandatory": True, "description": "Agent user id"},
            ],
            "outputs": [
                {"name": "CaseId", "type": "Long Integer", "description": "Id of created case"},
            ],
            "exposed_as_rest": True,
            "rest_method": "POST",
            "rest_path": "/cases",
            "business_rules": ["Assign next CaseNumber from sequence", "Initial StatusId = 1 (Open)"],
            "called_by": ["Agent_NewCase_Screen"],
        },
        {
            "name": "CloseCase",
            "module": "CMF_Case_CS",
            "description": "Close a case and stamp closure date.",
            "inputs": [
                {"name": "CaseId", "type": "Long Integer", "mandatory": True, "description": "Case to close"},
            ],
            "outputs": [],
            "exposed_as_rest": True,
            "rest_method": "PUT",
            "rest_path": "/cases/{caseId}/close",
            "business_rules": ["Only allowed if StatusId != 3"],
            "called_by": ["Agent_CaseDetail_Screen"],
        },
    ],
    "integrations": {
        "consumed_apis": [
            {
                "name": "Salesforce CRM",
                "base_url": "https://api.example-crm.com/v1",
                "description": "Customer lookup and account sync.",
                "auth": "OAuth2",
                "endpoints": [
                    {"method": "GET", "path": "/customers/{id}", "description": "Fetch customer profile", "request_schema": {}, "response_schema": {"id": "string", "email": "string"}},
                ],
            }
        ],
        "exposed_apis": [
            {
                "name": "CMF Public Case API",
                "base_url": "/rest/CMF_Public/v1",
                "description": "Partner-facing case read/write.",
                "auth": "ApiKey",
                "endpoints": [
                    {"method": "GET", "path": "/cases/{id}", "description": "Fetch case", "request_schema": {}, "response_schema": {}},
                ],
            }
        ],
    },
    "screens": [
        {
            "name": "Agent_NewCase_Screen",
            "module": "CMF_Agent_App",
            "route": "/cases/new",
            "type": "form",
            "description": "Form for agents to open a new case.",
            "role_access": ["Agent", "TeamLead"],
            "widgets": ["Input(Title)", "Button(Submit)"],
            "actions_triggered": ["OpenCase"],
            "wireframe_md": "Header with breadcrumbs. Form centred, title field full width, submit button right-aligned.",
        },
        {
            "name": "Agent_CaseDetail_Screen",
            "module": "CMF_Agent_App",
            "route": "/cases/{caseId}",
            "type": "detail",
            "description": "Case detail with attachments and comments.",
            "role_access": ["Agent", "TeamLead"],
            "widgets": ["CaseHeader", "Tabs(Details|Attachments|Comments)", "CloseButton"],
            "actions_triggered": ["CloseCase"],
            "wireframe_md": "Two-column layout. Left: case metadata. Right: activity feed.",
        },
    ],
    "navigation_flow": [
        {"from": "Agent_NewCase_Screen", "to": "Agent_CaseDetail_Screen", "trigger": "Submit button", "condition": "OpenCase returns success"},
    ],
    "security": {
        "roles": [
            {"name": "Agent", "description": "Opens and progresses cases.", "permissions": ["case.read", "case.write"]},
            {"name": "TeamLead", "description": "Supervises agents.", "permissions": ["case.read", "case.write", "case.escalate"]},
        ],
        "auth_approach": "ODC built-in auth + Azure AD federation via SAML.",
        "data_classification": [
            {"entity": "Case", "classification": "Confidential", "rationale": "May contain PII in title/description."},
        ],
        "compliance_requirements": ["GDPR Article 32", "SOC 2 CC6.1"],
    },
    "quality": {
        "test_strategy_md": "Unit tests per service action (Jest-equivalent in ODC). Integration tests via BDD framework. E2E with Playwright on staging.",
        "test_scenarios": [
            {"name": "Open case happy path", "type": "e2e", "description": "Agent opens case, sees detail screen.", "steps": ["Login", "Navigate to /cases/new", "Fill form", "Submit"], "expected": "Detail screen rendered with new case."},
            {"name": "Close already-closed case", "type": "integration", "description": "API rejects duplicate close.", "steps": ["Close case", "Attempt close again"], "expected": "Second call returns 409."},
        ],
        "risk_register": [
            {"risk": "Data migration loses CaseNumber uniqueness", "severity": "high", "mitigation": "Pre-migration dedupe + unique index enforced."},
            {"risk": "Forge component version drift", "severity": "med", "mitigation": "Pin versions, revisit quarterly."},
        ],
    },
    "operations": {
        "environments": [
            {"name": "Dev", "purpose": "Developer sandbox", "scaling": "1 stage", "data_refresh": "On-demand"},
            {"name": "Staging", "purpose": "UAT + pre-prod smoke", "scaling": "1 stage", "data_refresh": "Weekly from Prod (masked)"},
            {"name": "Prod", "purpose": "Live", "scaling": "Auto-scale 2-10 stages", "data_refresh": "N/A"},
        ],
        "ci_cd_md": "ODC LifeTime pipeline. Feature branches → Dev → Staging → Prod with manual approval gate.",
        "observability_md": "ODC built-in monitoring + Datadog forwarder for app logs. Alert on SLA breach rate > 2%.",
    },
    "migration": {
        "applicable": True,
        "strategy": "Strangler Fig",
        "phases": [
            {"name": "Foundation + Data Bootstrap", "sprint_range": "S1-S3", "scope": "Migrate Case + CaseStatus entities.", "go_no_go_criteria": "All historical cases readable in ODC."},
            {"name": "Write path cutover", "sprint_range": "S4-S7", "scope": "Route new cases to ODC.", "go_no_go_criteria": "Zero data loss for 7 days parallel run."},
            {"name": "Legacy decommission", "sprint_range": "S8-S12", "scope": "Retire OS11 CMF.", "go_no_go_criteria": "All integrations repointed."},
        ],
        "data_migration_approach_md": "Bootstrap action reads OS11 entity via REST, writes to ODC entity in batches of 500.",
        "data_migration_sql": "-- Truncate target before Bootstrap\nDELETE FROM ODC.Case WHERE 1=1;\nDELETE FROM ODC.CaseStatus WHERE 1=1;",
        "cutover_checklist": [
            "Freeze writes to OS11 CMF",
            "Run final Bootstrap delta",
            "Flip CRM integration endpoint",
            "Monitor for 24h",
        ],
    },
    "commercial": {
        "licencing_estimate_md": "ODC Enterprise: ~$120K/yr for expected 50 named users + 10 concurrent. Factor in Forge components (free).",
        "build_effort_md": "1 Solution Architect (full-time 6mo), 3 ODC Developers (full-time 6mo), 1 BA (50% 6mo), 1 QA (75% 6mo). Estimated build: $180K.",
        "roi_model_md": "Break-even in year 2 vs maintaining OS11 CMF license + specialist support. Year 3+ savings ~$80K/yr.",
    },
    "sprint_plan": [
        {"sprint": 1, "name": "Foundation", "goals": ["Theme module", "ODC stages provisioned"], "story_titles": [], "demo_criteria": "Empty ODC app deployed to Dev stage with theme."},
        {"sprint": 2, "name": "Case entity + Open flow", "goals": ["Case entity", "OpenCase action", "NewCase screen"], "story_titles": ["Agent opens a new case"], "demo_criteria": "Agent can open a case end-to-end in Dev."},
        {"sprint": 3, "name": "SLA v1", "goals": ["SLA entity", "Breach alert"], "story_titles": ["Breach alerts triggered at 80% SLA"], "demo_criteria": "Alert fires in Dev with seed data."},
    ],
}


def main() -> int:
    print("-" * 60)
    print("BUILD PACK SMOKE TEST")
    print("-" * 60)

    pack_id = build_pack.new_pack_id()
    out_dir = build_pack.pack_dir(pack_id)
    print(f"pack_id: {pack_id}")
    print(f"out_dir: {out_dir}")

    # 1. Run all 14 section writers
    print("\n[1/3] Generating files...")
    written = build_pack.generate_build_pack_files(SPEC, out_dir)
    print(f"       wrote {len(written)} file(s)")

    if len(written) < 15:
        print(f"!! FAIL: expected >=15 files, got {len(written)}")
        return 1

    # Check for any GENERATION_ERROR markers — means a writer blew up
    errors = [p for p in written if p.name.startswith("_GENERATION_ERROR_")]
    if errors:
        print("!! FAIL: one or more writers raised exceptions:")
        for p in errors:
            print(f"   - {p.name}: {p.read_text(encoding='utf-8')[:200]}")
        return 1

    # 2. List what we produced by directory
    print("\n[2/3] Directory tree:")
    dirs = {}
    for p in sorted(written):
        rel = p.relative_to(out_dir)
        parent = str(rel.parent) if rel.parent.parts else "(root)"
        dirs.setdefault(parent, []).append(rel.name)
    for parent, names in sorted(dirs.items()):
        print(f"  {parent}/")
        for n in names:
            print(f"    {n}")

    # 3. Zip it
    print("\n[3/3] Zipping...")
    zip_path = build_pack.zip_build_pack(out_dir)
    size = zip_path.stat().st_size
    print(f"       zip: {zip_path} ({size:,} bytes)")

    if size < 5_000:
        print(f"!! FAIL: zip suspiciously small ({size} bytes)")
        return 1

    # Inspect the zip
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        print(f"       zip contains {len(names)} entries")

    # Spot-check a few expected files
    expected_files = [
        "README.md",
        "_spec.json",
        "00_EXECUTIVE_SUMMARY/synthesis.md",
        "01_REQUIREMENTS/user-stories.md",
        "01_REQUIREMENTS/user-stories.json",
        "01_REQUIREMENTS/sprint-plan.md",
        "02_ARCHITECTURE/blueprint.md",
        "02_ARCHITECTURE/architecture-diagram.mmd",
        "02_ARCHITECTURE/forge-shortlist.md",
        "03_DATA_MODEL/entities.json",
        "03_DATA_MODEL/schema.sql",
        "03_DATA_MODEL/er-diagram.mmd",
        "03_DATA_MODEL/static-data.json",
        "04_SERVICE_ACTIONS/openapi.yaml",
        "04_SERVICE_ACTIONS/actions.json",
        "05_INTEGRATIONS/consumed-apis.yaml",
        "05_INTEGRATIONS/integration-map.mmd",
        "06_UX/screens.json",
        "06_UX/navigation-flow.mmd",
        "06_UX/wireframes.md",
        "07_SECURITY/security-requirements.md",
        "07_SECURITY/data-classification.md",
        "08_QUALITY/test-plan.md",
        "08_QUALITY/risk-register.md",
        "09_OPERATIONS/environments.md",
        "10_MIGRATION/migration-strategy.md",
        "10_MIGRATION/data-migration.sql",
        "11_COMMERCIAL/roi-model.md",
        "99_ODC_IMPORT_GUIDE/README.md",
        "99_ODC_IMPORT_GUIDE/IMPORT_WARNINGS.md",
    ]
    missing = []
    for rel in expected_files:
        if not (out_dir / rel).exists():
            missing.append(rel)
    if missing:
        print(f"!! FAIL: {len(missing)} expected file(s) missing:")
        for m in missing:
            print(f"   - {m}")
        return 1

    # Sanity-check schema.sql is valid-looking DDL
    sql = (out_dir / "03_DATA_MODEL/schema.sql").read_text(encoding="utf-8")
    if "CREATE TABLE" not in sql.upper():
        print("!! FAIL: schema.sql missing CREATE TABLE")
        return 1

    # Sanity-check openapi.yaml parses as something resembling a spec
    openapi_text = (out_dir / "04_SERVICE_ACTIONS/openapi.yaml").read_text(encoding="utf-8")
    if "openapi" not in openapi_text.lower() or "/cases" not in openapi_text:
        print("!! FAIL: openapi.yaml does not look like a valid OpenAPI doc")
        return 1

    # Sanity-check ER diagram mentions entities
    er = (out_dir / "03_DATA_MODEL/er-diagram.mmd").read_text(encoding="utf-8")
    if "Case" not in er or "erDiagram" not in er:
        print("!! FAIL: er-diagram.mmd missing expected content")
        return 1

    # Sanity-check stories made it into the JSON (file stores whole requirements block)
    req_dump = json.loads((out_dir / "01_REQUIREMENTS/user-stories.json").read_text(encoding="utf-8"))
    stories_out = req_dump.get("user_stories") if isinstance(req_dump, dict) else None
    if not isinstance(stories_out, list) or len(stories_out) < 2:
        print(f"!! FAIL: user-stories.json has {len(stories_out) if isinstance(stories_out, list) else '?'} story entries, expected >=2")
        return 1

    # Sanity-check static data was extracted
    static = json.loads((out_dir / "03_DATA_MODEL/static-data.json").read_text(encoding="utf-8"))
    if "CaseStatus" not in static:
        print("!! FAIL: static-data.json missing CaseStatus")
        return 1

    print("\n" + "-" * 60)
    print(f"PASS -- {len(written)} files, zip {size:,} bytes")
    print("-" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
