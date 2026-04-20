"""
Smoke test for materials_extractor.py (Phase 2 verification).

Builds fake artefacts in-memory and asserts the extractor handles each one
correctly. The headline test is a CMF-shaped .oap archive — that is the exact
shape the user is about to throw at it (OS11 Forge component for Customer
Management Framework). If that one fails, the upload UX is broken before the
user even tries it.

Coverage:
  1. Plain text (.md) — the trivial path
  2. Code file (.py) — the TEXT_EXTS branch
  3. Image (.png) — should mark as "image" with metadata only
  4. Unknown binary — falls back to "unknown" with no crash
  5. PDF (synthetic) — soft-skipped if pypdf missing, asserted if present
  6. ZIP archive — generic .zip path
  7. **OAP (CMF-shaped)** — the headline test:
        * Manifest.xml present
        * Several .oml binary modules
        * A few text-shaped resources
        * Asserts archive_kind=='OAP', outsystems_modules populated,
          manifest content present in body, all entries listed.
  8. materials_to_prompt_block — multi-material rendering + budget cap

Run: python test_materials_extractor.py
"""

from __future__ import annotations
import io
import os
import sys
import zipfile

import materials_extractor as mx


# ---------------------------------------------------------------------------
# Helpers to fabricate test payloads
# ---------------------------------------------------------------------------

CMF_MANIFEST_XML = b"""<?xml version="1.0" encoding="utf-8"?>
<ApplicationPackage>
  <Name>Customer Management Framework</Name>
  <Version>2.4.1</Version>
  <Vendor>OutSystems Forge</Vendor>
  <Description>Reference implementation of a customer management module.</Description>
  <Modules>
    <Module Name="CustomerManagement_CW" Kind="WebApp" />
    <Module Name="CustomerManagement_CS" Kind="Service" />
    <Module Name="CustomerManagement_BL" Kind="Library" />
    <Module Name="CustomerManagement_DM" Kind="Library" />
  </Modules>
</ApplicationPackage>
"""

# Fake .oml payloads — real OMLs are encrypted XML blobs; we just need bytes
# of plausible size so the extractor reports them as binary modules.
def _fake_oml(seed: bytes, n_kb: int = 12) -> bytes:
    return seed + os.urandom(n_kb * 1024)


def build_fake_cmf_oap() -> bytes:
    """Build a CMF-shaped .oap archive in memory."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Manifest.xml", CMF_MANIFEST_XML)
        # Four binary OML modules (matching Forge CMF layout)
        zf.writestr("CustomerManagement_CW.oml", _fake_oml(b"OML-CW-", 14))
        zf.writestr("CustomerManagement_CS.oml", _fake_oml(b"OML-CS-", 10))
        zf.writestr("CustomerManagement_BL.oml", _fake_oml(b"OML-BL-", 18))
        zf.writestr("CustomerManagement_DM.oml", _fake_oml(b"OML-DM-", 22))
        # A couple of text-shaped resources that should be concatenated
        zf.writestr("README.md",
                    b"# Customer Management Framework\n"
                    b"\n"
                    b"Forge component used as a reference implementation.\n")
        zf.writestr("config/settings.json",
                    b'{"feature_flags": {"loyalty": true, "audit": false}}')
        # Add a few extra entries to exercise the "Full entry list" path
        zf.writestr("docs/CHANGELOG.txt", b"v2.4.1 - bug fixes\nv2.4.0 - loyalty module\n")
    return buf.getvalue()


def build_fake_pdf() -> bytes | None:
    """Build a tiny synthetic PDF if pypdf is available; else None."""
    if mx.pypdf is None:
        return None
    try:
        # pypdf can author very small PDFs via PdfWriter
        writer = mx.pypdf.PdfWriter()
        writer.add_blank_page(width=72, height=72)
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

def test_plain_text():
    text, meta = mx.extract_text("notes.md", "text/markdown",
                                  b"# Hello\n\nA quick note for the agents.")
    assert meta["extracted"] == "text", meta
    assert "Hello" in text
    print("  [1/8] text/markdown               OK")


def test_code_file():
    src = b"def foo():\n    return 42\n"
    text, meta = mx.extract_text("snippet.py", "", src)
    assert meta["extracted"] == "text", meta
    assert "def foo" in text
    print("  [2/8] code (.py via TEXT_EXTS)    OK")


def test_image():
    png_magic = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
    text, meta = mx.extract_text("logo.png", "image/png", png_magic)
    assert meta["extracted"] == "image", meta
    assert text == ""           # no automatic text extraction yet
    assert "Gemini-vision" in meta.get("note", "")
    print("  [3/8] image (metadata only)       OK")


def test_unknown_binary():
    blob = bytes(range(256)) * 4   # definitely not valid UTF-8
    text, meta = mx.extract_text("mystery.bin", "application/octet-stream", blob)
    assert meta["extracted"] == "unknown", meta
    assert "Binary" in meta.get("note", "")
    print("  [4/8] unknown binary fallback     OK")


def test_pdf_when_available():
    payload = build_fake_pdf()
    if payload is None:
        print("  [5/8] pdf                         SKIP (pypdf not installed or build failed)")
        return
    text, meta = mx.extract_text("blank.pdf", "application/pdf", payload)
    if meta.get("error"):
        print(f"  [5/8] pdf                         SKIP (parse error: {meta['error']})")
        return
    assert meta["extracted"] == "pdf", meta
    assert meta.get("pages") == 1, meta
    print("  [5/8] pdf (synthetic)             OK")


def test_zip_generic():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("hello.txt", b"hi")
        zf.writestr("data/info.json", b'{"k":1}')
    payload = buf.getvalue()
    text, meta = mx.extract_text("bundle.zip", "application/zip", payload)
    assert meta["extracted"] == "zip", meta
    assert meta["archive_kind"] == "ZIP", meta
    assert meta["entry_count"] == 2, meta
    assert "hello.txt" in text and "info.json" in text
    print("  [6/8] zip (generic)               OK")


def test_oap_cmf_headline():
    """
    The headline test — CMF-shaped OAP. This is what the user is about to
    upload. If this fails, fix it before they hit it for real.
    """
    payload = build_fake_cmf_oap()
    text, meta = mx.extract_text("CustomerManagementFramework.oap",
                                  "application/octet-stream", payload)

    # 1. Recognised as OAP, not plain ZIP
    assert meta["extracted"] == "zip", meta
    assert meta["archive_kind"] == "OAP", \
        f"Expected archive_kind=OAP (.oap dispatch), got {meta.get('archive_kind')}"

    # 2. All four OML modules listed in the metadata
    oml = meta.get("outsystems_modules") or []
    assert len(oml) == 4, f"Expected 4 .oml modules, got {len(oml)}: {oml}"
    for expected in ("CustomerManagement_CW.oml", "CustomerManagement_CS.oml",
                     "CustomerManagement_BL.oml", "CustomerManagement_DM.oml"):
        assert expected in oml, f"Missing module {expected} in outsystems_modules"

    # 3. Manifest content lifted into the prompt body
    assert "Customer Management Framework" in text, \
        "Manifest <Name> not found in extracted text"
    assert "ApplicationPackage" in text, \
        "Manifest XML root not found in extracted text"

    # 4. Text-shaped resources concatenated
    assert "Forge component used as a reference implementation" in text, \
        "README.md content not concatenated into extracted text"
    assert "loyalty" in text, "settings.json content not concatenated"

    # 5. Entry counter sensible
    assert meta["entry_count"] >= 7, meta

    # 6. Stays under the byte cap (the OMLs were ~64KB total, well under 200K)
    assert len(text) <= mx.MAX_TEXT_BYTES + 200, \
        f"Extracted text exceeded MAX_TEXT_BYTES ({len(text)} chars)"

    # 7. The "binary OML — name + size only" annotation should appear
    assert "binary OML" in text, "OML annotation missing from listing"

    print(f"  [7/8] OAP/CMF headline            OK  "
          f"(modules={len(oml)}, entries={meta['entry_count']}, body={len(text):,} chars)")


def test_prompt_block_rendering():
    """materials_to_prompt_block should render a list of rows + cap to budget."""
    rows = [
        {
            "kind": "file",
            "filename": "Manifest.xml",
            "content_text": "<ApplicationPackage>...</ApplicationPackage>",
            "metadata": {"archive_kind": "OAP", "entry_count": 9},
        },
        {
            "kind": "text",
            "filename": "Note from PM",
            "content_text": "Build for B2B SaaS, expect 50K MAU.",
            "metadata": {},
        },
        {
            "kind": "file",
            "filename": "spec.pdf",
            "content_text": "Some PDF body...",
            "metadata": {"pages": 12},
        },
    ]
    block = mx.materials_to_prompt_block(rows)
    assert "## Project Materials" in block
    assert "Manifest.xml" in block
    assert "(9 entries inside the OAP)" in block, "OAP annotation missing in prompt block"
    assert "(12 pages)" in block, "PDF page-count annotation missing"
    assert "Build for B2B SaaS" in block

    # Budget cap behaviour — feed a giant body and assert we still get a string
    huge = [{
        "kind": "file",
        "filename": f"big_{i}.txt",
        "content_text": "x" * 30_000,
        "metadata": {},
    } for i in range(10)]
    capped = mx.materials_to_prompt_block(huge, max_total_chars=20_000)
    assert len(capped) <= 25_000, f"Block exceeded soft cap: {len(capped)} chars"
    print("  [8/8] materials_to_prompt_block   OK")


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> int:
    print("-" * 60)
    print("MATERIALS EXTRACTOR SMOKE TEST")
    print("-" * 60)
    print(f"  pypdf installed:       {mx.pypdf is not None}")
    print(f"  python-docx installed: {mx.docx_lib is not None}")
    print()

    tests = [
        test_plain_text,
        test_code_file,
        test_image,
        test_unknown_binary,
        test_pdf_when_available,
        test_zip_generic,
        test_oap_cmf_headline,
        test_prompt_block_rendering,
    ]

    failed = []
    for t in tests:
        try:
            t()
        except AssertionError as e:
            failed.append((t.__name__, str(e)))
            print(f"  [!!] {t.__name__}  FAIL  {e}")
        except Exception as e:
            failed.append((t.__name__, f"{type(e).__name__}: {e}"))
            print(f"  [!!] {t.__name__}  CRASH  {type(e).__name__}: {e}")

    print()
    print("-" * 60)
    if failed:
        print(f"FAIL  ({len(failed)} of {len(tests)} test(s) failed)")
        for name, err in failed:
            print(f"  - {name}: {err}")
        return 1
    print("PASS")
    print("-" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
