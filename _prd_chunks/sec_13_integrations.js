// Section 14 — Integrations
const H = require('./_helpers');

module.exports = [
  H.h1('14. Integrations'),

  H.p('The platform integrates with three outbound systems in v1.0 and lists four deferred integrations on the roadmap. In OutSystems terms each external system is modelled as a Consumed REST API in BacklogLib, typed via a Structure per request/response shape, called from Server Actions with Timeout set and Effective URL driven by a Site Property. Credentials are per-Project (stored on JiraConfig or pulled from Application Properties for LLM keys), verified before save, called with the platform\'s built-in retry semantics plus our own back-off loop in the BacklogLib.Http_CallWithRetry Server Action, and logged via the standard OutSystems LogMessage action for SIEM forwarding.'),

  H.h2('14.1 Anthropic Claude Sonnet 4.6 (drafting + enrichment)'),
  H.bullet('Purpose: Primary drafting engine for BA stories; primary enrichment for PM, Architect, Tech Lead, OS Architect, OS Migration agents; Mentor prompt refinement.'),
  H.bullet('Endpoint: https://api.anthropic.com/v1/messages (Messages API v1).'),
  H.bullet('Authentication: x-api-key header with Anthropic API key; commercial tier with zero data retention (NFR-SEC-10).'),
  H.bullet('Request shape: system prompt (cached via cache_control), user message, max_tokens (4K–10K depending on stage), temperature 0.1–0.3.'),
  H.bullet('Retry: 3 attempts; exponential backoff 15s/30s/60s on 429; fallback to Gemini on exhausted retries.'),
  H.bullet('Rate limiting: Anthropic Tier allows N input tokens/minute per API key; platform uses a semaphore of 2 concurrent calls to stay within limits.'),
  H.bullet('Cost tracking: Every call records input tokens, output tokens, cache read/write tokens; aggregated into run cost summary.'),

  H.h2('14.2 Google Gemini 2.0 Flash (column detection + clustering + vision)'),
  H.bullet('Purpose: Column auto-detection (cheap and fast); optional vision for uploaded screenshots; research grounding via Google Search (not used in v1.0 grooming but inherited from the fleet).'),
  H.bullet('Endpoint: https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent'),
  H.bullet('Authentication: API key via query string or header.'),
  H.bullet('Retry: 3 attempts; 5s/10s/20s; fallback to Anthropic if a key is unavailable.'),
  H.bullet('Fallback short-circuit: If no Gemini key is configured at all, the system routes Gemini-assigned work to Anthropic at call time rather than failing.'),
  H.bullet('Cost tracking: tokens in/out logged; much cheaper than Sonnet per token.'),

  H.h2('14.3 Atlassian Jira Cloud REST API v3 (backlog push)'),
  H.bullet('Purpose: Persist the groomed backlog as Jira Epics, Stories, and issue links.'),
  H.bullet('Base URL: https://{domain}/rest/api/3'),
  H.bullet('Authentication: HTTP Basic with email:api_token base64-encoded.'),

  H.h3('14.3.1 Consumed REST API Methods (under Consumed REST API "JiraCloud" in BacklogLib)'),
  H.table(
    ['REST API Method', 'HTTP Method', 'Purpose'],
    [
      ['Jira_GetMyself', 'GET /myself', 'Verify credentials on save'],
      ['Jira_GetProject', 'GET /project/{key}', 'Verify target project exists and is accessible'],
      ['Jira_GetFields', 'GET /field', 'Discover custom field IDs (Story Points, Epic Link) \u2014 cached via Site Property JiraFieldCacheJson on first push'],
      ['Jira_CreateIssue', 'POST /issue', 'Create Epic/Story/Task issue'],
      ['Jira_UpdateIssue', 'PUT /issue/{key}', 'Update existing issue (re-push path)'],
      ['Jira_CreateIssueLink', 'POST /issueLink', 'Create blocks/blocked-by issue links'],
      ['JiraAgile_GetClosedSprints', 'GET /rest/agile/1.0/sprint?state=closed', 'Fetch historical velocity (Enhancement 8.11.6)'],
    ],
    [2800, 2000, 4560],
  ),

  H.h3('14.3.2 Issue type + priority mapping'),
  H.table(
    ['Our type', 'Jira issue type', 'Our priority', 'Jira priority'],
    [
      ['story', 'Story', 'Must', 'Highest'],
      ['bug', 'Bug', 'Should', 'High'],
      ['spike', 'Task', 'Could', 'Medium'],
      ['tech-debt', 'Task', "Won't", 'Low'],
    ],
    [2000, 2400, 2000, 2960],
  ),

  H.h3('14.3.3 Field mapping'),
  H.table(
    ['Canonical field', 'Jira field', 'Notes'],
    [
      ['title', 'summary', ''],
      ['story', 'description', 'ADF (Atlassian Document Format) paragraph'],
      ['acceptance_criteria', 'appended to description', 'Separate custom-field if a configured Jira has one'],
      ['story_points', 'customfield (discovered)', 'Name "Story Points" or "Story point estimate"'],
      ['priority', 'priority.name', 'Via mapping table above'],
      ['labels', 'labels', ''],
      ['type', 'issuetype.name', ''],
      ['epic (parent)', 'parent.key', 'Modern Jira Cloud model'],
      ['dependencies', 'issueLink "Blocks"', 'Created after all stories are pushed'],
      ['mentor_prompt', 'appended to description', 'In a collapsed section header "## ODC Mentor 2.0 Prompt"'],
    ],
    [2100, 3100, 4160],
  ),

  H.h2('14.4 Deferred Integrations (roadmap)'),
  H.table(
    ['Integration', 'Approach', 'Target release'],
    [
      ['Azure DevOps', 'REST API v7.1; Work Item Tracking; similar push path', 'v1.1'],
      ['Linear', 'GraphQL API; teams/issues/cycles model', 'v1.2'],
      ['Monday.com', 'GraphQL API; board/item/subitem', 'Roadmap'],
      ['ClickUp', 'REST API v2; list/task/subtask', 'Roadmap'],
      ['GitHub Issues', 'Inherits pattern from Phase 3 export; milestones for epics', 'v1.1'],
    ],
    [1800, 5200, 2360],
  ),

  H.h2('14.5 Integration Design Principles'),
  H.bullet('Every Consumed REST API Method sets its Timeout Property to 20 seconds. The Http_CallWithRetry wrapper Server Action handles retry/backoff above that.'),
  H.bullet('Errors from outbound systems are caught via OnAfterResponse in the Consumed REST API; Structure IntegrationError captures HTTP status, first \u2248 400 chars of body, and endpoint name. Structures are returned to callers so users can diagnose without server log access.'),
  H.bullet('Secrets (API tokens, LLM keys) live in Application Properties (encrypted) or JiraConfig.ApiTokenEncrypted (column-encrypted via SecretsHelper). LogMessage calls NEVER include secret values, even partial.'),
  H.bullet('Health checks: an Admin Screen invokes per-tenant "verify integration" Server Actions (Jira_GetMyself, Anthropic_Ping, Gemini_Ping) that return green/red without modifying data.'),
  H.bullet('Consumed REST APIs\u2019 Effective URL is driven from a Site Property per environment: AnthropicBaseUrl, GeminiBaseUrl. JiraBaseUrl is per-JiraConfig, composed at call time as "https://" + JiraConfig.Domain + "/rest/api/3".'),
];
