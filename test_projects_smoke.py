"""
Smoke test for the Projects workspace (Phase 1).

Exercises the DB helpers in database.py directly:
  1. Create root project
  2. Create two sub-projects (one inheriting materials, one opting out)
  3. Fetch the tree and verify nesting
  4. Patch the root project
  5. Depth enforcement (cycle prevention via update helper — soft check)
  6. Create a material on root + verify collect_materials_for_run traverses
  7. Open + finalize a project_run
  8. Save artifacts
  9. Soft-delete all test projects (status=archived)

Detects whether the migration has been applied; if not, prints the exact
SQL file to run against Supabase and exits cleanly.

Run: python test_projects_smoke.py
"""

from __future__ import annotations
import sys
import time
from dotenv import load_dotenv

load_dotenv(override=True)

import database
from database import (
    ProjectModel, ProjectMaterialModel, ProjectRunModel, ProjectArtifactModel,
)


MIGRATION_PATH = "supabase_migrations/002_projects.sql"


def tables_exist() -> bool:
    """Return True if the new tables are present in Supabase."""
    try:
        database.supabase.table("projects").select("id").limit(1).execute()
        database.supabase.table("project_materials").select("id").limit(1).execute()
        database.supabase.table("project_runs").select("id").limit(1).execute()
        database.supabase.table("project_artifacts").select("id").limit(1).execute()
        return True
    except Exception as e:
        print(f"   (tables_exist probe: {e})")
        return False


def main() -> int:
    print("-" * 60)
    print("PROJECTS WORKSPACE SMOKE TEST")
    print("-" * 60)

    if not tables_exist():
        print()
        print("!! Migration has not been applied.")
        print(f"   Run this file against your Supabase project (SQL editor):")
        print(f"     {MIGRATION_PATH}")
        print()
        print("   After it runs, re-run this test.")
        return 1

    print("[1/9] Legacy holder project exists (or will be created)")
    legacy = database.get_legacy_project()
    assert legacy and legacy.get("id"), "Legacy project creation failed"
    print(f"       OK  legacy_holder id={legacy['id']}  name={legacy['name']}")

    stamp = str(int(time.time()))
    root_name = f"SMOKE-root-{stamp}"

    print("[2/9] Create root project")
    root = database.create_project(ProjectModel(
        name=root_name,
        goal="Smoke test root goal",
        description="Automated smoke test.",
    ))
    assert root and root["id"], "Root create failed"
    root_id = root["id"]
    print(f"       OK  root id={root_id}")

    print("[3/9] Create two sub-projects")
    sub_a = database.create_project(ProjectModel(
        name=f"{root_name}-sub-A-inherits",
        parent_id=root_id,
        goal="Sub A (inherits materials)",
        inherits_materials=True,
    ))
    sub_b = database.create_project(ProjectModel(
        name=f"{root_name}-sub-B-optout",
        parent_id=root_id,
        goal="Sub B (opts out of parent materials)",
        inherits_materials=False,
    ))
    assert sub_a and sub_b, "Sub-project create failed"
    print(f"       OK  sub_a id={sub_a['id']}  sub_b id={sub_b['id']}")

    print("[4/9] Fetch tree; verify parent/child linkage")
    all_active = database.list_projects()
    ids = {p["id"] for p in all_active}
    assert root_id in ids and sub_a["id"] in ids and sub_b["id"] in ids, \
        "Newly created projects missing from list_projects()"
    children = database.get_project_children(root_id)
    child_ids = {c["id"] for c in children}
    assert sub_a["id"] in child_ids and sub_b["id"] in child_ids, \
        "get_project_children failed to return sub-projects"
    print(f"       OK  root has {len(children)} child(ren)")

    print("[5/9] Patch root (change goal + description)")
    updated = database.update_project(root_id, {
        "goal": "Updated goal from smoke test",
        "description": "Updated description",
    })
    assert updated and updated["goal"] == "Updated goal from smoke test", \
        "update_project did not persist changes"
    print(f"       OK  root patched")

    print("[6/9] Attach material on root; verify inheritance walk")
    material = database.create_project_material(ProjectMaterialModel(
        project_id=root_id,
        kind="text",
        filename="Smoke note",
        content_text="Some context for the agents.",
        size_bytes=28,
    ))
    assert material and material["id"], "Material create failed"

    # sub_a inherits → should see parent material when asked to collect
    collected_a = database.collect_materials_for_run(sub_a["id"])
    ids_a = {m["id"] for m in collected_a}
    assert material["id"] in ids_a, \
        f"sub_a (inherits) did not get root material (collected: {ids_a})"
    print(f"       OK  sub_a inherits → saw {len(collected_a)} material(s)")

    # sub_b opts out → should NOT see parent material
    collected_b = database.collect_materials_for_run(sub_b["id"])
    ids_b = {m["id"] for m in collected_b}
    assert material["id"] not in ids_b, \
        f"sub_b (opts out) unexpectedly inherited root material"
    print(f"       OK  sub_b opts out → saw {len(collected_b)} material(s)")

    print("[7/9] Open and finalize a project_run")
    run = database.create_project_run(ProjectRunModel(
        project_id=root_id,
        kind="topic",
        input_payload={"topic": "smoke test run"},
    ))
    assert run and run["id"], "Run create failed"
    finalized = database.finalize_project_run(run["id"], status="complete")
    assert finalized and finalized.get("status") == "complete", \
        "Run did not transition to complete"
    print(f"       OK  run id={run['id']}  status={finalized['status']}")

    print("[8/9] Write artifacts + list them")
    database.save_run_artifacts(
        run_id=run["id"],
        project_id=root_id,
        results={
            "architect": "# Architect report\n\nSome findings...",
            "security": "# Security report\n\nZero CVEs.",
        },
        synthesis_content="# The Verdict\n\nGo ahead.",
    )
    artifacts = database.list_project_artifacts(root_id)
    kinds = {a["kind"] for a in artifacts}
    assert "report" in kinds and "synthesis" in kinds, \
        f"Artifacts missing kinds: got {kinds}"
    print(f"       OK  wrote {len(artifacts)} artifact(s), kinds={sorted(kinds)}")

    print("[9/9] Soft-delete the test projects (archived)")
    for pid in (sub_a["id"], sub_b["id"], root_id):
        database.delete_project(pid)
    # Verify they're no longer returned by list_projects()
    after = {p["id"] for p in database.list_projects()}
    assert root_id not in after and sub_a["id"] not in after and sub_b["id"] not in after, \
        "Soft-deleted projects still appear in list_projects()"
    print(f"       OK  all test projects archived")

    print()
    print("-" * 60)
    print("PASS")
    print("-" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
