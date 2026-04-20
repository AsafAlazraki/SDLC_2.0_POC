"""
Smoke test for Gemini → Anthropic fallback.

Scenarios:
  1. run_recon_agent with bogus Gemini key + real Anthropic key should succeed
     via the Anthropic fallback.
  2. run_recon_agent with bogus Gemini key + no Anthropic key should return
     {'_recon_success': False, ...} (old behaviour preserved).
  3. _classify_gemini_error should tag auth/quota errors.

Run: python test_gemini_fallback.py
"""

from __future__ import annotations
import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv(override=True)

import agent_engine

BOGUS_GEMINI = "AIzaSy_TOTALLY_BOGUS_KEY_FOR_TESTING_FALLBACK_abcd1234"
REAL_ANTHROPIC = os.environ.get("ANTHROPIC_API_KEY", "")

CODE_SAMPLE = """
====FILE: main.py====
from fastapi import FastAPI
app = FastAPI()

@app.get("/")
def root():
    return {"hello": "world"}

====FILE: requirements.txt====
fastapi
uvicorn
""" * 3  # make it slightly more interesting


def case_classifier() -> bool:
    """Unit-level: confirm the classifier tags known Gemini error shapes."""
    print("\n[1/3] _classify_gemini_error classification")
    cases = [
        (Exception("API key not valid. Please pass a valid API key."), "auth"),
        (Exception("Request had invalid authentication credentials."), "auth"),
        (Exception("PERMISSION_DENIED: Cloud AI Platform API has not been used"), "auth"),
        (Exception("403 Forbidden"), "auth"),
        (Exception("Quota exceeded for quota metric"), "quota"),
        (Exception("429 Too Many Requests"), "quota"),
        (Exception("RESOURCE_EXHAUSTED: ..."), "quota"),
        (Exception("Network connection reset"), "error"),
    ]
    ok = True
    for exc, expected in cases:
        got = agent_engine._classify_gemini_error(exc)
        marker = "OK " if got == expected else "!! "
        if got != expected:
            ok = False
        print(f"       {marker} {expected:>5} <- {str(exc)[:60]}  (got {got})")
    return ok


async def case_fallback_succeeds() -> bool:
    """Real end-to-end: bogus Gemini key, real Anthropic key. Should succeed via fallback."""
    print("\n[2/3] Gemini-fails + Anthropic-works -> expect Anthropic fallback")
    if not REAL_ANTHROPIC:
        print("       SKIPPED (no ANTHROPIC_API_KEY in .env)")
        return True

    result = await agent_engine.run_recon_agent(
        gemini_api_key=BOGUS_GEMINI,
        code_context=CODE_SAMPLE,
        anthropic_api_key=REAL_ANTHROPIC,
    )
    print(f"       _recon_success={result.get('_recon_success')} "
          f"_recon_via={result.get('_recon_via', 'gemini')}")
    print(f"       raw_summary={str(result.get('raw_summary', ''))[:120]}")

    if not result.get("_recon_success"):
        print("       !! FAIL: recon did not succeed despite Anthropic fallback being available")
        return False
    if result.get("_recon_via") != "anthropic_fallback":
        print("       !! FAIL: recon claimed success but not via anthropic_fallback")
        return False
    # Sanity: did we actually get the expected shape back from Claude?
    if "primary_language" not in result:
        print("       !! FAIL: JSON missing primary_language field")
        return False
    print("       OK -- fallback produced valid recon JSON")
    return True


async def case_no_fallback_available() -> bool:
    """Bogus Gemini, no Anthropic. Should degrade gracefully to 'unavailable'."""
    print("\n[3/3] Gemini-fails + no Anthropic key -> expect graceful unavailable marker")
    result = await agent_engine.run_recon_agent(
        gemini_api_key=BOGUS_GEMINI,
        code_context=CODE_SAMPLE,
        anthropic_api_key=None,
    )
    print(f"       _recon_success={result.get('_recon_success')}")
    print(f"       raw_summary={result.get('raw_summary')}")
    if result.get("_recon_success"):
        print("       !! FAIL: should have returned _recon_success=False without fallback")
        return False
    if "raw_summary" not in result:
        print("       !! FAIL: missing raw_summary")
        return False
    print("       OK -- graceful degrade with no Anthropic key")
    return True


async def main() -> int:
    print("-" * 60)
    print("GEMINI -> ANTHROPIC FALLBACK SMOKE TEST")
    print("-" * 60)
    print(f"Anthropic key configured: {bool(REAL_ANTHROPIC)}")

    ok = True
    ok = case_classifier() and ok
    ok = (await case_fallback_succeeds()) and ok
    ok = (await case_no_fallback_available()) and ok

    print("\n" + "-" * 60)
    print("PASS" if ok else "FAIL")
    print("-" * 60)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
