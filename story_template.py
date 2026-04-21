"""
story_template.py — the canonical User Story template used by the grooming
pipeline and the story detail UI.

Two layers:
  1. `DEFAULT_TEMPLATE` — the global default every new project starts from.
     Edit here to change the app-wide baseline.
  2. Per-project overrides — stored as a `story_template` project_artifact.
     Use `get_project_template(project_id)` and `set_project_template(project_id, template)`
     to read/write.

Used by:
  - grooming_engine — output schema the BA agent produces stories against
  - frontend story detail modal — rendered as editable fields
  - Jira push — maps template fields to Jira field IDs

Every field has:
  - `key`: canonical name used in code and JSON
  - `label`: human-readable UI label
  - `placeholder`: example text shown in the form
  - `field_type`: "text" | "textarea" | "select" | "number" | "tags" | "markdown"
  - `required`: whether grooming agents must populate it
  - `group`: visual grouping in the UI ("core" | "planning" | "quality" | "odc")
  - `options`: for "select" fields
  - `help`: tooltip explanation
  - `jira_field`: Jira field ID to push to (None = not pushed)

Story types (story/bug/spike/tech-debt) are tracked via the `type` field
rather than separate templates — same shape, different tag.
"""
from __future__ import annotations
import json
from datetime import datetime
from typing import List, Dict, Any, Optional


DEFAULT_TEMPLATE: List[Dict[str, Any]] = [
    # ── Core ──────────────────────────────────────────────────────────────
    {
        "key": "title",
        "label": "Title",
        "placeholder": "Short, action-oriented story title",
        "field_type": "text",
        "required": True,
        "group": "core",
        "help": "A developer reading only the title should grok what the story delivers.",
        "jira_field": "summary",
    },
    {
        "key": "story",
        "label": "User Story",
        "placeholder": "As a [persona], I want to [action], so that [value].",
        "field_type": "textarea",
        "required": True,
        "group": "core",
        "help": "Classic connextra format. Keep the 'so that' concrete — it's the success criteria.",
        "jira_field": "description",
    },
    {
        "key": "acceptance_criteria",
        "label": "Acceptance Criteria",
        "placeholder": "Given [context]\\nWhen [action]\\nThen [outcome]",
        "field_type": "markdown",
        "required": True,
        "group": "core",
        "help": "Given/When/Then format. At least 3 scenarios including one negative path.",
        "jira_field": "customfield_ac",
    },
    {
        "key": "story_points",
        "label": "Story Points",
        "placeholder": "1, 2, 3, 5, 8, 13",
        "field_type": "select",
        "options": ["1", "2", "3", "5", "8", "13", "21", "?"],
        "required": True,
        "group": "core",
        "help": "Fibonacci-ish sizing. > 13 means split.",
        "jira_field": "customfield_story_points",
    },
    {
        "key": "priority",
        "label": "Priority",
        "placeholder": "Must / Should / Could / Won't (MoSCoW)",
        "field_type": "select",
        "options": ["Must", "Should", "Could", "Won't"],
        "required": True,
        "group": "core",
        "help": "MoSCoW. Must = blocks release; Could = nice-to-have.",
        "jira_field": "priority",
    },
    {
        "key": "type",
        "label": "Type",
        "placeholder": "story / bug / spike / tech-debt",
        "field_type": "select",
        "options": ["story", "bug", "spike", "tech-debt"],
        "required": True,
        "group": "core",
        "help": "Story = new functionality. Bug = defect. Spike = research. Tech-debt = non-functional cleanup.",
        "jira_field": "issuetype",
    },

    # ── Planning ──────────────────────────────────────────────────────────
    {
        "key": "epic",
        "label": "Epic",
        "placeholder": "Parent epic ID (auto-assigned by grooming)",
        "field_type": "text",
        "required": False,
        "group": "planning",
        "help": "The high-level capability theme this story rolls up to.",
        "jira_field": "customfield_epic_link",
    },
    {
        "key": "feature",
        "label": "Feature",
        "placeholder": "Parent feature ID",
        "field_type": "text",
        "required": False,
        "group": "planning",
        "help": "The coherent capability unit within the epic.",
        "jira_field": None,   # Jira flattens features into labels typically
    },
    {
        "key": "labels",
        "label": "Labels",
        "placeholder": "auth, gdpr, mobile",
        "field_type": "tags",
        "required": False,
        "group": "planning",
        "help": "Free-form tags. Grooming agents propose some automatically.",
        "jira_field": "labels",
    },
    {
        "key": "dependencies",
        "label": "Dependencies",
        "placeholder": "Story IDs this one blocks / is blocked by",
        "field_type": "tags",
        "required": False,
        "group": "planning",
        "help": "Populated by Sequence stage of grooming. 'blocked_by' = this can't start until that finishes.",
        "jira_field": None,   # pushed as Jira issue links, not fields
    },

    # ── Quality & Risk ────────────────────────────────────────────────────
    {
        "key": "definition_of_done",
        "label": "Definition of Done",
        "placeholder": "- Unit tests pass\\n- Reviewed by 2 engineers\\n- Docs updated\\n- QA signed off",
        "field_type": "markdown",
        "required": False,
        "group": "quality",
        "help": "Per-story DoD on top of the team-wide DoD. Include anything story-specific.",
        "jira_field": None,
    },
    {
        "key": "risks_assumptions",
        "label": "Risks & Assumptions",
        "placeholder": "Risks that could derail this story; assumptions we're making",
        "field_type": "markdown",
        "required": False,
        "group": "quality",
        "help": "Forces grooming agents to think about what could go wrong. Reviewed at sprint planning.",
        "jira_field": None,
    },
    {
        "key": "nfr_notes",
        "label": "Non-Functional Notes",
        "placeholder": "Performance, security, accessibility, compliance considerations",
        "field_type": "markdown",
        "required": False,
        "group": "quality",
        "help": "Cross-cutting concerns that apply to THIS story beyond the team-wide NFR baseline.",
        "jira_field": None,
    },

    # ── ODC Mentor 2.0 ────────────────────────────────────────────────────
    {
        "key": "odc_entities",
        "label": "ODC Entities Touched",
        "placeholder": "User, Role, AuditLog",
        "field_type": "tags",
        "required": False,
        "group": "odc",
        "help": "OutSystems entities this story reads or writes. Populated by OutSystems Architect during grooming.",
        "jira_field": None,
    },
    {
        "key": "odc_screens",
        "label": "ODC Screens",
        "placeholder": "LoginScreen, ProfileScreen",
        "field_type": "tags",
        "required": False,
        "group": "odc",
        "help": "OutSystems screens/blocks this story modifies or adds.",
        "jira_field": None,
    },
    {
        "key": "mentor_prompt",
        "label": "ODC Mentor 2.0 Prompt",
        "placeholder": "(Auto-generated by grooming — click Regenerate to refresh)",
        "field_type": "markdown",
        "required": False,
        "group": "odc",
        "help": "Paste this directly into ODC Mentor 2.0 to scaffold the story. Grounded in the project's OutSystems blueprint when available.",
        "jira_field": None,
    },
    {
        "key": "mentor_prompt_history",
        "label": "Mentor Prompt History",
        "placeholder": "",
        "field_type": "history",           # special — not user-editable
        "required": False,
        "group": "odc",
        "help": "Last 3 generated versions. Click to revert.",
        "jira_field": None,
    },
]


# ─── Template helpers ────────────────────────────────────────────────────────

def template_by_group(template: Optional[List[Dict[str, Any]]] = None) -> Dict[str, List[Dict[str, Any]]]:
    """Group fields by their `group` key for UI rendering."""
    fields = template or DEFAULT_TEMPLATE
    out: Dict[str, List[Dict[str, Any]]] = {}
    for f in fields:
        out.setdefault(f.get("group", "core"), []).append(f)
    return out


def required_field_keys(template: Optional[List[Dict[str, Any]]] = None) -> List[str]:
    """Return the list of keys that grooming agents MUST populate."""
    return [f["key"] for f in (template or DEFAULT_TEMPLATE) if f.get("required")]


def empty_story(template: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """An empty story instance matching the template shape. Every field
    initialised to "" (or [] for tags/history).
    """
    out: Dict[str, Any] = {}
    for f in (template or DEFAULT_TEMPLATE):
        t = f.get("field_type", "text")
        if t in ("tags", "history"):
            out[f["key"]] = []
        else:
            out[f["key"]] = ""
    return out


def jira_field_map(template: Optional[List[Dict[str, Any]]] = None) -> Dict[str, str]:
    """Return {canonical_key: jira_field_id} for fields that push to Jira.

    Note: the Jira field IDs here are placeholders (e.g. 'customfield_ac').
    The actual Jira instance's field IDs are discovered at push time via
    /rest/api/3/field and matched by name. This map just records intent.
    """
    return {f["key"]: f["jira_field"] for f in (template or DEFAULT_TEMPLATE) if f.get("jira_field")}


# ─── DB read/write helpers ───────────────────────────────────────────────────
# Per-project overrides live as a `story_template` project_artifact. There is
# at most one active row per project. Soft-delete to archive old versions.

def serialize_template(template: List[Dict[str, Any]]) -> str:
    """JSON serialise the template with stable key ordering."""
    return json.dumps(template, indent=2, sort_keys=False)


def deserialize_template(raw: str) -> List[Dict[str, Any]]:
    """Parse a stored template. Returns DEFAULT_TEMPLATE on any error."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list) and all(isinstance(f, dict) and "key" in f for f in parsed):
            return parsed
    except Exception:
        pass
    return DEFAULT_TEMPLATE


def merged_template(
    project_override: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Return the effective template: project override if present, else default.

    Future enhancement: partial merges where a project adds a field or tweaks
    a label without redefining the whole template. Not needed for v1.
    """
    return project_override if project_override else DEFAULT_TEMPLATE
