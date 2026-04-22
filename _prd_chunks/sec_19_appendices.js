// Section 20 — Appendices
const H = require('./_helpers');

module.exports = [
  H.h1('20. Appendices'),

  H.h2('Appendix A — Sample CSV Input Schemas'),

  H.h3('A.1 Minimal (2 columns)'),
  ...H.code(`RequirementID,Description
R001,Users must be able to log in with SSO
R002,Export reports as PDF
R003,Dashboard loads in under 2s
R004,Delete user data on request (GDPR)`),
  H.p('Heuristic mapping: RequirementID → id, Description → description. All other canonical fields left unmapped; grooming still succeeds but agents receive less context.'),

  H.h3('A.2 Typical (5 columns — the shape most customers send)'),
  ...H.code(`ReqID,Req Description,Priority,Stakeholder,Notes
R001,"Users must be able to log in with SSO",High,IT,Okta preferred
R002,"Role-based access with 4 roles",High,Security,Needs audit trail
R003,"Dashboard top 10 KPIs in 2 seconds",Med,Operations,On 50+ concurrent users
R004,"Export any grid to CSV and PDF",Med,Finance,PDF matches print style
R005,"Delete all user data on request",High,Legal,GDPR Article 17 automated`),
  H.p('Confident mapping: ReqID → id, Req Description → description, Priority → priority, Stakeholder → owner, Notes → notes.'),

  H.h3('A.3 Messy (real-world 7+ columns, some unmapped)'),
  ...H.code(`RTM#,Function,Use Case Ref,"As a (Role / The Who)","I want (Goal / The Want)","So that (Benefit / The Reason)","Original FR Ref#",#Tags (for Analysis)
1,Authentication,UC-001,Queensland Police Officer,Log in with departmental SSO,I can access the system securely,FR-AUTH-12,#auth #security
2,Authentication,UC-002,Queensland Police Officer,Reset my password,I can recover access when I forget,FR-AUTH-14,#auth
3,Licence Issue,UC-011,Licensing Clerk,Register a new weapons licence,I can complete customer applications,FR-LIC-03,#licence
...`),
  H.p('Mapping (via LLM auto-detect): Use Case Ref → id, "I want (Goal / The Want)" → description, Original FR Ref# → source, #Tags (for Analysis) → tags, "As a (Role / The Who)" → owner. Unmapped: RTM#, Function, "So that (Benefit / The Reason)". Grooming still succeeds; the unmapped columns are visible to the user as a warning.'),

  H.h2('Appendix B — Story Template Field Specification'),

  H.p('The complete 17-field default template. Every field has a key, label, placeholder text, field_type, required flag, UI group, help text, and (where applicable) the Jira field it maps to during push.'),

  H.h3('B.1 Core Group (6 fields)'),
  H.table(
    ['Key', 'Label', 'Type', 'Required', 'Jira field'],
    [
      ['title', 'Title', 'text', 'Yes', 'summary'],
      ['story', 'User Story', 'textarea', 'Yes', 'description'],
      ['acceptance_criteria', 'Acceptance Criteria', 'markdown', 'Yes', 'appended to description'],
      ['story_points', 'Story Points', 'select (Fibonacci)', 'Yes', 'customfield (discovered)'],
      ['priority', 'Priority', 'select (MoSCoW)', 'Yes', 'priority.name (mapped)'],
      ['type', 'Type', 'select (story/bug/spike/tech-debt)', 'Yes', 'issuetype.name'],
    ],
    [2000, 2200, 2400, 1400, 1360],
  ),

  H.h3('B.2 Planning Group (4 fields)'),
  H.table(
    ['Key', 'Label', 'Type', 'Required', 'Jira field'],
    [
      ['epic', 'Epic', 'ref', 'No', 'parent.key'],
      ['feature', 'Feature', 'ref', 'No', '(not mapped — kept internal)'],
      ['labels', 'Labels', 'tags', 'No', 'labels'],
      ['dependencies', 'Dependencies', 'structured (target_id, type, reason)', 'No', 'issue links (Blocks)'],
    ],
    [2000, 2200, 2400, 1400, 1360],
  ),

  H.h3('B.3 Quality Group (3 fields)'),
  H.table(
    ['Key', 'Label', 'Type', 'Required', 'Jira field'],
    [
      ['definition_of_done', 'Definition of Done', 'markdown', 'No', 'appended to description'],
      ['risks_assumptions', 'Risks & Assumptions', 'markdown', 'No', '(not mapped)'],
      ['nfr_notes', 'Non-Functional Notes', 'markdown', 'No', '(not mapped)'],
    ],
    [2000, 2200, 2400, 1400, 1360],
  ),

  H.h3('B.4 ODC Group (4 fields)'),
  H.table(
    ['Key', 'Label', 'Type', 'Required', 'Jira field'],
    [
      ['odc_entities', 'ODC Entities Touched', 'tags', 'No', '(not mapped)'],
      ['odc_screens', 'ODC Screens Modified', 'tags', 'No', '(not mapped)'],
      ['mentor_prompt', 'ODC Mentor 2.0 Prompt', 'markdown (auto-generated)', 'No', 'appended to description'],
      ['mentor_prompt_history', 'Mentor Prompt History', 'history (read-only)', 'No', '(not mapped)'],
    ],
    [2000, 2200, 2400, 1400, 1360],
  ),

  H.h2('Appendix C — API Response Schemas'),

  H.h3('C.1 POST /api/projects/{id}/requirements/upload'),
  ...H.code(`{
  "upload": {
    "id": 42,
    "filename": "WLMS_Business_Requirements.xlsx",
    "kind": "excel",
    "row_count": 751,
    "uploaded_at": "2026-04-21T09:14:02Z"
  },
  "parse": {
    "rows": 751,
    "columns": ["Use Case Ref","I want (Goal / The Want)","Priority","Original FR Ref#","#Tags (for Analysis)"],
    "warnings": [],
    "sheet_names": ["Requirements"],
    "sheet_used": "Requirements"
  },
  "mapping": {
    "mapping": {
      "id": "Use Case Ref",
      "description": "I want (Goal / The Want)",
      "priority": "Priority",
      "source": "Original FR Ref#",
      "tags": "#Tags (for Analysis)"
    },
    "confidence": "medium",
    "unmapped_sources": ["RTM#", "Function", "As a (Role / The Who)", "So that (Benefit / The Reason)"],
    "reasoning": "LLM auto-detect identified the standard 5 canonical fields; four source columns could not be mapped to canonical fields.",
    "source": "autodetect"
  }
}`),

  H.h3('C.2 GET /api/projects/{id}/groomed-backlog'),
  ...H.code(`{
  "epics": [
    {
      "id": 101,
      "title": "Authentication & Access",
      "structured_data": {
        "level": "epic",
        "story": "Securely authenticate officers; enforce RBAC",
        "priority": "Must",
        "provenance": "groomed",
        "upload_id": 42,
        "requirement_source_id": "EPIC-001"
      },
      "features": [
        {
          "id": 201,
          "title": "SSO & Auth",
          "structured_data": {
            "level": "feature",
            "parent_epic_id": 101,
            "story": "Single sign-on integration with departmental identity providers"
          },
          "stories": [
            {
              "id": 301,
              "title": "Authenticate officer via dept SSO",
              "structured_data": {
                "level": "story",
                "parent_epic_id": 101,
                "parent_feature_id": 201,
                "story": "As a Queensland Police officer, I want to log in with departmental SSO, so that...",
                "acceptance_criteria": [
                  "Given an unauthenticated officer, When they click Login, Then redirect to Okta.",
                  "Given a valid SSO response, When the token is received, Then create AuthSession and land on Dashboard.",
                  "Given a revoked SSO account, When login is attempted, Then show a helpful error and log the attempt."
                ],
                "points": 5,
                "priority": "Must",
                "type": "story",
                "odc_entities": ["OfficerProfile", "AuthSession"],
                "odc_screens": ["LoginScreen"],
                "dependencies": [
                  { "target_id": 299, "type": "blocked_by", "reason": "Requires OfficerProfile entity from legacy migration", "added_by": "tech_lead" }
                ],
                "mentor_prompt": "# Story: Authenticate officer ...",
                "confidence_badge": "high",
                "quality": { "clarity": 82, "completeness": 91, "testability": 74 }
              }
            }
          ],
          "unparented_stories": []
        }
      ],
      "unparented_stories": []
    }
  ],
  "orphans": []
}`),

  H.h3('C.3 GET /api/projects/{id}/groomed-backlog/dependency-graph'),
  ...H.code(`{
  "nodes": [
    { "id": 301, "title": "Authenticate officer via dept SSO", "priority": "Must", "points": 5, "epic_id": 101, "feature_id": 201 },
    { "id": 299, "title": "Legacy data migration: officer identities", "priority": "Must", "points": 8, "epic_id": 105, "feature_id": 210 }
  ],
  "edges": [
    { "from": 301, "to": 299, "type": "blocked_by", "reason": "Requires OfficerProfile entity from legacy migration", "added_by": "tech_lead" }
  ]
}`),

  H.h3('C.4 GET /api/projects/{id}/groomed-backlog/schedule?dev_count=3&sprint_capacity=13'),
  ...H.code(`{
  "critical_path_ids": [299, 301, 312],
  "schedule": {
    "assignments": [
      { "dev": 1, "story_id": 299, "title": "Legacy data migration: officer identities", "sprint": 1, "start_points": 0, "end_points": 8, "points": 8, "blocked_until": 0 },
      { "dev": 1, "story_id": 301, "title": "Authenticate officer via dept SSO", "sprint": 1, "start_points": 8, "end_points": 13, "points": 5, "blocked_until": 8 },
      { "dev": 2, "story_id": 303, "title": "Profile page", "sprint": 2, "start_points": 8, "end_points": 11, "points": 3, "blocked_until": 8 }
    ],
    "dev_load": { "1": 13, "2": 11, "3": 0 },
    "predicted_total_points": 147,
    "predicted_sprint_count": 9
  }
}`),

  H.h2('Appendix D — Example ODC Mentor 2.0 Prompt'),

  H.p('The full Mentor prompt generated for the "Authenticate officer via departmental SSO" story from Journey 7.1. Every groomed story has a prompt of this shape.'),

  ...H.code(`# Story: Authenticate officer via departmental SSO

## Goal
As a Queensland Police officer, I want to log in with departmental SSO (Okta), so that I can access the Weapons Licence Management system securely and without additional credentials.

## Platform Context
The existing QPS Licence Management project on ODC uses:
- Entities: OfficerProfile (Id, Username, BadgeNumber, DepartmentId, Status), AuthSession (Id, OfficerProfileId, StartedAt, ExpiresAt, Token)
- Service actions: OfficerProfile_Get, OfficerProfile_Create (for first-time SSO landing)
- Screens: LoginScreen (Reactive Web Block)
- Forge components available: Okta OIDC Connector (installed), SessionManager utilities
- Authentication pattern: OIDC with Okta as the IdP; token exchange via the Okta connector, local session persisted to AuthSession entity.

## Implementation Approach
Use a reactive login flow. On LoginScreen, invoke the Okta connector's BeginAuthorisation action, handle the callback via the OnReady action of a LoginCallback screen, validate the id_token, upsert OfficerProfile by Username, create an AuthSession row, and redirect to the Dashboard. No credentials are stored locally.

## Acceptance Criteria
- **Given** an unauthenticated officer on LoginScreen, **When** they click the "Login with SSO" button, **Then** the browser redirects to Okta's authorisation endpoint with the correct client_id and state parameter.
- **Given** a valid Okta response at the LoginCallback screen, **When** the id_token is validated successfully, **Then** OfficerProfile is upserted (create if new username, update LastLoginAt if existing), an AuthSession row is created with a 480-minute expiry, and the browser navigates to Dashboard.
- **Given** a revoked or deprovisioned Okta account, **When** login is attempted, **Then** the user is shown the AccountDisabled screen and an AuditLog_Write entry is created with kind="login_blocked".

## Non-Functional Requirements
- End-to-end login MUST complete in ≤ 3 seconds on the 95th-percentile corporate network.
- AuthSession.Token MUST be cryptographically random (128-bit); stored only hashed server-side.
- Session cookies MUST be HttpOnly, Secure, SameSite=Strict.
- All login attempts (success and failure) MUST be logged to AuditLog with officer username, IP, timestamp, outcome.
- WCAG 2.2 AA: the LoginScreen MUST be fully operable via keyboard; contrast ratios ≥ 4.5:1.

## Suggested ODC Structure
- Entities touched: OfficerProfile, AuthSession, AuditLog
- Screens/Blocks: LoginScreen, LoginCallback, AccountDisabled
- Forge components to consider: Okta OIDC Connector (established); SessionManager (for rotation)

## Deliverables expected from Mentor
1. OfficerProfile entity scaffold confirming the existing attributes are sufficient.
2. Service action skeleton for AuthSession_CreateForOfficer (input: OfficerProfileId; output: AuthSession record).
3. LoginScreen Reactive Web Block wiring: UI components, client action flow to the Okta connector, error handling.
4. LoginCallback screen with id_token validation, OfficerProfile upsert, AuthSession creation, navigation.
5. Unit test stubs for AuthSession_CreateForOfficer and OfficerProfile_Upsert covering happy path, revoked account, and network failure paths.`),

  H.h2('Appendix E — Dependency Graph Mermaid Source'),

  H.p('The dependency graph view renders Mermaid flowchart syntax. Example source for a 6-story backlog where the critical path is Auth → Dashboard → Analytics:'),

  ...H.code(`graph LR
    n301["Authenticate officer via dept SSO<br/><small>5 pts</small>"]:::critical
    n299["Legacy migration: officer identities<br/><small>8 pts</small>"]:::critical
    n303["Profile page<br/><small>3 pts</small>"]
    n308["Dashboard top-10 KPIs<br/><small>8 pts</small>"]:::critical
    n312["Analytics drilldown<br/><small>5 pts</small>"]:::critical
    n320["Export CSV/PDF<br/><small>3 pts</small>"]

    n301 -.-> n299
    n303 -.-> n301
    n308 -.-> n301
    n312 -.-> n308
    n320 -.-> n308

    classDef critical fill:#ff3d71,stroke:#ff3d71,color:#fff;`),

  H.p('Rendering notes:'),
  H.bullet('classDef critical applies red fill to nodes on the longest-path chain computed by SchedulerMath.'),
  H.bullet('-.-> is used for blocked_by; --> for blocks. Legend explains this.'),
  H.bullet('Node labels truncate at 30 characters with trailing ellipsis if longer.'),
  H.bullet('For graphs > 500 nodes the UI switches to a paginated / filtered view to keep Mermaid responsive.'),

  H.h1('End of Document'),
  H.p('This PRD is version 1.0. All subsequent revisions MUST bump the version and append an entry to Section 1.1 Change History. The living reference is the Git-tracked copy in the SDLC_2.0_POC repository; distributed copies may go stale.'),
];
