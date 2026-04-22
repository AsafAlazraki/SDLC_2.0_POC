// Section 9 — Non-Functional Requirements
const H = require('./_helpers');

module.exports = [
  H.h1('9. Non-Functional Requirements'),

  H.p('Non-functional requirements define the bar below which the product is not shippable, even if all functional requirements are met. Each NFR has a target and an absolute-minimum threshold; targets drive design, thresholds drive go/no-go at release.'),

  H.h2('9.1 Performance'),
  H.table(
    ['ID', 'Metric', 'Target', 'Absolute minimum'],
    [
      ['NFR-PERF-1', 'Upload + column auto-detect (300-row file)', '\u2264 6 seconds end-to-end', '\u2264 15 seconds'],
      ['NFR-PERF-2', 'Upload + column auto-detect (2,000-row file)', '\u2264 20 seconds', '\u2264 60 seconds'],
      ['NFR-PERF-3', 'Cluster stage on 200 requirements', '\u2264 90 seconds', '\u2264 3 minutes'],
      ['NFR-PERF-4', 'Draft stage per feature', '\u2264 45 seconds', '\u2264 2 minutes'],
      ['NFR-PERF-5', 'Enrich stage per feature (5 agents concurrent)', '\u2264 90 seconds', '\u2264 4 minutes'],
      ['NFR-PERF-6', 'Full pipeline on a 300-row, 5-epic, 20-feature engagement', '\u2264 30 minutes', '\u2264 60 minutes'],
      ['NFR-PERF-7', 'Hierarchy tree render on 500 stories', '\u2264 400 ms', '\u2264 1.5 s'],
      ['NFR-PERF-8', 'Dependency graph Mermaid render on 500 stories', '\u2264 1.5 s', '\u2264 5 s'],
      ['NFR-PERF-9', 'Multi-dev schedule recompute on 500 stories', '\u2264 200 ms', '\u2264 1 s'],
      ['NFR-PERF-10', 'What-if simulator response to control change', '\u2264 200 ms', '\u2264 500 ms'],
      ['NFR-PERF-11', 'Jira push on 7 epics + 120 stories + 50 links', '\u2264 90 seconds', '\u2264 5 minutes'],
      ['NFR-PERF-12', 'Story detail modal open', '\u2264 200 ms (cached) / \u2264 500 ms (cold)', '\u2264 1 s'],
    ],
    [1100, 5000, 1600, 1660],
  ),

  H.h2('9.2 Security & Privacy'),
  H.p('Requirements spreadsheets may contain sensitive information — stakeholder names, internal product codenames, sometimes (inadvertently) PII. The platform must treat every upload as potentially sensitive and meet the customer organisation’s security baseline.'),
  H.table(
    ['ID', 'Requirement', 'Notes'],
    [
      ['NFR-SEC-1', 'All data in transit MUST use TLS 1.2 or higher.', 'ODC handles this by default on the platform ingress'],
      ['NFR-SEC-2', 'Requirements data at rest MUST be encrypted by the underlying storage engine.', 'OutSystems platform database encryption-at-rest is sufficient'],
      ['NFR-SEC-3', 'Jira API tokens MUST be stored with reversible encryption (required for outbound calls) using the platform’s secret store, never plaintext.', 'Use OutSystems Application Properties encrypted or Secret Keeper pattern'],
      ['NFR-SEC-4', 'Jira API tokens MUST NEVER be returned to the frontend except masked (e.g. "***").', 'The GET /jira-config endpoint returns has_token: bool and masked api_token'],
      ['NFR-SEC-5', 'User authentication MUST integrate with the customer’s existing identity provider (SAML 2.0 SSO).', 'Reuse the OutSystems platform auth'],
      ['NFR-SEC-6', 'The system MUST log every upload, every Jira push, and every approval request with user ID, timestamp, and IP. Audit retention ≥ 7 years.', 'Government/regulated customers require this'],
      ['NFR-SEC-7', 'Users MUST be able to permanently delete a project and all its data on request; the delete MUST cascade through materials, runs, artefacts, and Jira config.', 'GDPR Article 17 ("right to erasure") compliance'],
      ['NFR-SEC-8', 'Stakeholder approval links MUST expire after 30 days or single use (whichever comes first).', 'Stops stale tokens being replayed'],
      ['NFR-SEC-9', 'The system MUST detect obvious PII patterns (email, phone, tax ID, SSN regex) in uploaded requirements and warn the user before grooming proceeds.', 'NEW enhancement — not in reference implementation'],
      ['NFR-SEC-10', 'LLM calls (Claude, Gemini) MUST use the customer organisation’s commercial account with zero-data-retention enabled.', 'No LLM vendor may retain customer data for training'],
    ],
    [1100, 5500, 2760],
  ),

  H.h2('9.3 Reliability & Error Handling'),
  H.table(
    ['ID', 'Requirement', 'Notes'],
    [
      ['NFR-REL-1', 'The pipeline MUST be resumable — if the server restarts mid-grooming, the user MUST be able to resume from the last completed stage.', 'v1.0 target; reference implementation does not yet do this'],
      ['NFR-REL-2', 'Agent failures (rate limit, malformed response, timeout) MUST NOT abort the pipeline for other agents.', 'Resilient per reference implementation'],
      ['NFR-REL-3', 'Retry policy for Anthropic: up to 3 attempts with exponential backoff 15s / 30s / 60s.', 'Proven in reference'],
      ['NFR-REL-4', 'Retry policy for Gemini: up to 3 attempts with 5s / 10s / 20s.', 'Gemini rate limits are tighter'],
      ['NFR-REL-5', 'Cross-provider fallback: Anthropic → Gemini on exhausted retries, Gemini → Anthropic on auth/quota errors (short-circuit if no key).', 'Preserves the bidirectional fallback from Phase 8 of the reference implementation'],
      ['NFR-REL-6', 'Jira push MUST handle HTTP 429 (rate limit) with automatic retry after the server-supplied Retry-After header.', ''],
      ['NFR-REL-7', 'All SSE-style progress events MUST include a stage and status; end-of-stream with no grooming_complete MUST be surfaced to the user as an explicit error (not silently reported as success).', 'Direct lesson from the 751-row reference-implementation bug'],
      ['NFR-REL-8', 'Persistent storage operations MUST be idempotent on retry.', 'Upserts, not blind inserts, on all artefact writes'],
    ],
    [1100, 5700, 2560],
  ),

  H.h2('9.4 Auditability'),
  H.table(
    ['ID', 'Requirement', 'Notes'],
    [
      ['NFR-AUD-1', 'Every story MUST record its lineage: source requirement_ids, Draft agent call ID, Enrich agent call IDs, last user editor, last edit timestamp per field.', 'Field-level audit requires schema design up front'],
      ['NFR-AUD-2', 'Every Jira push MUST log: time, user, config used (domain + project_key, NOT the token), items pushed, items failed, final Jira issue keys.', 'Already implemented as jira_push_event in reference'],
      ['NFR-AUD-3', 'Every approval request MUST log send time, responded-at time, responder identity (email if tokenised), and response value.', ''],
      ['NFR-AUD-4', 'The audit log MUST be exportable as CSV by authorised users.', ''],
      ['NFR-AUD-5', 'Deletes MUST be soft deletes by default; hard delete requires an explicit second confirmation and is logged separately.', ''],
    ],
    [1100, 5700, 2560],
  ),

  H.h2('9.5 Scalability'),
  H.table(
    ['ID', 'Target', 'Approach'],
    [
      ['NFR-SCALE-1', 'Handle a single upload of up to 5,000 rows', 'Chunked grooming (8.11.11); cluster in batches of 200; merge epics in a second pass'],
      ['NFR-SCALE-2', 'Support 50 concurrent users per tenant, no interactive degradation', 'Stateless service tier; most work is async'],
      ['NFR-SCALE-3', 'Support 100 concurrent grooming pipelines per tenant', 'Queue-backed; long-running jobs execute on Timers (OutSystems) with controlled concurrency'],
      ['NFR-SCALE-4', 'Database growth: plan for 1 TB per tenant after 24 months', 'Archival strategy: groomed artefacts older than 18 months move to cold storage; raw_rows pruned after 6 months'],
      ['NFR-SCALE-5', 'Jira rate limits respected even at scale', 'Bulk operations use Jira bulk endpoints where available; otherwise strict token bucket per tenant'],
    ],
    [1200, 2500, 5660],
  ),

  H.h2('9.6 Usability / Accessibility'),
  H.table(
    ['ID', 'Requirement', 'Notes'],
    [
      ['NFR-UX-1', 'The UI MUST meet WCAG 2.2 AA baseline — keyboard navigable, screen-reader friendly, sufficient contrast.', 'Regulated-sector customer requirement'],
      ['NFR-UX-2', 'Critical actions (Start Grooming, Push to Jira) MUST require confirmation.', 'Prevent accidental large-scale operations'],
      ['NFR-UX-3', 'Destructive actions (delete project, clear Jira config) MUST require an explicit second confirmation naming the target.', ''],
      ['NFR-UX-4', 'Progress indicators MUST be visible for any operation taking > 500 ms.', 'Live SSE panel for grooming; spinners elsewhere'],
      ['NFR-UX-5', 'Error messages MUST be actionable: what broke, why, what to try.', 'Not "Internal Server Error"'],
      ['NFR-UX-6', 'Every dialog MUST be dismissible via ESC.', ''],
      ['NFR-UX-7', 'The platform MUST be usable on a 1280×800 display (minimum laptop target); smaller screens degrade gracefully.', 'Mobile is read-only (see OoS-10)'],
    ],
    [1100, 5700, 2560],
  ),

  H.h2('9.7 Observability'),
  H.bullet('Every LLM call MUST record: provider, model, token counts, duration, cost. Aggregated per project and per run.'),
  H.bullet('Every Jira API call MUST record: endpoint, status code, duration, retry count. Aggregated per push event.'),
  H.bullet('Every grooming stage MUST record: duration, success/failure, requirement count processed.'),
  H.bullet('Metrics MUST be exposed on an Admin dashboard filterable by project and date range.'),
  H.bullet('Structured logs MUST include a correlation ID that spans the entire grooming lifecycle.'),
];
