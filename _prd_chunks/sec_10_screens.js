// Section 11 — Screen Designs (textual wireframes)
const H = require('./_helpers');

module.exports = [
  H.h1('11. Screen Designs'),

  H.p('Textual wireframes for every primary screen. Each screen includes layout, key elements, persona targeted, interaction rules, and edge cases. Detailed component-level specs (button states, focus handling, keyboard shortcuts) are deferred to the design system doc; this section establishes the mental model and content architecture.'),

  H.h2('11.1 Project Dashboard'),
  H.p('Landing page after login. Lists all projects the user has access to. Primary action: create a new project or open an existing one.'),
  H.h4('Layout'),
  ...H.code(`┌─ Header: logo, user menu, admin link (if admin) ─────────────┐
├─ Left nav: My Projects | Shared Projects | Template Library ──┤
├─ Main:                                                         │
│   Search + Filters (client, status, updated-within)            │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │ Project card (name, client, last activity, status badge, │ │
│   │   counts: materials/runs/artefacts/stories, "Open" btn)  │ │
│   └──────────────────────────────────────────────────────────┘ │
│   ...repeat                                                     │
│                                                                 │
│   [+ New Project] floating action (bottom-right)                │
└─────────────────────────────────────────────────────────────────┘`),
  H.h4('Behaviour'),
  H.bullet('Cards sort by most-recently-updated by default; filters never collapse rows, they tint them grey.'),
  H.bullet('Clicking a card opens the project detail view (11.2).'),
  H.bullet('Archived projects hidden unless user toggles "Include archived".'),

  H.h2('11.2 Project Detail — Overview Tab'),
  H.p('Top-level view for a single project. Tab bar exposes the seven domains: Overview, Materials, Runs, Artefacts, Backlog, Groomed Backlog, Documents.'),
  H.h4('Layout'),
  ...H.code(`┌─ Project header: name, description, chips (client, materials, runs, artefacts, sub-projects) ─┐
│  [Edit]  [+ Sub-project]  [▶ Run agent fleet]                                                    │
├─ Tabs: Overview | Materials | Runs | Artefacts | Backlog | 🪄 Groomed Backlog | 📋 Documents ────┤
├─ Overview body:                                                                                   │
│   Project summary (goal, description)                                                             │
│   Key metrics: stories count, critical path length, predicted sprints, Jira config status         │
│   Quick actions: Upload requirements · Open Groomed Backlog · Push to Jira · Configure Jira       │
│   Recent activity timeline (uploads, groomings, pushes, story edits)                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘`),

  H.h2('11.3 Upload & Mapping View'),
  H.p('Entry point for the grooming journey. Shown on the Groomed Backlog tab when the user selects Upload.'),
  H.h4('Layout'),
  ...H.code(`┌─ Groomed Backlog shell (toolbar: Jira config | Push to Jira | Refresh) ─────────┐
├─ Sub-tabs: 📥 Upload | 🌳 Hierarchy | 🕸️ Dependencies | 📅 Multi-dev | 🧑 Mentor │
├──────────────────────────────────────────────────────────────────────────────────┤
│  Template banner (green/purple): "Best-practice default in use — 17 fields across │
│  core/planning/quality/ODC groups."                                               │
│                                                                                    │
│  Drop zone (dashed cyan border, drag target):                                     │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  📊  Drop a CSV or Excel file here                                          │  │
│  │      We’ll auto-detect the columns and preview the mapping                  │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                    │
│  [After upload: Mapping Preview panel appears]                                    │
│    Column mapping preview                                                          │
│    LLM auto-detected · Confidence: medium · Reasoning: ...                         │
│    ┌──────────────────┬──────────────────────────────┬───────────┐                │
│    │ Canonical field  │ Source column                │ Warning   │                │
│    ├──────────────────┼──────────────────────────────┼───────────┤                │
│    │ id               │ [select: Use Case Ref      ▾]│           │                │
│    │ description ★    │ [select: I want (Goal)    ▾]│           │                │
│    │ priority         │ [select: — unmapped —     ▾]│           │                │
│    │ ...                                                                           │
│    └──────────────────┴──────────────────────────────┴───────────┘                │
│    Unmapped: RTM#, Function, As a (Role), So that (Benefit)                       │
│    Dev count [3]       [▶ Start Grooming]                                         │
│                                                                                    │
│  PREVIOUS UPLOADS                                                                  │
│  · WLMS_Business_Requirements.xlsx · 751 rows · conf medium · [Review/Re-groom]   │
│                                                                                    │
│  [If grooming running: Live Progress panel replaces the above]                    │
└──────────────────────────────────────────────────────────────────────────────────┘`),

  H.h2('11.4 Live Grooming Progress'),
  H.p('Appears below the mapping preview once the user clicks Start Grooming. Closes when grooming completes; content moves to the status bar and user is auto-switched to Hierarchy.'),
  H.h4('Layout'),
  ...H.code(`┌─ Grooming in progress... ───────────────────────────────────────┐
│  ● 1. Intake          running   Validating 751 requirements     │
│  ○ 2. Cluster         pending                                   │
│  ○ 3. Draft (BA)      pending                                   │
│  ○ 4. Enrich (5 ag)   pending                                   │
│  ○ 5. Sequence        pending                                   │
│                                                                  │
│  Log (scrollable, monospace, timestamps):                        │
│   09:14:02  [intake] complete: 748 requirements ready            │
│   09:14:05  [cluster] running: sending 200 requirements...       │
│   09:15:41  [cluster] complete: 7 epics, 23 features             │
│   09:15:42  Drafted 3 stories for feature "SSO & auth" (1/23)    │
│   ...                                                            │
└──────────────────────────────────────────────────────────────────┘`),
  H.h4('Behaviour'),
  H.bullet('Stage dots animate: pending (grey) → running (pulsing cyan) → complete (green) → error (red).'),
  H.bullet('Log scrolls automatically; user can scroll up and back without auto-scroll stealing focus.'),
  H.bullet('On error event, the errored stage turns red with the message; subsequent stages stay pending.'),
  H.bullet('On stream end without grooming_complete, the overall banner turns amber with "Stream ended unexpectedly; see console".'),

  H.h2('11.5 Story Detail Modal'),
  H.p('The primary editing surface. Opens in an overlay modal from the Hierarchy view or Mentor prompts list.'),
  H.h4('Layout'),
  ...H.code(`┌─ Story detail — "Authenticate officer via departmental SSO" ────────────[×]─┐
├─ Core ─────────────────────────────────────────────────────────────────────┤
│  Title        [_____________________________________]                       │
│  User Story   [As a Queensland Police officer, I want to...          ]     │
│  AC           [- Given an unauthenticated officer...                  ]    │
│  Points [5] Priority [Must▾] Type [story▾]                                 │
├─ Planning ─────────────────────────────────────────────────────────────────┤
│  Epic: Authentication & Access  ·  Feature: SSO & Auth  ·  Labels: [ ]    │
├─ Quality ──────────────────────────────────────────────────────────────────┤
│  Definition of Done  [......]                                              │
│  Risks & Assumptions [......]                                              │
│  NFR Notes           [......]                                              │
├─ ODC ──────────────────────────────────────────────────────────────────────┤
│  ODC Entities [OfficerProfile, AuthSession]                                 │
│  ODC Screens  [LoginScreen]                                                 │
│  ODC Mentor 2.0 Prompt         [📋 Copy]                                   │
│  ┌─ monospace textarea with 8 visible rows ────────────────────────────┐   │
│  │ # Story: Authenticate officer via departmental SSO                   │   │
│  │ ## Goal ...                                                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  Mentor prompt history (last 3): ▸ v2 (yesterday)  ▸ v1 (2 days ago)       │
├─ Dependencies ─────────────────────────────────────────────────────────────┤
│  · blocked_by #142 "Legacy data migration" (Tech Lead: needs officer IDs)  │
├─ Refine with AI (NEW) ─────────────────────────────────────────────────────┤
│  [Type an instruction e.g. "make AC more specific about MFA"]  [Send]      │
│  Conversation: ...                                                          │
├─ Quality scores: Clarity 82 · Completeness 91 · Testability 74 ───────────┤
├─ Confidence: HIGH ★★★                                                      │
├────────────────────────────────────────────────────────────────────────────┤
│  [🗑 Delete]   [Cancel]   [🔄 Regenerate Mentor]   [Save]                  │
└────────────────────────────────────────────────────────────────────────────┘`),

  H.h2('11.6 Hierarchy Tree View'),
  H.p('The default view after grooming completes. Nested collapsible tree of Epic → Feature → Story with story badges.'),
  H.h4('Layout'),
  ...H.code(`▼ EPIC: Authentication & Access
    Securely authenticate officers; enforce role-based access
  ▼ FEATURE: SSO & Auth                                              [3 stories]
      • Authenticate officer via dept SSO   story · Must · 5 pts · 2 deps · ★★★
      • Handle SSO failure/fallback         story · Must · 3 pts · 1 dep  · ★★☆
      • Logout invalidates session          story · Should · 2 pts · 0 deps · ★★★
  ▸ FEATURE: Role-Based Access                                       [4 stories]
▼ EPIC: Licence Management
  ...`),

  H.h2('11.7 Dependency Graph View'),
  H.p('Mermaid-rendered flowchart. Nodes coloured by priority or critical-path membership. Clickable to open story detail.'),
  H.h4('Layout (rendered Mermaid)'),
  ...H.code(`graph LR
    n1["Authenticate officer via dept SSO<br/><small>5 pts</small>"]:::critical
    n2["Legacy data migration<br/><small>8 pts</small>"]:::critical
    n3["Handle SSO failure<br/><small>3 pts</small>"]
    n2 --> n1
    n1 --> n3
    classDef critical fill:#ff3d71,stroke:#ff3d71,color:#fff;`),
  H.bullet('Legend below: solid arrow = blocks; dashed arrow = blocked_by; red node = critical path.'),
  H.bullet('Hovering a node shows the first line of the story; click navigates to the story detail modal.'),

  H.h2('11.8 Multi-Dev Schedule View'),
  H.p('Per-developer Gantt-style lanes, bars positioned by points, with critical path distinguished. Controls above for dev count, sprint capacity, and "What-if" simulator launch.'),
  H.h4('Layout'),
  ...H.code(`┌─ Controls ───────────────────────────────────────────────────┐
│  Devs [3]  Sprint cap [13]  [Re-compute]  [Open What-If]       │
│  Summary: 9 sprint(s) · 147 total pts · critical path: 14 stories│
├──────────────────────────────────────────────────────────────────┤
│  Axis:  0 ··················· 73 pts ······················· 147│
│                                                                  │
│  Dev 1  ━━[Auth:5]━━━[Dashboard:8*]━━━━━[Analytics:5]━━━        │
│  Dev 2  ━━[Profile:3]━━[API:5]━━━━━[Reports:8]━━━━━              │
│  Dev 3  ━━━━━━━━━━━━[Search:5]━━[Export:3]━━━━                   │
│  * = critical path                                                │
└──────────────────────────────────────────────────────────────────┘`),

  H.h2('11.9 Mentor Prompts View'),
  H.p('Grid of cards, one per story. Each card shows title, prompt length, first 220 characters. Click opens the story detail modal scrolled to the Mentor prompt section.'),

  H.h2('11.10 Jira Config Modal'),
  H.p('Modal overlay triggered from the Groomed Backlog toolbar. Test-before-save behaviour.'),
  H.h4('Layout'),
  ...H.code(`┌─ Jira configuration ─────────────────────────────────────────[×]─┐
│  Atlassian domain   [acme.atlassian.net_____________]             │
│  Email              [bianca@acme.com__________________]           │
│  API token          [••••••••••••••••  show]                      │
│                     (generate at id.atlassian.com/manage-profile) │
│  Target project key [ACM_____]                                    │
│                                                                    │
│  Status: Currently configured (token present). Re-enter to update.│
│                                                                    │
│  [🗑 Clear]                              [Cancel] [Test & Save]   │
└────────────────────────────────────────────────────────────────────┘`),
  H.bullet('Test & Save runs /myself + /project/{key} before persisting; any failure shown inline.'),
  H.bullet('Clear button requires a second confirm; logs an audit event.'),

  H.h2('11.11 Approval Inbox (NEW)'),
  H.p('Stakeholder view reached via tokenised link (no full login required). Shows the epics/features they were asked to approve.'),
  H.h4('Layout'),
  ...H.code(`┌─ QPS Weapons Licence Management — your review is requested ─┐
│  Hi Clive,                                                    │
│                                                                │
│  Bianca has groomed 7 epics from your requirements. Please    │
│  approve the shape or request changes before the team begins. │
│                                                                │
│  ▸ EPIC 1: Authentication & Access    [Approve] [Changes] [?] │
│     Securely authenticate officers; enforce RBAC              │
│  ▸ EPIC 2: Licence Issuance            [Approve] [Changes] [?] │
│     ...                                                        │
│                                                                │
│  [Submit responses]                                            │
└────────────────────────────────────────────────────────────────┘`),

  H.h2('11.12 What-If Simulator (NEW)'),
  H.p('Overlay view accessed from the Multi-Dev Schedule. Live sliders + toggles update a preview Gantt in real time. Apply or Discard at the end.'),
  H.h4('Layout'),
  ...H.code(`┌─ What-If Simulator ──────────────────────────────────────────[×]─┐
│  Base schedule: 9 sprints · 4 devs · 13 pts/sprint                │
│                                                                     │
│  ▸ Devs:        [── ○ ──] 5                                        │
│  ▸ Sprint cap:  [── ○ ──] 15                                       │
│  ▸ Epic toggles:  [✔] Auth [✔] Licence [ ] Reporting [✔] Mobile    │
│  ▸ Priority overrides: drag stories between Must/Should bins       │
│                                                                     │
│  Preview:                                                           │
│   → 6 sprints · same critical path · saves 35 working days          │
│                                                                     │
│  Scenario name [Aggressive staffing]    [Save scenario] [Apply]    │
└─────────────────────────────────────────────────────────────────────┘`),
];
