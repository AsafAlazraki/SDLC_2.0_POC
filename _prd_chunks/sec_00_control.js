// Section 1 — Document Control
const { Paragraph, TextRun, PageBreak } = require('docx');
const H = require('./_helpers');

module.exports = [
  H.h1NoBreak('1. Document Control'),
  H.p('This document is the authoritative specification for rebuilding the Requirements Intelligence Platform on OutSystems. It is maintained by the product owner and should be version-bumped on every material change. Previous versions must be preserved in the document repository.'),
  H.spacer(),

  H.table(
    ['Field', 'Value'],
    [
      ['Document title', 'Requirements Intelligence Platform — Product Requirements Document'],
      ['Version', '1.0'],
      ['Status', 'Draft for OutSystems rebuild'],
      ['Owner', 'Asaf Alazraki'],
      ['Author', 'Product + Engineering, co-authored'],
      ['Reviewers', 'Architecture board, Product Owner, Engineering Manager, Customer advocate'],
      ['Approval cadence', 'v1.0 approved at architecture kick-off; quarterly review thereafter'],
      ['Classification', 'Internal — distribute within organisation only'],
      ['Date created', new Date().toISOString().slice(0, 10)],
      ['Last updated', new Date().toISOString().slice(0, 10)],
      ['Related documents', 'SDLC Discovery Engine CLAUDE.md; LEARNINGS.md; Phase 12 codebase'],
      ['Source reference implementation', 'Python/FastAPI reference at github.com/AsafAlazraki/SDLC_2.0_POC (Phase 12 commits e6e6155, 2155ccc, bb31604, c9c7187, 2b1c9bc, 9fbce0d)'],
    ],
    [2800, 6560],
  ),
  H.spacer(),

  H.h2('1.1 Change History'),
  H.table(
    ['Version', 'Date', 'Author', 'Summary of change'],
    [
      ['0.1', '2026-04-15', 'Engineering', 'Initial Python prototype (Phase 12 on the Discovery Engine) — proved the concept end-to-end with 18 API endpoints and a 5-stage grooming pipeline.'],
      ['0.9', '2026-04-20', 'Product', 'Captured enhancement wishlist after live demo: duplicate detection, quality scoring, approval workflow, what-if simulator.'],
      ['1.0', new Date().toISOString().slice(0, 10), 'Asaf Alazraki', 'First full PRD cutover draft for the OutSystems rebuild. Consolidates the reference implementation behaviour, the enhancements backlog, and the target ODC architecture.'],
    ],
    [1000, 1400, 1600, 5360],
  ),
  H.spacer(),

  H.h2('1.2 Glossary Location'),
  H.p('A full glossary is provided in Section 19. Readers should scan it once before diving into the functional requirements; the document uses platform-specific terminology (ODC, Service Action, Forge, BPT, etc.) without re-defining each term inline.'),

  H.h2('1.3 Reading Guide'),
  H.bullet('For product + BA audiences: start at Section 2 (Executive Summary), then 4 (Personas), then 7 (User Journeys), then skim Section 8 (Functional Requirements).'),
  H.bullet('For engineering audiences: read Section 8 in full, then Section 10 (Data Model), Section 12 (State Machines), and the entire Section 18 (OutSystems Implementation Guide).'),
  H.bullet('For architects: Section 18 first, then 8.4 (Agent-Driven Grooming Pipeline), then 14 (Integrations). Section 9 (NFRs) defines the performance and security bar.'),
  H.bullet('For QA: Section 15 (Acceptance Criteria in Gherkin) is the test-design starting point.'),
  H.bullet('For anyone: Section 17 (Risk Register) before design sign-off, Section 16 (Success Metrics) before implementation.'),
];
