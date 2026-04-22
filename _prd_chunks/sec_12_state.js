// Section 13 — State Machines
const H = require('./_helpers');

module.exports = [
  H.h1('13. State Machines'),

  H.p('Four core entities have non-trivial lifecycles. Each is documented as a state table: current state × event → next state + side effect. Illegal transitions MUST be rejected by the service tier; direct database writes are prohibited except via the defined transitions.'),

  H.h2('13.1 Requirement Row Lifecycle'),
  H.p('Individual requirement rows move through states as the user reviews uploads and runs grooming.'),
  H.table(
    ['State', 'Event', 'Next state', 'Side effect'],
    [
      ['—', 'Upload parsed', 'draft', 'Row written to DB'],
      ['draft', 'Grooming starts', 'grooming', 'No side effect; status change for visibility'],
      ['grooming', 'Grooming succeeds (row covered by a story)', 'groomed', 'Story(ies) created; row.requirement_source_ids set'],
      ['grooming', 'Grooming succeeds (no story covers this row)', 'uncovered', 'Flagged on Coverage Heatmap'],
      ['groomed', 'Re-upload detects row GONE', 'archived', 'Associated stories move to status=gone; row retained for audit'],
      ['groomed', 'Re-upload detects row CHANGED', 'revised', 'Diff Preview surfaces; user approves before re-draft'],
      ['uncovered', 'User manually creates story or re-runs grooming', 'groomed', 'Story link established'],
      ['archived', 'User un-archives', 'groomed', 'Side effect limited if associated stories were also archived'],
    ],
    [1600, 3400, 1600, 2760],
  ),

  H.h2('13.2 Story Lifecycle'),
  H.table(
    ['State', 'Event', 'Next state', 'Side effect'],
    [
      ['—', 'Created by grooming pipeline', 'backlog', 'BacklogItem row written; Mentor prompt generated'],
      ['—', 'Created manually by user', 'backlog', 'status=manual; BA agent NOT invoked unless user requests refinement'],
      ['backlog', 'User moves on Kanban', 'todo', ''],
      ['todo', 'User moves on Kanban', 'in_progress', ''],
      ['in_progress', 'User moves on Kanban', 'done', ''],
      ['done', 'User moves back to in_progress', 'in_progress', ''],
      ['backlog | todo | in_progress | done', 'User edits fields', 'same', 'structured_data updated; quality scores recomputed; confidence badge re-derived'],
      ['backlog | todo | in_progress | done', 'User regenerates Mentor prompt', 'same', 'Previous prompt archived in mentor_prompt_history; new current prompt generated'],
      ['any', 'Re-upload classifies originating row as GONE + user approves', 'gone', 'Story hidden from default views; faded in full-view; Jira sync sets status Cancelled'],
      ['any', 'User soft-deletes', 'archived', 'Hidden from all views; recoverable from admin'],
      ['archived', 'Admin hard-deletes', '—', 'Row removed; audit event retained'],
    ],
    [1800, 3600, 1600, 2360],
  ),

  H.h2('13.3 Jira Push Lifecycle'),
  H.table(
    ['State', 'Event', 'Next state', 'Side effect'],
    [
      ['—', 'User clicks Push to Jira', 'verifying', 'GET /myself + /project/{key} invoked'],
      ['verifying', 'Verification succeeds', 'pushing_epics', 'POST /issue for each Epic'],
      ['verifying', 'Verification fails', 'failed_auth', 'User shown the Atlassian error; no further action'],
      ['pushing_epics', 'Last Epic created', 'pushing_stories', 'Mapping stored {story_id → jira_key}'],
      ['pushing_epics', 'Non-auth error on individual Epic', 'pushing_epics', 'Error collected in jira_push_event.errors; loop continues'],
      ['pushing_stories', 'Last Story created', 'pushing_links', ''],
      ['pushing_stories', 'Non-auth error on individual Story', 'pushing_stories', 'Error collected; loop continues'],
      ['pushing_links', 'Last link created', 'complete', 'jira_push_event finalised with full counts'],
      ['pushing_links', 'Error creating link', 'pushing_links', 'Error collected; loop continues'],
      ['complete', 'User pushes again later (re-push)', 'verifying', 'Re-push path: updates existing Jira issues by stored mapping'],
      ['failed_auth', 'User updates JiraConfig', '—', 'Previous failed push archived; user retries from UI'],
    ],
    [1800, 3400, 1600, 2560],
  ),

  H.h2('13.4 Approval Request Lifecycle'),
  H.table(
    ['State', 'Event', 'Next state', 'Side effect'],
    [
      ['—', 'BA sends approval request', 'pending', 'Email dispatched with tokenised URL; token stored'],
      ['pending', 'Stakeholder clicks Approve', 'approved', 'Pipeline can proceed if all pending approvals resolved; email confirmation sent to BA'],
      ['pending', 'Stakeholder clicks Request Changes', 'changes_requested', 'Comment captured; BA notified; pipeline paused'],
      ['pending', 'Stakeholder clicks Flag for Discussion', 'flagged', 'BA notified; pipeline paused'],
      ['pending', 'ExpiresAt passes with no response', 'expired', 'Token invalidated; BA notified; BA may resend'],
      ['approved | changes_requested | flagged', 'BA resends', 'pending', 'New token issued; old record archived'],
      ['any', 'BA cancels', 'cancelled', 'Token invalidated; no further action'],
    ],
    [1800, 3200, 1600, 2760],
  ),
];
