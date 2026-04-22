// Section 4 — Vision & Value Proposition
const H = require('./_helpers');

module.exports = [
  H.h1('4. Vision & Value Proposition'),

  H.h2('4.1 Vision Statement'),
  H.pRuns([
    { bold: true, text: 'Every delivery team, on the day the customer hands over their requirements, should have a reviewable, platform-aware, Jira-ready backlog in their hands by end-of-day — with developer-ready Mentor prompts attached to every story, dependencies made explicit, and a multi-dev schedule that tells leadership when it will ship under several realistic staffing scenarios.' }
  ].map(r => new (require('docx').TextRun)(r))),

  H.p('The tool does not replace the Business Analyst. It elevates them. The BA becomes an editor and decision-maker rather than a typist — reviewing agent drafts, merging duplicates, resolving ambiguities the agents flagged, and curating the story template to match the customer’s domain. The tool handles the tedious translation work; the BA handles the judgement work that only they can do.'),

  H.h2('4.2 Value Pillars'),

  H.h3('4.2.1 Speed'),
  H.p('The end-to-end pipeline — upload, auto-map columns, cluster into epics, draft stories, enrich with specialist agents, sequence with dependency detection, generate Mentor prompts, and present in a reviewable UI — completes in 30 to 60 minutes for a typical 300-row customer upload. For context, a senior BA working in the current spreadsheet-and-Jira workflow produces the equivalent in one to three weeks. The tool is therefore a 30-to-150-times speed multiplier on the drafting step, with review time added on top.'),

  H.h3('4.2.2 Quality'),
  H.p('Every groomed story carries the fields that industry best practice requires: Connextra-format user story, three or more Given/When/Then acceptance criteria with at least one negative path, Fibonacci-sized story points, MoSCoW priority, named dependencies with reasoning, a definition of done, and non-functional considerations specific to that story. These fields are not optional — the grooming pipeline refuses to emit a story that is missing any of them. The result is a baseline quality floor the organisation could never consistently achieve with manual grooming.'),

  H.h3('4.2.3 Platform-Aware Output'),
  H.p('The ODC Mentor 2.0 prompt generated per story is the decisive differentiator. Because the grooming pipeline runs after the main SDLC Discovery Engine analysis, it has access to the project’s OutSystems architecture blueprint — the entities, service actions, screens, and Forge components that already exist in the customer’s ODC environment. The Mentor prompt for story X references entity Y by name because Y is known to exist; it suggests screen Z as the surface because Z is the existing login experience. Developers paste the prompt into ODC Mentor and receive scaffolding that fits the existing codebase rather than generic OutSystems templates.'),

  H.h3('4.2.4 Auditability'),
  H.p('Every story records its lineage: the source requirement row(s) that produced it, the agents that contributed, the user who approved it, the date each field was last edited, the Jira issue key it was pushed as, and the last three versions of its Mentor prompt. The customer can ask "what happened to requirement R-147?" and the tool can answer in one click. This is the scar the status quo leaves that the rebuild must close.'),

  H.h3('4.2.5 Adaptability'),
  H.p('The story template is editable per project. Government engagements want a "Regulatory reference" field; healthcare wants "PHI classification"; finance wants "SOX impact". The tool ships with a library of pre-built templates for common regulated domains and lets organisations save their own. The grooming agents are driven from the template so a field added on Monday flows into every story groomed on Tuesday.'),

  H.h3('4.2.6 Honest Scheduling'),
  H.p('The multi-dev schedule is not a Gantt export from Microsoft Project. It is computed from the real dependency graph, respects the critical path, and allows leadership to ask "what if?" interactively — add a developer, re-prioritise an epic, change sprint capacity — and see the delivery date shift in real time. Forecasts given to customers are grounded in the actual backlog and the team’s actual velocity (once the first sprint completes and real data is available).'),

  H.h2('4.3 Value to Each Audience'),
  H.table(
    ['Audience', 'Value delivered', 'Measurable outcome'],
    [
      ['Business Analyst', 'Removes the 40-hour typing task; the BA reviews and judges rather than drafts.', 'BA time per engagement drops from 1-3 weeks to 2-4 days of review.'],
      ['Product Owner', 'A credible, citation-backed backlog ready for stakeholder review on day one.', 'Stakeholder sign-off conversations shift from "what do we have?" to "should we include this?"'],
      ['Engineering Manager', 'Honest delivery forecasts grounded in the dependency graph; realistic multi-dev staffing conversations.', 'Sprint planning surprises drop; "when will this ship?" has a defensible answer.'],
      ['OutSystems Developer', 'Ready-to-paste Mentor 2.0 prompts grounded in the project’s own ODC blueprint; entities and screens named correctly.', 'First-code-commit time drops from 2-5 days to same-day.'],
      ['QA Lead', 'Given/When/Then acceptance criteria on every story from day one; Gherkin export for BDD tooling.', 'QA test design starts alongside development rather than after it; shift-left becomes real.'],
      ['Customer / Stakeholder', 'Every story is traceable back to their original requirement. Revisions are diffed, not re-done.', 'Trust goes up; re-work drops; invoices are easier to explain.'],
      ['Leadership', 'Interactive what-if simulator for the "add a dev, change a priority, what shifts?" conversation.', 'Decisions are data-grounded and auditable.'],
    ],
    [1800, 3680, 3880],
  ),

  H.h2('4.4 Non-Goals (Explicitly Out of Scope)'),
  H.bullet('Replacing Jira. The tool is upstream of Jira. Execution happens in Jira; this tool exists to populate it correctly.'),
  H.bullet('Managing sprints, assignments, or velocity after grooming. That is Jira’s job. The tool consumes velocity as an input for forecasting but does not control sprint execution.'),
  H.bullet('Auto-pushing without user approval. Every Jira push is explicit and confirmed.'),
  H.bullet('Replacing the customer conversation. Ambiguous requirements produce agent flags; the BA must resolve them with the customer. The tool does not hallucinate answers to questions the customer didn’t answer.'),
  H.bullet('Supporting non-Atlassian ticketing systems in v1.0. Azure DevOps, Linear, Monday, ClickUp are on the roadmap but not initial scope.'),
];
