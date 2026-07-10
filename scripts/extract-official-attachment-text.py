#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        raise SystemExit("Usage: extract-official-attachment-text.py <attachment-file>")

    source = Path(sys.argv[1]).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    with tempfile.TemporaryDirectory(prefix="policy-attachment-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        pdf_path = source
        converted = False

        if source.suffix.lower() not in {".pdf"}:
            pdf_path = convert_office_to_pdf(source, temp_dir)
            converted = True

        render_info = render_first_page(pdf_path, temp_dir)
        reader = PdfReader(str(pdf_path))
        pages = []
        for index, page in enumerate(reader.pages, start=1):
            text = normalize_text(page.extract_text() or "")
            pages.append({"page": index, "text": text, "length": len(text)})

        full_text = normalize_text("\n\n".join(page["text"] for page in pages if page["text"]))
        output = {
            "sourceFile": source.name,
            "sourceExtension": source.suffix.lower(),
            "convertedToPdf": converted,
            "pageCount": len(reader.pages),
            "textLength": len(full_text),
            "text": full_text,
            "pages": pages,
            "render": render_info,
            "requiresOcr": len(full_text) < 40,
        }
        print(json.dumps(output, ensure_ascii=False))
    return 0


def convert_office_to_pdf(source: Path, output_dir: Path) -> Path:
    soffice = find_executable([
        os.environ.get("SOFFICE_PATH"),
        r"C:\Program Files\LibreOffice\program\soffice.com",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        "soffice",
        "libreoffice",
    ])
    profile_dir = output_dir / "lo-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_uri = profile_dir.as_uri()
    command = [
        soffice,
        f"-env:UserInstallation={profile_uri}",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        str(output_dir),
        str(source),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if completed.returncode != 0:
        raise RuntimeError(
            f"LibreOffice conversion failed ({completed.returncode}): "
            f"{completed.stdout}\n{completed.stderr}"
        )

    candidates = list(output_dir.glob(f"{source.stem}.pdf"))
    if not candidates:
        candidates = [item for item in output_dir.glob("*.pdf") if item.is_file()]
    if len(candidates) != 1 or candidates[0].stat().st_size < 100:
        raise RuntimeError(
            f"LibreOffice did not create one usable PDF. stdout={completed.stdout!r} stderr={completed.stderr!r}"
        )
    return candidates[0]


def render_first_page(pdf_path: Path, output_dir: Path) -> dict:
    pdftoppm = find_executable([
        os.environ.get("PDFTOPPM_PATH"),
        "pdftoppm",
    ])
    prefix = output_dir / "render"
    command = [
        pdftoppm,
        "-f",
        "1",
        "-l",
        "1",
        "-singlefile",
        "-png",
        "-r",
        "96",
        str(pdf_path),
        str(prefix),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=90)
    rendered = prefix.with_suffix(".png")
    if completed.returncode != 0 or not rendered.is_file() or rendered.stat().st_size < 500:
        raise RuntimeError(
            f"PDF render verification failed ({completed.returncode}): "
            f"{completed.stdout}\n{completed.stderr}"
        )
    return {
        "verified": True,
        "renderer": Path(pdftoppm).name,
        "firstPagePngBytes": rendered.stat().st_size,
    }


def find_executable(candidates) -> str:
    for candidate in candidates:
        if not candidate:
            continue
        expanded = os.path.expandvars(str(candidate))
        if Path(expanded).is_file():
            return expanded
        resolved = shutil.which(expanded)
        if resolved:
            return resolved
    raise FileNotFoundError(f"Required executable not found. Tried: {candidates}")


def normalize_text(value: str) -> str:
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    output = []
    blank = False
    for line in lines:
        normalized = " ".join(line.split())
        if not normalized:
            if output and not blank:
                output.append("")
            blank = True
            continue
        output.append(normalized)
        blank = False
    return "\n".join(output).strip()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
