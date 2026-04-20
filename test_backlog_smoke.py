"""
Smoke test for the Phase 4 backlog (project_artifacts where kind='backlog_item').

Two-part test:
  Part A — pure-Python: BA-content → stories parser. Runs anywhere, no DB.
  Part B — DB round-trip via Supabase: create → list → patch (status move) →
           import-from-ba (with dedupe) → delete. Skips cleanly if the
           projects migration hasn't been applied.

Run: python test_backlog_smoke.py
"""

from __future__ import annotations
import sys
import time
from dotenv import load_dotenv

load_dotenv(override=True)

import database
from database import ProjectModel


SAMPLE_BA = """
# Business Analyst Report

## Top User Stories

**Title**: Customer onboarding wizard
**Story Points**: 8
**User Story**: As a new customer I want a guided wizard so that I can complete signup in under 3 minutes.
**Acceptance Criteria**:
- Wizard has 4 steps with progress bar
- Email + phone verification
- Drop-off analytics tracked

---

**Title**: Forgotten password self-service
**Story Points**: 3
**User Story**: As a returning customer I want to reset my password without contacting support.
**Acceptance Criteria**:
- Password reset email sent within 30s
- Token expires after 60 minutes
- Lockout after 5 failed attempts

---

**Title**: Admin merge duplicate customers
**Story Points**: 13
**User Story**: As an admin I want to merge duplicate customer records so that the data warehouse stays clean.
**Acceptance Criteria**:
- Manual merge UI with diff preview
- Audit trail for every merge
- Reversible within 7 days
"""


def part_a_parser():
    print("Part A — BA story parser")
    stories = database.parse_ba_stories(SAMPLE_BA)
    assert len(stories) == 3, f"Expected 3 stories, got {len(stories)}"
    titles = [s["title"] for s in stories]
    assert "Customer onboarding wizard" in titles
    assert stories[0]["points"] == 8
    assert stories[0]["priority"] == "med"           # 8 → med (>3, not >8)
    assert stories[2]["priority"] == "high"          # 13 → high
    assert "Wizard has 4 steps with progress bar" in stories[0]["acceptance_criteria"]
    assert all(s["source"] == "ba_agent" for s in stories)
    assert all(s["status"] == "backlog" for s in stories)
    print(f"  OK  parsed {len(stories)} stories  "
          f"(priorities: {[s['priority'] for s in stories]})")


def tables_exist() -> bool:
    try:
        database.supabase.table("project_artifacts").select("id").limit(1).execute()
        return True
    except Exception as e:
        print(f"  (probe: {e})")
        return False


def part_b_db_roundtrip() -> int:
    print("\nPart B — DB round-trip")
    if not tables_exist():
        print("  SKIP — project_artifacts table not present "
              "(run supabase_migrations/002_projects.sql).")
        return 0

    legacy = database.get_legacy_project()
    if not legacy:
        print("  SKIP — could not get/create Legacy holder.")
        return 0

    # Use a dedicated test project so we can clean up neatly.
    stamp = str(int(time.time()))
    test_project = database.create_project(ProjectModel(
        name=f"BACKLOG-SMOKE-{stamp}",
        goal="Backlog smoke test scaffolding",
    ))
    if not test_project:
        print("  SKIP — could not create test project.")
        return 0
    pid = test_project["id"]
    print(f"  scaffold: project id={pid}")

    failures = []
    try:
        # 1. create_backlog_item
        story = {
            "title": f"Manual story {stamp}",
            "story": "As a smoke test I want a deterministic insert so I can assert.",
            "acceptance_criteria": ["created via create_backlog_item", "id non-null"],
            "points": 5,
            "priority": "med",
            "status": "backlog",
            "source": "manual",
        }
        created = database.create_backlog_item(pid, story)
        if not (created and created.get("id")):
            failures.append("create_backlog_item returned no id")
        else:
            print(f"  [1] create_backlog_item OK (id={created['id']})")

        # 2. list_backlog_items
        items = database.list_backlog_items(pid)
        assert any(i.get("title") == story["title"] for i in items), \
            "Newly created backlog item missing from list_backlog_items"
        print(f"  [2] list_backlog_items OK ({len(items)} item(s))")

        # 3. update_backlog_item — move it to in_progress
        item_id = created["id"]
        updated = database.update_backlog_item(item_id, {"status": "in_progress"})
        assert updated and (updated.get("structured_data") or {}).get("status") == "in_progress", \
            f"status move did not persist: {updated}"
        print("  [3] update_backlog_item (status move) OK")

        # 4. update_backlog_item — change points + priority
        updated2 = database.update_backlog_item(item_id, {"points": 13, "priority": "high"})
        sd = (updated2 or {}).get("structured_data") or {}
        assert sd.get("points") == 13 and sd.get("priority") == "high", \
            f"edit did not persist: {sd}"
        print("  [4] update_backlog_item (edit) OK")

        # 5. import_backlog_from_ba — first import
        summary = database.import_backlog_from_ba(pid, SAMPLE_BA)
        assert summary["parsed"] == 3, f"Expected 3 parsed, got {summary}"
        assert summary["imported"] == 3, f"Expected 3 imported, got {summary}"
        print(f"  [5] import_backlog_from_ba (first run) OK  {summary}")

        # 6. import_backlog_from_ba — second import with dedupe should skip all 3
        summary2 = database.import_backlog_from_ba(pid, SAMPLE_BA)
        assert summary2["imported"] == 0 and summary2["skipped_existing"] == 3, \
            f"Dedupe failed: {summary2}"
        print(f"  [6] dedupe on re-import OK  {summary2}")

        # 7. delete a backlog item — soft delete
        assert database.delete_backlog_item(item_id), "delete_backlog_item returned False"
        items_after = database.list_backlog_items(pid)
        assert not any(i.get("id") == item_id for i in items_after), \
            "Deleted item still appears in list"
        print("  [7] delete_backlog_item (soft) OK")

    except AssertionError as e:
        failures.append(str(e))
        print(f"  [!!] FAIL  {e}")
    except Exception as e:
        failures.append(f"{type(e).__name__}: {e}")
        print(f"  [!!] CRASH  {type(e).__name__}: {e}")
    finally:
        # Cleanup — soft delete the test project (cascades to artifacts in our model
        # via status filter). Failure here is non-fatal for the test verdict.
        try:
            database.delete_project(pid)
            print(f"  cleanup: project {pid} archived")
        except Exception as e:
            print(f"  cleanup warning: {e}")

    return 0 if not failures else 1


def main() -> int:
    print("-" * 60)
    print("BACKLOG SMOKE TEST")
    print("-" * 60)

    rc = 0
    try:
        part_a_parser()
    except AssertionError as e:
        print(f"  [!!] Part A FAIL: {e}")
        rc = 1

    rc |= part_b_db_roundtrip()

    print()
    print("-" * 60)
    print("PASS" if rc == 0 else "FAIL")
    print("-" * 60)
    return rc


if __name__ == "__main__":
    sys.exit(main())
