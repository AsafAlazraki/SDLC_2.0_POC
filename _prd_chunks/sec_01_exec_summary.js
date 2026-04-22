// Section 2 — Executive Summary
const H = require('./_helpers');

module.exports = [
  H.h1('2. Executive Summary'),

  H.p('Every enterprise software engagement begins with the same artefact: a spreadsheet of requirements from the customer. It is usually messy — 300 to 2,000 rows, inconsistent priorities, terminology that shifts between rows, duplicate entries filed under different reference IDs, and critical dependencies implied in free-text notes rather than captured explicitly. Business Analysts then spend one to three weeks grooming this into a Jira backlog the engineering team can actually execute against. The output quality is inconsistent because it depends on the individual BA’s stamina; stories end up missing acceptance criteria, skipping non-functional considerations, or ignoring cross-cutting dependencies.'),

  H.p('The Requirements Intelligence Platform collapses this one-to-three-week manual process into a 30-to-60-minute supervised pipeline. It accepts the customer’s spreadsheet verbatim, uses a large language model to detect column semantics, and runs a six-agent grooming pipeline that produces a fully structured Epic → Feature → Story hierarchy. Each story carries an industry-standard user story statement, Given/When/Then acceptance criteria, Fibonacci story points, MoSCoW priority, dependencies detected from cross-story analysis, a definition of done, non-functional considerations, ODC entity and screen attributions where relevant, and — uniquely — a ready-to-paste ODC Mentor 2.0 prompt grounded in the project’s own OutSystems architecture blueprint.'),

  H.p('The resulting backlog is not a one-way deliverable. It renders in four complementary views: a Kanban-style hierarchy tree, a dependency graph with the critical path highlighted, a multi-developer Gantt showing predicted delivery dates under different staffing scenarios, and a Mentor-prompt-per-story list that developers copy directly into ODC Mentor 2.0. At any point the user can edit stories, refine acceptance criteria with AI assistance, re-run the grooming to incorporate new requirements with a diff preview, and then push the entire tree to Jira with correctly-linked epics, stories, and blocks/blocked-by issue links.'),

  H.p('This PRD documents the feature in sufficient detail for a full OutSystems rebuild. The reference implementation already runs end-to-end in Python/FastAPI — every behaviour in this document has been observed, measured, and, where it failed, hardened. The rebuild preserves the core pipeline and extends it with twelve enhancements identified during live use: smart duplicate detection across uploads, AI-driven story quality scoring, inline conversational refinement, a template library of pre-built domain-specific story templates, stakeholder approval workflows, velocity-based delivery predictions, a what-if simulator, a requirement coverage heatmap, Gherkin export for BDD tooling, cross-project reusable epics, chunked grooming for uploads exceeding 1,000 rows, and per-story confidence badges surfaced from agent agreement.'),

  H.h2('2.1 Outcomes at a Glance'),
  H.table(
    ['Metric', 'Before', 'Target (v1.0)', 'Stretch'],
    [
      ['Time from CSV to Jira backlog', '1–3 weeks', '60 minutes', '15 minutes'],
      ['Acceptance criteria completeness', '~50% of stories', '\u2265 95%', '100%'],
      ['Dependencies detected at draft time', '~15%', '\u2265 80%', '\u2265 95%'],
      ['Stories pushed to Jira cleanly', 'Manual copy/paste', '\u2265 95% on first push', '100%'],
      ['Developer lead time to first code commit', '2–5 days after story assignment', 'Same day (with Mentor prompt)', 'Within 2 hours'],
      ['BA time per 300 requirements', '~40 hours', '\u2264 4 hours review', '\u2264 2 hours'],
    ],
    [3200, 2000, 2000, 2160],
  ),

  H.h2('2.2 Why OutSystems'),
  H.p('The customer organisation standardises delivery on OutSystems Developer Cloud (ODC). The reference Python implementation was a fast way to prove the pipeline, but it lives outside the platform and therefore outside the governance, audit, and deployment infrastructure the customer already operates. Rebuilding on ODC brings the platform into the single-pane-of-glass the rest of the delivery stack uses — authentication, audit logs, data residency, CI/CD gates, LifeTime-managed environments, and the OutSystems AI Agent infrastructure are all in place already. The platform also happens to be the target of the Mentor prompts themselves, which makes hosting the tool on it an elegant closing of the loop.'),
];
