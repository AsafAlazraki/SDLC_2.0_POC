// Section 8 — Functional Requirements
const H = require('./_helpers');

module.exports = [
  H.h1('8. Functional Requirements'),

  H.p('Functional requirements are grouped by product module. Each requirement has a stable ID (FR-x.y.z) that downstream test cases and implementation tasks reference. Where the reference Python implementation already behaves as described, that is called out; requirements marked "NEW" are additions required for v1.0 that were not in the reference implementation.'),

  // ─── 8.1 Project Workspace ───────────────────────────────────────────
  H.h2('8.1 Project Workspace'),
  H.p('A Project is the top-level unit of work. It groups everything the tool knows about a single engagement: raw materials, grooming runs, the groomed backlog, living documents, Jira configuration, and push history. Projects can be nested (sub-projects inherit materials from parents) but nesting is optional.'),

  H.h3('8.1.1 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.1.1', 'The system MUST allow a user to create a project with name, description, goal, and optional client tag.', 'Must', 'Reference: POST /api/projects'],
      ['FR-8.1.2', 'The system MUST allow a user to create a sub-project under an existing project.', 'Should', 'inherits_materials flag toggles parent-material inheritance.'],
      ['FR-8.1.3', 'The system MUST list all projects the current user has access to, newest first.', 'Must', 'Soft-deleted projects excluded by default.'],
      ['FR-8.1.4', 'The system MUST render a project detail view with tabs: Overview, Materials, Runs, Artefacts, Backlog, Groomed Backlog, Documents.', 'Must', 'Groomed Backlog tab is the Phase 12 surface.'],
      ['FR-8.1.5', 'The system MUST display project-level counts (materials, runs, artefacts, sub-projects) on the header.', 'Should', 'Quick visual signal of engagement maturity.'],
      ['FR-8.1.6', 'The system MUST support optional project metadata fields for budget_range, timeline, and path_preference (Conservative/Balanced/Transformative).', 'Should', 'Consumed by grooming agents to produce budget-aware recommendations.'],
      ['FR-8.1.7', 'The system MUST allow a user to archive (soft-delete) a project.', 'Must', 'Archived projects hidden from the default list but recoverable.'],
      ['FR-8.1.8', 'The system SHOULD allow a user to edit project name, description, and goal post-creation.', 'Should', 'Goal edits propagate to grooming context.'],
    ],
    [1100, 4900, 900, 2460],
  ),

  // ─── 8.2 Requirements Intake ─────────────────────────────────────────
  H.h2('8.2 Requirements Intake'),
  H.p('Intake is the first step of the grooming journey. A user uploads a CSV, TSV, or Excel file; the system parses it, normalises headers, runs LLM-based column auto-detection, and presents a mapping preview the user can accept or override.'),

  H.h3('8.2.1 Supported Formats'),
  H.table(
    ['Extension', 'Supported', 'Parser', 'Notes'],
    [
      ['.csv', 'Yes', 'Python csv / OutSystems CSV library', 'UTF-8 assumed; BOM handled; comma or user-selected delimiter'],
      ['.tsv', 'Yes', 'Same', 'Tab delimiter'],
      ['.xlsx', 'Yes', 'openpyxl / OutSystems Excel Utils', 'Modern Excel; first non-empty sheet preferred, "Requirements" sheet if found'],
      ['.xlsm', 'Yes', 'Same', 'Macro-enabled Excel; macros ignored, cells only'],
      ['.xls', 'No', 'n/a', 'Legacy format; user must save as .xlsx first'],
      ['.pdf / .docx', 'No (v1.0)', 'n/a', 'Exported to CSV by user; direct support on v1.2 roadmap'],
    ],
    [1200, 1000, 2600, 4560],
  ),

  H.h3('8.2.2 Size and Row Limits'),
  H.table(
    ['Limit', 'Value', 'Rationale'],
    [
      ['Max file size', '10 MB', 'Covers ~2,000-row Excel with typical column counts'],
      ['Soft row count warning', '1,000 rows', 'User is warned grooming will take longer and cost more'],
      ['Hard row count limit', '5,000 rows', 'Rejected; user must split the file'],
      ['Chunked-grooming threshold', '500 rows (NEW enhancement)', 'Auto-chunks into cluster batches to keep per-prompt size bounded'],
    ],
    [2500, 2500, 4360],
  ),

  H.h3('8.2.3 Column Auto-Detection'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.2.1', 'On upload, the system MUST parse the header row plus first 5 data rows.', 'Must', ''],
      ['FR-8.2.2', 'The system MUST call a large language model to map source columns onto 9 canonical fields: id, description, priority, source, type, notes, acceptance, owner, tags.', 'Must', 'Gemini 2.0 Flash primary; Claude Sonnet fallback'],
      ['FR-8.2.3', 'The LLM response MUST be validated against the canonical field schema. Invalid responses trigger heuristic fallback.', 'Must', 'Rule: description field MUST be mapped or fallback is invoked'],
      ['FR-8.2.4', 'The heuristic fallback MUST match source columns by case-insensitive substring against a known keyword dictionary.', 'Must', 'Dictionary extensible via configuration'],
      ['FR-8.2.5', 'If heuristic fails to find a description column, the system MUST pick the column with the longest average string length across first 20 rows.', 'Must', 'Ultimate fallback; never produces an unmapped description'],
      ['FR-8.2.6', 'The mapping preview MUST render one editable select per canonical field with the source columns as options plus "— unmapped —".', 'Must', ''],
      ['FR-8.2.7', 'The UI MUST flag required fields as missing with a visible warning badge until mapped.', 'Must', 'description is the only hard-required field'],
      ['FR-8.2.8', 'Unmapped source columns MUST be listed visibly so the user understands what data is being ignored.', 'Must', ''],
      ['FR-8.2.9', 'The system MUST allow the user to edit the mapping and persist the edit back to the upload row (best-effort).', 'Must', 'Failure to persist is non-fatal; mapping can be passed inline to grooming'],
      ['FR-8.2.10', 'The system MUST allow the user to proceed with grooming using the inline mapping even if persistence fails.', 'Must', 'Learned from 751-row upload bug during reference-implementation testing'],
    ],
    [1100, 5700, 900, 1660],
  ),

  H.h3('8.2.4 Smart Duplicate Detection (NEW)'),
  H.p('When a project already has a prior upload, the system applies duplicate detection to the new upload. This is the v1.0 enhancement that unlocks the revision workflow.'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.2.11', 'On a second or subsequent upload, the system MUST compare rows to the most recent prior upload.', 'Must', ''],
      ['FR-8.2.12', 'Duplicate detection MUST use three signals in order: exact id match, exact description match, high semantic similarity (cosine similarity ≥ 0.85 on a short embedding of description + notes).', 'Must', 'NEW — reference implementation did not have this'],
      ['FR-8.2.13', 'The system MUST present a Diff Preview with sections NEW / CHANGED / GONE before grooming begins.', 'Must', 'Same approve-changes pattern as specialist spawning in Phase 7B'],
      ['FR-8.2.14', 'The user MUST be able to approve, reject, or flag-for-review each detected change.', 'Must', ''],
      ['FR-8.2.15', 'Grooming runs only on rows the user has approved as NEW or CHANGED; prior groomed stories tied to GONE rows are archived with a status transition (see Section 13).', 'Must', ''],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.3 Story Template Management ───────────────────────────────────
  H.h2('8.3 Story Template Management'),
  H.p('The story template is the field contract the grooming pipeline produces against and the story detail Popup edits against. It is an ordered list of field descriptors with type, validation, and (where applicable) Jira mapping.'),

  H.h3('8.3.1 Default Template'),
  H.p('The default template ships with 17 fields in 4 groups. It encodes industry best practices: Connextra-format user story, Given/When/Then acceptance criteria, Fibonacci story points, MoSCoW priority. Full field specification in Appendix B.'),

  H.h3('8.3.2 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.3.1', 'The system MUST provide a built-in default template with the 17 fields specified in Appendix B.', 'Must', ''],
      ['FR-8.3.2', 'The system MUST allow a user to override the default on a per-project basis.', 'Must', ''],
      ['FR-8.3.3', 'Overrides MUST be versioned — editing an override creates a new revision and archives the old.', 'Must', 'Historical groomed stories preserved in their original shape'],
      ['FR-8.3.4', 'The UI MUST display an indicator on the Upload view showing which template (default or override) is in use, with a summary of field count and groups.', 'Must', ''],
      ['FR-8.3.5', 'The system MUST ship a Template Library (NEW) with pre-built templates for common domains: Government/Public Sector, Financial Services, Healthcare, Telecoms, Retail, Generic-Agile.', 'Should', 'User can clone any library template as their project override and edit'],
      ['FR-8.3.6', 'The API MUST expose the effective template for any project so the UI and grooming agents can consume the same source of truth.', 'Must', 'GET /api/projects/{id}/story-template returns {template, is_override, default}'],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.4 Agent-Driven Grooming Pipeline ──────────────────────────────
  H.h2('8.4 Agent-Driven Grooming Pipeline'),
  H.p('The core capability. Five sequential stages orchestrate six collaborating agents to transform a list of normalised requirements into a full Epic → Feature → Story hierarchy with dependencies, a multi-dev schedule, and Mentor prompts. The pipeline emits SSE-style progress events so the UI can render live status.'),

  H.h3('8.4.1 Stages Overview'),
  H.table(
    ['Stage', 'Inputs', 'Output', 'LLM calls', 'Typical duration'],
    [
      ['1. Intake', 'Normalised requirements', 'Deduped, validated requirement list + warnings', '0 (pure compute)', '< 1 s'],
      ['2. Cluster', 'Up to 200 sampled requirements', 'Epic → Feature → requirement_ids tree', '1 (Sonnet)', '60–180 s'],
      ['3. Draft', 'Each feature with its requirements', '2–6 stories per feature', '1 per feature (Sonnet)', '30 s per feature × N'],
      ['4. Enrich', 'Feature + its drafted stories', 'Stories with PM/Architect/Tech Lead/OS notes', '5 per feature (Sonnet)', '45–90 s per feature × N'],
      ['5. Sequence', 'All enriched stories', 'Dependency graph + critical path + schedule + Mentor prompts', '0 (pure compute) + 1 per story optional', '< 5 s base; +2 s per Mentor prompt if LLM-refined'],
    ],
    [1200, 2000, 2500, 1500, 2160],
  ),

  H.h3('8.4.2 Agents'),
  H.p('Six agents collaborate. BA is the drafter; the other five enrich in parallel per feature.'),
  H.table(
    ['Agent', 'Stage', 'Contribution', 'Fields populated'],
    [
      ['Business Analyst', 'Draft', 'Writes 2–6 stories per feature in Connextra format with Given/When/Then AC, Fibonacci points, MoSCoW priority, story type', 'title, story, acceptance_criteria, story_points, priority, type, requirement_source_ids'],
      ['Product Manager', 'Enrich', 'Reviews priority and adds business outcome + success metric + priority rationale', 'priority (may override BA), success_metric, business_outcome, priority_rationale'],
      ['Solutions Architect', 'Enrich', 'Adds NFR considerations and technical approach; flags architectural risk', 'nfr_notes, technical_approach, risks_assumptions (append)'],
      ['Tech Lead', 'Enrich (batch)', 'Detects cross-story dependencies within the feature; flags stories that should be split', 'dependencies, split_suggestions'],
      ['OutSystems Architect', 'Enrich', 'Identifies ODC entities/screens touched; flags Forge component opportunities; adds platform notes', 'odc_entities, odc_screens, forge_opportunities, platform_notes'],
      ['OutSystems Migration', 'Enrich', 'Adds migration phase (early/mid/late/any), migration risks, legacy-system dependencies', 'migration_phase, migration_risks, legacy_dependencies, risks_assumptions (append)'],
    ],
    [1800, 1200, 3400, 2960],
  ),

  H.h3('8.4.3 Stage Details'),

  H.h4('Stage 1 — Intake'),
  H.bullet('Pure computation; no LLM call.'),
  H.bullet('Drops rows with empty descriptions. Dedupes by requirement id.'),
  H.bullet('Emits a warning per dropped row.'),
  H.bullet('Aborts the pipeline if 0 usable requirements remain.'),

  H.h4('Stage 2 — Cluster'),
  H.bullet('Single Sonnet call with max_tokens 10,000.'),
  H.bullet('Receives up to 200 requirement descriptions in the prompt (larger uploads chunk — see Enhancement 8.11.11).'),
  H.bullet('Returns strict JSON: epics array, each with feature array, each with requirement_ids array.'),
  H.bullet('If JSON is malformed, one corrective retry: prompt is appended with "Return ONLY a JSON object starting with {, no prose, no fences".'),
  H.bullet('On second failure, abort with grooming_error event carrying the stage name and the first 600 chars of the model response.'),

  H.h4('Stage 3 — Draft'),
  H.bullet('One Sonnet call per feature, parallelised within the Anthropic concurrent-call limit (semaphore of 2).'),
  H.bullet('Input: epic title/description, feature title/description, the feature’s contained requirements verbatim, prior stories summary (if this is a re-groom).'),
  H.bullet('Output: 2–6 stories per feature with the Draft-stage fields populated.'),
  H.bullet('Stories reference requirement_source_ids so traceability to the customer’s original rows is preserved (consumed later by the coverage heatmap).'),

  H.h4('Stage 4 — Enrich'),
  H.bullet('For each feature, the 5 enrichment agents run concurrently. Tech Lead receives the batch of drafted stories for cross-story analysis. Others receive each story individually.'),
  H.bullet('Each agent returns a structured patch. The pipeline merges patches into each story; later-running agents do not overwrite earlier fields unless they are explicitly authorised (e.g. PM may override priority with rationale).'),
  H.bullet('Enrichment failures per agent are non-fatal; the story retains whatever other agents produced.'),

  H.h4('Stage 5 — Sequence'),
  H.bullet('Flattens all stories across all epics and features into a single list with stable indices.'),
  H.bullet('Resolves intra-feature Tech Lead dependencies (target_index) into global dependency edges.'),
  H.bullet('Detects cycles; aborts with a grooming_error if any exist. Otherwise computes the critical path via DP over the dependency DAG in points units.'),
  H.bullet('Computes the multi-dev schedule (see 8.7).'),
  H.bullet('Generates the ODC Mentor 2.0 prompt per story (see 8.8).'),

  H.h3('8.4.4 SSE Event Stream'),
  H.p('The pipeline streams events to the UI in real time. The frontend displays stage-by-stage progress and, critically, surfaces honest end-of-stream status (complete with counts, or specific error). Event schemas:'),
  ...H.code(`event: grooming_started
data: {"stages": [...], "total_requirements": 748, "agents": [...]}

event: grooming_stage
data: {"stage": "intake", "status": "running", "message": "Validating..."}

event: grooming_stage
data: {"stage": "intake", "status": "complete", "message": "748 requirements ready for grooming.", "warnings": [...]}

event: grooming_epics
data: {"epics": [...], "orphan_ids": []}

event: grooming_stories
data: {"epic_key": "EPIC-001", "feature_key": "FEAT-001", "feature_title": "...", "stories": [...], "progress": {"current": 3, "total": 23}}

event: grooming_enriched
data: {"epic_key": "EPIC-001", "feature_key": "FEAT-001", "stories": [...]}

event: grooming_sequence
data: {"critical_path_indices": [0, 5, 7, 23], "dependency_graph": {...}, "multi_dev_schedule": {...}}

event: grooming_complete
data: {"epic_count": 7, "feature_count": 23, "story_count": 118, "critical_path_length": 14, "predicted_sprint_count": 9, "enriched_epics": [...]}

event: grooming_persisted
data: {"ok": true}

event: grooming_error
data: {"stage": "cluster", "message": "Sonnet returned malformed JSON after 2 attempts; first 600 chars: ..."}`),

  H.h3('8.4.5 Fairness & Fallback'),
  H.p('The pipeline is resilient to individual agent failures. If PM enrichment fails for a story, that story still ships with BA + Architect + Tech Lead + OS output. If the Sonnet call itself fails (rate limit, 529 overload), the retry loop at the transport layer applies (3 attempts with 15s/30s/60s backoff; then Gemini fallback for agents whose fallback path is defined).'),
  H.p('The OutSystems rebuild MUST preserve these fallback semantics. Section 18.7 describes the OutSystems-native implementation of the retry and circuit-breaker behaviour.'),

  // ─── 8.5 Backlog Hierarchy Management ─────────────────────────────────
  H.h2('8.5 Backlog Hierarchy Management'),
  H.p('The groomed output is organised as a three-level hierarchy: Epic → Feature → Story. All three levels share a common storage shape (backlog_item) distinguished by a `level` attribute. This simplifies rendering and allows the existing Kanban view to extend with grouping.'),

  H.h3('8.5.1 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.5.1', 'The system MUST render the groomed backlog as a collapsible Epic → Feature → Story tree.', 'Must', 'Each level is individually collapsible'],
      ['FR-8.5.2', 'Each story MUST display badges for type, priority, point value, dependency count, and ODC entity chips.', 'Must', 'Visual signal at tree level without opening the story'],
      ['FR-8.5.3', 'Clicking any story MUST open the Story Detail Popup.', 'Must', 'Screen spec in Section 11.5'],
      ['FR-8.5.4', 'Stories MUST be editable across all template fields from the detail Popup.', 'Must', 'PATCH /api/projects/{id}/backlog-items/{itemId}'],
      ['FR-8.5.5', 'Epics and Features MUST be editable (title, description).', 'Should', 'Same PATCH Service Action; level preserved'],
      ['FR-8.5.6', 'Stories without a parent epic (orphans) MUST be rendered in a dedicated "Unassigned" section at the bottom.', 'Should', 'Only populated when user manually creates stories or agents fail to cluster a requirement'],
      ['FR-8.5.7', 'The system MUST allow a user to delete (soft-delete) any level.', 'Must', 'Soft-deleted items archived; cascade to children optional, user-prompted'],
      ['FR-8.5.8', 'The system MUST allow a user to re-parent a story to a different feature or epic.', 'Should', 'Drag-and-drop in tree view; validation warns on orphaning'],
      ['FR-8.5.9', 'The system SHOULD highlight stories flagged "needs review" distinctly (amber badge).', 'Should', 'Agent-flagged + user-flagged review items'],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.6 Dependency Graph & Critical Path ────────────────────────────
  H.h2('8.6 Dependency Graph & Critical Path'),

  H.h3('8.6.1 Data Model'),
  H.p('Dependencies are stored inline on each story as structured_data.dependencies, an array of {target_id, type, reason, added_by} objects. The type is either "blocks" (this story blocks the target) or "blocked_by" (this story is blocked by the target). added_by indicates whether the agent pipeline or a user created the dependency.'),

  H.h3('8.6.2 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.6.1', 'The system MUST auto-detect dependencies during the Tech Lead enrichment stage based on cross-story analysis within a feature.', 'Must', 'Tech Lead sees all drafted stories for a feature; identifies "Story A cannot start until Story B is done" patterns'],
      ['FR-8.6.2', 'The system MUST allow users to add, edit, and remove dependencies from the story detail view.', 'Must', 'PUT /api/projects/{id}/backlog-items/{id}/dependencies'],
      ['FR-8.6.3', 'The system MUST render the dependency graph as a Mermaid flowchart with nodes coloured by priority and critical-path nodes highlighted red.', 'Must', 'Reference implementation uses Mermaid v10'],
      ['FR-8.6.4', 'The system MUST compute the critical path as the longest dependency chain in points units via DP over the dependency DAG.', 'Must', 'Dijkstra-style, DAG-guaranteed by cycle detection'],
      ['FR-8.6.5', 'The system MUST detect and reject cycles in the dependency graph; the affected stories MUST be flagged for the user to resolve.', 'Must', 'No cycles = no critical path ambiguity'],
      ['FR-8.6.6', 'Users MUST be able to provide a reason when adding a dependency, captured in structured_data.dependencies.reason.', 'Must', 'Preserved in Jira push as the issue link comment'],
      ['FR-8.6.7', 'Users MUST be able to jump from a graph node to the story detail.', 'Should', 'Click-through improves explorability'],
      ['FR-8.6.8', 'The graph MUST re-render on any dependency change without a full page reload.', 'Must', ''],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.7 Multi-Dev Scheduling ────────────────────────────────────────
  H.h2('8.7 Multi-Dev Scheduling'),
  H.p('The scheduler computes a greedy topological assignment of stories to developers, respecting the dependency graph and sprint capacity. Every story has an earliest-start = max(developer\'s current load, max(blocker finish times)) — NOT simply the developer\'s load — so blocked stories start at the correct time even if the assigned developer is idle.'),

  H.h3('8.7.1 Algorithm'),
  H.p('1. Build a blocker map per story (story_id → set of story_ids it is blocked by). 2. Iterate: pull ready stories (no unsatisfied blockers) from the remaining pool. 3. Sort ready stories by MoSCoW priority, then points descending. 4. For each ready story, compute the earliest start across all developers and pick the one giving the earliest start time. 5. Record the assignment with start_points, end_points, sprint_num, and blocked_until. 6. Repeat until no stories remain or no ready stories can be found (cycle — should never happen post-validation).'),

  H.h3('8.7.2 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.7.1', 'The system MUST compute a multi-dev schedule given a developer count (default 3) and sprint capacity (default 13 points).', 'Must', ''],
      ['FR-8.7.2', 'The schedule MUST respect dependency order — a blocked story starts only when all its blockers finish.', 'Must', 'Bug fix lesson from reference implementation'],
      ['FR-8.7.3', 'Developer idle gaps (blocker not yet finished) MUST be visible in the Gantt.', 'Should', 'Tracked as blocked_until per assignment'],
      ['FR-8.7.4', 'The Gantt MUST render one horizontal lane per developer with stories positioned by start/end points.', 'Must', ''],
      ['FR-8.7.5', 'Critical-path stories MUST be visually distinct (red gradient) across the Gantt.', 'Must', ''],
      ['FR-8.7.6', 'The system MUST display predicted sprint count and total points above the Gantt.', 'Must', ''],
      ['FR-8.7.7', 'The system MUST allow the user to change dev count and sprint capacity and re-compute the schedule on demand.', 'Must', ''],
      ['FR-8.7.8', 'The system SHOULD provide a "what-if" simulator (NEW) letting the user disable specific stories or change priorities, preview the new schedule, and either accept or revert.', 'Should', 'See 8.11.7 for the full spec'],
      ['FR-8.7.9', 'The system MAY incorporate historical velocity (NEW) to predict calendar dates rather than point counts.', 'Should', 'See 8.11.6'],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.8 Mentor Prompt Generation ────────────────────────────────────
  H.h2('8.8 ODC Mentor 2.0 Prompt Generation'),
  H.p('For each groomed story the pipeline produces a developer-ready Mentor 2.0 prompt. The prompt is a Markdown document with six sections: Goal, Platform Context, Implementation Approach, Acceptance Criteria, Non-Functional Requirements, and Suggested ODC Structure. When the project has run the main Discovery Engine fleet, the OutSystems Architect\'s blueprint is embedded in the Platform Context section so the prompt is grounded in the actual codebase.'),

  H.h3('8.8.1 Template Sections'),
  H.table(
    ['Section', 'Content', 'Source'],
    [
      ['Goal', 'The user story in Connextra format', 'Story.story field'],
      ['Platform Context', 'Entities/services/screens known to exist; relevant architecture patterns', 'OutSystems Architect fleet findings (if available); generic ODC patterns otherwise'],
      ['Implementation Approach', 'Preferred implementation shape (reactive pattern, service action, etc.)', 'Architect enrichment agent output + template defaults'],
      ['Acceptance Criteria', 'The story’s Given/When/Then scenarios', 'Story.acceptance_criteria'],
      ['Non-Functional Requirements', 'Performance, security, accessibility considerations for THIS story', 'Architect enrichment agent output'],
      ['Suggested ODC Structure', 'Entities touched, screens affected, Forge components to consider', 'OS Architect enrichment output'],
    ],
    [2100, 4200, 3060],
  ),

  H.h3('8.8.2 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.8.1', 'The system MUST generate a Mentor prompt for every groomed story during the Sequence stage.', 'Must', ''],
      ['FR-8.8.2', 'The prompt MUST be Markdown-formatted, rendered as plain text to a monospace viewer.', 'Must', 'Copy-to-clipboard keeps formatting'],
      ['FR-8.8.3', 'The prompt MUST reference the project’s OutSystems Architect blueprint when available.', 'Must', 'Distinguishing value-add vs generic prompts'],
      ['FR-8.8.4', 'The prompt MUST be regeneratable from the story detail Popup.', 'Must', 'POST /api/projects/{id}/backlog-items/{id}/mentor-prompt/regenerate'],
      ['FR-8.8.5', 'The system MUST keep the last 3 versions of each story’s prompt. Older versions are discarded.', 'Must', 'Learned from reference implementation; users iterate the prompt and want to revert'],
      ['FR-8.8.6', 'The system MUST expose a prominent "Copy to Clipboard" action on the prompt.', 'Must', ''],
      ['FR-8.8.7', 'The system SHOULD expose a bulk export: all Mentor prompts in the backlog as a single Markdown document with per-story section headers.', 'Should', 'NEW — useful for batch developer handover'],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.9 Jira Integration ────────────────────────────────────────────
  H.h2('8.9 Jira Integration'),
  H.p('Jira Cloud is the default execution system of record. The platform supports configuring a target Jira project per platform-project and pushing the full groomed backlog with dependencies as issue links.'),

  H.h3('8.9.1 Configuration'),
  H.table(
    ['Field', 'Type', 'Required', 'Notes'],
    [
      ['domain', 'Text', 'Yes', 'e.g. acme.atlassian.net (no https://, no trailing slash)'],
      ['email', 'Email', 'Yes', 'Atlassian login email'],
      ['api_token', 'Secret', 'Yes', 'Generated at id.atlassian.com/manage-profile/security/api-tokens'],
      ['project_key', 'Text (uppercase)', 'Yes', 'e.g. ACM — must already exist in the target Jira instance'],
    ],
    [1500, 1800, 1200, 4860],
  ),

  H.h3('8.9.2 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.9.1', 'The system MUST store Jira configuration per project.', 'Must', 'Token encrypted at rest; never returned to frontend except masked'],
      ['FR-8.9.2', 'On save, the system MUST verify credentials via /rest/api/3/myself and the target project via /rest/api/3/project/{key} before persisting.', 'Must', 'Fail-fast — never save a broken config'],
      ['FR-8.9.3', 'The push operation MUST create epics first, then stories linked to epics, then dependency issue links.', 'Must', 'Three-phase ordering required by Jira referential integrity'],
      ['FR-8.9.4', 'Stories MUST map to Jira issue types per the canonical mapping: story→Story, bug→Bug, spike→Task, tech-debt→Task.', 'Must', 'Customisable per instance in future'],
      ['FR-8.9.5', 'MoSCoW priorities MUST map: Must→Highest, Should→High, Could→Medium, Won’t→Low.', 'Must', ''],
      ['FR-8.9.6', 'Story points MUST be pushed to the instance’s "Story Points" or "Story point estimate" custom field, discovered via /rest/api/3/field.', 'Must', 'Field ID cached on first push'],
      ['FR-8.9.7', 'Dependencies of type blocked_by MUST become Jira Blocks issue links.', 'Must', ''],
      ['FR-8.9.8', 'Push failures MUST be collected per item, not abort the push.', 'Must', 'Partial success is valuable'],
      ['FR-8.9.9', 'The system MUST log every push event as a jira_push_event artefact: counts, created keys, errors.', 'Must', 'Audit + debugging'],
      ['FR-8.9.10', 'The system MUST allow clearing the saved Jira config.', 'Must', 'Use case: rotating tokens, moving to a new Jira instance'],
      ['FR-8.9.11', 'Re-pushing an already-pushed backlog MUST update existing Jira issues rather than create duplicates.', 'Should', 'NEW vs reference implementation which always created new issues'],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.10 Re-upload & Diff Preview ───────────────────────────────────
  H.h2('8.10 Re-upload & Diff Preview'),
  H.p('The revision workflow. See Journey 7.2 for narrative context. This section specifies the formal contract.'),

  H.h3('8.10.1 Requirements'),
  H.table(
    ['ID', 'Requirement', 'Priority', 'Notes'],
    [
      ['FR-8.10.1', 'The system MUST detect when a new upload shares a project with prior uploads and offer the Diff Preview workflow.', 'Must', ''],
      ['FR-8.10.2', 'The Diff Preview MUST classify each row as NEW / CHANGED / GONE relative to the most recent prior upload.', 'Must', 'Matching via (id exact → description exact → semantic similarity)'],
      ['FR-8.10.3', 'The user MUST be able to approve, reject, or flag-for-review each classified change individually.', 'Must', ''],
      ['FR-8.10.4', 'Approved NEW rows MUST be routed to grooming as new requirements.', 'Must', ''],
      ['FR-8.10.5', 'Approved CHANGED rows MUST trigger a targeted re-draft of the affected stories, preserving user edits where the agents had not changed them.', 'Must', 'Merge policy: user edits win over fresh agent drafts on the same field'],
      ['FR-8.10.6', 'Approved GONE rows MUST archive their associated stories with status=GONE and a comment indicating the originating revision.', 'Must', 'Stories remain visible in the UI with a faded style; not re-pushed to Jira'],
      ['FR-8.10.7', 'Flag-for-review rows MUST halt at the preview and require explicit resolution before grooming proceeds.', 'Must', ''],
    ],
    [1100, 5700, 900, 1660],
  ),

  // ─── 8.11 ENHANCED Features ──────────────────────────────────────────
  H.h2('8.11 Enhanced Features (v1.0 Additions)'),
  H.p('The following features extend the reference implementation and are required for v1.0. Each is a discrete capability with its own requirements sub-list.'),

  H.h3('8.11.1 Smart Duplicate Detection'),
  H.p('Beyond the Diff Preview (which compares across uploads), duplicate detection operates within a single upload and within the current backlog. It catches the customer-side duplicate (same requirement filed under two different IDs) and the agent-side duplicate (two stories with near-identical AC).'),
  H.bullet('FR-8.11.1.1 — The system MUST compare every pair of requirements within a single upload using embedding cosine similarity with a default threshold of 0.88.'),
  H.bullet('FR-8.11.1.2 — Detected duplicates MUST surface in the mapping preview as a warning the user can resolve (merge, keep both, flag).'),
  H.bullet('FR-8.11.1.3 — After grooming, stories with near-identical AC (cosine ≥ 0.90 on the AC text) MUST be flagged as potential duplicates in the hierarchy view.'),

  H.h3('8.11.2 Story Quality Scoring'),
  H.p('Each story receives three quality sub-scores — Clarity, Completeness, Testability — each on a 0–100 scale, computed from structural signals and a lightweight LLM review.'),
  H.table(
    ['Sub-score', 'Signals', 'Threshold "good"'],
    [
      ['Clarity', 'Connextra format present, persona named, "so that" clause non-trivial, no jargon without definition', '\u2265 75'],
      ['Completeness', 'AC count \u2265 3; includes negative path; DoD populated; NFR notes present; ODC fields populated when OS project', '\u2265 80'],
      ['Testability', 'AC expressed as Given/When/Then with concrete values; avoids "should work"; success state observable', '\u2265 70'],
    ],
    [1900, 5000, 2460],
  ),
  H.bullet('FR-8.11.2.1 — Scores MUST display as badges on each story card in the hierarchy view.'),
  H.bullet('FR-8.11.2.2 — Low-scoring stories (any sub-score below threshold) MUST be visually distinguished (amber border).'),
  H.bullet('FR-8.11.2.3 — Clicking a score MUST show the specific reason(s) for the deduction.'),

  H.h3('8.11.3 Inline AI Refinement'),
  H.p('In the story detail Popup, the BA can enter a natural-language instruction ("make the AC more specific about error handling") and a focused agent call refines the story accordingly. The interaction is conversational — each refinement message appends to a per-story refinement history.'),
  H.bullet('FR-8.11.3.1 — The story detail Popup MUST expose a "Refine with AI" panel with a text input, submit button, and scrollable history.'),
  H.bullet('FR-8.11.3.2 — Each refinement MUST call the BA enrichment agent with the current story state + the instruction, and propose diffs the user accepts or rejects.'),
  H.bullet('FR-8.11.3.3 — Accepted refinements MUST update the story fields and append a refinement_history entry.'),
  H.bullet('FR-8.11.3.4 — Refinement history MUST be capped at the last 10 entries per story.'),

  H.h3('8.11.4 Template Library'),
  H.p('Ship with pre-built story templates tuned for high-regulation domains. Users can clone a library template into their project, then edit the copy.'),
  H.table(
    ['Library template', 'Added fields', 'Use case'],
    [
      ['Generic Agile (default)', '17 fields as per Appendix B', 'Any engagement'],
      ['Government / Public Sector', 'regulatory_reference, data_residency, accessibility_level (WCAG 2.2 A/AA/AAA)', 'Federal, state, local govt'],
      ['Financial Services', 'sox_impact, pii_classification, pci_touchpoint, audit_requirements', 'Banks, insurers, payment processors'],
      ['Healthcare', 'phi_classification (HIPAA), hl7_fhir_relevance, clinical_safety_case', 'Providers, payers, health-tech'],
      ['Telecoms', 'telecom_regulator, network_impact_class (1–4), sla_tier', 'Carriers, network equipment vendors'],
      ['Retail', 'pci_scope, gdpr_article_relevance, seasonal_peak_class', 'E-commerce, brick-and-mortar chains'],
    ],
    [2600, 3700, 3060],
  ),

  H.h3('8.11.5 Stakeholder Approval Workflow'),
  H.p('Before grooming fires on the full requirements set, the customer can be asked to approve the proposed Epic / Feature structure. This catches clustering mistakes early and involves the customer in the shape of the backlog they will accept.'),
  H.bullet('FR-8.11.5.1 — The system MUST allow the BA to send an Approval Request to one or more named stakeholders after the Cluster stage but before Draft starts.'),
  H.bullet('FR-8.11.5.2 — Approval Requests MUST include a summary of each Epic and Feature in plain English, with an action for the stakeholder to Approve / Request Changes / Flag for Discussion.'),
  H.bullet('FR-8.11.5.3 — Delivery MUST be via email link with tokenised URL (no password login required) + optional in-app inbox for users with accounts.'),
  H.bullet('FR-8.11.5.4 — Grooming MUST NOT proceed until all Approval Requests are resolved or the BA explicitly overrides.'),
  H.bullet('FR-8.11.5.5 — Stakeholder comments MUST attach to the originating Epic or Feature so grooming agents see them as context when Draft fires.'),

  H.h3('8.11.6 Velocity-Based Delivery Predictions'),
  H.p('When a project has at least one completed sprint in Jira, pull the velocity data (story points completed per sprint per dev) and use it to convert the point-based schedule into calendar-based predictions.'),
  H.bullet('FR-8.11.6.1 — The system MUST query Jira for completed sprints associated with the configured project and compute per-dev velocity.'),
  H.bullet('FR-8.11.6.2 — Where velocity data is absent, the system MUST use a default assumed velocity (configurable; ship with 8 points/dev/sprint).'),
  H.bullet('FR-8.11.6.3 — The Multi-Dev Gantt MUST show calendar dates (start of sprint, end of sprint) overlaid on the points-based bars when velocity is known.'),
  H.bullet('FR-8.11.6.4 — Predictions MUST include a confidence band (e.g. "Sprint 7 start, ± 1 sprint, based on 4 observed sprints of data"). No false precision.'),

  H.h3('8.11.7 What-If Simulator'),
  H.p('A live, interactive view where the Product Owner can toggle scenarios and see the schedule shift in real time without persisting changes.'),
  H.bullet('FR-8.11.7.1 — The What-If Simulator MUST be accessible from the Multi-Dev Schedule view.'),
  H.bullet('FR-8.11.7.2 — The user MUST be able to toggle: dev count, sprint capacity, inclusion/exclusion of specific epics or features, priority overrides per story.'),
  H.bullet('FR-8.11.7.3 — Changes MUST recompute the schedule and critical path within 200 ms (target) on a 500-story backlog.'),
  H.bullet('FR-8.11.7.4 — Users MUST be able to save a scenario with a name for later recall or sharing.'),
  H.bullet('FR-8.11.7.5 — "Accept this scenario" MUST apply the changes to the persistent backlog (with confirmation Popup).'),

  H.h3('8.11.8 Requirement Coverage Heatmap'),
  H.p('A visual matrix answering: for each original requirement, which story or stories derived from it? Which requirements produced zero stories (coverage gaps)?'),
  H.bullet('FR-8.11.8.1 — The heatmap MUST display one row per original requirement, coloured by coverage depth (0 stories=red, 1 story=amber, 2+=green).'),
  H.bullet('FR-8.11.8.2 — Clicking a requirement MUST show the derived stories; clicking a story MUST show its source requirement(s).'),
  H.bullet('FR-8.11.8.3 — Uncovered requirements MUST be explicitly listed so the BA can add stories manually or re-run grooming with an adjusted scope.'),

  H.h3('8.11.9 Gherkin / .feature Export'),
  H.p('Export all acceptance criteria across the backlog as a structured set of Gherkin .feature files, one per Feature, ready for BDD tooling (Cucumber, SpecFlow, Behat, pytest-bdd).'),
  H.bullet('FR-8.11.9.1 — The system MUST provide an export action producing a ZIP of .feature files.'),
  H.bullet('FR-8.11.9.2 — Each .feature file MUST contain one Feature declaration and one Scenario per Given/When/Then set from the associated stories.'),
  H.bullet('FR-8.11.9.3 — Scenarios MUST preserve the story ID and title as Gherkin tags for traceability.'),

  H.h3('8.11.10 Cross-Project Reusable Epics'),
  H.p('Tag an epic as reusable; other projects with similar domain characteristics can browse and clone it as a starting point.'),
  H.bullet('FR-8.11.10.1 — Any epic MUST be taggable as "Reusable" via a boolean on its structured_data.'),
  H.bullet('FR-8.11.10.2 — The Template Library UI MUST expose a "Borrow" pane listing reusable epics from other projects the user has access to.'),
  H.bullet('FR-8.11.10.3 — Cloning a reusable epic MUST copy the epic and all its features/stories into the current project, stripped of project-specific context (requirement_source_ids, Jira keys, dependencies), and flag them as "borrowed, needs review".'),

  H.h3('8.11.11 Chunked Grooming for Large Uploads'),
  H.p('Uploads over 500 rows exceed what a single Cluster-stage Sonnet call can handle reliably. The system chunks the requirements into batches of ~200, clusters each batch, merges the resulting epics (de-duping similar themes), and proceeds.'),
  H.bullet('FR-8.11.11.1 — The system MUST detect uploads > 500 rows and invoke the chunked grooming path automatically.'),
  H.bullet('FR-8.11.11.2 — Chunks MUST be cluster-grouped by initial keyword similarity to keep each chunk thematically coherent.'),
  H.bullet('FR-8.11.11.3 — Per-chunk epics MUST be merged by a second Sonnet call that dedupes themes and reconciles overlapping features.'),
  H.bullet('FR-8.11.11.4 — The user MUST see per-chunk progress in the live progress panel.'),

  H.h3('8.11.12 Confidence Badges'),
  H.p('Each story receives a confidence badge expressing the pipeline’s certainty that the story is correct and complete. The badge is derived from: (a) number of enrichment agents that succeeded vs. failed for this story, (b) quality scores (8.11.2), (c) whether Tech Lead flagged it with split_suggestions.'),
  H.table(
    ['Badge', 'Criteria', 'Display'],
    [
      ['High', 'All 5 enrichment agents succeeded, all quality sub-scores above threshold, no split suggestions', 'Green check'],
      ['Medium', 'One enrichment agent failed OR one sub-score below threshold', 'Amber dot'],
      ['Low', 'Two+ enrichment agents failed OR multiple sub-scores below threshold OR split suggestion present', 'Red triangle'],
    ],
    [1400, 5500, 2460],
  ),
  H.bullet('FR-8.11.12.1 — Each story MUST carry a confidence badge visible in the hierarchy view.'),
  H.bullet('FR-8.11.12.2 — Low-confidence stories MUST be filterable — "show me the risky ones" is a common BA workflow.'),
  H.bullet('FR-8.11.12.3 — The badge MUST persist across re-grooms until the underlying issues are resolved by user edits or re-enrichment.'),
];
