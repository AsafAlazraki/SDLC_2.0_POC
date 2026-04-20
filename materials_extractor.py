"""
materials_extractor.py — turn any uploaded material into the text the agents see.

Strategy: dispatch by file extension / MIME, return (extracted_text, metadata).
Never raises — extraction failures yield ("", {"error": ...}) so the upload
still records and the user gets an honest record of what couldn't be parsed.

Special handling:
  - .oap files (OutSystems Application Packages) are zip archives. We crack the
    archive open, read Manifest.xml, list the .oml modules (binary, can't be
    parsed but their names + sizes are valuable signal), and concatenate any
    text-shaped contents up to a reasonable cap.
  - .zip / .gz tarballs: same recursion strategy as OAP.
  - .pdf via pypdf  (soft-imported; missing dep = clean error message).
  - .docx via python-docx (same).
  - Code / text / markup: decoded as UTF-8 with replacement.
  - Images: marked binary with metadata only (Phase 2.5 will optionally
    add Gemini-vision summaries; gated on env GEMINI_API_KEY).

Hard cap: MAX_TEXT_BYTES per extracted blob to protect prompt budget.
"""

from __future__ import annotations
import io
import os
import zipfile
from typing import Tuple, Dict, Any, List

# Optional libraries — soft-imported so missing deps fail gracefully per file.
try:
    import pypdf  # type: ignore
except ImportError:
    pypdf = None  # type: ignore

try:
    import docx as docx_lib  # type: ignore  # python-docx
except ImportError:
    docx_lib = None  # type: ignore


MAX_TEXT_BYTES = 200_000        # per-material body cap (~50K tokens)
MAX_ZIP_FILES = 60              # cap how many entries we crack open inside a zip
MAX_ZIP_BYTES_PER_ENTRY = 80_000

TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".rst", ".json", ".yaml", ".yml", ".xml",
    ".csv", ".tsv", ".log", ".html", ".htm", ".sql", ".sh", ".bat", ".ps1",
    ".ini", ".cfg", ".conf", ".toml", ".env",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".cs", ".cpp", ".c", ".h",
    ".hpp", ".go", ".rs", ".rb", ".php", ".kt", ".swift", ".scala", ".lua",
    ".dart", ".vue", ".svelte", ".css", ".scss", ".less",
}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}

# OutSystems-specific extensions we recognise even if we can't fully parse them.
OUTSYSTEMS_BINARY_EXTS = {".oml", ".xif", ".eap"}


def _truncate(text: str, limit: int = MAX_TEXT_BYTES) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n\n... [truncated — original was {len(text):,} chars]"


def _decode_text(payload: bytes, meta: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    try:
        text = payload.decode("utf-8", errors="replace")
    except Exception as e:
        meta["error"] = f"text decode failed: {e}"
        return ("", meta)
    meta["extracted"] = "text"
    return (_truncate(text), meta)


def _extract_pdf(payload: bytes, meta: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    if pypdf is None:
        meta["error"] = "PDF support requires `pypdf` — add it to requirements.txt and reinstall."
        return ("", meta)
    try:
        reader = pypdf.PdfReader(io.BytesIO(payload))
        pages = []
        for i, page in enumerate(reader.pages):
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                pages.append(f"[page {i+1}: extraction failed]")
        text = "\n\n".join(pages)
        meta["pages"] = len(reader.pages)
        meta["extracted"] = "pdf"
        return (_truncate(text), meta)
    except Exception as e:
        meta["error"] = f"pdf parse failed: {e}"
        return ("", meta)


def _extract_docx(payload: bytes, meta: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    if docx_lib is None:
        meta["error"] = "DOCX support requires `python-docx` — add it to requirements.txt and reinstall."
        return ("", meta)
    try:
        doc = docx_lib.Document(io.BytesIO(payload))
        paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
        # Tables as TSV-ish blocks
        for tbl in doc.tables:
            for row in tbl.rows:
                cells = [c.text.strip() for c in row.cells]
                paragraphs.append(" | ".join(cells))
        text = "\n".join(paragraphs)
        meta["paragraphs"] = len(paragraphs)
        meta["extracted"] = "docx"
        return (_truncate(text), meta)
    except Exception as e:
        meta["error"] = f"docx parse failed: {e}"
        return ("", meta)


def _extract_zip(payload: bytes, meta: Dict[str, Any], *, label: str) -> Tuple[str, Dict[str, Any]]:
    """
    Crack open a zip-shaped archive (.zip, .oap). For OAP packages, we look for
    Manifest.xml first and lift its contents into the prompt. We then list every
    file (truncated by name + size), and concatenate the text-shaped contents.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as e:
        meta["error"] = f"{label} archive could not be opened: {e}"
        return ("", meta)

    names = zf.namelist()
    meta["archive_kind"] = label
    meta["entry_count"] = len(names)
    meta["extracted"] = "zip"

    out_parts: List[str] = []
    out_parts.append(f"=== {label} ARCHIVE LISTING ({len(names)} entries) ===")

    # Highlight OutSystems-specific structure first (manifests, modules).
    manifest_names = [n for n in names if os.path.basename(n).lower() in (
        "manifest.xml", "applicationmanifest.xml", "package.xml", "package.json",
    )]
    oml_names = [n for n in names if n.lower().endswith(tuple(OUTSYSTEMS_BINARY_EXTS))]

    if oml_names:
        meta["outsystems_modules"] = oml_names
        out_parts.append("")
        out_parts.append(f"OutSystems modules detected ({len(oml_names)}):")
        for n in oml_names[:30]:
            try:
                size = zf.getinfo(n).file_size
            except KeyError:
                size = 0
            out_parts.append(f"  - {n}  ({size:,} bytes, binary OML — name + size only)")
        if len(oml_names) > 30:
            out_parts.append(f"  ... and {len(oml_names) - 30} more")

    if manifest_names:
        out_parts.append("")
        out_parts.append("--- Manifest content ---")
        for mn in manifest_names[:3]:
            try:
                with zf.open(mn) as fh:
                    raw = fh.read(MAX_ZIP_BYTES_PER_ENTRY)
                out_parts.append(f"\n[{mn}]\n{raw.decode('utf-8', errors='replace')}")
            except Exception as e:
                out_parts.append(f"\n[{mn}]  (could not read: {e})")

    # General-purpose listing of remaining entries.
    out_parts.append("")
    out_parts.append("--- Full entry list ---")
    for n in names[:MAX_ZIP_FILES]:
        try:
            size = zf.getinfo(n).file_size
        except KeyError:
            size = 0
        out_parts.append(f"  {n}  ({size:,} bytes)")
    if len(names) > MAX_ZIP_FILES:
        out_parts.append(f"  ... and {len(names) - MAX_ZIP_FILES} more (truncated)")

    # Concatenate text-shaped contents (excluding ones we already showed).
    shown_text_names = {n.lower() for n in manifest_names}
    text_entries = [n for n in names
                    if any(n.lower().endswith(ext) for ext in TEXT_EXTS)
                    and n.lower() not in shown_text_names]
    if text_entries:
        out_parts.append("")
        out_parts.append(f"--- Text contents ({min(len(text_entries), MAX_ZIP_FILES)} of {len(text_entries)} files) ---")
        for n in text_entries[:MAX_ZIP_FILES]:
            try:
                with zf.open(n) as fh:
                    raw = fh.read(MAX_ZIP_BYTES_PER_ENTRY)
                body = raw.decode("utf-8", errors="replace")
                out_parts.append(f"\n====FILE: {n}====")
                out_parts.append(body)
            except Exception as e:
                out_parts.append(f"\n[{n}]  (read failed: {e})")

    text = "\n".join(out_parts)
    return (_truncate(text), meta)


def extract_text(filename: str, mime: str, payload: bytes) -> Tuple[str, Dict[str, Any]]:
    """
    Public entry point. Returns (extracted_text, metadata_dict).

    metadata fields populated:
      - original_size: bytes received
      - extracted: 'text' | 'pdf' | 'docx' | 'zip' | 'image' | 'unknown'
      - error: if extraction failed
      - archive_kind, entry_count, outsystems_modules: for zips/oaps
      - pages: for pdfs
      - paragraphs: for docx
    """
    name = (filename or "").lower()
    mime_l = (mime or "").lower()
    meta: Dict[str, Any] = {"original_size": len(payload)}

    # Order matters — most specific dispatch first.
    if name.endswith(".pdf") or mime_l == "application/pdf":
        return _extract_pdf(payload, meta)
    if name.endswith(".docx") or "wordprocessingml" in mime_l:
        return _extract_docx(payload, meta)
    if name.endswith(".oap"):
        return _extract_zip(payload, meta, label="OAP")
    if name.endswith(".zip") or mime_l in ("application/zip", "application/x-zip-compressed"):
        return _extract_zip(payload, meta, label="ZIP")
    if any(name.endswith(ext) for ext in IMAGE_EXTS) or mime_l.startswith("image/"):
        meta["extracted"] = "image"
        meta["note"] = "Image attached — no automatic text extraction (Gemini-vision summaries land in Phase 2.5)."
        return ("", meta)
    if any(name.endswith(ext) for ext in TEXT_EXTS) or mime_l.startswith("text/"):
        return _decode_text(payload, meta)

    # Fallback: try to decode as UTF-8 — many "unknown" files are actually plain text.
    try:
        sample = payload[:2048].decode("utf-8")
        meta["note"] = f"Unknown extension/MIME ({mime}); decoded as UTF-8 best-effort."
        return _decode_text(payload, meta)
    except UnicodeDecodeError:
        meta["extracted"] = "unknown"
        meta["note"] = f"Binary file ({mime or 'unknown MIME'}) — metadata only."
        return ("", meta)


def materials_to_prompt_block(materials: List[Dict[str, Any]],
                               *, max_total_chars: int = 80_000) -> str:
    """
    Render a list of project_materials rows (as returned by Supabase) into the
    `## Project Materials` block injected into agent prompts. Truncates the
    aggregate to max_total_chars to protect prompt budget.
    """
    if not materials:
        return ""
    lines = ["", "## Project Materials",
             "The following materials were attached to this project. Treat them as authoritative context — they are documents the team has explicitly handed you to reason against.",
             ""]
    used = sum(len(line) + 1 for line in lines)
    for m in materials:
        kind = m.get("kind", "unknown")
        title = m.get("filename") or m.get("source_url") or "(untitled)"
        body = m.get("content_text") or ""
        meta = m.get("metadata") or {}
        header_parts = [f"### [{kind}] {title}"]
        if meta.get("archive_kind"):
            header_parts.append(f" ({meta['entry_count']} entries inside the {meta['archive_kind']})")
        if meta.get("pages"):
            header_parts.append(f" ({meta['pages']} pages)")
        if meta.get("error"):
            header_parts.append(f"  ⚠ extraction error: {meta['error']}")
        header = "".join(header_parts)
        # Compute how much body we can afford.
        remaining = max_total_chars - used - len(header) - 4
        if remaining <= 200:
            lines.append(header)
            lines.append("(remaining materials trimmed to protect prompt budget)")
            break
        clipped = body if len(body) <= remaining else body[:remaining] + "\n... [trimmed]"
        lines.append(header)
        if m.get("source_url"):
            lines.append(f"Source URL: {m['source_url']}")
        if clipped:
            lines.append(clipped)
        lines.append("")
        used += len(header) + len(clipped) + 8
        if used >= max_total_chars:
            break
    return "\n".join(lines)
