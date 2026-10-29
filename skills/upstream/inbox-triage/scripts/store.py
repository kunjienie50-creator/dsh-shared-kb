#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""inbox-triage 素材库落盘器（确定性部分）。

只负责查重、命名、复制、写边车、维护索引；识别/分类/摘要由 agent 决定后传参。
所有输出为 ASCII 转义的 JSON，避免 Windows 控制台编码问题。

常用：
  python store.py doctor
  python store.py inbox                       # 看待整理里有什么、哪些已在库
  python store.py seen <sha256>
  python store.py put --src A.png --category 01_票据报销 --summary 差旅报销3480元 --content-file A.txt
  python store.py put --text-file A.txt --category 06_灵感创意 --summary 游戏循环三改
  python store.py put --src A.png ... --move   # 落盘后删掉源文件（投递口来的文件）
  python store.py skip --src B.png --reason 纯表情无信息 --delete
  python store.py move --path "<rel>" --category 03_合同协议
  python store.py index
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT_DEFAULT = r"D:\素材库"
CATEGORIES = [
    "01_票据报销",
    "02_证件资质",
    "03_合同协议",
    "04_工作项目",
    "05_学习资料",
    "06_灵感创意",
    "07_图文素材",
    "08_人脉联络",
    "09_生活事务",
    "10_待办提醒",
]
PENDING = "99_待分类"
BAD_CHARS = '\\/:*?"<>|\r\n\t'
TEXT_EXT = {".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".log", ".ini", ".toml"}


class Fail(Exception):
    def __init__(self, msg, code=2):
        super().__init__(msg)
        self.code = code


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=True))
    raise SystemExit(code)


def now():
    return datetime.now().astimezone()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def store_root(arg=None) -> Path:
    return Path(arg or os.environ.get("MATERIAL_ROOT") or ROOT_DEFAULT)


def index_dir(root: Path) -> Path:
    return root / "_索引"


def index_path(root: Path) -> Path:
    return index_dir(root) / "index.jsonl"


def read_index(root: Path):
    p = index_path(root)
    rows = []
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def append_index(root: Path, row: dict):
    index_dir(root).mkdir(parents=True, exist_ok=True)
    with index_path(root).open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def rewrite_index(root: Path, rows):
    index_dir(root).mkdir(parents=True, exist_ok=True)
    tmp = index_path(root).with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, index_path(root))


def find_seen(root: Path, sha: str):
    for row in reversed(read_index(root)):
        if row.get("sha256") == sha:
            return row
    return None


def clean_summary(s: str) -> str:
    s = "".join(ch for ch in (s or "") if ch not in BAD_CHARS)
    s = s.strip().strip(".")
    if not s:
        raise Fail("summary 为空")
    if len(s) > 10:
        raise Fail(f"summary 超长：{s}（{len(s)} 字，上限 10）。请压缩后再传。")
    return s


def valid_category(name: str, allow_new: bool):
    if name in CATEGORIES or name == PENDING:
        return name
    if not allow_new:
        raise Fail(
            "分类不在内置清单里：%s。内置：%s。"
            "新建类目必须先征得用户同意，然后加 --allow-new。" % (name, "、".join(CATEGORIES))
        )
    if not re.fullmatch(r"\d{2}_[\w\u4e00-\u9fa5]{1,12}", name):
        raise Fail("自定义类目需形如 11_旅行票据（两位数字_名称，名称≤12字）")
    return name


def uniq_base(folder: Path, base: str, ext: str):
    candidate = base + ext
    n = 2
    while (folder / candidate).exists():
        candidate = f"{base}-{n}{ext}"
        n += 1
    return candidate


def yaml_scalar(v) -> str:
    if isinstance(v, list):
        return "[" + ", ".join(yaml_scalar(x) for x in v) + "]"
    return json.dumps(str(v), ensure_ascii=False)


def write_sidecar(path: Path, meta: dict, rel_path: str, content: str, points: str):
    lines = ["---"]
    for k, v in meta.items():
        lines.append(f"{k}: {yaml_scalar(v)}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {meta['title']}")
    lines.append("")
    lines.append("## 提取内容")
    lines.append("")
    lines.append(content.strip() if content.strip() else f"（原文即内容：{rel_path}）")
    lines.append("")
    lines.append("## 要点")
    lines.append("")
    lines.append(points.strip() if points.strip() else "—")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def parse_sidecar(path: Path):
    """拆开边车：frontmatter 字典、标题、提取内容、要点。"""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    fm, i = {}, 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            if ":" in lines[i]:
                k, _, v = lines[i].partition(":")
                raw = v.strip()
                try:
                    fm[k.strip()] = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    fm[k.strip()] = raw
            i += 1
        i += 1
    title, content, points, cur = "", "", "", None
    for line in lines[i:]:
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            cur = None
            continue
        if line.startswith("## "):
            cur = "content" if "提取内容" in line else ("points" if "要点" in line else None)
            continue
        if cur == "content":
            content += line + "\n"
        elif cur == "points":
            points += line + "\n"
    return fm, title, content.strip(), points.strip()


def apply_enrich(row: dict, content=None, points=None, tags=None, title=None) -> bool:
    """把新内容并进已有条目的边车；返回是否有改动。"""
    side = Path(row.get("sidecar") or "")
    if not side.is_file():
        raise Fail(f"边车不存在：{side}", 3)
    fm, old_title, old_content, old_points = parse_sidecar(side)
    new_title = (title or old_title or row.get("summary", "")).strip()
    new_content = content if content is not None else old_content
    new_points = points if points is not None else old_points
    old_tags = fm.get("tags") or []
    if not isinstance(old_tags, list):
        old_tags = [str(old_tags)]
    new_tags = list(tags) if tags is not None else old_tags
    changed = (
        new_title != old_title
        or new_content.strip() != old_content.strip()
        or new_points.strip() != old_points.strip()
        or [str(t) for t in new_tags] != [str(t) for t in old_tags]
    )
    fm.update({"title": new_title, "tags": new_tags})
    row["title"] = new_title
    row["tags"] = new_tags
    if changed:
        write_sidecar(side, fm, row.get("rel_path", ""), new_content, new_points)
    return changed


def render_index_md(root: Path, rows):
    """从 index.jsonl 重建人读索引。"""
    keep = [r for r in rows if r.get("status") != "skipped"]
    keep.sort(key=lambda r: r.get("ts", ""), reverse=True)
    out_lines = ["# 素材库索引", "", f"更新：{now().strftime('%Y-%m-%d %H:%M')}　共 {len(keep)} 件", ""]
    groups = {}
    for r in keep:
        groups.setdefault(r.get("category", "未分类"), []).append(r)
    for cat in sorted(groups):
        out_lines += [f"## {cat}", "", "| 日期 | 摘要 | 标题 | 文件 | 标签 |", "|---|---|---|---|---|"]
        for r in groups[cat]:
            tags = "、".join(r.get("tags") or [])
            out_lines.append(
                f"| {r.get('date','')} | {r.get('summary','')} | {r.get('title','')} | {r.get('rel_path','')} | {tags} |"
            )
        out_lines.append("")
    skipped = [r for r in rows if r.get("status") == "skipped"]
    if skipped:
        out_lines += ["## 已跳过（无有用内容）", "", "| 日期 | 文件 | 原因 |", "|---|---|---|"]
        for r in reversed(skipped):
            out_lines.append(f"| {r.get('date','')} | {r.get('source_name','')} | {r.get('note','')} |")
        out_lines.append("")
    p = index_dir(root) / "索引.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(out_lines), encoding="utf-8", newline="\n")
    return p


def cmd_doctor(args):
    root = store_root(args.root)
    info = {
        "ok": True,
        "root": str(root),
        "index": str(index_path(root)),
        "categories": CATEGORIES + [PENDING],
        "python": sys.version.split()[0],
    }
    try:
        root.mkdir(parents=True, exist_ok=True)
        index_dir(root).mkdir(parents=True, exist_ok=True)
        info["root_exists"] = True
        probe = index_dir(root) / ".probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        info["writable"] = True
        rows = read_index(root)
        info["items"] = len([r for r in rows if r.get("status") != "skipped"])
        info["skipped"] = len([r for r in rows if r.get("status") == "skipped"])
    except OSError as e:
        info["writable"] = False
        info["ok"] = False
        info["error"] = str(e)
    out(info)


def cmd_hash(args):
    p = Path(args.path)
    if not p.is_file():
        raise Fail(f"文件不存在：{p}", 3)
    out({"ok": True, "sha256": sha256_file(p), "bytes": p.stat().st_size})


def cmd_seen(args):
    root = store_root(args.root)
    row = find_seen(root, args.sha.lower())
    if row:
        out({"ok": True, "found": True, "record": row})
    out({"ok": True, "found": False})


def cmd_skip(args):
    root = store_root(args.root)
    src = Path(args.src)
    if not src.is_file():
        raise Fail(f"文件不存在：{src}", 3)
    sha = sha256_file(src)
    row = {
        "status": "skipped",
        "date": now().strftime("%Y-%m-%d"),
        "ts": now().isoformat(timespec="seconds"),
        "source_name": src.name,
        "sha256": sha,
        "note": args.reason,
    }
    append_index(root, row)
    render_index_md(root, read_index(root))
    removed = False
    if args.delete and src.is_file():
        try:
            src.unlink()
            removed = True
        except OSError:
            removed = False
    out({"ok": True, "status": "skipped", "file": src.name, "reason": args.reason,
         "source_removed": removed})


def cmd_inbox(args):
    """列待整理里的文件，并标出哪些已经在库里。"""
    root = store_root(args.root)
    inbox = Path(args.dir) if args.dir else root / "待整理"
    if not inbox.is_dir():
        out({"ok": True, "exists": False, "dir": str(inbox), "count": 0, "files": []})
    rows = read_index(root)
    by_sha = {r.get("sha256"): r for r in rows if r.get("sha256")}
    files = []
    for p in sorted(inbox.rglob("*")):
        if not p.is_file():
            continue
        sha = sha256_file(p)
        hit = by_sha.get(sha)
        files.append(
            {
                "path": str(p),
                "name": p.name,
                "bytes": p.stat().st_size,
                "sha256": sha,
                "ext": p.suffix.lower(),
                "seen": hit is not None,
                "seen_status": hit.get("status") if hit else None,
                "seen_rel": hit.get("rel_path") if hit else None,
            }
        )
    out({"ok": True, "exists": True, "dir": str(inbox), "count": len(files), "files": files})


def cmd_put(args):
    root = store_root(args.root)
    category = valid_category(args.category, args.allow_new)
    summary = clean_summary(args.summary)

    src = Path(args.src) if args.src else None
    text_file = Path(args.text_file) if args.text_file else None
    if src is None and text_file is None:
        raise Fail("需要 --src 或 --text-file")
    if src is None:
        src = text_file
    if not src.is_file():
        raise Fail(f"文件不存在：{src}", 3)

    sha = sha256_file(src)

    content = ""
    if args.content_file:
        cf = Path(args.content_file)
        if not cf.is_file():
            raise Fail(f"--content-file 不存在：{cf}", 3)
        content = cf.read_text(encoding="utf-8-sig", errors="replace")
    elif args.content:
        content = args.content
    points = ""
    if args.points_file:
        pf = Path(args.points_file)
        if not pf.is_file():
            raise Fail(f"--points-file 不存在：{pf}", 3)
        points = pf.read_text(encoding="utf-8-sig", errors="replace")

    tags = [t.strip() for t in re.split(r"[,，、;；]", args.tags or "") if t.strip()]
    title = (args.title or summary).strip()

    if not args.force:
        rows = read_index(root)
        dup = next((r for r in reversed(rows)
                    if r.get("sha256") == sha and r.get("status") == "ingested"), None)
        if dup:
            updated = apply_enrich(
                dup,
                content=content or None,
                points=points or None,
                tags=tags or None,
                title=(args.title or "").strip() or None,
            )
            if updated:
                rewrite_index(root, rows)
                render_index_md(root, rows)
            removed = False
            if args.move and src.is_file():
                try:
                    src.unlink()
                    removed = True
                except OSError:
                    removed = False
            out({"ok": True, "duplicate": True, "stored": False, "updated": updated,
                 "source_removed": removed, "existing": dup})

    ts = now()
    month = ts.strftime("%Y-%m")
    folder = root / category / month
    ext = (src.suffix or ".txt").lower()
    base = f"{ts.strftime('%Y%m%d')}_{summary}"
    name = uniq_base(folder, base, ext)

    if args.dry_run:
        out(
            {
                "ok": True,
                "dry_run": True,
                "would_store": str(folder / name),
                "sidecar": str(folder / (Path(name).stem + ".md")),
                "sha256": sha,
            }
        )

    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    shutil.copy2(src, target)
    if sha256_file(target) != sha:
        raise Fail("复制校验失败：目标与源哈希不一致，已中止（源文件未动）")
    source_removed = False
    if args.move and src.is_file():
        try:
            src.unlink()
            source_removed = True
        except OSError:
            source_removed = False

    stem = target.stem
    side_name = f"{stem}.md"
    if side_name == name:
        side_name = f"{stem}.note.md"
    side = folder / side_name

    rel = f"{category}/{month}/{name}"
    meta = {
        "title": title,
        "category": category,
        "summary": summary,
        "date": ts.strftime("%Y-%m-%d"),
        "source_name": src.name,
        "source": args.source or "",
        "file": rel,
        "sha256": sha,
        "tags": tags,
        "confidence": args.confidence or "",
    }
    write_sidecar(side, meta, rel, content, points)

    row = {
        "status": "ingested",
        "ts": ts.isoformat(timespec="seconds"),
        "date": ts.strftime("%Y-%m-%d"),
        "category": category,
        "summary": summary,
        "title": title,
        "path": str(target),
        "rel_path": rel,
        "sidecar": str(side),
        "sha256": sha,
        "ext": ext,
        "bytes": target.stat().st_size,
        "source_name": src.name,
        "source": args.source or "",
        "tags": tags,
        "confidence": args.confidence or "",
        "note": args.note or "",
    }
    append_index(root, row)
    render_index_md(root, read_index(root))
    out(
        {
            "ok": True,
            "duplicate": False,
            "stored": True,
            "path": str(target),
            "rel_path": rel,
            "sidecar": str(side),
            "category": category,
            "summary": summary,
            "source_removed": source_removed,
        }
    )


def patch_sidecar(path: Path, updates: dict):
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                break
            for k, v in updates.items():
                if lines[i].startswith(f"{k}:"):
                    lines[i] = f"{k}: {yaml_scalar(v)}"
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def _find_row(rows, target: str):
    want = str(target).replace("\\", "/").lstrip("./")
    for row in rows:
        if row.get("status") != "ingested":
            continue
        for key in ("path", "rel_path", "sidecar"):
            val = row.get(key)
            if not val:
                continue
            norm = str(val).replace("\\", "/")
            if norm == want or norm.endswith("/" + want):
                return row
    name = Path(want).name
    for row in rows:
        if row.get("status") == "ingested" and row.get("path") and Path(row["path"]).name == name:
            return row
    return None


def cmd_move(args):
    root = store_root(args.root)
    category = valid_category(args.category, args.allow_new)
    rows = read_index(root)
    row = _find_row(rows, args.path)
    if row is None:
        raise Fail(f"索引里没有这件：{args.path}", 3)
    summary = clean_summary(args.summary or row["summary"])
    src = Path(row["path"])
    if not src.is_file():
        raise Fail(f"原件不见了：{src}", 3)

    new_title = (args.title or row.get("title") or summary).strip()
    month = (row.get("date") or now().strftime("%Y-%m-%d"))[:7]
    folder = root / category / month
    ext = row.get("ext") or src.suffix
    base = f"{(row.get('date') or now().strftime('%Y-%m-%d')).replace('-', '')}_{summary}"
    folder.mkdir(parents=True, exist_ok=True)
    name = uniq_base(folder, base, ext)
    target = folder / name
    shutil.move(str(src), str(target))

    stem = target.stem
    side_name = f"{stem}.md" if f"{stem}.md" != name else f"{stem}.note.md"
    side = folder / side_name
    old_side = Path(row["sidecar"])
    if old_side.is_file():
        shutil.move(str(old_side), str(side))
        patch_sidecar(side, {"category": category, "summary": summary,
                             "title": new_title, "file": f"{category}/{month}/{name}"})
        lines = side.read_text(encoding="utf-8").split("\n")
        for i, line in enumerate(lines):
            if line.startswith("# "):
                lines[i] = f"# {new_title}"
                break
        side.write_text("\n".join(lines), encoding="utf-8", newline="\n")

    row.update(
        {
            "category": category,
            "summary": summary,
            "title": new_title,
            "path": str(target),
            "rel_path": f"{category}/{month}/{name}",
            "sidecar": str(side),
        }
    )
    rewrite_index(root, rows)
    render_index_md(root, rows)
    out({"ok": True, "moved": True, "path": str(target), "rel_path": row["rel_path"],
         "category": category, "summary": summary})


def cmd_enrich(args):
    root = store_root(args.root)
    rows = read_index(root)
    row = _find_row(rows, args.path)
    if row is None:
        raise Fail(f"索引里没有这件：{args.path}", 3)
    content = None
    if args.content_file:
        cf = Path(args.content_file)
        if not cf.is_file():
            raise Fail(f"--content-file 不存在：{cf}", 3)
        content = cf.read_text(encoding="utf-8-sig", errors="replace")
    points = None
    if args.points_file:
        pf = Path(args.points_file)
        if not pf.is_file():
            raise Fail(f"--points-file 不存在：{pf}", 3)
        points = pf.read_text(encoding="utf-8-sig", errors="replace")
    tags = None
    if args.tags is not None:
        tags = [t.strip() for t in re.split(r"[,，、;；]", args.tags) if t.strip()]
    changed = apply_enrich(row, content=content, points=points, tags=tags, title=args.title)
    if changed:
        rewrite_index(root, rows)
        render_index_md(root, rows)
    out({"ok": True, "updated": changed, "rel_path": row.get("rel_path"),
         "sidecar": row.get("sidecar"), "title": row.get("title")})


def cmd_index(args):
    root = store_root(args.root)
    rows = read_index(root)
    p = render_index_md(root, rows)
    by_cat = {}
    for r in rows:
        if r.get("status") == "skipped":
            continue
        by_cat[r.get("category", "?")] = by_cat.get(r.get("category", "?"), 0) + 1
    out({"ok": True, "index_md": str(p), "total": sum(by_cat.values()), "by_category": by_cat})


def main():
    ap = argparse.ArgumentParser(description="inbox-triage 素材库落盘器")
    ap.add_argument("--root", help="库根目录，默认 D:\\素材库 或环境变量 MATERIAL_ROOT")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor").set_defaults(func=cmd_doctor)

    p = sub.add_parser("hash")
    p.add_argument("path")
    p.set_defaults(func=cmd_hash)

    p = sub.add_parser("seen")
    p.add_argument("sha")
    p.set_defaults(func=cmd_seen)

    p = sub.add_parser("skip")
    p.add_argument("--src", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--delete", action="store_true", help="记账后删掉源文件（待整理里的垃圾）")
    p.set_defaults(func=cmd_skip)

    p = sub.add_parser("inbox", help="列待整理文件夹，标出已在库里的")
    p.add_argument("--dir", help="默认 <库根>\\待整理")
    p.set_defaults(func=cmd_inbox)

    p = sub.add_parser("put")
    p.add_argument("--src")
    p.add_argument("--text-file")
    p.add_argument("--category", required=True)
    p.add_argument("--summary", required=True)
    p.add_argument("--title")
    p.add_argument("--tags")
    p.add_argument("--content-file")
    p.add_argument("--content")
    p.add_argument("--points-file")
    p.add_argument("--confidence")
    p.add_argument("--source")
    p.add_argument("--note")
    p.add_argument("--allow-new", action="store_true")
    p.add_argument("--force", action="store_true", help="忽略查重，强制再存一份")
    p.add_argument("--move", action="store_true", help="落盘成功后删掉源文件（从待整理投递时用）")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_put)

    sub.add_parser("index").set_defaults(func=cmd_index)

    p = sub.add_parser("move", help="重新归类/改名（待分类归位、分错类时用）")
    p.add_argument("--path", required=True, help="库内路径：绝对路径或 rel_path")
    p.add_argument("--category", required=True)
    p.add_argument("--summary", help="顺带改成新的十字总结")
    p.add_argument("--title", help="顺带改标题（边车一级标题同步）")
    p.add_argument("--allow-new", action="store_true")
    p.set_defaults(func=cmd_move)

    p = sub.add_parser("enrich", help="给已入库的条目补/改内容与要点")
    p.add_argument("--path", required=True)
    p.add_argument("--content-file")
    p.add_argument("--points-file")
    p.add_argument("--tags")
    p.add_argument("--title")
    p.set_defaults(func=cmd_enrich)

    args = ap.parse_args()
    try:
        args.func(args)
    except Fail as e:
        out({"ok": False, "error": str(e)}, e.code)
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": f"{type(e).__name__}: {e}"}, 1)


if __name__ == "__main__":
    main()
