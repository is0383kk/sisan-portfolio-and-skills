"""楽天証券「資産残高」CSV から NISA 非課税枠（生涯）の使用状況を算出して Markdown 化する。

入力: 楽天証券のマイメニュー > 資産合計 > CSV出力 で得られる Shift-JIS の CSV。
出力: 同じディレクトリに `NISA生涯枠_{yyyymmdd}.md` を生成する。

算出の考え方:
  NISA の生涯枠（非課税保有限度額）は「簿価（取得価額）」で管理される。値上がり益は枠を
  消費しないため、時価ではなく簿価で使用額を集計する必要がある。CSV の保有商品詳細には
  簿価列が無いので、`簿価 = 時価評価額[円] - 評価損益[円]` で復元する（評価益なら時価より小さく、
  評価損なら時価より大きくなる）。

  どの枠に属するかは「口座」列で判定する:
    - 「NISA成長投資枠」      -> 成長投資枠（生涯 1,200 万円の内枠）
    - 「NISAつみたて投資枠」  -> つみたて投資枠
    - 「つみたてNISA」        -> 旧つみたてNISA。新NISA の生涯枠とは別制度なので算入せず、参考として併記する。
    - それ以外（特定/一般口座、外貨預り金など）-> NISA 対象外として無視する。

日付の判定:
  入力ファイル名に `YYYYMMDD` の 8 桁日付が含まれていればそれを採用する。
  取れなければエラー終了する（黙ってフォールバックしない）。convert.py と同じ規則。

使い方:
    py nisa.py <input.csv> [--out <output.md>]
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path

# 新NISA の非課税保有限度額（制度で固定）。
LIMIT_TOTAL = 18_000_000   # 生涯投資枠（合計）
LIMIT_GROWTH = 12_000_000  # うち成長投資枠の上限
# つみたて投資枠には単独の生涯上限が無い（生涯枠 1,800 万を全額つみたてに充てることも可能）。

# 「口座」列の表記 -> 枠キー
ACCOUNT_GROWTH = "NISA成長投資枠"
ACCOUNT_TSUMITATE = "NISAつみたて投資枠"
ACCOUNT_OLD_TSUMITATE = "つみたてNISA"


def detect_date(csv_path: Path) -> str:
    """入力ファイル名から `YYYYMMDD` の 8 桁日付を取り出して返す（convert.py と同一規則）。"""
    m = re.search(r"(\d{4})(\d{2})(\d{2})", csv_path.name)
    if m:
        return f"{m.group(1)}{m.group(2)}{m.group(3)}"
    raise ValueError(
        "日付を特定できませんでした（ファイル名に YYYYMMDD の 8 桁日付がありません）"
    )


def read_csv_cp932(csv_path: Path) -> list[list[str]]:
    raw = csv_path.read_bytes().decode("cp932")
    return list(csv.reader(io.StringIO(raw)))


def parse_yen(cell: str) -> int:
    """`+276,289` / `-22,620` / `65,890` のような金額セルを整数（円）に変換する。

    空欄や `-`（データ無し）は 0 として扱う。簿価復元の引き算で安全に使えるようにするため。
    """
    s = (cell or "").strip().replace(",", "")
    if s in ("", "-"):
        return 0
    return int(s)


def extract_holdings(rows: list[list[str]]) -> list[list[str]]:
    """「■ 保有商品詳細」セクションの明細行（ヘッダー行を除く）だけを返す。"""
    in_section = False
    seen_header = False
    out: list[list[str]] = []
    for row in rows:
        head = (row[0] if row else "").strip()
        if head.startswith("■ 保有商品詳細") or head.startswith("■保有商品詳細"):
            in_section = True
            continue
        if head.startswith("■"):  # 別セクションに入ったら終了
            in_section = False
            continue
        if not in_section:
            continue
        if all((c or "").strip() == "" for c in row):
            continue
        if not seen_header:  # セクション直後の 1 行はヘッダー
            seen_header = True
            continue
        out.append(row)
    return out


class Entry:
    """NISA 枠に属する 1 明細（簿価ベース）。"""

    __slots__ = ("frame", "name", "cost", "market", "gain")

    def __init__(self, frame: str, name: str, market: int, gain: int) -> None:
        self.frame = frame          # "growth" / "tsumitate" / "old"
        self.name = name
        self.market = market        # 時価評価額[円]
        self.gain = gain            # 評価損益[円]
        self.cost = market - gain   # 簿価（取得価額）= 枠の使用額


def classify(rows: list[list[str]]) -> list[Entry]:
    """保有明細を NISA 枠ごとに分類し、簿価を復元した Entry のリストを返す。"""
    entries: list[Entry] = []
    for r in rows:
        if len(r) < 18:
            r = r + [""] * (18 - len(r))
        account = (r[3] or "").strip()
        # 先に口座で枠を判定し、NISA 対象外（特定/一般口座・外貨預り金など）は金額を parse せず除外する。
        # 外貨預り金行のように円以外の値（"239.00"）が混ざる行を踏まないため。
        if account == ACCOUNT_GROWTH:
            frame = "growth"
        elif account == ACCOUNT_TSUMITATE:
            frame = "tsumitate"
        elif account == ACCOUNT_OLD_TSUMITATE:
            frame = "old"
        else:
            continue  # NISA 対象外
        name = (r[2] or "").strip()
        market = parse_yen(r[14])  # 時価評価額[円]
        gain = parse_yen(r[16])    # 評価損益[円]
        entries.append(Entry(frame, name, market, gain))
    return entries


def yen(n: int) -> str:
    return f"{n:,}"


def pct(used: int, limit: int) -> str:
    return f"{used / limit * 100:.1f}%" if limit else "—"


def build_markdown(entries: list[Entry], date: str) -> str:
    year, month, day = date[:4], date[4:6], date[6:8]
    growth = sum(e.cost for e in entries if e.frame == "growth")
    tsumitate = sum(e.cost for e in entries if e.frame == "tsumitate")
    used = growth + tsumitate
    old = [e for e in entries if e.frame == "old"]

    out: list[str] = []
    out.append(f"# NISA非課税枠（生涯）使用状況（{year}年{month}月{day}日時点）")
    out.append("")
    out.append(
        "新NISA の非課税枠は**簿価（取得価額）**で管理される。"
        "値上がり益は枠を消費しないため、`簿価 = 時価評価額[円] - 評価損益[円]` で復元した使用額を集計している。"
    )
    out.append("")
    out.append("## 枠サマリー")
    out.append("")
    out.append("| 枠 | 非課税保有限度額[円] | 使用額（簿価）[円] | 残枠[円] | 使用率 |")
    out.append("|---|---:|---:|---:|---:|")
    out.append(
        f"| **生涯投資枠（合計）** | **{yen(LIMIT_TOTAL)}** | **{yen(used)}** "
        f"| **{yen(LIMIT_TOTAL - used)}** | **{pct(used, LIMIT_TOTAL)}** |"
    )
    out.append(
        f"| └ 成長投資枠 | {yen(LIMIT_GROWTH)} | {yen(growth)} "
        f"| {yen(LIMIT_GROWTH - growth)} | {pct(growth, LIMIT_GROWTH)} |"
    )
    out.append(
        f"| └ つみたて投資枠 | 単独上限なし | {yen(tsumitate)} | — | — |"
    )
    out.append("")
    out.append(
        "- 成長投資枠は生涯枠 1,800 万円のうち最大 1,200 万円まで。"
        "つみたて投資枠には単独の生涯上限が無く、生涯枠の内数として使用額のみを示す。"
    )
    out.append(
        "- 旧「つみたてNISA」は新NISA の生涯枠とは別制度のため、上記の使用額には算入していない。"
    )

    if old:
        old_total = sum(e.cost for e in old)
        out.append("")
        out.append("## 参考：旧つみたてNISA（生涯枠の対象外）")
        out.append("")
        out.append("| 銘柄 | 簿価[円] |")
        out.append("|---|---:|")
        for e in old:
            name = e.name.replace("|", "\\|")
            out.append(f"| {name} | {yen(e.cost)} |")
        out.append(f"| **合計** | **{yen(old_total)}** |")

    return "\n".join(out).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="楽天証券 資産残高 CSV から NISA 生涯枠の使用状況を算出"
    )
    parser.add_argument("input", help="入力 CSV（Shift-JIS / CP932）")
    parser.add_argument(
        "--out", help="出力先 .md パス（省略時は同ディレクトリに自動命名）"
    )
    args = parser.parse_args(argv)

    csv_path = Path(args.input).resolve()
    if not csv_path.is_file():
        print(f"error: 入力ファイルが見つかりません: {csv_path}", file=sys.stderr)
        return 2

    rows = read_csv_cp932(csv_path)
    date = detect_date(csv_path)
    entries = classify(extract_holdings(rows))
    md = build_markdown(entries, date)

    out_path = Path(args.out).resolve() if args.out else csv_path.with_name(
        f"NISA生涯枠_{date}.md"
    )
    out_path.write_text(md, encoding="utf-8")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
