// Section 17 — Risk Register
const H = require('./_helpers');

module.exports = [
  H.h1('17. Risk Register'),

  H.p('Top risks to v1.0 delivery and sustained operation. Severity and likelihood are scored 1–5; score = severity × likelihood. Mitigations should be tracked as tasks and their status reported alongside product status.'),

  H.h2('17.1 Top 10 Risks'),
  H.table(
    ['#', 'Risk', 'Sev', 'Like', 'Score', 'Mitigation', 'Owner'],
    [
      ['R1', 'LLM cost spiral on large (1,000+ row) uploads surprises the finance team', 3, 4, 12, 'Chunked grooming (8.11.11); per-tenant cost ceiling + circuit-breaker; cost dashboard on Admin view; per-project cost alerts', 'Engineering Manager'],
      ['R2', 'Jira field mapping differs between customer instances (custom workflows, custom priority schemes)', 3, 4, 12, 'Discover fields via /field on first push; allow per-project override of the mapping table; surface mapping errors per-item without aborting', 'Solution Architect'],
      ['R3', 'LLM hallucinates dependencies that do not actually exist', 4, 3, 12, 'Dependencies require reason text; user must approve agent-proposed deps; cycle detection catches the worst cases', 'Product Owner'],
      ['R4', 'Customer uploads contain PII the organisation cannot legally process with an LLM', 5, 2, 10, 'PII detector (NFR-SEC-9) warns pre-grooming; zero-data-retention contract with LLM providers (NFR-SEC-10); BA can redact-and-reupload', 'Compliance'],
      ['R5', 'Sonnet rate limits throttle mid-pipeline on a large upload, causing partial failure', 3, 3, 9, 'Three-attempt retry with exponential backoff; semaphore bounds concurrent calls; Gemini fallback where applicable; resume-from-stage (NFR-REL-1) for long pipelines', 'Engineering'],
      ['R6', 'Jira API version changes break the push integration', 4, 2, 8, 'Pin to v3; contract tests run on every release; monitor Atlassian deprecation notices; Forge component for Jira can provide insulation', 'Engineering'],
      ['R7', 'Users share API tokens in screenshots or bug reports accidentally', 3, 3, 9, 'Frontend never displays raw tokens; tokens encrypted at rest; audit log notes who saved a config but never the value; user education in app', 'Security Lead'],
      ['R8', 'Grooming takes longer than the user expects and they close the browser mid-run', 3, 3, 9, 'Durable server-side pipeline with resume capability; email-on-complete optional; clear ETA based on requirement count at start', 'UX'],
      ['R9', 'Stakeholder approval links are phished or shared inappropriately', 4, 2, 8, '30-day expiry; single-use tokens; approver email captured in audit; ability to revoke a pending token', 'Security Lead'],
      ['R10', 'ODC Mentor 2.0 prompt format changes and our generation becomes less effective', 3, 3, 9, 'Prompt template is configurable without code change; quarterly review of a sample of prompts against actual ODC Mentor output; feedback loop from developers via inline rating', 'Product Owner'],
    ],
    [500, 3200, 400, 400, 500, 3060, 1300],
  ),

  H.h2('17.2 Lower-Severity Risks (Tracked but Not in Top 10)'),
  H.bullet('Mermaid graph performance degrades beyond ~500 nodes — plan for Cytoscape or similar upgrade path (v2.0).'),
  H.bullet('Browser compatibility: Reactive Web in ODC targets evergreen browsers; confirm IE/legacy Edge are unsupported and set user expectations.'),
  H.bullet('Backup / restore rehearsals for the platform database — not Phase 12-specific but affects this feature disproportionately because story data is high-value.'),
  H.bullet('Localisation: the platform is English-only in v1.0. Localisation of agent prompts is a substantial undertaking; defer to v2.0+.'),
  H.bullet('Keyboard-only accessibility compliance needs testing with actual screen readers (NVDA, JAWS); visual-only review is insufficient for WCAG 2.2 AA.'),
];
