"""楽天証券「資産残高」CSVを Markdown に変換する。

入力: 楽天証券のマイメニュー > 資産合計 > CSV出力 で得られる Shift-JIS の CSV。
出力: 同じディレクトリに `楽天証券_資産状況_{yyyymmdd}.md` を生成する。

日付の判定:
  入力ファイル名に `YYYYMMDD` の 8 桁日付が含まれていればそれを採用する。
  取れなければエラー終了する（黙ってフォールバックしない）。
  ※ 為替レート時刻 `(MM/DD ...)` には年が無く日付を確定できないため判定には使わない。

使い方:
    python convert.py <input.csv> [--out <output.md>]
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path

SECTION_SUMMARY = "summary"
SECTION_HOLDINGS = "holdings"
SECTION_FX = "fx"


def detect_date(csv_path: Path) -> str:
    """入力ファイル名から `YYYYMMDD` の 8 桁日付を取り出して返す。

    楽天証券の既定ファイル名 `assetbalance(all)_YYYYMMDD_HHMMSS.csv` に含まれる
    8 桁日付を採用する。取れなければエラー終了する（推測でフォールバックしない）。
    為替レート時刻 `(MM/DD ...)` には年が無く日付を確定できないため使わない。
    """
    name = csv_path.name
    m = re.search(r"(\d{4})(\d{2})(\d{2})", name)
    if m:
        return f"{m.group(1)}{m.group(2)}{m.group(3)}"
    raise ValueError(
        "日付を特定できませんでした（ファイル名に YYYYMMDD の 8 桁日付がありません）"
    )


def read_csv_cp932(csv_path: Path) -> list[list[str]]:
    raw = csv_path.read_bytes().decode("cp932")
    reader = csv.reader(io.StringIO(raw))
    return [row for row in reader]


def split_sections(rows: list[list[str]]) -> dict[str, list[list[str]]]:
    """セクション見出し（"■..."）でグルーピングする。"""
    sections: dict[str, list[list[str]]] = {
        SECTION_SUMMARY: [],
        SECTION_HOLDINGS: [],
        SECTION_FX: [],
    }
    current: str | None = None
    for row in rows:
        head = (row[0] if row else "").strip()
        if head.startswith("■資産合計欄"):
            current = SECTION_SUMMARY
            continue
        if head.startswith("■ 保有商品詳細") or head.startswith("■保有商品詳細"):
            current = SECTION_HOLDINGS
            continue
        if head.startswith("■参考為替レート"):
            current = SECTION_FX
            continue
        if current is None:
            continue
        sections[current].append(row)
    return sections


def is_blank_row(row: list[str]) -> bool:
    return all((cell or "").strip() == "" for cell in row)


def split_blocks(rows: list[list[str]]) -> list[list[list[str]]]:
    """空行で行をブロックに分割する。"""
    blocks: list[list[list[str]]] = []
    current: list[list[str]] = []
    for row in rows:
        if is_blank_row(row):
            if current:
                blocks.append(current)
                current = []
        else:
            current.append(row)
    if current:
        blocks.append(current)
    return blocks


def md_escape(cell: str) -> str:
    """Markdown テーブル内に安全に書ける文字列に整える。

    全角スペース等は CSV 原文どおり保持する（証券会社の表記をそのまま転記する方針）。
    Markdown の区切り `|` だけはエスケープする。
    """
    s = (cell or "").strip()
    s = s.replace("|", "\\|")
    return s if s != "" else "-"


def render_table(
    headers: list[str], rows: list[list[str]], align: list[str] | None = None
) -> str:
    """シンプルな Markdown テーブルを描画する。align の指定がない列は左寄せ。"""
    if align is None:
        align = ["left"] * len(headers)
    sep = []
    for a in align:
        if a == "right":
            sep.append("---:")
        elif a == "center":
            sep.append(":---:")
        else:
            sep.append("---")
    out: list[str] = []
    out.append("| " + " | ".join(md_escape(h) for h in headers) + " |")
    out.append("|" + "|".join(sep) + "|")
    for row in rows:
        cells = [md_escape(c) for c in row]
        if len(cells) < len(headers):
            cells += ["-"] * (len(headers) - len(cells))
        else:
            cells = cells[: len(headers)]
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


SUMMARY_HEADERS = [
    "項目",
    "時価評価額[円]",
    "前日比[円]",
    "前日比[％]",
    "前月比[円]",
    "前月比[％]",
    "評価損益[円]",
    "評価損益[％]",
    "実現損益[円]",
    "配当・分配金[円貨]",
    "配当・分配金[外貨]",
]
SUMMARY_ALIGN = ["left"] + ["right"] * (len(SUMMARY_HEADERS) - 1)

DEPOSIT_HEADERS = [
    "区分",
    "金額[円]",
    "前日比[円]",
    "前日比[％]",
    "前月比[円]",
    "前月比[％]",
]
DEPOSIT_ALIGN = ["left"] + ["right"] * (len(DEPOSIT_HEADERS) - 1)

HOLDINGS_HEADERS = [
    "種別",
    "コード・ティッカー",
    "銘柄",
    "口座",
    "保有数量",
    "単位",
    "平均取得価額",
    "単位",
    "現在値",
    "単位",
    "前日比",
    "単位",
    "時価評価額[円]",
    "時価評価額[外貨]",
    "評価損益[円]",
    "評価損益[％]",
]
HOLDINGS_ALIGN = [
    "left",
    "left",
    "left",
    "left",
    "right",
    "left",
    "right",
    "left",
    "right",
    "left",
    "right",
    "left",
    "right",
    "right",
    "right",
    "right",
]

FX_HEADERS = ["通貨", "レート", "単位", "取得時刻"]
FX_ALIGN = ["left", "right", "left", "left"]


def take_summary_columns(row: list[str]) -> list[str]:
    """資産合計欄の 1 行から SUMMARY_HEADERS に沿って 11 列を抽出。

    元 CSV のヘッダーは 12 列だが、評価損益[％] の右に空文字の区切り列が 1 つ挟まる。
    その空列を取り除いて 11 列に揃える。
    """
    if len(row) < 12:
        row = row + [""] * (12 - len(row))
    return [
        row[0],
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        row[6],
        row[7],
        row[9],
        row[10],
        row[11],
    ]


def take_deposit_columns(row: list[str]) -> list[str]:
    if len(row) < 6:
        row = row + [""] * (6 - len(row))
    return row[:6]


def take_holdings_columns(row: list[str]) -> list[str]:
    if len(row) < 18:
        row = row + [""] * (18 - len(row))
    return [
        row[0],  # 種別
        row[1],  # コード
        row[2],  # 銘柄
        row[3],  # 口座
        row[4],  # 保有数量
        row[5],  # 単位
        row[6],  # 平均取得価額
        row[7],  # 単位
        row[8],  # 現在値
        row[9],  # 単位
        row[12],  # 前日比
        row[13],  # 単位
        row[14],  # 時価評価額[円]
        row[15],  # 時価評価額[外貨]
        row[16],  # 評価損益[円]
        row[17],  # 評価損益[％]
    ]


def render_summary_section(rows: list[list[str]]) -> str:
    blocks = split_blocks(rows)
    out: list[str] = ["## 資産合計欄", ""]

    total_block = next(
        (b for b in blocks if any(r and r[0].strip() == "資産合計" for r in b)), []
    )
    breakdown_block = next(
        (
            b
            for b in blocks
            if any(r and r[0].strip() == "保有商品の評価額合計" for r in b)
        ),
        [],
    )
    deposit_block = next(
        (b for b in blocks if any(r and r[0].strip() == "預り金合計" for r in b)),
        [],
    )
    bank_block = next(
        (
            b
            for b in blocks
            if any(r and r[0].strip() == "楽天銀行普通預金残高" for r in b)
        ),
        [],
    )

    total_rows = [
        take_summary_columns(r) for r in total_block if r and r[0].strip() == "資産合計"
    ]
    if total_rows:
        # 強調表示
        r = total_rows[0]
        r = [f"**{r[0]}**", f"**{r[1]}**"] + r[2:]
        out.append(render_table(SUMMARY_HEADERS, [r], SUMMARY_ALIGN))
        out.append("")

    breakdown_rows = [
        take_summary_columns(r)
        for r in breakdown_block
        if r and r[0].strip() and r[0].strip() != ""
    ]
    if breakdown_rows:
        out.append("### 保有商品の評価額内訳")
        out.append("")
        breakdown_headers = ["区分"] + SUMMARY_HEADERS[1:]
        out.append(render_table(breakdown_headers, breakdown_rows, SUMMARY_ALIGN))
        out.append("")

    deposit_rows = [
        take_deposit_columns(r) for r in deposit_block if r and r[0].strip()
    ]
    if deposit_rows:
        out.append("### 預り金")
        out.append("")
        out.append(render_table(DEPOSIT_HEADERS, deposit_rows, DEPOSIT_ALIGN))
        out.append("")

    if bank_block:
        out.append("### 楽天銀行普通預金残高")
        out.append("")
        # CSV では ["楽天銀行普通預金残高", "未取得"] の 2 列
        bank = bank_block[0]
        value = bank[1].strip() if len(bank) > 1 else ""
        out.append(value if value else "(値なし)")
        out.append("")

    return "\n".join(out)


def render_holdings_section(rows: list[list[str]]) -> str:
    out: list[str] = ["## 保有商品詳細（すべて）", ""]
    # 1 行目はヘッダー、2 行目以降が明細
    detail_rows = []
    seen_header = False
    for r in rows:
        if not r or all((c or "").strip() == "" for c in r):
            continue
        if not seen_header:
            seen_header = True
            continue
        detail_rows.append(take_holdings_columns(r))
    out.append(render_table(HOLDINGS_HEADERS, detail_rows, HOLDINGS_ALIGN))
    out.append("")
    return "\n".join(out)


def render_fx_section(rows: list[list[str]]) -> str:
    out: list[str] = ["## 参考為替レート", ""]
    fx_rows: list[list[str]] = []
    for r in rows:
        if not r or all((c or "").strip() == "" for c in r):
            continue
        # 4 列固定: 通貨, レート, 単位, 取得時刻
        if len(r) < 4:
            r = r + [""] * (4 - len(r))
        # 取得時刻の余分な空白を畳む
        ts = re.sub(r"\s+", " ", r[3].strip())
        fx_rows.append([r[0], r[1], r[2], ts])
    out.append(render_table(FX_HEADERS, fx_rows, FX_ALIGN))
    out.append("")
    return "\n".join(out)


def build_markdown(rows: list[list[str]], date: str) -> str:
    sections = split_sections(rows)
    year, month, day = date[:4], date[4:6], date[6:8]
    parts: list[str] = []
    parts.append(f"# 楽天証券 資産状況（{year}年{month}月{day}日時点）")
    parts.append("")
    parts.append(render_summary_section(sections[SECTION_SUMMARY]))
    parts.append("---")
    parts.append("")
    parts.append(render_holdings_section(sections[SECTION_HOLDINGS]))
    parts.append("---")
    parts.append("")
    parts.append(render_fx_section(sections[SECTION_FX]))
    return "\n".join(parts).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="楽天証券 資産残高 CSV → Markdown 変換"
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
    md = build_markdown(rows, date)

    if args.out:
        out_path = Path(args.out).resolve()
    else:
        out_path = csv_path.with_name(f"楽天証券_資産状況_{date}.md")

    out_path.write_text(md, encoding="utf-8")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
