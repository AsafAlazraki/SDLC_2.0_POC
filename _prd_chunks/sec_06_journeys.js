// Section 7 — User Journeys
const H = require('./_helpers');

module.exports = [
  H.h1('7. User Journeys'),

  H.p('Three end-to-end journeys anchor the design. Each is described in Bianca-the-BA’s voice, with screen stops, decision points, and the handover to other personas. Specific screens referenced here are defined in Section 11.'),

  // ─── Journey 1 ───────────────────────────────────────────────────────
  H.h2('7.1 Journey 1 — First-Time Grooming'),
  H.p('Bianca receives an Excel file from the customer (WLMS_Business_Requirements_Consolidated.xlsx, 751 rows) for a new QPS Weapons Licence Management modernisation. She has never worked with this customer before; there is no prior project in the tool. Estimated journey duration: 2.5 hours (one hour of tool time plus 90 minutes of BA review).'),

  H.h3('7.1.1 Step-by-step'),
  H.num('Bianca logs in and clicks "New Project" from the Projects dashboard. She names it "QPS Weapons License Management", adds a one-line description, optionally tags it with a client.'),
  H.num('The project opens with empty tabs. She clicks the 🪄 Groomed Backlog tab.'),
  H.num('The Upload view greets her with a green banner confirming the default best-practice template is in use (no project-level template override needed). She drags the .xlsx file onto the drop zone.'),
  H.num('Within 5 seconds the tool shows a Mapping Preview. The LLM has auto-detected: "Use Case Ref" → id, "I want (Goal / The Want)" → description, "Original FR Ref#" → source, "#Tags (for Analysis)" → tags. Confidence shown as "medium" (mixed auto-detect + heuristic). Unmapped columns flagged: RTM#, Function, As a (Role / The Who), So that (Benefit / The Reason).'),
  H.num('Bianca reviews the mapping. She manually sets "As a (Role / The Who)" → owner. Everything else looks right.'),
  H.num('She sets Dev Count to 4 (the project’s anticipated team size) and clicks "▶ Start Grooming".'),
  H.num('A live progress panel appears below. Five stage dots animate from pending → running → complete. The Intake stage finishes in 2 seconds (751 → 748 requirements after deduping). The Cluster stage (Sonnet call) runs for ~90 seconds and produces 7 epics, 23 features.'),
  H.num('The Draft stage fans out across the 23 features. Bianca watches the log tick off each feature as it is completed; she switches tabs to finish a morning email.'),
  H.num('After ~35 minutes total, the Enrich stage completes and the Sequence stage fires almost instantly (pure compute). The progress banner turns green: "Grooming complete — 7 epic(s), 23 feature(s), 118 story(ies). Switch tabs to see result."'),
  H.num('Bianca clicks the Hierarchy tab. The full Epic → Feature → Story tree is rendered. Every story shows type, priority, points, and ODC entity chips.'),
  H.num('She clicks a story "Authenticate officer via departmental SSO". The detail modal opens with all 17 template fields populated: the Connextra statement, three AC in Given/When/Then, 5 story points, Must priority, NFR notes about session timeout, risks/assumptions flagging Okta dependency, ODC entities (OfficerProfile, AuthSession), ODC screens (LoginScreen), and a 450-word Mentor 2.0 prompt at the bottom. She copies the prompt to show a developer later.'),
  H.num('She switches to Dependencies. The Mermaid graph shows 118 nodes; 14 are highlighted red as the critical path. She spots a story "Legacy data migration: officer identities" on the critical path and realises it must start before authentication can ship. Tech Lead agent already captured that dependency.'),
  H.num('She switches to Multi-dev Schedule. With 4 devs the predicted delivery is 9 sprints. She clicks the dev count spinner to 5 and sees it drop to 7 sprints. She mentally files that to share with Priya in the next stand-up.'),
  H.num('She spends 90 minutes reviewing 5–10 stories per epic, editing where the agents were too generic, and marking three stories with the "needs customer clarification" tag for follow-up. She resolves 8 of 9 duplicate-like stories by deleting the weaker draft and merging the acceptance criteria into the remaining one.'),
  H.num('Once satisfied, she clicks "⚙️ Jira config", enters the target Jira domain (qps.atlassian.net), her email, her API token, and project key WLMS. The tool verifies /myself and /project/WLMS in under 2 seconds and confirms "authenticated as Bianca BA; project \u2018WLMS: Weapons Licence Management\u2019 found".'),
  H.num('She clicks "🚀 Push to Jira". A confirmation modal lists exact counts: 7 epics, 118 stories, 47 dependency links. She confirms. 30 seconds later the result toast shows "✓ Pushed 7 epic(s) + 118 story(ies) + 44 link(s). 3 errors (see console for details)."'),
  H.num('Clicking the three errors reveals two issues with a Jira custom field that does not accept the "Spike" issue type in this project — Bianca reclassifies those two stories as Tasks and re-pushes; the third error is a transient 429 that succeeded on the second push.'),

  H.h3('7.1.2 Exit state'),
  H.bullet('Jira project WLMS contains 7 new Epic issues, 118 new Story/Task issues linked to their epics, and ~44 blocks/blocked-by issue links.'),
  H.bullet('The Groomed Backlog tab in the tool is the canonical editable view; Jira is the execution view.'),
  H.bullet('Bianca has spent ~2.5 hours of active work. The equivalent manual process would have taken her ~2 weeks.'),

  // ─── Journey 2 ───────────────────────────────────────────────────────
  H.h2('7.2 Journey 2 — Customer Revision Mid-Engagement'),
  H.p('Three weeks into the engagement, the QPS customer sends a revised spreadsheet: 47 new requirements, 12 modified existing requirements (same Use Case Ref, changed text), and 8 requirements they no longer want. The engineering team is mid-sprint on stories from the original grooming.'),

  H.h3('7.2.1 Step-by-step'),
  H.num('Bianca uploads the revised Excel into the same project. The Previous Uploads panel shows the original upload from 3 weeks ago.'),
  H.num('The tool detects 12 rows have the same Use Case Ref but different descriptions. It also detects 8 rows that existed before and are now missing. It detects 47 entirely new rows.'),
  H.num('A "Re-upload Diff Preview" panel appears instead of the usual mapping preview. It shows three sections: NEW (47 rows to be groomed into new stories), CHANGED (12 rows whose stories may need updating), GONE (8 rows whose stories may need archiving).'),
  H.num('Bianca reviews. She approves the 47 NEW rows for grooming. For the 12 CHANGED rows she reviews each individually — for 9 she accepts the change (updating the existing stories with new descriptions), for 3 she flags the change as "requires customer clarification" before accepting. For the 8 GONE rows she chooses "archive the stories" — the stories remain in the tool with a GONE status, visible but not pushed to Jira again.'),
  H.num('She clicks "Start Grooming" which now runs only on the approved 47 new requirements plus the 9 changed ones. Previous groomed stories untouched by the revision are preserved verbatim, including any manual edits Bianca had made.'),
  H.num('15 minutes later grooming completes. The new stories are in the Hierarchy view; Bianca spot-reviews them (now she knows the domain better, review is faster), and then clicks Push to Jira.'),
  H.num('The push only creates new Jira issues for the 47 new stories. It updates the 9 changed stories in Jira via PATCH. It archives the 8 removed ones by setting them to Status=Cancelled in Jira with a comment explaining why.'),

  H.h3('7.2.2 Why this journey matters'),
  H.p('Revisions are where the competing commercial tools usually fall down. They either force a full re-groom (destroying manual edits) or they ignore revisions entirely and force the BA to patch the backlog by hand. The platform preserves prior work, surfaces only the delta for human review, and then applies the minimum change needed. This is the single most valuable workflow for long-running engagements.'),

  // ─── Journey 3 ───────────────────────────────────────────────────────
  H.h2('7.3 Journey 3 — Developer Pickup'),
  H.p('David is assigned four stories for the upcoming sprint. He opens Jira, picks up the first story, and begins implementation.'),

  H.h3('7.3.1 Step-by-step'),
  H.num('David opens the Jira issue. The description contains the Connextra statement and a link: "Groomed story detail — click for Mentor prompt."'),
  H.num('He clicks the link; the tool opens directly on the story detail modal. He reviews the acceptance criteria, sees the ODC entities named (OfficerProfile, AuthSession), notes the platform_notes saying to use a Reactive login screen, and checks the dependencies list (two blocking stories are marked Done in Jira — good).'),
  H.num('He clicks "Copy Mentor Prompt". The 450-word prompt lands on his clipboard.'),
  H.num('In a separate tab, ODC Mentor 2.0. He pastes the prompt. Mentor produces: an OfficerProfile entity scaffold confirming existing attributes, a service action "AuthenticateOfficer" with input/output schemas, a Reactive Web Block for the login UI that matches the project’s design system, unit test stubs, and a worked example of invoking the OAuth provider.'),
  H.num('He commits the scaffold to the project’s Git branch and begins iterating. First meaningful commit lands within 90 minutes of opening the story.'),

  H.h3('7.3.2 Why this journey matters'),
  H.p('This is where the platform’s ODC-awareness pays off. Generic Mentor prompts give developers generic scaffolding; the platform’s prompts give developers scaffolding that fits the existing codebase. The difference is measured in hours saved per story, multiplied across hundreds of stories per engagement.'),
];
