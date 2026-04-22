// Section 12 — Information Architecture / Site Map
const H = require('./_helpers');

module.exports = [
  H.h1('12. Information Architecture'),

  H.p('The platform’s site map is a shallow two-tier structure. The top tier is the application shell (global nav, user settings, admin); the second tier is the project workspace with its seven tabs. The Groomed Backlog tab has its own internal sub-navigation (five views) rendered inside the tab without changing the URL tier. Deep links to specific stories are supported via the story detail modal, which accepts a story ID via query string.'),

  H.h2('12.1 Site Map'),
  ...H.code(`APPLICATION ROOT
├── /login                                     (SSO redirect)
├── /projects                                  (Project Dashboard)
│   ├── /projects/new                          (Create Project modal)
│   └── /projects/{id}                         (Project Detail)
│       ├── ?tab=overview                      (default)
│       ├── ?tab=materials                     (upload non-requirements files)
│       ├── ?tab=runs                          (main fleet analysis history)
│       ├── ?tab=artefacts                     (generated reports, packs)
│       ├── ?tab=backlog                       (Phase 4 manual Kanban)
│       ├── ?tab=groomed                       (Phase 12 Groomed Backlog)
│       │   ├── ?view=upload                   (default on entry)
│       │   │   └── ?upload_id={N}             (Review an existing upload)
│       │   ├── ?view=tree
│       │   ├── ?view=deps
│       │   ├── ?view=schedule
│       │   └── ?view=mentor
│       └── ?tab=documents                     (living documents)
├── /templates                                 (Template Library)
│   ├── /templates/library                     (pre-built + borrowable)
│   └── /templates/{id}/edit                   (edit a template override)
├── /approvals                                 (in-app approval inbox, authenticated)
├── /approvals/{token}                         (stakeholder view, token-authenticated)
├── /admin                                     (usage, costs, audit export)
│   ├── /admin/users
│   ├── /admin/audit
│   └── /admin/costs
└── /help                                      (docs, keyboard shortcuts, contact)`),

  H.h2('12.2 Cross-Cutting Concerns'),
  H.bullet('Global search (top nav): searches across project names, stories (title + description), uploads, and audit events within the user’s accessible projects.'),
  H.bullet('Breadcrumbs: Project name → Tab → Sub-view. Clickable to navigate up.'),
  H.bullet('Keyboard shortcuts: g p (go projects), g a (go approvals), / (global search), ? (shortcut cheat sheet), ESC (close modal).'),
  H.bullet('Deep link to story: /projects/{id}?tab=groomed&view=tree&story={storyId} opens the tab + view and auto-opens the story detail modal.'),
  H.bullet('Permissions: v1.0 treats every user as full-access. v1.1 introduces role-based access (see OoS-7).'),
];
