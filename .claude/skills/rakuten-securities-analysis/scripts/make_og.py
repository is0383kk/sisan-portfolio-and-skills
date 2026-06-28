# -*- coding: utf-8 -*-
"""ポートフォリオ・ダッシュボードの構成比カード（.pf-donut-card）を OGP 画像(og.png)として描き出す。

ダッシュボード本体は React/SVG をブラウザで描画するため、画像化には通常 HTTP サーバ＋
ヘッドレスブラウザが要る。このスクリプトはそれを避け、`data/holdings.json` を読んで
`js/model.js` の computeModel() 相当（評価額・損益・構成比・ドーナツ幾何・凡例）を Python
側で再計算し、Pillow でカード 1 枚を直接 PNG へ描く。ブラウザ／サーバ不要で完結する。

数値の出典は holdings.json の `usdRateFallback`（為替）であり、ライブ為替で描かれる実画面とは
数百円〜千円ほどズレうる（構成比は一致する）。固定値で再現性を担保するための割り切り。

使い方:
    py make_og.py [<holdings.json>] [--out <og.png>]

入出力パスは引数で受け取り、convert.py / nisa.py と同じ流儀に揃える。
省略時はリポジトリ直下の既定（data/holdings.json -> og.png）にフォールバックする。
スクリプトは標準出力に書き出し先のパスを 1 行返す。実行後そのパスをユーザーに伝えること。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# このスクリプトは <repo>/.claude/skills/rakuten-securities-analysis/scripts/ に置かれる。
# 既定の入出力を解決するためのリポジトリルート（parents[4]）。
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_HOLDINGS = REPO_ROOT / "data" / "holdings.json"
DEFAULT_OUT = REPO_ROOT / "og.png"

# ---- 色（styles.css のライトテーマより）----
C_SURFACE = (255, 255, 255)
C_BORDER = (227, 230, 237)
C_RING = (240, 242, 246)        # --pf-donut-ring
C_TEXT = (31, 39, 51)           # --pf-text  #1f2733
C_MUTED = (118, 128, 143)       # --pf-text-3 #76808f
C_UP = (215, 80, 73)            # 損益プラス #d75049
C_DOWN = (31, 138, 91)          # 損益マイナス #1f8a5b
C_TRACK = (236, 239, 244)       # 凡例バーのトラック

# 3区分の定義と色（model.js の categories() と同一の単一情報源）。
CATS = [
    {"key": "jp", "name": "国内株", "color": (91, 155, 213)},      # #5b9bd5
    {"key": "us", "name": "米国株", "color": (92, 196, 163)},      # #5cc4a3
    {"key": "fund", "name": "投資信託", "color": (155, 140, 212)},  # #9b8cd4
]

# ---- フォント（游ゴシック。Windows 標準同梱）----
FONT_DIR = Path("C:/Windows/Fonts")


def _font(name: str, size, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), int(size), index=index)


# ============ format.js 相当 ============
def yen(n) -> str:
    return "¥" + format(int(round(n)), ",d")


def sign_yen(n) -> str:
    s = "+" if n >= 0 else "-"
    return s + "¥" + format(int(round(abs(n))), ",d")


def pct(n) -> str:
    s = "+" if n >= 0 else "-"
    return s + "{:.2f}%".format(abs(n))


def ratio_pct(n) -> str:
    return "{:.1f}%".format(n * 100)


def col(n):
    if n is None:
        return C_MUTED
    return C_UP if n > 0 else (C_DOWN if n < 0 else C_MUTED)


# ============ model.js computeModel() 相当 ============
def compute_model(holdings_path: Path) -> dict:
    """holdings.json から評価額・損益・構成比・ドーナツ幾何・中央テキストを算出する。"""
    cfg = json.loads(holdings_path.read_text(encoding="utf-8"))
    rate = cfg.get("usdRateFallback", 160.83)

    def enrich(h):
        per = h.get("per", 1) or 1
        r = rate if h.get("cur") == "USD" else 1
        eval_jpy = h["shares"] * h["price"] / per * r
        avg = h.get("avg")
        cost_jpy = None if avg is None else h["shares"] * avg / per * r
        gain = None if cost_jpy is None else eval_jpy - cost_jpy
        e = dict(h)
        e.update(evalJPY=eval_jpy, costJPY=cost_jpy, gain=gain)
        return e

    allh = [enrich(h) for h in cfg["holdings"]]
    total = sum(h["evalJPY"] for h in allh)

    cats = []
    for c in CATS:
        hs = [h for h in allh if h["cat"] == c["key"]]
        ev = sum(h["evalJPY"] for h in hs)
        garr = [h for h in hs if h["gain"] is not None]
        gain = sum(h["gain"] for h in garr) if garr else None
        cost = sum(h["costJPY"] for h in garr) if garr else None
        ratio = ev / total if total > 0 else 0
        gain_pct = None if (gain is None or not cost) else gain / cost * 100
        cats.append(dict(c, evalNum=ev, ratio=ratio, gain=gain, gainPct=gain_pct))

    # ドーナツ幾何（r=86, cx=cy=118）。セグメント間は 3px のギャップを空ける（実画面と同じ）。
    r, circ = 86, 2 * math.pi * 86
    cum = 0.0
    segs = []
    for c in cats:
        frac = c["evalNum"] / total if total > 0 else 0
        a_start = (cum / circ * 360) - 90  # PIL arc は時計回り・3時方向が 0 度
        sweep = max(frac * 360 - (3 / circ * 360), 0)
        segs.append(dict(color=c["color"], a0=a_start, a1=a_start + sweep))
        cum += frac * circ

    # 中央テキスト（全体合計）。
    garr = [h for h in allh if h["gain"] is not None]
    tg = sum(h["gain"] for h in garr)
    tc = sum(h["costJPY"] for h in garr)
    center = dict(label="評価額合計", value=yen(total),
                  sub=sign_yen(tg), sub2=pct(tg / tc * 100), color=col(tg))

    return dict(total=total, cats=cats, segs=segs, center=center)


# ============ 描画 ============
def render(model: dict, out_path: Path) -> Path:
    SS = 4  # スーパーサンプリング倍率（高解像度で描画→縮小してアンチエイリアスをかける）
    CARD_W, CARD_H = 860, 300

    def s(v):
        return int(round(v * SS))

    W, H = CARD_W * SS, CARD_H * SS
    img = Image.new("RGB", (W, H), (238, 241, 246))  # --pf-bg
    d = ImageDraw.Draw(img)

    # カード本体（角丸の白面）
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=s(18),
                        fill=C_SURFACE, outline=C_BORDER, width=max(SS, 1))

    # ---- ドーナツ ----
    don_pad = 40
    dcx = don_pad + 118
    dcy = CARD_H / 2
    r, ring_w = 86, 30

    def arc(a0, a1, color):
        bb = [s(dcx - r), s(dcy - r), s(dcx + r), s(dcy + r)]
        d.arc(bb, a0, a1, fill=color, width=s(ring_w))

    arc(0, 360, C_RING)  # 背景リング（全周）
    for seg in model["segs"]:
        arc(seg["a0"], seg["a1"], seg["color"])
    # ドーナツ上の % ラベルは OGP 画像では省略（小さく読みづらく、比率は右の凡例で示すため）。

    # 中央テキスト（評価額合計・含み益・含み益率）
    cen = model["center"]
    f_cl = _font("YuGothB.ttc", s(11))
    f_cv = _font("YuGothB.ttc", s(23))
    f_cs = _font("YuGothB.ttc", s(12))
    cyy = dcy - 24
    _text_center(d, s(dcx), s(cyy), cen["label"], f_cl, C_MUTED)
    _text_center(d, s(dcx), s(cyy + 18), cen["value"], f_cv, C_TEXT)
    _text_center(d, s(dcx), s(cyy + 40), cen["sub"], f_cs, cen["color"])
    _text_center(d, s(dcx), s(cyy + 56), cen["sub2"], f_cs, cen["color"])

    # ---- 凡例 ----
    leg_x = don_pad + 236 + 40
    leg_w = CARD_W - leg_x - 26
    rows = model["cats"]
    row_h = 58
    y0 = (CARD_H - row_h * len(rows)) / 2

    f_name = _font("YuGothB.ttc", s(14))
    f_eval = _font("YuGothR.ttc", s(11.5))
    f_ratio = _font("YuGothB.ttc", s(16))
    f_gain = _font("YuGothB.ttc", s(13))
    f_gpct = _font("YuGothR.ttc", s(11))

    # グリッド列: swatch 14 / name+eval 108 / bar-wrap(1fr) / gain 110, gap 14（元CSS準拠）。
    # bar-wrap 内はさらに track(1fr) + 比率ラベル 50px(gap10)。track と比率を別カラムにして重なりを防ぐ。
    gap = 14
    ratio_w, ratio_gap = 50, 10
    sw_w, name_w, gain_w = 14, 108, 110
    barwrap_w = leg_w - (sw_w + name_w + gain_w + gap * 3)
    bar_w = barwrap_w - (ratio_w + ratio_gap)

    for i, c in enumerate(rows):
        ry = y0 + i * row_h + row_h / 2
        x = leg_x
        # スウォッチ
        d.rounded_rectangle([s(x), s(ry - 7), s(x + sw_w), s(ry + 7)], radius=s(4), fill=c["color"])
        x += sw_w + gap
        # 銘柄名 + 評価額
        d.text((s(x), s(ry - 14)), c["name"], font=f_name, fill=C_TEXT)
        d.text((s(x), s(ry + 3)), yen(c["evalNum"]), font=f_eval, fill=C_MUTED)
        x += name_w + gap
        # バー（トラック + 構成比フィル）
        d.rounded_rectangle([s(x), s(ry - 3.5), s(x + bar_w), s(ry + 3.5)], radius=s(3.5), fill=C_TRACK)
        fill_w = max(bar_w * c["ratio"], 2)
        d.rounded_rectangle([s(x), s(ry - 3.5), s(x + fill_w), s(ry + 3.5)], radius=s(3.5), fill=c["color"])
        # 比率%（バーの右隣 50px カラムに右寄せ）
        _text_right(d, s(x + bar_w + ratio_gap + ratio_w), s(ry - 8), ratio_pct(c["ratio"]), f_ratio, C_TEXT)
        x += barwrap_w + gap
        # 評価損益（右端）
        gcolor = col(c["gain"])
        gtxt = "—" if c["gain"] is None else sign_yen(c["gain"])
        _text_right(d, s(leg_x + leg_w), s(ry - 14), gtxt, f_gain, gcolor)
        if c["gainPct"] is not None:
            _text_right(d, s(leg_x + leg_w), s(ry + 3), pct(c["gainPct"]), f_gpct, gcolor)

    # 2x へ縮小してアンチエイリアスを効かせる
    out = img.resize((CARD_W * 2, CARD_H * 2), Image.LANCZOS)
    out.save(out_path)
    return out_path


def _text_center(d, x, y, txt, font, fill):
    bb = d.textbbox((0, 0), txt, font=font)
    w, hh = bb[2] - bb[0], bb[3] - bb[1]
    d.text((x - w / 2 - bb[0], y - hh / 2 - bb[1]), txt, font=font, fill=fill)


def _text_right(d, x, y, txt, font, fill):
    bb = d.textbbox((0, 0), txt, font=font)
    d.text((x - (bb[2] - bb[0]) - bb[0], y), txt, font=font, fill=fill)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="ポートフォリオ構成比カードを OGP 画像(og.png)として生成"
    )
    parser.add_argument(
        "input", nargs="?", default=str(DEFAULT_HOLDINGS),
        help="入力 holdings.json（省略時はリポジトリ直下 data/holdings.json）"
    )
    parser.add_argument(
        "--out", help="出力先 .png パス（省略時はリポジトリ直下 og.png）"
    )
    args = parser.parse_args(argv)

    holdings_path = Path(args.input).resolve()
    if not holdings_path.is_file():
        print(f"error: 入力ファイルが見つかりません: {holdings_path}", file=sys.stderr)
        return 2

    out_path = Path(args.out).resolve() if args.out else DEFAULT_OUT
    out_path.parent.mkdir(parents=True, exist_ok=True)

    model = compute_model(holdings_path)
    render(model, out_path)
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
