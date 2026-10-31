#!/usr/bin/env python3
"""Build the static party-cards site from source/*.md into dist/."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source"
WEB = ROOT / "web"
DIST = ROOT / "dist"
LV = "🟢🟡🔴🔥💞"
FILES = [
    ("1_uznat_glubzhe.md", "deep", "Узнать глубже", "💬"),
    ("2_posmeyatsya.md", "fun", "Посмеяться", "😂"),
    ("3_final_18.md", "x18", "Финал 18+", "🔥"),
]
ID_SALT = "party-cards-v1"


def level_of(text: str, deck_name: str) -> str:
    blob = text[:3] + deck_name
    for ch in LV:
        if ch in text[:3]:
            return ch
    for ch in LV:
        if ch in deck_name:
            return ch
    return ""


def strip_trailing_rule(text: str) -> str:
    text = text.strip()
    return re.sub(r"(?:\n|\A)---\s*\Z", "", text).strip()


def opaque_id(*parts: str) -> str:
    raw = ID_SALT + "\x1f" + "\x1f".join(parts)
    digest = hashlib.sha256(raw.encode("utf-8")).digest()[:8]
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def parse_file(fn: str, sid: str, stitle: str, icon: str) -> tuple[dict, list[str]]:
    text = (SRC / fn).read_text(encoding="utf-8")
    errors: list[str] = []
    parts = re.split(r"(?m)^(?=## )", text)
    head, secs = parts[0], parts[1:]
    m = re.match(r"# (.*)", head)
    if not m:
        raise SystemExit(f"{fn}: missing H1")
    full = m.group(1).strip()
    intro = head[m.end():].strip()
    section: dict = {
        "id": sid,
        "title": stitle,
        "full": full,
        "icon": icon,
        "intro": intro,
        "before": None,
        "info": [],
        "games": [],
    }
    cards: dict[str, dict] = {}
    gi = 0
    for sec in secs:
        h, body = sec.split("\n", 1)
        h = h[3:].strip()
        if h.startswith("Игра"):
            gi += 1
            chunks = re.split(r"(?m)^### Колода:\s*", body)
            rules = strip_trailing_rule(chunks[0])
            decks = []
            mt = re.match(r"Игра \d+\.\s*(.*)", h)
            if not mt:
                errors.append(f"{fn}: bad game heading {h}")
                continue
            title = mt.group(1).strip()
            short_bits = re.findall(r"«([^»]*)»", title)
            gid = f"{sid}{gi}"
            for ch in chunks[1:]:
                dn, db = ch.split("\n", 1)
                dn = dn.strip()
                deck_cards: list[str] = []
                seen_n: set[int] = set()
                for line in db.split("\n"):
                    mm = re.match(r"^(\d+)\.\s+(.*)$", line)
                    if mm:
                        n = int(mm.group(1))
                        t = mm.group(2).strip()
                        if n in seen_n:
                            errors.append(f"{fn}: duplicate number {n} in {dn}")
                        seen_n.add(n)
                        if not t:
                            errors.append(f"{fn}: empty card {n} in {dn}")
                        cid = opaque_id(sid, title, dn, str(n))
                        if cid in cards:
                            errors.append(f"id collision {cid}")
                        if not re.fullmatch(r"[A-Za-z0-9_-]{10,}", cid) or "." in cid or "/" in cid:
                            errors.append(f"bad id {cid}")
                        if cid.isdigit() or cid == str(n):
                            errors.append(f"guessable id {cid}")
                        cards[cid] = {"t": t, "l": level_of(t, dn), "n": n, "d": dn, "g": gid}
                        deck_cards.append(cid)
                    elif line.strip() not in ("", "---"):
                        errors.append(f"UNPARSED {fn} | {dn} | {line}")
                decks.append({"name": dn, "cards": deck_cards})
            game = {
                "id": gid,
                "title": title,
                "short": " + ".join(short_bits) if short_bits else title,
                "rules": rules,
                "decks": decks,
            }
            if sid == "x18" and any(d["name"].startswith("Бандит") for d in decks):
                game["mode"] = "bandit"
                names = [d["name"] for d in decks]
                for prefix in ("Бандит — Что", "Бандит — Где", "Бандит — Как", "Колесо"):
                    if not any(name.startswith(prefix) for name in names):
                        errors.append(f"bandit deck missing {prefix}")
            section["games"].append(game)
        elif h.startswith("Перед игрой"):
            section["before"] = {"title": h, "md": body.strip()}
        else:
            section["info"].append({"title": h, "md": strip_trailing_rule(body)})
    return {"section": section, "cards": cards}, errors


def raw_cards(fn: str) -> list[tuple[str, int, str]]:
    """Independent count: numbered lines that sit inside a deck block."""
    lines = (SRC / fn).read_text(encoding="utf-8").splitlines()
    in_deck = False
    deck = ""
    found: list[tuple[str, int, str]] = []
    for line in lines:
        if line.startswith("### Колода:"):
            in_deck = True
            deck = line.split(":", 1)[1].strip()
            continue
        if line.startswith("## ") or (line.startswith("### ") and not line.startswith("### Колода:")):
            in_deck = False
            continue
        if not in_deck:
            continue
        mm = re.match(r"^(\d+)\.\s+(.*)$", line)
        if mm:
            found.append((deck, int(mm.group(1)), mm.group(2).strip()))
    return found


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def inside_round(x: int, y: int, x0: int, y0: int, x1: int, y1: int, rad: int) -> bool:
    if x < x0 or y < y0 or x > x1 or y > y1:
        return False
    if x0 + rad <= x <= x1 - rad or y0 + rad <= y <= y1 - rad:
        return True
    for cx, cy in ((x0 + rad, y0 + rad), (x1 - rad, y0 + rad), (x0 + rad, y1 - rad), (x1 - rad, y1 - rad)):
        if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad:
            return True
    return False


def write_icon(path: Path, size: int) -> None:
    raw = bytearray()
    margin = int(size * 0.1)
    rad = int(size * 0.16)
    x0, y0, x1, y1 = margin, margin, size - 1 - margin, size - 1 - margin
    # module grid inside the paper
    grid = 11
    inner = int(size * 0.22)
    cell = (size - inner * 2) / grid

    def module(gx: int, gy: int) -> bool:
        # three finder squares plus a few data blocks, not a real code
        def finder(ox: int, oy: int) -> bool:
            if not (ox <= gx <= ox + 2 and oy <= gy <= oy + 2):
                return False
            return gx in (ox, ox + 2) or gy in (oy, oy + 2) or (gx == ox + 1 and gy == oy + 1)
        if finder(0, 0) or finder(8, 0) or finder(0, 8):
            return True
        return (gx * 3 + gy * 5) % 7 in (0, 1) and 3 <= gx <= 7 and 3 <= gy <= 7

    for y in range(size):
        raw.append(0)
        for x in range(size):
            if inside_round(x, y, x0, y0, x1, y1, rad):
                gx = int((x - inner) / cell)
                gy = int((y - inner) / cell)
                if 0 <= gx < grid and 0 <= gy < grid and module(gx, gy):
                    raw.extend((22, 20, 28, 255))
                else:
                    raw.extend((246, 241, 232, 255))
            else:
                raw.extend((16, 14, 20, 255))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def normalize_base(raw: str) -> str:
    base = (raw or "/").strip()
    if not base.startswith("/"):
        base = "/" + base
    if not base.endswith("/"):
        base += "/"
    return base


def sha256_bytes(chunks: list[bytes]) -> str:
    h = hashlib.sha256()
    for c in chunks:
        h.update(c)
    return h.hexdigest()[:12]


def main() -> None:
    base = normalize_base(os.environ.get("BASE_PATH", "/party-cards/"))
    sections = []
    cards: dict[str, dict] = {}
    errors: list[str] = []
    report = []
    for fn, sid, stitle, icon in FILES:
        parsed, err = parse_file(fn, sid, stitle, icon)
        errors.extend(err)
        section = parsed["section"]
        for cid, card in parsed["cards"].items():
            if cid in cards:
                errors.append(f"cross-file id collision {cid}")
            cards[cid] = card
        independent = raw_cards(fn)
        parsed_rows = []
        for g in section["games"]:
            for d in g["decks"]:
                for cid in d["cards"]:
                    c = parsed["cards"][cid]
                    parsed_rows.append((d["name"], c["n"], c["t"]))
        if parsed_rows != independent:
            errors.append(f"{fn}: parser mismatch parsed={len(parsed_rows)} source={len(independent)}")
            for a, b in zip(parsed_rows, independent):
                if a != b:
                    errors.append(f"  first diff parsed={a!r} source={b!r}")
                    break
            if len(parsed_rows) != len(independent):
                errors.append("  length differs")
        report.append((stitle, section, len(independent)))
        sections.append(section)

    if errors:
        print("\n".join(errors))
        raise SystemExit(1)

    # Every stored card line must appear verbatim in its source file.
    blobs = {fn: (SRC / fn).read_text(encoding="utf-8") for fn, *_ in FILES}
    for fn, sid, *_ in FILES:
        blob = blobs[fn]
        for sec in sections:
            if sec["id"] != sid:
                continue
            for g in sec["games"]:
                for d in g["decks"]:
                    for cid in d["cards"]:
                        c = cards[cid]
                        token = f"{c['n']}. {c['t']}"
                        if token not in blob:
                            raise SystemExit(f"card text drifted from source: {token!r}")

    data = {"sections": sections, "cards": cards}
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "vendor").mkdir(parents=True)

    data_js = "/* generated by build.py — do not edit */\nwindow.PARTY=" + payload + ";\n"
    (DIST / "data.js").write_text(data_js, encoding="utf-8")
    shutil.copyfile(WEB / "app.js", DIST / "app.js")
    shutil.copyfile(WEB / "styles.css", DIST / "styles.css")
    shutil.copyfile(WEB / "vendor" / "qrcode.js", DIST / "vendor" / "qrcode.js")
    shutil.copyfile(WEB / "favicon.svg", DIST / "favicon.svg")
    write_icon(DIST / "icon-192.png", 192)
    write_icon(DIST / "icon-512.png", 512)
    (DIST / ".nojekyll").write_text("", encoding="utf-8")

    hashed_inputs = [
        data_js.encode("utf-8"),
        (DIST / "app.js").read_bytes(),
        (DIST / "styles.css").read_bytes(),
        (DIST / "vendor" / "qrcode.js").read_bytes(),
        (DIST / "favicon.svg").read_bytes(),
        (DIST / "icon-192.png").read_bytes(),
        (DIST / "icon-512.png").read_bytes(),
        (WEB / "index.html").read_bytes(),
        (WEB / "sw.js").read_bytes(),
    ]
    for fn, *_ in FILES:
        hashed_inputs.append((SRC / fn).read_bytes())
    digest = sha256_bytes(hashed_inputs)
    cache = "pc-" + digest

    index = (WEB / "index.html").read_text(encoding="utf-8").replace("__BASE__", base).replace("__HASH__", digest)
    if "__" in index:
        raise SystemExit("unreplaced placeholder in index.html")
    (DIST / "index.html").write_text(index, encoding="utf-8")
    (DIST / "404.html").write_text(index, encoding="utf-8")

    asset_paths = [
        "index.html",
        "404.html",
        f"styles.css?v={digest}",
        f"app.js?v={digest}",
        f"data.js?v={digest}",
        f"vendor/qrcode.js?v={digest}",
        "manifest.webmanifest",
        "favicon.svg",
        "icon-192.png",
        "icon-512.png",
    ]
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    sw = sw.replace("__CACHE__", cache).replace("__ASSET_PATHS__", json.dumps(asset_paths, ensure_ascii=False))
    if "__" in sw:
        raise SystemExit("unreplaced placeholder in sw.js")
    (DIST / "sw.js").write_text(sw, encoding="utf-8")

    manifest = {
        "name": "Игры для компании",
        "short_name": "Карточки",
        "start_url": base,
        "scope": base,
        "display": "standalone",
        "background_color": "#100e14",
        "theme_color": "#100e14",
        "lang": "ru",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        ],
    }
    (DIST / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DIST / "base.txt").write_text(base, encoding="utf-8")

    decks_out = []
    total = 0
    games = 0
    print(f"base {base}")
    for stitle, section, raw_n in report:
        games += len(section["games"])
        got = sum(len(d["cards"]) for g in section["games"] for d in g["decks"])
        print(f"== {stitle}: games={len(section['games'])} cards={got} source={raw_n}")
        for g in section["games"]:
            mark = g.get("mode", "")
            print(f"  {g['id']}  {g['short']}  {mark}".rstrip())
            for d in g["decks"]:
                print(f"    {len(d['cards']):4d}  {d['name']}")
                decks_out.append({
                    "section": section["id"],
                    "game": g["id"],
                    "gameTitle": g["short"],
                    "deck": d["name"],
                    "count": len(d["cards"]),
                })
                total += len(d["cards"])
    print(f"TOTAL games={games} cards={total} ids={len(cards)}")
    stats = {"games": games, "cards": total, "base": base, "decks": decks_out}
    (DIST / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if total != len(cards):
        raise SystemExit("card map size does not match deck lists")


if __name__ == "__main__":
    main()
