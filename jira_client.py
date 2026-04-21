"""
jira_client.py — thin async Jira REST v3 client for the push-to-Jira flow.

Scope: enough to create Epics + Stories under an existing project, link
dependencies as issue links, and set priority/labels/story points. NOT a
general-purpose Jira wrapper — we use it only from main.py's push endpoint.

Auth: Basic auth with `email:api_token` base64-encoded. Atlassian Cloud
style (since 2019). Uses the configured domain (`acme.atlassian.net`).

No SDK dependency — just httpx. Keeps the footprint small.

Graceful failure: every method returns (ok, result_or_error) rather than
raising, so the caller can collect errors across many issues and report a
partial success.
"""
from __future__ import annotations
import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)


# Which Atlassian issue type name to use per our canonical story `type` tag.
# Most Jira projects have Story + Task + Bug as defaults; Spike/Tech-Debt
# are mapped to Task unless the user has configured equivalents.
ISSUE_TYPE_MAP = {
    "story":     "Story",
    "bug":       "Bug",
    "spike":     "Task",
    "tech-debt": "Task",
}

# Our MoSCoW priorities → Jira's default priority scheme.
PRIORITY_MAP = {
    "Must":   "Highest",
    "Should": "High",
    "Could":  "Medium",
    "Won't":  "Low",
}


class JiraClient:
    """Async Jira Cloud REST v3 client. One instance per push."""

    def __init__(self, domain: str, email: str, api_token: str, timeout_s: float = 20.0):
        self.base_url = f"https://{domain.strip().rstrip('/')}/rest/api/3"
        creds = f"{email}:{api_token}".encode("utf-8")
        self.auth_header = "Basic " + base64.b64encode(creds).decode("ascii")
        self.timeout = httpx.Timeout(timeout_s)
        self._field_cache: Dict[str, str] = {}   # lowercased field name -> field id

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": self.auth_header,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    # ─── Discovery ────────────────────────────────────────────────────────

    async def verify_connection(self) -> Tuple[bool, str]:
        """Quick connectivity + auth check. Hits /myself which requires auth."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(f"{self.base_url}/myself", headers=self._headers())
            if r.status_code == 200:
                data = r.json()
                return True, f"Authenticated as {data.get('displayName', data.get('emailAddress', 'unknown'))}"
            return False, f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            return False, f"Connection failed: {e}"

    async def verify_project(self, project_key: str) -> Tuple[bool, str]:
        """Verify the target Jira project exists and the user can access it."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(
                    f"{self.base_url}/project/{project_key}",
                    headers=self._headers(),
                )
            if r.status_code == 200:
                data = r.json()
                return True, f"Found project '{data.get('name', project_key)}' ({data.get('projectTypeKey', '?')})"
            return False, f"Project '{project_key}' not accessible — HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            return False, f"Project verify failed: {e}"

    async def _resolve_custom_field(self, name: str) -> Optional[str]:
        """Look up a custom field ID by its display name. Cached."""
        key = name.strip().lower()
        if key in self._field_cache:
            return self._field_cache[key]
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(f"{self.base_url}/field", headers=self._headers())
            if r.status_code != 200:
                return None
            for f in r.json():
                self._field_cache[(f.get("name") or "").strip().lower()] = f.get("id", "")
            return self._field_cache.get(key)
        except Exception as e:
            logger.warning(f"field resolve for '{name}' failed: {e}")
            return None

    # ─── Issue creation ───────────────────────────────────────────────────

    async def create_issue(
        self,
        *,
        project_key: str,
        summary: str,
        description: str = "",
        issue_type: str = "Story",
        priority: Optional[str] = None,
        labels: Optional[List[str]] = None,
        story_points: Optional[int] = None,
        parent_epic_key: Optional[str] = None,
    ) -> Tuple[bool, Any]:
        """Create a Jira issue. Returns (ok, {"key": "PROJ-123", ...}) or (False, error)."""
        fields: Dict[str, Any] = {
            "project":   {"key": project_key},
            "summary":   summary[:250],   # Jira's summary cap
            "issuetype": {"name": issue_type},
        }
        # Description uses ADF (Atlassian Document Format). We send plain text
        # as a single paragraph — sufficient for most push scenarios.
        if description:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": description[:30000]}],
                }],
            }
        if priority:
            fields["priority"] = {"name": priority}
        if labels:
            fields["labels"] = [re.sub(r"\s+", "-", l.strip()) for l in labels if l.strip()]
        if story_points is not None:
            sp_field = await self._resolve_custom_field("Story Points") or await self._resolve_custom_field("Story point estimate")
            if sp_field:
                fields[sp_field] = story_points
        if parent_epic_key:
            # Modern Jira Cloud: parent key
            fields["parent"] = {"key": parent_epic_key}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(
                    f"{self.base_url}/issue",
                    headers=self._headers(),
                    json={"fields": fields},
                )
            if r.status_code in (200, 201):
                return True, r.json()
            return False, f"HTTP {r.status_code}: {r.text[:400]}"
        except Exception as e:
            return False, f"Create failed: {e}"

    async def link_issues(
        self,
        *,
        inward_key: str,   # the issue that "is blocked by"
        outward_key: str,  # the issue that "blocks"
        link_type: str = "Blocks",
    ) -> Tuple[bool, Any]:
        """Create an issue link. Default 'Blocks' — the standard Jira dep type."""
        payload = {
            "type": {"name": link_type},
            "inwardIssue":  {"key": inward_key},
            "outwardIssue": {"key": outward_key},
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(
                    f"{self.base_url}/issueLink",
                    headers=self._headers(),
                    json=payload,
                )
            if r.status_code in (200, 201, 204):
                return True, {"linked": f"{outward_key} blocks {inward_key}"}
            return False, f"Link HTTP {r.status_code}: {r.text[:300]}"
        except Exception as e:
            return False, f"Link failed: {e}"


import re  # noqa: E402  — used by create_issue label normalisation


async def push_groomed_backlog_to_jira(
    *,
    jira_cfg: Dict[str, Any],             # get_jira_config(include_token=True)
    backlog_tree: Dict[str, Any],         # get_groomed_tree()
    dep_graph: Dict[str, Any],            # get_dependency_graph()
    issue_type_by_tag: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """High-level push — creates epics, then stories linked to their epic,
    then dependency issue links. Returns a summary dict.

    Push order:
      1. Create all Epic issues (no dependencies between epics)
      2. Create all Story issues with parent_epic_key set
      3. Create issue links for dependencies (blocks/blocked-by)

    Failures on individual issues are collected in `errors` and don't abort
    the push — partial success is valuable.
    """
    issue_type_by_tag = issue_type_by_tag or ISSUE_TYPE_MAP

    client = JiraClient(
        domain=jira_cfg["domain"],
        email=jira_cfg["email"],
        api_token=jira_cfg["api_token"],
    )
    project_key = jira_cfg["project_key"]

    # Sanity check: can we even reach the project?
    conn_ok, conn_msg = await client.verify_project(project_key)
    if not conn_ok:
        return {
            "ok": False,
            "error": f"Jira project check failed: {conn_msg}",
            "pushed_epics": 0,
            "pushed_stories": 0,
            "created_keys": [],
            "errors": [],
        }

    epics = backlog_tree.get("epics") or []
    errors: List[Dict[str, Any]] = []
    created_keys: List[str] = []
    epic_db_to_jira: Dict[int, str] = {}   # our epic row id -> Jira epic key
    story_db_to_jira: Dict[int, str] = {}  # our story row id -> Jira issue key

    # 1) Epics
    pushed_epics = 0
    for epic in epics:
        sd = epic.get("structured_data") or {}
        ok, result = await client.create_issue(
            project_key=project_key,
            summary=epic.get("title") or "Epic",
            description=(epic.get("content") or sd.get("story") or sd.get("description") or "")[:2500],
            issue_type="Epic",
            priority=PRIORITY_MAP.get(sd.get("priority"), "Medium"),
            labels=sd.get("labels") or [],
        )
        if ok:
            key = result["key"]
            epic_db_to_jira[epic["id"]] = key
            created_keys.append(key)
            pushed_epics += 1
        else:
            errors.append({"stage": "epic", "title": epic.get("title"), "error": result})

    # 2) Stories (under their epics)
    pushed_stories = 0
    for epic in epics:
        parent_key = epic_db_to_jira.get(epic["id"])
        # Flatten features' stories + unparented
        flat_stories = []
        for f in epic.get("features") or []:
            flat_stories.extend(f.get("stories") or [])
        flat_stories.extend(epic.get("unparented_stories") or [])

        for story in flat_stories:
            sd = story.get("structured_data") or {}
            pts_raw = sd.get("points")
            try:
                pts = int(pts_raw) if pts_raw is not None else None
            except (ValueError, TypeError):
                pts = None
            ok, result = await client.create_issue(
                project_key=project_key,
                summary=story.get("title") or "Story",
                description=(sd.get("story") or "") + "\n\nAcceptance Criteria:\n" + (sd.get("acceptance_criteria") or ""),
                issue_type=issue_type_by_tag.get(sd.get("type", "story"), "Story"),
                priority=PRIORITY_MAP.get(sd.get("priority"), "Medium"),
                labels=(sd.get("labels") or []) + (["odc"] if sd.get("odc_entities") or sd.get("odc_screens") else []),
                story_points=pts,
                parent_epic_key=parent_key,
            )
            if ok:
                key = result["key"]
                story_db_to_jira[story["id"]] = key
                created_keys.append(key)
                pushed_stories += 1
            else:
                errors.append({"stage": "story", "title": story.get("title"), "error": result})

    # Also push orphan stories (no epic)
    for story in backlog_tree.get("orphans") or []:
        sd = story.get("structured_data") or {}
        pts_raw = sd.get("points")
        try:
            pts = int(pts_raw) if pts_raw is not None else None
        except (ValueError, TypeError):
            pts = None
        ok, result = await client.create_issue(
            project_key=project_key,
            summary=story.get("title") or "Story",
            description=(sd.get("story") or "") + "\n\nAcceptance Criteria:\n" + (sd.get("acceptance_criteria") or ""),
            issue_type=issue_type_by_tag.get(sd.get("type", "story"), "Story"),
            priority=PRIORITY_MAP.get(sd.get("priority"), "Medium"),
            labels=sd.get("labels") or [],
            story_points=pts,
        )
        if ok:
            key = result["key"]
            story_db_to_jira[story["id"]] = key
            created_keys.append(key)
            pushed_stories += 1
        else:
            errors.append({"stage": "orphan", "title": story.get("title"), "error": result})

    # 3) Dependency links
    pushed_links = 0
    for edge in dep_graph.get("edges") or []:
        f, t = edge.get("from"), edge.get("to")
        from_key = story_db_to_jira.get(f)
        to_key = story_db_to_jira.get(t)
        if not (from_key and to_key):
            continue
        # "blocked_by" edge: from is blocked by to  →  to blocks from
        if edge.get("type") == "blocked_by":
            outward, inward = to_key, from_key
        else:
            outward, inward = from_key, to_key
        ok, result = await client.link_issues(outward_key=outward, inward_key=inward)
        if ok:
            pushed_links += 1
        else:
            errors.append({"stage": "link", "from": from_key, "to": to_key, "error": result})

    return {
        "ok": len(errors) == 0,
        "pushed_epics": pushed_epics,
        "pushed_stories": pushed_stories,
        "pushed_links": pushed_links,
        "created_keys": created_keys,
        "errors": errors,
        "jira_project_key": project_key,
    }
