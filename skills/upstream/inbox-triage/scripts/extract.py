#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""inbox-triage 文本抽取器（尽量零依赖）。

抽取结果写进 UTF-8 文本文件，终端只回元信息——避免把长文灌进对话、也避开控制台编码问题。

  python extract.py extract <文件> [--out <txt>] [--max-chars 20000]
      → {"ok":true,"kind":"docx","out":"...\\a.txt","chars":512,"truncated":false}
      → 图片只回元信息（宽高、字节），内容由 agent 用 read_image 看
      → PDF 若 text 极少，回 "scanned":true，改用 render-pdf

  python extract.py render-pdf <文件> --out <目录> [--dpi 150] [--max-pages 8]
      → {"ok":true,"images":["...p01.png", ...]} 供逐页视觉识别
"""

import argparse
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
TEXT_EXT = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml",
    ".log", ".ini", ".toml", ".py", ".js", ".ts", ".html", ".htm", ".xml", ".sql", ".tex",
}
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic"}
ENCODINGS = ("utf-8-sig", "utf-8", "gb18030", "utf-16")


def emit(obj, code=0):
    print(json.dumps(obj, ensure_ascii=True))
    raise SystemExit(code)


def read_text_auto(p: Path) -> str:
    raw = p.read_bytes()
    for enc in ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def docx_text(p: Path) -> str:
    with zipfile.ZipFile(p) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    paras = []
    for para in root.iter(f"{W}p"):
        buf = []
        for node in para.iter():
            if node.tag == f"{W}t" and node.text:
                buf.append(node.text)
            elif node.tag == f"{W}tab":
                buf.append("\t")
            elif node.tag in (f"{W}br", f"{W}cr"):
                buf.append("\n")
        line = "".join(buf).strip()
        if line:
            paras.append(line)
    return "\n".join(paras)


def xlsx_text(p: Path) -> str:
    S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
        shared = []
        if "xl/sharedStrings.xml" in names:
            sroot = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sroot.iter(f"{S}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{S}t")))
        sheets = sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        out = []
        for idx, sheet in enumerate(sheets, 1):
            sroot = ET.fromstring(z.read(sheet))
            rows = []
            for row in sroot.iter(f"{S}row"):
                cells = []
                for c in row.iter(f"{S}c"):
                    t = c.get("t")
                    v = c.find(f"{S}v")
                    val = v.text if v is not None and v.text else ""
                    if t == "s" and val.isdigit() and int(val) < len(shared):
                        val = shared[int(val)]
                    elif t == "inlineStr":
                        val = "".join(x.text or "" for x in c.iter(f"{S}t"))
                    cells.append(val.replace("\n", " ").strip())
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                out.append(f"## Sheet{idx}\n" + "\n".join(rows[:300]))
        return "\n\n".join(out)


def pptx_text(p: Path) -> str:
    with zipfile.ZipFile(p) as z:
        slides = sorted(
            (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)),
        )
        out = []
        for i, slide in enumerate(slides, 1):
            root = ET.fromstring(z.read(slide))
            lines = []
            for para in root.iter(f"{A}p"):
                txt = "".join(t.text or "" for t in para.iter(f"{A}t")).strip()
                if txt:
                    lines.append(txt)
            if lines:
                out.append(f"## 第{i}页\n" + "\n".join(lines))
        return "\n\n".join(out)


def pdf_extract(p: Path) -> dict:
    try:
        import pymupdf  # type: ignore
    except ImportError:
        return {"kind": "pdf", "error": "缺少 pymupdf，读不了 PDF", "need": "pip install pymupdf"}
    doc = pymupdf.open(str(p))
    pages = [page.get_text().strip() for page in doc]
    text = "\n\n".join(t for t in pages if t)
    info = {"kind": "pdf", "pages": len(pages), "text": text}
    info["scanned"] = len(text) < 20 * max(1, len(pages))
    if info["scanned"]:
        info["note"] = "文本层几乎为空，按扫描件处理：先 render-pdf 再逐页视觉识别"
    return info


def image_meta(p: Path) -> dict:
    info = {"kind": "image", "ext": p.suffix.lower()}
    try:
        from PIL import Image  # type: ignore

        with Image.open(p) as im:
            info.update({"width": im.width, "height": im.height, "mode": im.mode})
    except Exception as e:  # noqa: BLE001
        info["image_error"] = f"{type(e).__name__}: {e}"
    info["note"] = "图片内容用 read_image 视觉识别，不要走 OCR"
    return info


def zip_listing(p: Path) -> dict:
    try:
        with zipfile.ZipFile(p) as z:
            names = [i.filename for i in z.infolist() if not i.is_dir()]
        return {"kind": "zip", "members": names[:50], "count": len(names)}
    except zipfile.BadZipFile:
        return {"kind": "binary", "note": "非 zip 容器，无法读取"}


def extract(p: Path, max_chars: int) -> dict:
    ext = p.suffix.lower()
    if ext == ".pdf":
        info = pdf_extract(p)
    elif ext == ".docx":
        info = {"kind": "docx", "text": docx_text(p)}
    elif ext == ".xlsx":
        info = {"kind": "xlsx", "text": xlsx_text(p)}
    elif ext == ".pptx":
        info = {"kind": "pptx", "text": pptx_text(p)}
    elif ext in IMG_EXT:
        info = image_meta(p)
    elif ext in TEXT_EXT:
        info = {"kind": "text", "text": read_text_auto(p)}
    elif ext == ".zip":
        info = zip_listing(p)
    elif ext in {".doc", ".xls", ".ppt"}:
        info = {"kind": "legacy", "need": "convert",
                "note": "旧版二进制格式，请转存为 docx/xlsx/pptx，或截图发来"}
    else:
        info = {"kind": "unknown", "note": f"未支持的扩展名 {ext}"}

    text = info.pop("text", "") or ""
    if text:
        info["chars"] = len(text)
        if len(text) > max_chars:
            text = text[:max_chars]
            info["truncated"] = True
        info["_text"] = text
    return info


def render_pdf(p: Path, out_dir: Path, dpi: int, max_pages: int) -> dict:
    try:
        import pymupdf  # type: ignore
    except ImportError:
        emit({"ok": False, "error": "缺少 pymupdf，无法渲染 PDF", "need": "pip install pymupdf"}, 3)
    doc = pymupdf.open(str(p))
    out_dir.mkdir(parents=True, exist_ok=True)
    images = []
    total = len(doc)
    for i in range(min(total, max_pages)):
        img = out_dir / f"{p.stem}_p{i + 1:02d}.png"
        doc[i].get_pixmap(dpi=dpi).save(str(img))
        images.append(str(img))
    return {"ok": True, "pages_total": total, "rendered": len(images),
            "images": images, "truncated": total > len(images)}


def main():
    ap = argparse.ArgumentParser(description="inbox-triage 文本抽取器")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("extract")
    p.add_argument("path")
    p.add_argument("--out", help="抽取文本写到哪个文件；默认写系统临时目录")
    p.add_argument("--max-chars", type=int, default=20000)

    p2 = sub.add_parser("render-pdf")
    p2.add_argument("path")
    p2.add_argument("--out", required=True)
    p2.add_argument("--dpi", type=int, default=150)
    p2.add_argument("--max-pages", type=int, default=8)

    args = ap.parse_args()
    src = Path(args.path)
    if not src.is_file():
        emit({"ok": False, "error": f"文件不存在：{src}"}, 3)
    try:
        if args.cmd == "render-pdf":
            emit(render_pdf(src, Path(args.out), args.dpi, args.max_pages))

        info = extract(src, args.max_chars)
        text = info.pop("_text", "")
        info["file"] = str(src)
        if text:
            out = Path(args.out) if args.out else Path(
                tempfile.gettempdir()) / f"inbox_{src.stem[:24]}_{os.getpid()}.txt"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8", newline="\n")
            info["out"] = str(out)
        info["ok"] = "error" not in info
        emit(info)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        emit({"ok": False, "error": f"{type(e).__name__}: {e}"}, 1)


if __name__ == "__main__":
    main()
