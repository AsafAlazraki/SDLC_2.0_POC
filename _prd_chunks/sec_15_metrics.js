// Section 16 — Success Metrics & KPIs
const H = require('./_helpers');

module.exports = [
  H.h1('16. Success Metrics & KPIs'),

  H.p('The platform is successful when it demonstrably collapses the time-to-first-reviewable-backlog while holding or improving quality. Metrics are divided into Leading (measurable within days), Lagging (measurable after one engagement), and Quality-of-Life (longer-term team health).'),

  H.h2('16.1 Leading Metrics (per engagement)'),
  H.table(
    ['KPI', 'How measured', 'Target', 'Stretch'],
    [
      ['Time from upload to first reviewable backlog', 'Timestamp of upload → grooming_complete event', '< 60 minutes', '< 30 minutes'],
      ['Column auto-detect accuracy', '% of columns mapped correctly without user override', '\u2265 80%', '\u2265 95%'],
      ['Cluster re-run rate', '% of grooming runs that triggered the cluster retry path', '\u2264 15%', '\u2264 5%'],
      ['Story quality scores (median)', 'Clarity, Completeness, Testability composite', '\u2265 75 per sub-score', '\u2265 85'],
      ['Dependencies caught at draft time', 'Deps auto-detected / total deps eventually noted', '\u2265 80%', '\u2265 95%'],
      ['Uncovered requirement rate', 'Requirements producing 0 stories', '\u2264 3%', '< 1%'],
    ],
    [2800, 3000, 1800, 1760],
  ),

  H.h2('16.2 Lagging Metrics (per engagement, end of first sprint)'),
  H.table(
    ['KPI', 'How measured', 'Target'],
    [
      ['First-code-commit-time per story', 'Jira timestamps: story In Progress → first related commit', '\u2264 same day'],
      ['Sprint mid-flight surprises', 'Stories blocked mid-sprint due to missed dependency', '\u2264 1 per 50 stories'],
      ['AC completeness at first QA review', '% of stories with full G/W/T + negative path', '\u2265 95%'],
      ['Story points variance vs actuals', 'Median abs(estimated - actual) / estimated', '\u2264 30% (first sprint); \u2264 15% (by sprint 3)'],
      ['Stakeholder sign-off lag', 'Send approval request → receive all responses', '\u2264 3 business days'],
    ],
    [2600, 4000, 2760],
  ),

  H.h2('16.3 Quality-of-Life Metrics'),
  H.table(
    ['KPI', 'How measured', 'Target'],
    [
      ['BA hours per 300 requirements', 'Time-tracking survey end of engagement', '\u2264 4 hours review (vs 40 today)'],
      ['BA Net Promoter Score on the tool', 'Quarterly NPS survey', '\u2265 +40'],
      ['Product Owner confidence in forecasts', '"How confident are you in the delivery date?" 1-10', '\u2265 7/10'],
      ['Engineering Manager surprise reduction', '% reduction in "surprise" sprint blockers vs prior baseline', '\u2265 50% reduction by engagement 3'],
      ['Developer first-prompt-success', '% of Mentor prompts that scaffold usable code first pass', '\u2265 70%'],
    ],
    [2800, 4000, 2560],
  ),

  H.h2('16.4 Cost KPIs'),
  H.table(
    ['KPI', 'Target', 'Absolute ceiling'],
    [
      ['Grooming cost per 100 stories', '\u2264 $4 USD', '\u2264 $10 USD'],
      ['Cost of Jira push per 100 issues', '\u2264 $0.01 USD (API call cost)', '—'],
      ['Storage cost per project per year', '\u2264 $1 USD', '\u2264 $10 USD'],
      ['Total run cost for a 300-row engagement', '\u2264 $15 USD', '\u2264 $50 USD'],
    ],
    [4000, 2800, 2560],
  ),

  H.h2('16.5 Instrumentation Plan'),
  H.bullet('Every KPI MUST have a dashboard view with filters by project, engagement, and date range.'),
  H.bullet('The Admin area exposes the KPI dashboard; read access restricted to project owners and admins.'),
  H.bullet('Weekly automated email digest to the delivery director summarising the top-5 KPI trends.'),
  H.bullet('Quarterly deep-dive review where targets are reassessed and re-baselined.'),
];
