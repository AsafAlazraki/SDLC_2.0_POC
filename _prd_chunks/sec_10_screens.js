// Section 11 — Screen Designs (textual wireframes)
const H = require('./_helpers');

module.exports = [
  H.h1('11. Screen Designs'),

  H.p('Textual wireframes for every primary Screen. OutSystems terminology used throughout: a Screen is a navigable URL; a Block is a reusable UI fragment composed into Screens; Widgets are the primitive UI components (Button, Input, Dropdown, Container, Form, Table, etc.) that compose a Block. Layouts below describe the Widget tree at the Screen root. Detailed Widget-level specs (exact Button states, Input validation strings, CSS class hooks) are deferred to the design system artefact; this section establishes the Screen/Block composition and Screen Action behaviour.'),

  H.p('Every Screen in the Backlog_Planner Reactive Web app inherits the organisation\u2019s Layout Block for header/nav chrome. Routing is the standard OutSystems ScreenFlow; URL parameters are listed in Section 12.'),

  H.h2('11.1 Project Dashboard'),
  H.h4('Screen'),
  H.p('ProjectsDashboard — URL /projects. Composed of Layout Block + ProjectCard Block (repeated).'),
  H.h4('Purpose'),
  H.p('Landing Screen after login. Lists Project Entities the current User has access to. Primary action: create a new Project or open an existing one.'),
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
  H.bullet('Data Fetch: GetMyProjects Aggregate ordered by UpdatedOn desc; filters applied client-side without re-fetch.'),
  H.bullet('Clicking a ProjectCard Block fires the OnClick Screen Action \u2192 navigates to ProjectDetail Screen.'),
  H.bullet('Archived Projects hidden by default; a Switch Widget ("Include archived") toggles the Aggregate filter.'),
  H.bullet('"+ New Project" Button opens the NewProjectPopup Block; confirmed submission calls the Project_Create Service Action and refreshes the list.'),

  H.h2('11.2 Project Detail — Overview Tab'),
  H.h4('Screen'),
  H.p('ProjectDetail — URL /projects/{ProjectId}. Composed of Layout Block + ProjectHeader Block + TabBar Block + one of seven tab-specific content Blocks depending on the Tab URL parameter.'),
  H.h4('Purpose'),
  H.p('Top-level Screen for a single Project Entity. Tab Bar Widget exposes the seven domains: Overview, Materials, Runs, Artefacts, Backlog, Groomed Backlog, Documents. Each tab swaps the inner content Block via a Reactive client variable.'),
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
  H.h4('Block'),
  H.p('GroomedBacklog_UploadTab — rendered inside ProjectDetail Screen when Tab=groomed and Sub-view=upload. Composed of: TemplateBanner Block, UploadDropzone Block (wraps the standard OutSystems Upload Widget with drag-and-drop behaviour), MappingPreview Block (Table Widget with editable Dropdown cells), UploadHistory Block (List of ReviewableUploadCard Blocks), LiveProgress Block (shown only while RunEvent.Stage is active).'),
  H.h4('Purpose'),
  H.p('Entry point for the grooming journey. The dominant Screen Action is UploadFileOnChange which fires OnChange of the Upload Widget.'),
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
  H.h4('Block'),
  H.p('LiveProgress Block — visible while the parent GroomedBacklog_UploadTab Block holds an active RunEvent reference. Composed of: five StageIndicator Widgets (driven by a RefreshData Client Action polling GetGroomingStatus every 3 seconds) plus a ProgressLog List Widget bound to recent log lines stored in a client variable.'),
  H.h4('Purpose'),
  H.p('Polling loop visualisation of the Timer-driven pipeline. Polls GetGroomingStatus Service Action every 3 seconds while RunEvent.Stage \u2209 {complete, error}; when terminal, closes the Block and auto-switches the parent to the Hierarchy sub-view via a Client Action.'),
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

  H.h2('11.5 Story Detail Popup'),
  H.h4('Block'),
  H.p('StoryDetailPopup — implemented as a Popup (OutSystems UI Popup Widget wrapping a Form Widget). The primary editing surface for a BacklogItem where LevelId=Level.Story. Opens from the Hierarchy tree or Mentor prompts grid.'),
  H.h4('Purpose'),
  H.p('Edit all 17 Story Template fields. Each field is a Widget bound to a local variable; Save calls PatchStory Service Action with a StoryPatch Structure; Regenerate Mentor calls RegenerateMentorPrompt Service Action.'),
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
  H.h4('Block'),
  H.p('GroomedBacklog_HierarchyTab — renders GetGroomedTree Service Action output via a recursive Block pattern (EpicCard Block \u2192 nested FeatureCard Blocks \u2192 nested StoryCard Blocks). Each card uses Container Widgets for layout, Badge Widgets for metadata chips, and fires the OnClick Screen Action to open the appropriate Popup.'),
  H.h4('Purpose'),
  H.p('Default sub-view after grooming completes. Uses OutSystems\u2019 Expandable Widget pattern (Chevron + Toggle) for collapsing Epics and Features.'),
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
  H.h4('Block'),
  H.p('GroomedBacklog_DependencyTab — composed of a DependencyGraphRenderer Block backed by a thin Extension (JavaScript Node) that wraps a Mermaid library loaded as an Embedded Resource. The Extension exposes a single Client Action RenderMermaid(Source: Text, ContainerId: Text).'),
  H.h4('Purpose'),
  H.p('Read-only dependency visualisation. Nodes coloured by PriorityId or critical-path membership (computed server-side in GetDependencyGraph Service Action and passed as graph attributes). Node click is wired via a JS Node callback to a parent Client Action that opens the StoryDetailPopup.'),
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
  H.h4('Block'),
  H.p('GroomedBacklog_ScheduleTab — Gantt rendered as SVG generated by a Server-side Client Action using positions computed by SchedulerMath in BacklogLib. Controls Widgets (NumberBox for Devs, NumberBox for Sprint Capacity, Button for Re-compute, Button for Open What-If) sit above. No Extension required — SVG string interpolated into a Container via the Expression Widget with EscapeHTML=False.'),
  H.h4('Purpose'),
  H.p('Per-developer lanes, bars positioned by points. Critical-path bars rendered with a different fill via ScheduleAssignment.IsOnCriticalPath. The What-If Simulator Popup is separate (Section 11.12).'),
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
  H.h4('Block'),
  H.p('GroomedBacklog_MentorTab — List Records Widget iterating over BacklogItems where LevelId=Level.Story, wrapped in MentorPromptCard Blocks. Each card shows Title, a character count, and the first 220 characters of the PromptText attribute. OnClick opens StoryDetailPopup with focus on the Mentor section via a local scroll-to-hash trick.'),

  H.h2('11.10 Jira Config Popup'),
  H.h4('Block'),
  H.p('JiraConfigPopup — Popup Widget triggered from the GroomedBacklog toolbar. Form Widget with Input Widgets for Domain, Email, ApiToken (Input Password), and JiraProjectKey. Test & Save Button fires the SaveJiraConfig Service Action which verifies credentials against Jira /myself and /project/{key} Consumed REST API Methods before persisting.'),
  H.h4('Purpose'),
  H.p('Test-before-save behaviour: any non-2xx response from either verification call aborts the save and surfaces the Jira error in a Feedback Message Widget.'),
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
  H.h4('Screen'),
  H.p('ApprovalInbox_Tokenised — anonymous Screen, URL /approvals/{UrlToken}. Identified by URL token only; no authentication required. Composed of Layout Block (slimmed — no user menu, no global nav) + ApprovalItem Block repeated for every BacklogItem under the ApprovalRequest\u2019s target.'),
  H.h4('Purpose'),
  H.p('Stakeholder review surface. Screen Preparation action validates the UrlToken against the ApprovalRequest Entity (non-expired, status=pending) and redirects to ApprovalExpired Screen if invalid.'),
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
  H.h4('Block'),
  H.p('WhatIfPopup — Popup Widget launched from GroomedBacklog_ScheduleTab. Sliders implemented via the Slider Widget (OutSystems UI); toggles via CheckBox. Every input change fires a Client Action that calls SimulateScheduleWhatIf Service Action and re-renders the preview SVG without mutating the persistent BacklogItem rows.'),
  H.h4('Purpose'),
  H.p('Live "what if we had more devs / changed priorities / dropped an Epic" exploration. Save Scenario persists the input tuple to a client-scoped store (no Entity needed for v1.0); Apply writes changes to BacklogItem via PatchStory for each affected Story.'),
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
