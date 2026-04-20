"""
Pure-Python smoke test for kickoff_pack.generate_kickoff_pack_files.

Skips the Claude call entirely — we feed a hand-rolled spec dict into the
file generator and assert the eight expected docs + README + _spec.json land
on disk with non-trivial content.

Run: python test_kickoff_pack_smoke.py
"""

from __future__ import annotations
import shutil
import sys
import tempfile
from pathlib import Path

import kickoff_pack as kp


SAMPLE_SPEC = {
    "meta": {
        "topic": "Customer Management Framework modernisation",
        "github_url": "https://github.com/example/cmf",
        "summary": "Move CMF onto OutSystems Developer Cloud over two quarters.",
        "generated_at": "2026-04-16T10:00:00Z",
    },
    "executive_one_pager": {
        "headline": "Modernising CMF onto ODC unlocks 40% faster releases.",
        "body_md": (
            "We are replatforming the Customer Management Framework from O11 onto "
            "ODC. The discovery surfaced 18 high-severity security findings and a "
            "fragile data model. We move now to retire the unsupported runtime "
            "before vendor support ends in Q4."
        ),
    },
    "team_composition": [
        {
            "role": "Solutions Architect",
            "seniority": "Principal",
            "engagement": "FTE",
            "headcount": 1,
            "responsibility": "Owns the 4-layer ODC blueprint and Forge selection.",
            "non_negotiable_skills": ["ODC certification", "Strangler Fig migrations"],
        },
        {
            "role": "Tech Lead",
            "seniority": "Senior",
            "engagement": "FTE",
            "headcount": 1,
            "responsibility": "Day-to-day delivery; mentors juniors.",
            "non_negotiable_skills": ["O11 → ODC migration experience"],
        },
    ],
    "sprint_zero": [
        {
            "owner": "Tech Lead",
            "tasks": [
                "Set up GitHub repo with branch protection on main + signed commits",
                "Provision ODC personal env for every dev",
            ],
        },
        {
            "owner": "DevOps",
            "tasks": [
                "Stand up the LifeTime + ODC pipelines",
                "Wire Datadog APM into staging",
            ],
        },
    ],
    "raci_decisions": [
        {
            "decision": "ODC tenant region",
            "responsible": "Architect",
            "accountable": "CTO",
            "consulted": "Security, Compliance",
            "informed": "All",
            "deadline": "Sprint 0",
        },
    ],
    "day_one_decisions": [
        {
            "decision": "Big-bang vs Strangler Fig migration",
            "options": ["Big bang", "Strangler Fig", "Parallel run"],
            "recommendation": "Strangler Fig — lowest blast radius given the 18 security findings.",
            "sign_off": "CTO",
            "if_we_dont": "Architecture work on Sprint 1 cannot start.",
        },
    ],
    "risk_briefing": [
        {
            "risk": "Untested data migration path",
            "severity": "high",
            "why": "Discovery found 6 entities with no FK constraints and undocumented joins.",
            "mitigation": "Run ETL in shadow mode for 2 sprints before cut-over.",
            "owner": "Data Engineer",
            "early_warning_signal": "Reconciliation drift > 0.1% per day.",
        },
        {
            "risk": "Forge component licence cost",
            "severity": "medium",
            "why": "5 Forge components recommended; 2 are paid.",
            "mitigation": "Procurement sign-off before Sprint 2.",
            "owner": "Programme Manager",
            "early_warning_signal": "Procurement still pending at end of Sprint 1.",
        },
    ],
    "success_metrics": [
        {
            "kpi": "p95 API latency",
            "baseline": "850ms (current O11)",
            "target": "<200ms by end of Q2",
            "measurement": "Datadog APM dashboard 'cmf-api'",
        },
    ],
    "reporting_cadence": {
        "daily": "Standup at 09:30 — full team",
        "weekly": "Programme review Thursday 16:00 — sponsor + leads",
        "monthly": "Executive steering — first Monday of month",
    },
    "critical_success_factors": [
        {
            "factor": "Strangler Fig discipline — no parallel feature work on the legacy stack.",
            "why": "Every patch on O11 doubles the migration backlog.",
        },
        {
            "factor": "Day-1 security posture — all 18 findings remediated before go-live.",
            "why": "Audit window opens Q3 and the existing CVEs would block sign-off.",
        },
        {
            "factor": "Honest baseline measurement in Sprint 1.",
            "why": "Without a real baseline we cannot prove the modernisation worked.",
        },
    ],
}


def main() -> int:
    print("-" * 60)
    print("KICKOFF PACK FILE GENERATOR SMOKE TEST")
    print("-" * 60)

    tmp = Path(tempfile.mkdtemp(prefix="kickoff_smoke_"))
    out_dir = tmp / "pack"
    failures = []

    try:
        written = kp.generate_kickoff_pack_files(SAMPLE_SPEC, out_dir)

        expected = {
            "README.md",
            "00_EXEC_ONE_PAGER.md",
            "10_TEAM_COMPOSITION.md",
            "20_SPRINT_0_CHECKLIST.md",
            "30_RACI.md",
            "40_DAY_1_DECISIONS.md",
            "50_RISK_BRIEFING.md",
            "60_SUCCESS_METRICS.md",
            "70_CRITICAL_SUCCESS_FACTORS.md",
            "_spec.json",
        }
        actual = {p.name for p in written} | {p.name for p in out_dir.iterdir() if p.is_file()}
        missing = expected - actual
        if missing:
            failures.append(f"Missing expected files: {missing}")

        # Spot checks on individual files
        checks = [
            ("00_EXEC_ONE_PAGER.md", ["Modernising CMF onto ODC", "Customer Management Framework"]),
            ("10_TEAM_COMPOSITION.md", ["Solutions Architect", "Principal", "ODC certification"]),
            ("20_SPRINT_0_CHECKLIST.md", ["Tech Lead", "branch protection", "DevOps"]),
            ("30_RACI.md", ["ODC tenant region", "CTO"]),
            ("40_DAY_1_DECISIONS.md", ["Strangler Fig", "If we don't decide"]),
            ("50_RISK_BRIEFING.md", ["Untested data migration path", "🔴", "Reconciliation drift"]),
            ("60_SUCCESS_METRICS.md", ["p95 API latency", "Datadog APM", "Daily:"]),
            ("70_CRITICAL_SUCCESS_FACTORS.md", ["Strangler Fig discipline", "Why this matters most"]),
            ("README.md", ["Who reads what", "00_EXEC_ONE_PAGER.md", "70_CRITICAL_SUCCESS_FACTORS.md"]),
        ]
        for fname, needles in checks:
            path = out_dir / fname
            if not path.exists():
                failures.append(f"{fname}: file missing")
                continue
            text = path.read_text(encoding="utf-8")
            for n in needles:
                if n not in text:
                    failures.append(f"{fname}: missing expected content '{n}'")

        # Zip
        zip_path = kp.zip_kickoff_pack(out_dir)
        if not zip_path.exists() or zip_path.stat().st_size < 500:
            failures.append(f"Zip not produced or implausibly small ({zip_path})")

        # Print per-file summary
        print()
        print(f"  Generated {len(written)} file(s) into {out_dir}")
        for p in sorted(out_dir.iterdir()):
            if p.is_file():
                print(f"    - {p.name:<35} {p.stat().st_size:>6,} bytes")
        print(f"  Zip:   {zip_path.name} ({zip_path.stat().st_size:,} bytes)")

    finally:
        try:
            shutil.rmtree(tmp)
        except Exception:
            pass

    print()
    print("-" * 60)
    if failures:
        print(f"FAIL  ({len(failures)} issue(s))")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS")
    print("-" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
