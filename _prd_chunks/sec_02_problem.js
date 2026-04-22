// Section 3 — Problem Statement
const H = require('./_helpers');

module.exports = [
  H.h1('3. Problem Statement'),

  H.h2('3.1 The Status Quo'),
  H.p('The handover from customer to delivery team is the single most fragile moment in an enterprise software engagement. The customer produces a requirements artefact — typically a Microsoft Excel workbook, sometimes a Confluence dump, occasionally a Word document — then expects the delivery team to reflect those requirements back as a Jira backlog within days. The team then has to simultaneously: translate the customer’s language into story-ready prose, infer structure (what is a theme, what is a feature, what is a story), detect dependencies that the customer did not make explicit, add acceptance criteria the customer did not provide, assess sizing, and populate the platform-specific fields (for an ODC project: entities touched, screens affected, Mentor prompt).'),

  H.p('This work happens three ways today. A senior Business Analyst can do it well but slowly — one person producing 40-60 groomed stories per week is realistic. A junior BA can do it quickly but loses quality — missed dependencies, thin acceptance criteria, inconsistent sizing. An engineering team can do it themselves, which trades BA time for senior developer time at a much higher cost per story. All three paths leave the same organisational scar: the backlog that emerges does not survive long-term. Its lineage to the customer’s original ask is lost, and when the customer produces the inevitable revision the team has to re-do the work from scratch.'),

  H.h2('3.2 Specific Pains'),
  H.table(
    ['#', 'Pain', 'Current impact', 'Who feels it'],
    [
      ['P1', 'Every customer uses a different spreadsheet column schema (RequirementID, ReqRef, RTM#, UseCaseRef, etc.)', 'BAs spend 2-3 hours per engagement just mapping and normalising columns before they can even begin grooming.', 'Business Analyst'],
      ['P2', 'Raw requirements are flat; structure (Epic → Feature → Story) must be inferred manually', '~30% of BA grooming time is spent on clustering, not on writing.', 'Business Analyst, Product Owner'],
      ['P3', 'Dependencies are almost never captured explicitly in the customer’s file', 'Cross-cutting dependencies surface only during sprint planning, causing re-sequencing and blocked stories mid-sprint.', 'Engineering Manager, Tech Lead'],
      ['P4', 'Acceptance criteria are missing or in prose, not testable Given/When/Then', 'QA cannot begin test design until BA circles back; ~1 sprint of shift-left testing is lost.', 'QA Lead, Tech Lead'],
      ['P5', 'Story size estimation is inconsistent', 'Velocity-based forecasting is unreliable for the first 2-3 sprints of every engagement.', 'Engineering Manager'],
      ['P6', 'Mentor/ODC-specific prompts are always hand-crafted per story', 'Developers write the prompt themselves before they can leverage ODC Mentor 2.0, wasting 15-30 minutes per story.', 'OutSystems Developer'],
      ['P7', 'The backlog in Jira has no lineage back to the customer’s original requirement', 'When the customer says "that was requirement R-147", no one can find which Jira issue addressed it.', 'Product Owner, Customer'],
      ['P8', 'Customer revisions force a full re-groom', 'BAs rebuild large sections of the backlog manually; risk of dropping work the team had already started.', 'Business Analyst'],
      ['P9', 'Multi-dev parallelisation is not modelled during grooming', 'Sprint planning surprises the team with stories that could have run in parallel, or stories that cannot because a blocker is unfinished.', 'Engineering Manager, Tech Lead'],
      ['P10', 'The three-strategic-paths conversation (what if we had more devs? what if we prioritised differently?) requires custom spreadsheet modelling every time', 'Leadership asks "when will this ship" and gets a single fragile date that collapses on the first change.', 'Product Owner, Engineering Manager'],
    ],
    [600, 2500, 3260, 3000],
  ),

  H.h2('3.3 Why Now'),
  H.p('Three forces have converged to make this problem addressable now where it was not five years ago. First, large language models can reliably perform the language-to-structure translation that previously required a human expert — recent frontier models (Claude Sonnet 4.6, Gemini 2.0 Flash) pass human-quality thresholds for user-story drafting and cross-document reasoning. Second, OutSystems Developer Cloud exposes the AI Agent infrastructure needed to integrate these models without a custom hosting stack, and ODC Mentor 2.0 provides a downstream target that rewards a high-quality, platform-aware prompt. Third, Atlassian’s Jira Cloud REST v3 API has stabilised around a model (hierarchy of Epic/Story, custom fields via discoverable schema, issue links for dependencies) that makes programmatic push tractable.'),

  H.p('The reference Python implementation validated the technical hypothesis: a 5-stage pipeline orchestrating six collaborating agents can produce a backlog a BA would sign off on after a 90-minute review. The value hypothesis is now to prove: in an OutSystems environment with governance, identity, and multi-tenant concerns, can we deliver the same quality at the same speed while fitting the delivery team’s actual workflow?'),

  H.h2('3.4 What This Document Is Not'),
  H.bullet('Not a replacement for BAs. The tool is an accelerator the BA supervises. It produces first-draft stories; the BA reviews, edits, and approves. The tool never pushes to Jira without explicit user action.'),
  H.bullet('Not an all-or-nothing tool. Users can groom a subset of requirements, edit a single story by hand, push a partial backlog, and re-run grooming on the remaining requirements later.'),
  H.bullet('Not a Jira replacement. Jira remains the execution system of record. This tool is upstream of Jira, not parallel to it.'),
  H.bullet('Not locked to ODC. Grooming agents produce ODC-aware content when the project has an OutSystems blueprint available; on non-OutSystems projects they fall back gracefully and simply omit the ODC-specific fields.'),
];
