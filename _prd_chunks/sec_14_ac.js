// Section 15 — Acceptance Criteria (Gherkin)
const H = require('./_helpers');

module.exports = [
  H.h1('15. Acceptance Criteria'),

  H.p('Acceptance criteria are written in Given/When/Then Gherkin form, grouped by module. They are the contract QA will test against. Each scenario targets one behaviour; complex flows are broken into multiple scenarios. Scenarios carry feature-level tags (@intake, @grooming, @jira, etc.) for test-runner filtering.'),

  H.h2('15.1 Intake — Upload & Column Mapping'),
  ...H.code(`@intake @csv
Scenario: Upload a valid CSV auto-detects columns with high confidence
  Given I am on the Groomed Backlog tab of a project
  And I have a CSV with headers "ReqID, Description, Priority, Stakeholder"
  When I drop the file on the upload zone
  Then the system parses the file within 6 seconds
  And the mapping preview shows ReqID -> id, Description -> description, Priority -> priority, Stakeholder -> owner
  And the confidence badge shows "high"
  And the unmapped source list is empty

@intake @xlsx
Scenario: Upload an Excel file with 751 rows produces a soft warning
  Given I am on the Groomed Backlog tab of a project
  When I upload WLMS_Business_Requirements.xlsx (751 rows)
  Then the system parses the file within 20 seconds
  And the mapping preview lists 5 columns
  And a warning banner says "Large requirement set (751 rows). Grooming will take longer and cost more."

@intake @error
Scenario: Upload exceeding the hard limit is rejected
  Given I have a CSV with 6000 rows
  When I attempt to upload it
  Then the system rejects the upload with "Too many rows. Hard limit 5000."
  And no RequirementsUpload row is created

@intake @legacy-format
Scenario: Legacy .xls format is rejected with a helpful message
  Given I have a legacy .xls file
  When I attempt to upload it
  Then the system responds "Legacy .xls not supported - save as .xlsx and retry."

@intake @fallback
Scenario: LLM auto-detect failure falls back to heuristic
  Given the Gemini API is returning 403
  When I upload a CSV with clearly-named columns
  Then the system still produces a mapping via heuristic fallback
  And the confidence badge shows "medium" or "low"
  And the reasoning text says "Heuristic rule-based mapping ..."`),

  H.h2('15.2 Story Template'),
  ...H.code(`@template
Scenario: New project uses the default best-practice template
  Given I have just created a project and have not set a template override
  When I open the Groomed Backlog tab
  Then a green banner says "Best-practice default in use: 17 fields across core, planning, quality, and ODC groups"

@template @override
Scenario: Per-project template override applies to grooming
  Given I have saved a custom template that adds a "regulatory_reference" field
  When grooming completes on this project
  Then every story includes a regulatory_reference field (possibly empty)

@template @library
Scenario: Cloning a library template creates a project override
  Given I am on the Template Library page
  When I click "Use Government template" on this project
  Then a project override is created with the Government template fields
  And the banner on the Groomed Backlog view switches to purple "Custom template in use"`),

  H.h2('15.3 Grooming Pipeline'),
  ...H.code(`@grooming @happy-path
Scenario: Full pipeline completes end-to-end on a typical upload
  Given I have uploaded a 300-row CSV with a good mapping
  When I click "Start Grooming"
  Then 5 stage dots progress from pending -> running -> complete
  And the live log shows per-feature drafting progress
  And within 30 minutes the status banner reads "Grooming complete - N epic(s), M feature(s), K story(ies)"
  And the Hierarchy view renders the full tree

@grooming @empty-intake
Scenario: Intake with 0 usable requirements aborts cleanly
  Given I upload a CSV where all rows have empty descriptions
  When I click "Start Grooming"
  Then the Intake stage turns red
  And the log shows "No usable requirements found - intake aborted"
  And no stories are created

@grooming @malformed-cluster-json
Scenario: Cluster stage recovers from malformed JSON
  Given Sonnet returns "Here is the clustering: { ..." with a preamble
  When clustering runs
  Then the pipeline automatically retries with the corrective instruction
  And the second attempt succeeds
  And the log notes "cluster retry succeeded"

@grooming @persisted-tree
Scenario: Completed grooming persists to the database
  Given grooming has just completed with 5 epics, 15 features, 60 stories
  When I close the browser and reopen the project
  Then the Hierarchy view still shows those 5 epics, 15 features, 60 stories
  And the Dependencies and Multi-dev Schedule views render without re-grooming`),

  H.h2('15.4 Story Detail'),
  ...H.code(`@story-detail
Scenario: Editing a story and saving updates all field-level attributes
  Given I have opened the story detail modal for story #42
  When I change the title, priority, and add a DoD
  And I click Save
  Then the hierarchy view shows the updated title
  And subsequent opens show the saved priority and DoD

@story-detail @mentor-regen
Scenario: Regenerating the Mentor prompt archives the current one
  Given a story has a Mentor prompt marked as current (v2)
  When I click "Regenerate Mentor prompt"
  Then a new prompt (v3) is generated and displayed
  And v2 moves into Mentor prompt history
  And the history panel shows v1, v2

@story-detail @refine
Scenario: AI refinement proposes a patch the user can accept or reject
  Given I am editing story #42 in the detail modal
  When I enter "make the AC more specific about error handling" in the Refine panel
  Then the BA agent proposes a patch containing updated acceptance_criteria
  And the UI shows the diff between current and proposed
  And accepting the patch updates the story and appends a refinement_history entry`),

  H.h2('15.5 Dependencies'),
  ...H.code(`@deps @auto
Scenario: Tech Lead agent auto-detects a cross-story dependency
  Given two stories in the same feature where story B logically depends on story A
  When the Enrich stage runs
  Then story B contains a dependency of type "blocked_by" pointing to story A
  And the dependency reason explains "B requires A's entities"

@deps @manual-edit
Scenario: User adds a dependency from the story detail modal
  Given I am editing story #42
  When I add a "blocked_by" dependency targeting story #17 with reason "requires auth"
  And I click Save
  Then the dependency graph adds an edge from #42 to #17
  And the schedule re-computes with #42 waiting for #17's finish time

@deps @cycle-rejection
Scenario: Creating a cycle in dependencies is rejected
  Given story A is blocked_by story B
  When I attempt to add a dependency where B is blocked_by A
  Then the system rejects the change with "Dependency would create a cycle"
  And no edge is added`),

  H.h2('15.6 Multi-Dev Schedule'),
  ...H.code(`@schedule @happy
Scenario: Schedule respects blocker finish times
  Given three stories: Auth (5 pts), Dashboard (8 pts, blocked by Auth), Analytics (5 pts, blocked by Dashboard)
  And 2 developers
  When the schedule is computed
  Then Auth is on Dev 1 at points 0-5
  And Dashboard is on any dev at points 5-13 (not 0-8)
  And Analytics starts at points 13

@schedule @what-if
Scenario: What-if simulator updates the preview live
  Given the current schedule predicts 9 sprints with 3 devs
  When I open the What-if simulator and change dev count to 5
  Then within 200ms the preview shows a new sprint count
  And the original schedule is not modified until I click Apply`),

  H.h2('15.7 Jira Integration'),
  ...H.code(`@jira @config
Scenario: Saving Jira config verifies credentials before persisting
  Given I open the Jira config modal
  When I enter a valid domain, email, token, and project key
  And I click Test & Save
  Then /rest/api/3/myself returns 200
  And /rest/api/3/project/{key} returns 200
  And the config is persisted

@jira @config @bad-token
Scenario: Invalid API token is rejected at save time
  Given I enter an incorrect API token
  When I click Test & Save
  Then the verification returns 401
  And the config is NOT persisted
  And the UI shows "Jira auth failed: HTTP 401: Unauthorized"

@jira @push @happy
Scenario: Push creates epics, stories, and links
  Given I have a groomed backlog with 3 epics and 20 stories with 8 dependencies
  And Jira config is valid
  When I click Push to Jira and confirm
  Then 3 Jira Epic issues are created
  And 20 Jira Story/Task issues are created with parent epic keys set
  And 8 Jira issue links are created as Blocks relations
  And the jira_push_event row records all created keys

@jira @push @partial-failure
Scenario: One story fails but the rest of the push succeeds
  Given 20 stories to push, one of which has an invalid field
  When I push to Jira
  Then 19 stories are created
  And the failed story is captured in jira_push_event.errors
  And the UI summary reads "Pushed 3 epic(s) + 19 story(ies). 1 error"`),

  H.h2('15.8 Re-upload Diff'),
  ...H.code(`@reupload
Scenario: Revised CSV surfaces NEW/CHANGED/GONE classifications
  Given this project has a prior upload with 300 rows
  When I upload a revised CSV with 47 new IDs, 12 changed-text same-IDs, and 8 missing IDs
  Then the Diff Preview shows NEW (47), CHANGED (12), GONE (8)
  And I can approve or reject each section

@reupload @preserve-edits
Scenario: User edits survive a CHANGED re-draft
  Given story #42 has been manually edited with a custom DoD
  And the originating requirement is classified as CHANGED
  When I approve the CHANGED re-draft
  Then story #42's fields are updated where the customer's description changed
  And my custom DoD is preserved`),

  H.h2('15.9 Enhancements'),
  ...H.code(`@enhancement @duplicate-detection
Scenario: Within-upload duplicates are flagged on the mapping preview
  Given I upload a CSV where two rows share 90%+ semantic similarity
  When the upload is parsed
  Then a warning flags the duplicate pair for user review

@enhancement @quality-scoring
Scenario: Low-quality stories show amber borders in the hierarchy
  Given a story has AC count of 1 and no DoD
  Then its Completeness sub-score is below 80
  And its hierarchy card renders with an amber border

@enhancement @approval-workflow
Scenario: Grooming pauses for stakeholder approval
  Given I have sent approval requests for all 5 epics
  When one stakeholder clicks "Request Changes"
  Then grooming halts at the Cluster->Draft boundary
  And the BA sees a notification with the stakeholder's comment

@enhancement @gherkin-export
Scenario: Export produces one .feature file per Feature
  Given a backlog with 5 features containing 40 stories
  When I click "Export Gherkin"
  Then a ZIP downloads containing 5 .feature files
  And each .feature has one Feature declaration
  And each scenario inside has the story ID as a tag

@enhancement @coverage-heatmap
Scenario: Requirements with no derived story are flagged uncovered
  Given 300 uploaded requirements
  And grooming produced 118 stories covering 290 source IDs
  Then the coverage heatmap shows 10 uncovered requirements in red
  And clicking any shows the requirement text with a "create story" action`),
];
