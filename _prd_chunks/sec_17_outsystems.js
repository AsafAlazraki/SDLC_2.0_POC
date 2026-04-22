// Section 18 — OutSystems Implementation Guide
const H = require('./_helpers');

module.exports = [
  H.h1('18. OutSystems Implementation Guide'),

  H.p('This section is written specifically for the OutSystems engineering team who will deliver the rebuild. It assumes familiarity with ODC, the 4-Layer Architecture Canvas, Service Actions, Entities, and the Forge. Where the reference Python implementation does something that does not map cleanly onto ODC, the platform-idiomatic alternative is described with rationale.'),

  H.h2('18.1 Platform Choice — ODC vs O11'),

  H.h3('18.1.1 Recommendation: OutSystems Developer Cloud (ODC)'),
  H.p('Build on ODC. The rebuild is greenfield; there is no existing O11 codebase to migrate. ODC is the customer’s standard for new-build engagements, and ODC-first architecture gives us features we would otherwise have to build (multi-tenant identity, fine-grained audit, Forge AI Agent infrastructure, native Git/CI/CD via the ODC CLI, environment promotion via the ODC Portal).'),

  H.table(
    ['Dimension', 'ODC', 'O11 (classic)', 'Decision'],
    [
      ['New build appropriateness', 'Target platform for all new builds at the customer organisation', 'Legacy platform; migration-only', 'ODC'],
      ['External REST integration', 'Built-in Integration Builder; direct consumption of REST in Service Actions', 'Supported via External Logic', 'Tie; slight edge to ODC for modern tooling'],
      ['AI Agent hosting', 'Native AI Agent infrastructure; LLM integrations via Forge connectors', 'Requires custom hosting', 'ODC'],
      ['Long-running workflows', 'BPT deprecated; Workflow Builder is the modern alternative', 'BPT supported but legacy', 'ODC (Workflow Builder)'],
      ['Timers for async orchestration', 'Supported; native to the runtime', 'Supported; native', 'Tie'],
      ['CI/CD', 'ODC CLI + LifeTime equivalent; Git-native', 'LifeTime', 'ODC'],
      ['Multi-tenant identity', 'First-class', 'Requires manual set-up', 'ODC'],
    ],
    [1500, 2200, 2200, 3460],
  ),

  H.h3('18.1.2 Deployment Topology'),
  H.bullet('Environments: Development → Testing → Production, per standard ODC pattern. Staging is a testing environment flavour.'),
  H.bullet('One ODC Organisation; the platform is deployed as three apps (see Section 18.4).'),
  H.bullet('Secrets managed via ODC Portal secrets store; never in code or configuration files.'),
  H.bullet('Observability via ODC’s native dashboards plus structured logs emitted through the OutSystems Log mechanism; forwarded to the customer’s SIEM.'),

  H.h2('18.2 4-Layer Architecture Canvas'),

  H.p('The platform follows the canonical OutSystems Architecture Canvas. Three applications and a set of shared libraries. Diagrammed textually below; colour-codings match the canvas conventions (yellow = End-User, blue = Core, green = Foundation).'),

  ...H.code(`                  ┌─────────────────────────────────────────────┐
 End-User Layer   │   Backlog_Planner (reactive web app, UX)    │
 (YELLOW)         │                                              │
                  └───────────────────┬──────────────────────────┘
                                      │ consumes Service Actions
                  ┌───────────────────▼──────────────────────────┐
 Core Layer       │   BacklogCore (service application)          │
 (BLUE)           │   ┌─────────────────────────────────────┐   │
                  │   │ Requirements_Service                │   │
                  │   │   - Upload                          │   │
                  │   │   - Parse + Normalise               │   │
                  │   │   - ColumnMapping autodetect        │   │
                  │   │   - Duplicate detection             │   │
                  │   ├─────────────────────────────────────┤   │
                  │   │ Grooming_Service                    │   │
                  │   │   - Pipeline orchestrator           │   │
                  │   │   - Stage state machine (Timer)     │   │
                  │   │   - Per-agent invoker               │   │
                  │   ├─────────────────────────────────────┤   │
                  │   │ Jira_Integration_Service            │   │
                  │   │   - Config verify                   │   │
                  │   │   - Issue push (epic/story)         │   │
                  │   │   - Issue link creator              │   │
                  │   └─────────────────────────────────────┘   │
                  │                                              │
                  │  Entities: Project, BacklogItem, RequirementsUpload,
                  │            RequirementRow, MentorPrompt,
                  │            JiraConfig, JiraPushEvent, ApprovalRequest,
                  │            StoryTemplate, StoryRefinement
                  └───────────────────┬──────────────────────────┘
                                      │ depends on
                  ┌───────────────────▼──────────────────────────┐
 Foundation Layer │   BacklogLib (library app)                   │
 (GREEN)          │   ┌──────────────────────────────────────┐   │
                  │   │ CsvExcelParser  (CSV + xlsx)         │   │
                  │   │ LlmClient       (Claude + Gemini)    │   │
                  │   │ JiraRestClient  (HTTPS wrapper)      │   │
                  │   │ PromptTemplates (cluster, draft, ..) │   │
                  │   │ SchedulerMath   (critical path,      │   │
                  │   │                  multi-dev schedule) │   │
                  │   │ SecretsHelper   (encryption wrapper) │   │
                  │   └──────────────────────────────────────┘   │
                  └──────────────────────────────────────────────┘`),

  H.h2('18.3 Entities (OutSystems-friendly shapes)'),

  H.p('All entities in BacklogCore. Types use OutSystems attribute-type conventions: Long Integer, Text, Boolean, Date Time, Record (for enum-style reference), Binary Data (for uploaded file bytes).'),

  H.h3('18.3.1 Standard audit attributes (present on every entity)'),
  H.bullet('Id — Long Integer — auto PK'),
  H.bullet('CreatedOn — Date Time — default CurrDateTime()'),
  H.bullet('CreatedBy — Long Integer — FK → User'),
  H.bullet('UpdatedOn — Date Time — updated via pre-save action'),
  H.bullet('UpdatedBy — Long Integer — FK → User'),
  H.bullet('Status — Text(20) — default "active"'),

  H.h3('18.3.2 Project (see Section 10.2.1 for full attribute list)'),
  H.p('Standard OutSystems shape. ParentProjectId is self-referential FK. Goal and Description are Text(Long) for flexibility. Metadata is Text(Long) storing JSON; consider a JsonType extension if OutSystems introduces native JSON support mid-project.'),

  H.h3('18.3.3 BacklogItem (Epic / Feature / Story unified shape)'),
  H.p('Decision: store Epic, Feature, Story in one entity disambiguated by a Level static record. This mirrors the reference implementation’s backlog_item pattern and simplifies querying. Alternative (three separate entities) was considered and rejected because it forces three sets of CRUD service actions and complicates the Kanban renderer.'),
  H.bullet('Indexes: (ProjectId, LevelId, Status); (ParentEpicId); (ParentFeatureId).'),
  H.bullet('LevelId is a Record → Level (static entity with Epic/Feature/Story entries).'),
  H.bullet('TypeId is a Record → StoryType (Story/Bug/Spike/TechDebt).'),
  H.bullet('Dependencies stored as a 1-to-many child entity StoryDependency (TargetStoryId, TypeId, Reason, AddedByAgent boolean). Alternative inline-JSON is simpler but harder to index.'),
  H.bullet('Labels + OdcEntities + OdcScreens stored as child entities (ManyToMany pattern: Item_Label, Item_Entity, Item_Screen) for OutSystems-idiomatic queryability — even though the reference implementation inlined them as JSON arrays.'),

  H.h3('18.3.4 MentorPrompt'),
  H.p('1-to-many on BacklogItem; IsCurrent boolean + unique filtered index on (StoryId, IsCurrent=true). History is simply non-current rows.'),

  H.h3('18.3.5 JiraConfig + JiraPushEvent'),
  H.p('JiraConfig.ApiTokenEncrypted uses BacklogLib.SecretsHelper_Encrypt server-side; decryption only happens inside JiraRestClient service actions, never returned to the UX layer.'),

  H.h2('18.4 Application Separation'),

  H.p('Three apps in the ODC organisation:'),
  H.table(
    ['App name', 'Layer', 'Exposes', 'Consumes'],
    [
      ['Backlog_Planner', 'End-User', 'Reactive Web UI (the screens from Section 11)', 'BacklogCore Service Actions via Service API'],
      ['BacklogCore', 'Core', 'Service Actions for every operation (upload, groom, query, push)', 'BacklogLib libraries'],
      ['BacklogLib', 'Foundation', 'Reusable libraries (parser, LLM, Jira, scheduler, secrets)', 'External REST APIs only'],
    ],
    [2400, 1400, 3400, 2160],
  ),

  H.p('Service API versioning: Backlog_Planner consumes BacklogCore via versioned Service APIs. Breaking changes in BacklogCore require a new major version of the Service API; Backlog_Planner can pin a specific version during migration windows.'),

  H.h2('18.5 Action Taxonomy'),
  H.p('Before listing Service Actions per module, clarify which OutSystems Action Type each operation uses. The platform uses four Action Types:'),
  H.table(
    ['Action Type', 'Where it lives', 'Visibility', 'Typical use in this platform'],
    [
      ['Screen Action', 'Inside a Screen / Block in Backlog_Planner', 'Local to the Screen', 'Button OnClick, Form OnSubmit, Input OnChange — orchestrates local UI state + invokes Service Actions'],
      ['Client Action', 'Client Actions folder in Backlog_Planner (or a Block)', 'Reusable within the Reactive Web app', 'Shared UI logic — polling loops, SVG renderers, clipboard helpers, scroll-to-hash'],
      ['Server Action', 'BacklogCore or BacklogLib', 'Internal to the module', 'Business logic, Entity CRUD, integration wrappers — NOT exposed outside the module'],
      ['Service Action', 'BacklogCore', 'Exposed to consumers via the Service API', 'Every operation Backlog_Planner invokes on the Core — see Section 18.5.1 onwards'],
    ],
    [1800, 2200, 1800, 3560],
  ),
  H.p('Additionally, BacklogCore exposes no Exposed REST APIs in v1.0 — the Backlog_Planner app is its sole consumer and uses the tighter OutSystems Service API binding instead. Should future integrations need external access (e.g. a Jenkins pipeline triggering grooming), an Exposed REST API is added as a v1.1 enhancement.'),

  H.h2('18.5.1 Service Actions (BacklogCore)'),

  H.h3('Requirements_Service'),
  H.table(
    ['Action', 'Input', 'Output', 'Notes'],
    [
      ['UploadRequirements', 'ProjectId: Long; File: BinaryData; Filename: Text; MimeType: Text', 'UploadId: Long; RowCount: Integer; Columns: List<Text>; Warnings: List<Text>; Error: Text', 'Uses BacklogLib.CsvExcelParser; persists RequirementsUpload + RequirementRow rows'],
      ['AutodetectColumns', 'UploadId: Long', 'Mapping: Mapping; Confidence: Text; UnmappedSources: List<Text>; Reasoning: Text', 'Calls BacklogLib.LlmClient_Gemini_DetectColumns; heuristic fallback'],
      ['PatchUploadMapping', 'UploadId: Long; Mapping: Mapping', 'Success: Boolean', 'Updates the upload row; does NOT write raw_rows (to avoid the large-payload bug from reference implementation)'],
      ['ListUploads', 'ProjectId: Long', 'Uploads: List<UploadSummary>', ''],
      ['DetectDuplicates', 'UploadId: Long', 'Duplicates: List<DuplicatePair>', 'Enhancement 8.11.1'],
      ['ComputeReuploadDiff', 'ProjectId: Long; NewUploadId: Long', 'Diff: ReuploadDiff (new, changed, gone)', 'Enhancement FR-8.2.11+'],
    ],
    [2000, 2600, 2500, 2260],
  ),

  H.h3('Grooming_Service'),
  H.table(
    ['Action', 'Input', 'Output', 'Notes'],
    [
      ['StartGrooming', 'UploadId: Long; MappingOverride: Mapping (optional); DevCount: Integer', 'RunId: Long', 'Creates a RunEvent row; enqueues a Timer that invokes RunGroomingNextStage'],
      ['RunGroomingNextStage', 'RunId: Long', '(Timer callback)', 'State-machine step: Intake → Cluster → Draft → Enrich → Sequence; self-enqueues for the next stage or marks complete'],
      ['GetGroomingStatus', 'RunId: Long', 'Stage: Text; Progress: Integer; Errors: List<Text>; Complete: Boolean', 'UX polls this or subscribes via Reactive client event'],
      ['GetGroomedTree', 'ProjectId: Long', 'Epics: List<EpicWithChildren>; Orphans: List<Story>', 'Hierarchy-joined query'],
      ['GetDependencyGraph', 'ProjectId: Long', 'Nodes: List<Node>; Edges: List<Edge>; CriticalPathIds: List<Long>', ''],
      ['GetSchedule', 'ProjectId: Long; DevCount: Integer; SprintCapacity: Integer', 'Assignments: List<Assignment>; PredictedSprintCount: Integer; TotalPoints: Integer', ''],
      ['SimulateScheduleWhatIf', 'ProjectId: Long; DevCount: Integer; SprintCapacity: Integer; ExcludedEpicIds: List<Long>; PriorityOverrides: List<PriorityOverride>', 'Same as GetSchedule output', 'Enhancement 8.11.7'],
      ['PatchStory', 'StoryId: Long; Patch: StoryPatch', 'Success: Boolean', 'Generic patch merges structured attributes; recomputes quality scores + confidence badge'],
      ['RegenerateMentorPrompt', 'StoryId: Long', 'Prompt: Text(long); Version: Integer', 'Archives current prompt to non-current; inserts new; max 3 historical kept'],
      ['SetStoryDependencies', 'StoryId: Long; Dependencies: List<Dependency>', 'Success: Boolean; CycleDetected: Boolean', 'Cycle detection before write'],
      ['RefineStoryWithAgent', 'StoryId: Long; Instruction: Text', 'ProposedPatch: StoryPatch; AgentResponse: Text', 'Enhancement 8.11.3 — user accepts or rejects'],
    ],
    [2200, 3000, 2400, 1760],
  ),

  H.h3('Jira_Integration_Service'),
  H.table(
    ['Action', 'Input', 'Output', 'Notes'],
    [
      ['SaveJiraConfig', 'ProjectId: Long; Domain: Text; Email: Text; ApiToken: Text; ProjectKey: Text', 'Success: Boolean; AuthMessage: Text; ProjectMessage: Text', 'Verifies /myself + /project/{key} before persisting'],
      ['GetJiraConfig', 'ProjectId: Long', 'Config: JiraConfigView (token masked)', ''],
      ['ClearJiraConfig', 'ProjectId: Long', 'Success: Boolean', ''],
      ['PushBacklogToJira', 'ProjectId: Long', 'PushedEpics: Integer; PushedStories: Integer; PushedLinks: Integer; CreatedKeys: List<Text>; Errors: List<JiraError>', 'Three-phase: epics → stories → links; partial success acceptable'],
      ['ListJiraPushes', 'ProjectId: Long', 'Events: List<JiraPushEvent>', 'History view'],
      ['FetchHistoricalVelocity', 'ProjectId: Long', 'Velocity: List<VelocitySample>', 'Enhancement 8.11.6; pulls completed sprints from Jira Agile API'],
    ],
    [2400, 3200, 2400, 1360],
  ),

  H.h3('Approval_Service (NEW in v1.0)'),
  H.table(
    ['Action', 'Input', 'Output', 'Notes'],
    [
      ['SendApprovalRequests', 'ProjectId: Long; TargetIds: List<Long>; Stakeholders: List<StakeholderTarget>', 'CreatedIds: List<Long>; EmailsSent: Integer', 'Creates ApprovalRequest rows + tokens; dispatches emails via platform mail'],
      ['GetApprovalByToken', 'Token: Text', 'Request: ApprovalRequestView', 'Tokenised URL landing'],
      ['SubmitApprovalResponse', 'Token: Text; Decision: Text; Comment: Text', 'Success: Boolean', 'Updates state; notifies BA'],
      ['RevokeApproval', 'ApprovalId: Long', 'Success: Boolean', 'BA-initiated cancel'],
      ['ListPendingApprovals', 'ProjectId: Long', 'Requests: List<ApprovalRequestSummary>', ''],
    ],
    [2200, 3200, 2400, 1560],
  ),

  H.h2('18.5.2 Structures (DTOs exposed through Service APIs)'),
  H.p('Every Service Action input/output uses strongly-typed OutSystems Structures rather than loose Text fields or generic JSON blobs. Structures live in BacklogCore.DataTypes and are referenced by both the Service API and by BacklogLib Server Actions so there is a single source of truth. A complete list of Structures is in Section 10.6. Design principles:'),
  H.bullet('Structures with 4+ Attributes get their own name. Structures with 1\u20132 Attributes become simple Input/Output Parameters of the Service Action itself.'),
  H.bullet('Lists of Structures use the platform\u2019s built-in List<Structure> type; no custom collection wrappers.'),
  H.bullet('Optional fields carry defaults (empty Text, 0 for Integer, NullIdentifier()) rather than being \u201cnot mandatory\u201d \u2014 mandatory = True is the default for every Attribute.'),
  H.bullet('Structures with fields that are Identifiers into Static Entities use the Identifier type directly (e.g. Priority Identifier) so client code gets compile-time type safety for the static records.'),

  H.h2('18.5.3 Aggregates vs Advanced SQL'),
  H.p('The platform uses Aggregates (OutSystems\u2019 visual query builder) as the default. Advanced SQL is reserved for two cases:'),
  H.bullet('The recursive Epic\u2192Feature\u2192Story tree query (GetGroomedTree) \u2014 implemented as an Advanced SQL using a CTE. Wrapping it in a Server Action with the tree Structure as output keeps consumers oblivious.'),
  H.bullet('The semantic-similarity duplicate detection (Enhancement 8.11.1) \u2014 uses a pgvector extension or a dedicated Embedding Entity with a similarity-sorted Advanced SQL query; the Aggregate builder cannot express cosine distance.'),
  H.p('All other queries (list uploads for a project, list stories by status, fetch current Mentor prompt, etc.) are Aggregates. Use TypedExecute for Advanced SQL calls so the output Record Type is verified by the compiler.'),

  H.h2('18.5.4 Site Properties and Application Properties'),
  H.p('Configuration that varies per environment is stored in Site Properties on BacklogLib or BacklogCore. Configuration that varies per Application installation (one App per customer tenant) goes in Application Properties. Both are set via the ODC Portal after deployment.'),
  H.table(
    ['Property', 'Kind', 'Default', 'Notes'],
    [
      ['AnthropicBaseUrl', 'Site Property', 'https://api.anthropic.com/v1', 'Effective URL for the Anthropic Consumed REST API'],
      ['GeminiBaseUrl', 'Site Property', 'https://generativelanguage.googleapis.com/v1', ''],
      ['AnthropicModel', 'Site Property', 'claude-sonnet-4-6', 'Bump here to change model version'],
      ['GeminiModel', 'Site Property', 'gemini-2.0-flash', ''],
      ['AnthropicApiKey', 'Application Property', '(set at install)', 'Per-tenant key; encrypted'],
      ['GeminiApiKey', 'Application Property', '(set at install)', ''],
      ['MaxFileUploadMb', 'Site Property', '10', 'Mirrors NFR-PERF limits'],
      ['MaxRowsHard', 'Site Property', '5000', ''],
      ['MaxRowsWarn', 'Site Property', '1000', ''],
      ['GroomingTimerIntervalSeconds', 'Site Property', '5', 'How often the grooming Timer re-activates'],
      ['JiraFieldCacheJson', 'Site Property', '{}', 'Cached field-name \u2192 field-id map per Jira instance; updated by Jira_GetFields'],
      ['MentorPromptHistoryCap', 'Site Property', '3', ''],
      ['RefinementHistoryCap', 'Site Property', '10', ''],
      ['ApprovalTokenExpiryDays', 'Site Property', '30', ''],
      ['SmtpSenderEmail', 'Application Property', '(set at install)', 'Approval emails From address'],
    ],
    [2800, 2200, 2400, 1960],
  ),

  H.h2('18.5.5 Events and Workflow Builder'),
  H.p('Two cross-module communication points use Events rather than direct Service Action calls:'),
  H.bullet('Grooming_Completed Event \u2014 fired by Grooming_Service when a run ends (complete or error). Backlog_Planner subscribes and refreshes the open Screen if a user is viewing that Project.'),
  H.bullet('Backlog_Pushed_To_Jira Event \u2014 fired after a successful Jira push. Future consumers (notifications app, analytics app) can subscribe without us re-wiring.'),
  H.p('Workflow Builder (the ODC replacement for BPT) is NOT used in v1.0 for the grooming pipeline \u2014 the Timer-driven state machine is simpler and well-understood. Workflow Builder is the recommended upgrade path if the pipeline grows to include human-in-the-loop mid-run tasks (e.g. approve each epic as it\u2019s clustered).'),

  H.h2('18.6 Forge Component Shortlist'),

  H.p('Evaluate these Forge components early — even if they do not ultimately fit, they inform our own library design.'),
  H.table(
    ['Component', 'Version', 'Use case', 'Fit assessment'],
    [
      ['Excel Utils', 'Latest', 'Read .xlsx cells server-side', 'Primary candidate for CsvExcelParser. Mature, widely used.'],
      ['CSV Util', 'Latest', 'Parse CSV to list of records', 'Primary candidate for CSV path.'],
      ['Atlassian Jira Connector', 'Latest', 'Wraps Jira REST', 'Evaluate — if it exposes /myself, /project, /issue, /issueLink, /field, we can use it directly for JiraRestClient. Otherwise roll our own over HTTP Request.'],
      ['HTTP Request Handler', 'N/A', 'Issuing outbound REST with retry', 'Baseline; used if no dedicated connector fits.'],
      ['OpenAI Connector / Claude Connector', 'Latest', 'LLM client', 'Evaluate for LlmClient; if present, saves weeks of work; otherwise build directly over HTTP Request Handler.'],
      ['JSON Util', 'Latest', 'Parse and produce nested JSON', 'Needed extensively for LLM response parsing; reference implementation relied on Python dict unpacking which doesn’t exist in OutSystems.'],
      ['SilkUI / OutSystems UI', 'Shipped', 'Form controls + modal + tabs', 'Reactive Web standard; no evaluation needed.'],
      ['Mermaid Renderer (Forge)', 'Variable', 'Render Mermaid graphs', 'Investigate — if unmaintained, use an iframe with a CDN-loaded Mermaid.js library or roll a lightweight D3/SVG alternative.'],
    ],
    [2200, 1000, 2800, 3360],
  ),

  H.h2('18.7 LLM Integration Pattern'),

  H.p('Long-running grooming pipelines cannot be handled with a single synchronous Service Action call — the entire pipeline can take 30+ minutes. OutSystems Timer is the right primitive: fire-and-forget action that records state, and re-enqueue for the next step.'),

  H.h3('18.7.1 Timer-driven pipeline (recommended)'),
  H.bullet('StartGrooming creates a RunEvent row with Stage=intake and schedules a Timer to fire immediately.'),
  H.bullet('The Timer invokes RunGroomingNextStage(RunId).'),
  H.bullet('RunGroomingNextStage reads RunEvent.Stage, runs that stage (making LLM calls), updates RunEvent.Stage to the next stage, and re-schedules itself via Wait / NewTimer at the end.'),
  H.bullet('The UX polls GetGroomingStatus(RunId) every 3 seconds OR subscribes to a Reactive Web client event (via a lightweight Server Action + ClientVariable pattern).'),
  H.bullet('On failure in any stage, RunEvent.Stage = "error" and the Error field is populated; UX surfaces the message.'),

  H.h3('18.7.2 Concurrency + rate limiting'),
  H.p('Anthropic rate limits are per-API-key. A semaphore pattern in the OutSystems Timer execution model is non-trivial; the recommended approach is a leaky-bucket counter stored in a small LlmRateBudget entity with one row per provider. Before every LLM call, the library checks (and decrements) the budget; if the budget is exhausted, the call is queued into a pending-LLM-calls entity and drained by a second Timer running every 30 seconds. This is approximate but robust.'),

  H.h3('18.7.3 Retry and fallback'),
  H.bullet('BacklogLib.LlmClient_Anthropic_Call: internal retry loop (3 attempts, 15/30/60s); on exhausted retries, delegates to LlmClient_Gemini_Call with the same prompt.'),
  H.bullet('BacklogLib.LlmClient_Gemini_Call: internal retry (3 attempts, 5/10/20s); on exhausted retries, delegates to Anthropic if a key is configured.'),
  H.bullet('Bidirectional short-circuit: if one provider’s key is missing at configuration time, the call routes to the other provider up-front without the wasted first attempt.'),

  H.h2('18.8 Reactive Web UI Notes'),

  H.bullet('File upload: use the standard OutSystems Upload widget; post to the UploadRequirements Service Action endpoint. Max file size 10 MB — set the platform limit accordingly.'),
  H.bullet('Live progress: the UX polls GetGroomingStatus every 3 seconds while the stage is not "complete" or "error". The SSE pattern from the reference implementation is not idiomatic in ODC; polling is acceptable for the 30-minute pipeline.'),
  H.bullet('Drag-and-drop zone: the default Upload widget supports drag-and-drop. No custom JS needed.'),
  H.bullet('Mermaid rendering: wrap the Mermaid library in an Extension; pass the Mermaid source as input and receive an SVG back. Or embed via an iframe to a static HTML page that loads Mermaid from CDN and posts the rendered SVG to the parent via postMessage. The first approach is cleaner.'),
  H.bullet('Gantt rendering: SVG-based. Compute the positions server-side (SchedulerMath), return {lanes: [{devId, bars: [{left, width, critical, title, points}]}]} and render with an inline SVG template. No external Gantt library needed.'),
  H.bullet('Story detail modal: ModalBox (OutSystems UI); tabs for Core / Planning / Quality / ODC / Dependencies / Refinement. Autosave on blur for each field (debounced) to minimise the "save then regret" surface area.'),
  H.bullet('Copy-to-clipboard: native browser Clipboard API via a small Extension action; tested across browsers.'),

  H.h2('18.9 External REST APIs'),

  H.p('Configure as External Logic REST integrations via the ODC Integration Builder. For each, import a minimal OpenAPI spec and expose only the specific endpoints we consume.'),
  H.table(
    ['API', 'Base URL', 'Auth', 'Endpoints used'],
    [
      ['Anthropic Messages', 'https://api.anthropic.com/v1', 'x-api-key header', 'POST /messages'],
      ['Gemini GenerativeAI', 'https://generativelanguage.googleapis.com/v1', 'API key query / header', 'POST /models/gemini-2.0-flash:generateContent'],
      ['Jira Cloud v3', 'https://{tenant}.atlassian.net/rest/api/3', 'Basic (email:token)', 'GET /myself, GET /project/{key}, GET /field, POST /issue, PUT /issue/{key}, POST /issueLink'],
      ['Jira Agile v1', 'https://{tenant}.atlassian.net/rest/agile/1.0', 'Basic (email:token)', 'GET /sprint?state=closed (velocity)'],
    ],
    [2500, 3400, 1700, 1760],
  ),

  H.h2('18.10 Data Migration Strategy'),

  H.p('The reference Python implementation persists backlog data in Supabase. If the customer organisation has used the Python prototype on any live project, a one-time migration is required to bring that data into the ODC platform database.'),
  H.bullet('One-shot migration script (Python) reads Supabase project_artifacts, transforms to OutSystems Entity rows, and writes via ODC’s bulk-import CSV endpoints or via a one-time ImportLegacy Service Action.'),
  H.bullet('Migration runs per-project; user triggers via Admin view.'),
  H.bullet('Story template overrides are re-imported. Mentor prompt histories capped at last 3 (matching platform policy).'),
  H.bullet('Jira push events are imported for history but marked read-only (their keys may not round-trip to the current Jira config).'),
  H.bullet('Rollback plan: if the OD rebuild is delayed and the Python implementation remains in use, no migration required — the two co-exist (reference implementation has no write dependency on the OD instance).'),

  H.h2('18.11 Effort Estimates'),

  H.table(
    ['Module', 'T-shirt size', 'Justification'],
    [
      ['Project workspace (reuse existing customer tooling if possible)', 'S', 'Mostly wiring; UI already well-understood'],
      ['Requirements intake + column mapping UI', 'M', 'New file upload flow; LLM integration for column detect'],
      ['Story template management + Template Library', 'M', 'Admin CRUD + library seeding'],
      ['Grooming pipeline (5 stages, Timer-driven state machine)', 'L', 'Non-trivial orchestration; test matrix is large'],
      ['Six agents + prompt templates', 'M', 'Prompt engineering + per-agent wrappers; reference implementation is the starting contract'],
      ['Backlog hierarchy + Kanban extension', 'M', 'New screens; drag-and-drop re-parenting'],
      ['Dependency graph (Mermaid / SVG)', 'M', 'Rendering is tricky at 500+ nodes; performance work may stretch to L'],
      ['Multi-dev Gantt + What-If Simulator', 'M', 'Scheduler algorithm is easy; UI interactivity is where the complexity lives'],
      ['Mentor prompt generation + history', 'S', 'Pure template assembly'],
      ['Jira integration (config + push + verify)', 'L', 'Careful error handling + field discovery + idempotent re-push'],
      ['Re-upload diff preview', 'M', 'Semantic similarity for duplicates + merge UI'],
      ['ENHANCED features (quality scoring, duplicate detection, refinement chat, velocity, coverage heatmap)', 'L (aggregate)', 'Eight enhancements; individually S/M but costs add up'],
      ['Approval workflow (email + tokenised URL + inbox)', 'M', 'Mail sending + short-lived tokens + stakeholder-facing UI'],
      ['Observability + cost dashboard', 'S', 'Out-of-the-box OutSystems logs + custom aggregation'],
      ['Testing + documentation', 'L', 'Non-negotiable; do not trim'],
    ],
    [4000, 1200, 4160],
  ),
  H.p('Aggregate rough estimate: 4–5 developer-months for the core build, assuming two senior ODC developers working in parallel and one Forge engineer on the foundation libraries. Enhancement features add roughly 2 more developer-months if delivered alongside v1.0. QA and documentation are additive (~1 developer-month). Target 3–4 calendar months end to end at full staffing.'),
];
