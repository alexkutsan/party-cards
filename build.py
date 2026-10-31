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


Q_LINE = re.compile(r"^(\d+)\.\s+\[(1|2|3)\]\s+(🔴|🔥|💞)\s+(.*)$")


def parse_summa(cards: dict[str, dict]) -> tuple[dict, list[str]]:
    """Parse the hidden-score game. Questions are not cards and do not join `cards`."""
    fn = "4_summa_stavki_18.md"
    text = (SRC / fn).read_text(encoding="utf-8")
    errors: list[str] = []
    parts = re.split(r"(?m)^(?=## )", text)
    head, secs = parts[0], parts[1:]
    m = re.match(r"# (.*)", head)
    if not m:
        return {"game": None, "questions": {}}, [f"{fn}: missing H1"]
    intro = head[m.end():].strip()
    before = ""
    rules = ""
    body = ""
    for sec in secs:
        h, rest = sec.split("\n", 1)
        h = h[3:].strip()
        if h.startswith("Перед игрой"):
            before = rest.strip()
        elif h.startswith("Игра"):
            chunks = re.split(r"(?m)^### ", rest)
            rules = strip_trailing_rule(chunks[0])
            body = "### " + "### ".join(chunks[1:]) if len(chunks) > 1 else ""
        else:
            errors.append(f"{fn}: unexpected section {h}")
    blocks = re.split(r"(?m)^### ", body) if body else []
    sets = []
    pool_ids: list[str] = []
    questions: dict[str, dict] = {}
    seen_n: set[tuple[str, int]] = set()

    def add_q(scope: str, line: str) -> str | None:
        mm = Q_LINE.match(line.strip())
        if not mm:
            if line.strip() not in ("", "---"):
                errors.append(f"UNPARSED {fn} | {scope} | {line}")
            return None
        n, w, level, qtext = int(mm.group(1)), int(mm.group(2)), mm.group(3), mm.group(4).strip()
        if (scope, n) in seen_n:
            errors.append(f"{fn}: duplicate question {n} in {scope}")
        seen_n.add((scope, n))
        qid = opaque_id("summa-q", scope, str(n))
        if qid in questions or qid in cards:
            errors.append(f"summa id collision {qid}")
        if "." in qid or "/" in qid:
            errors.append(f"summa id not path-safe {qid}")
        questions[qid] = {"id": qid, "t": qtext, "w": w, "l": level, "n": n, "scope": scope}
        return qid

    for block in blocks:
        if not block.strip():
            continue
        first, _, rest = block.partition("\n")
        first = first.strip()
        if first.startswith("Набор:"):
            sm = re.match(r"Набор:\s*(\d+)\.\s*(.+)", first)
            if not sm:
                errors.append(f"{fn}: bad set heading {first}")
                continue
            num, name = int(sm.group(1)), sm.group(2).strip()
            scope = f"set:{num}"
            qids = []
            for line in rest.split("\n"):
                qid = add_q(scope, line)
                if qid:
                    qids.append(qid)
            weights = [questions[i]["w"] for i in qids]
            if weights != [1, 1, 2, 2, 3, 3]:
                errors.append(f"{fn}: set {num} weights {weights}, want 1,1,2,2,3,3")
            levels = {questions[i]["l"] for i in qids}
            sets.append({
                "id": opaque_id("summa-set", str(num)),
                "n": num,
                "name": name,
                "level": next(iter(levels)) if len(levels) == 1 else "",
                "qs": qids,
            })
        elif first.startswith("Пул:"):
            scope = "pool"
            for line in rest.split("\n"):
                qid = add_q(scope, line)
                if qid:
                    pool_ids.append(qid)
        elif first.strip():
            errors.append(f"{fn}: unknown block {first}")

    if len(sets) != 10:
        errors.append(f"{fn}: expected 10 sets, got {len(sets)}")
    if len(pool_ids) != 30:
        errors.append(f"{fn}: expected 30 pool questions, got {len(pool_ids)}")
    for w in (1, 2, 3):
        count = sum(1 for i in pool_ids if questions[i]["w"] == w)
        if count < 2:
            errors.append(f"{fn}: pool weight {w} has {count}")
    game = {
        "id": "summa",
        "title": "«Сумма и ставки»",
        "short": "Сумма и ставки",
        "rules": (before + "\n\n" + rules).strip(),
        "intro": intro,
        "mode": "score",
        "decks": [],
        "sets": [{"id": s["id"], "n": s["n"], "name": s["name"], "level": s["level"], "qs": s["qs"]} for s in sets],
        "pool": pool_ids,
    }
    return {"game": game, "questions": questions}, errors


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

    summa, summa_err = parse_summa(cards)
    errors.extend(summa_err)
    if summa.get("game"):
        host = next((s for s in sections if s["id"] == "x18"), None)
        if host is None:
            errors.append("summa: Финал 18+ section missing")
        else:
            host["games"].append(summa["game"])

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

    data = {"sections": sections, "cards": cards, "score": {
        "sets": summa.get("game", {}).get("sets", []) if summa.get("game") else [],
        "pool": summa.get("game", {}).get("pool", []) if summa.get("game") else [],
        "questions": summa.get("questions", {}),
    }}
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "vendor").mkdir(parents=True)

    data_js = "/* generated by build.py — do not edit */\nwindow.PARTY=" + payload + ";\n"
    (DIST / "data.js").write_text(data_js, encoding="utf-8")
    shutil.copyfile(WEB / "app.js", DIST / "app.js")
    shutil.copyfile(WEB / "score.js", DIST / "score.js")
    shutil.copyfile(WEB / "styles.css", DIST / "styles.css")
    shutil.copyfile(WEB / "vendor" / "qrcode.js", DIST / "vendor" / "qrcode.js")
    shutil.copyfile(WEB / "favicon.svg", DIST / "favicon.svg")
    write_icon(DIST / "icon-192.png", 192)
    write_icon(DIST / "icon-512.png", 512)
    (DIST / ".nojekyll").write_text("", encoding="utf-8")

    hashed_inputs = [
        data_js.encode("utf-8"),
        (DIST / "app.js").read_bytes(),
        (DIST / "score.js").read_bytes(),
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
    hashed_inputs.append((SRC / "4_summa_stavki_18.md").read_bytes())
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
        f"score.js?v={digest}",
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
