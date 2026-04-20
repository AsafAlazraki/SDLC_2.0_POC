-- ─────────────────────────────────────────────────────────────
-- Migration 002 — Projects workspace
--
-- Introduces first-class projects (with sub-projects), attached
-- materials (files / urls / text), runs (executions of the agent
-- fleet), and artifacts (everything the fleet produces).
--
-- Run this once against your Supabase database (SQL editor).
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── projects ────────────────────────────────────────────────
-- Top-level workspace. Sub-projects reference their parent via
-- parent_id. Delete cascade: deleting a project wipes the subtree
-- and everything attached.
CREATE TABLE IF NOT EXISTS projects (
    id BIGSERIAL PRIMARY KEY,
    parent_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    goal TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    inherits_materials BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects(status);

-- ── project_materials ───────────────────────────────────────
-- Anything the user uploads or pastes into a project that the
-- agent fleet should consider at run time. kind = file | url |
-- text | image. content_text holds extracted body text; large
-- binaries live at storage_path.
CREATE TABLE IF NOT EXISTS project_materials (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    filename TEXT,
    mime_type TEXT,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    content_text TEXT,
    storage_path TEXT,
    source_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_materials_project_id ON project_materials(project_id);
CREATE INDEX IF NOT EXISTS idx_project_materials_kind       ON project_materials(kind);

-- ── project_runs ────────────────────────────────────────────
-- One execution of the agent fleet against a project. Stores the
-- input payload, lifecycle status, and the rolled-up token / cost
-- usage once Phase 5 (cost optimisation) lands.
CREATE TABLE IF NOT EXISTS project_runs (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'running',
    token_cost_cents INTEGER NOT NULL DEFAULT 0,
    usage_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    error TEXT,
    legacy_report_id BIGINT
);

CREATE INDEX IF NOT EXISTS idx_project_runs_project_id ON project_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_runs_status     ON project_runs(status);

-- ── project_artifacts ───────────────────────────────────────
-- Every output produced against a project: agent reports, the
-- synthesis verdict, build packs, kickoff packs, backlog items,
-- user notes. kind discriminates the renderer.
CREATE TABLE IF NOT EXISTS project_artifacts (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id BIGINT REFERENCES project_runs(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    persona_key TEXT,
    title TEXT,
    content TEXT,
    structured_data JSONB,
    storage_path TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_artifacts_project_id ON project_artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_run_id     ON project_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_kind       ON project_artifacts(kind);

-- ── Seed: Legacy project ────────────────────────────────────
-- Auto-created holder for any `reports` rows that pre-date the
-- Projects workspace, so the history view never shows "orphans".
INSERT INTO projects (name, goal, description, metadata)
SELECT
    'Legacy Analyses',
    'Analyses produced before Projects existed.',
    'Auto-generated holder for reports that existed before the Projects workspace. You can move runs out of here into proper projects at any time.',
    '{"auto_seeded": true, "legacy_holder": true}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM projects
    WHERE metadata->>'legacy_holder' = 'true'
);
