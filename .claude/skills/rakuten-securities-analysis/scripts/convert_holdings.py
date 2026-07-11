"""楽天証券「資産残高」CSV から ダッシュボード用 `data/holdings.json` を生成（更新）する。

入力: 楽天証券のマイメニュー > 資産合計 > CSV出力 で得られる Shift-JIS の CSV。
出力: `data/holdings.json`（既定は同名で上書き更新。--out で別パスへ出力可）。

なぜ「マージ方式」か:
  CSV の保有商品詳細には、ダッシュボードが使う一部の項目が存在しない/そのままでは使えない:
    - `code`（例 "S&P500" / "オルカン" / "楽天NASDAQ100"）… 投信は CSV のコード列が空。手作業の短縮名。
    - 整形済み `name`（例 CSV "…(オール・カントリー)(オルカン)" → JSON "…(オール・カントリー)"）。
    - `monthAbs`（1単位あたり前月比）… CSV には「前日比」列しか無く、銘柄別の前月比が無い。
  そこで、既存 `holdings.json` を**キュレーション情報源**として読み、CSV からは数値
  （`shares` / `avg` / `price`）だけを反映する。`code` / 整形済み `name` / `monthAbs` /
  `cat` / `cur` / `unit` / `per` は既存値を維持する（monthAbs は特にユーザー方針で維持）。

CSV → JSON のマッピング要点:
  - 種別列で `cat` を判定: 「国内株」→jp / 「米国株」→us / 「投資信託」→fund。それ以外の行
    （外貨預り金・預り金など）は保有商品ではないので除外する。
  - `cur` は平均取得価額の単位列（円→JPY / USD→USD）で判定。
  - 数量単位が「口」の投信は基準価額が 1万口あたりのため `per=10000`。「株」は per を持たない。
  - **同一銘柄の複数口座（つみたて/成長/旧つみたて等）は合算**する:
      shares = 口数(株数)の合計 / avg = 口数(株数)で加重平均した平均取得価額 / price = 現在値（各口座同値）。
  - 平均取得価額 = 時価ベースではなく CSV の「平均取得価額」列そのもの（取得単価）。

既存 JSON との突合キー:
  - 個別株: CSV のティッカー == 既存 `code`。
  - 投信: 名称の前方一致（既存 `name` が CSV 名称の先頭、またはその逆／完全一致）。同一 `cat` 内でのみ照合。

差分の扱い（すべて標準出力に要約を出す。黙って切り落とさない）:
  - CSV と既存の両方にある銘柄 → 数値を更新。
  - 既存にあり CSV に無い銘柄 → 除外（売却等）。警告として列挙する。
  - CSV にあり既存に無い銘柄 → 追加。ただし code/整形名/monthAbs は補完できないため
    （code="" / name=CSV名 / monthAbs=0）で追加し、キュレーションを促す警告を出す。

その他:
  - `usdRateFallback` は CSV の参考為替レート「米ドル」で更新する（ライブ取得失敗時のフォールバック値）。
  - `_comment` の「(yyyy/mm時点)」を CSV の日付で更新する。
  - 日付は入力ファイル名の 8 桁（YYYYMMDD）から決める（convert.py / nisa.py と同一規則）。

使い方:
    py convert_holdings.py <input.csv> [--holdings <data/holdings.json>] [--out <output.json>]
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

# 保有商品として取り込む種別（部分一致で判定）。これ以外（外貨預り金・預り金など）は除外。
CAT_RULES = [
    ("国内株", "jp"),
    ("米国株", "us"),
    ("投資信託", "fund"),
]

# 既定の holdings.json（このスキルからリポジトリの data/ を指す）。
# scripts / rakuten-securities-analysis / skills / .claude / <repo-root>
DEFAULT_HOLDINGS = Path(__file__).resolve().parents[4] / "data" / "holdings.json"


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


def parse_number(cell: str) -> float | None:
    """`8,851.00` / `+1.2101` / `-63.0` のような数値セルを float に変換する。

    空欄や `-`（データ無し）は None を返す。
    """
    s = (cell or "").strip().replace(",", "")
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def jsonnum(x: float) -> int | float:
    """JSON 出力用に、整数値は int、それ以外は 4 桁までに丸めた float にする。"""
    r = round(float(x), 4)
    if r == int(r):
        return int(r)
    return r


def extract_holdings_rows(rows: list[list[str]]) -> list[list[str]]:
    """「■ 保有商品詳細」セクションの明細行（ヘッダー行を除く）だけを返す（nisa.py と同じ抽出）。"""
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


def extract_usd_rate(rows: list[list[str]]) -> float | None:
    """「■参考為替レート」セクションから米ドル/円のレートを取り出す。取れなければ None。"""
    in_section = False
    for row in rows:
        head = (row[0] if row else "").strip()
        if head.startswith("■参考為替レート"):
            in_section = True
            continue
        if head.startswith("■"):
            in_section = False
            continue
        if not in_section:
            continue
        name = (row[0] if row else "").strip()
        if name == "米ドル":
            return parse_number(row[1]) if len(row) > 1 else None
    return None


def cat_of(shubetsu: str) -> str | None:
    """種別文字列から cat（jp/us/fund）を判定。保有商品でなければ None。"""
    s = (shubetsu or "").strip()
    for key, cat in CAT_RULES:
        if key in s:
            return cat
    return None


class Group:
    """同一銘柄（複数口座は合算）を表す、CSV 由来の集約単位。"""

    __slots__ = ("cat", "ticker", "name", "cur", "unit", "per", "_sw", "_w", "price")

    def __init__(self, cat: str, ticker: str, name: str, cur: str, unit: str, per: int | None) -> None:
        self.cat = cat
        self.ticker = ticker          # CSV コード・ティッカー（投信は ""）
        self.name = name              # CSV 銘柄名（整形前）
        self.cur = cur
        self.unit = unit
        self.per = per
        self._sw = 0.0                # Σ(shares * avg) 加重平均の分子
        self._w = 0.0                 # Σ(shares)       加重平均の分母（= 合計数量）
        self.price = None             # 現在値（各口座同値の想定。最初の非 None を採用）

    def add(self, shares: float, avg: float | None, price: float | None) -> None:
        self._w += shares
        if avg is not None:
            self._sw += shares * avg
        if price is not None and self.price is None:
            self.price = price

    @property
    def shares(self) -> float:
        return self._w

    @property
    def avg(self) -> float | None:
        return self._sw / self._w if self._w else None


def build_groups(detail_rows: list[list[str]]) -> list[Group]:
    """保有明細行を銘柄単位（複数口座は合算）に集約する。"""
    groups: dict[str, Group] = {}
    order: list[str] = []
    for r in detail_rows:
        if len(r) < 18:
            r = r + [""] * (18 - len(r))
        cat = cat_of(r[0])
        if cat is None:
            continue  # 保有商品でない行（外貨預り金など）は除外
        ticker = (r[1] or "").strip()
        name = (r[2] or "").strip()
        unit = (r[5] or "").strip()          # 数量単位（株 / 口）
        avg_unit = (r[7] or "").strip()      # 平均取得価額の単位（円 / USD）
        cur = "USD" if "USD" in avg_unit.upper() else "JPY"
        per = 10000 if unit == "口" else None
        shares = parse_number(r[4]) or 0.0
        avg = parse_number(r[6])
        price = parse_number(r[8])

        key = f"{cat}\x00{ticker}" if ticker else f"{cat}\x00{name}"
        g = groups.get(key)
        if g is None:
            g = Group(cat, ticker, name, cur, unit, per)
            groups[key] = g
            order.append(key)
        g.add(shares, avg, price)
    return [groups[k] for k in order]


def match_existing(g: Group, existing: list[dict], used: set[int]) -> int | None:
    """CSV 集約 g に対応する既存 holdings のインデックスを返す。無ければ None。

    個別株はティッカー == 既存 code、投信は名称の前方一致（同一 cat 内）で照合する。
    """
    # 個別株: ティッカー一致を最優先。
    if g.ticker:
        for i, h in enumerate(existing):
            if i in used:
                continue
            if h.get("cat") == g.cat and (h.get("code") or "").strip() == g.ticker:
                return i
    # 投信/コード無し: 同一 cat 内で名称の完全一致 → 前方一致。
    for i, h in enumerate(existing):
        if i in used or h.get("cat") != g.cat:
            continue
        if (h.get("name") or "").strip() == g.name:
            return i
    for i, h in enumerate(existing):
        if i in used or h.get("cat") != g.cat:
            continue
        hn = (h.get("name") or "").strip()
        if hn and (g.name.startswith(hn) or hn.startswith(g.name)):
            return i
    return None


def build_holding_from_existing(h: dict, g: Group) -> dict:
    """既存エントリのキュレーション情報を維持し、数値だけ CSV で更新した 1 件を作る。"""
    out: dict = {}
    # キー順は既存 JSON に合わせる: cat, name, code, cur, unit, (per), shares, avg, price, monthAbs
    out["cat"] = h.get("cat", g.cat)
    out["name"] = h.get("name", g.name)
    out["code"] = h.get("code", g.ticker)
    out["cur"] = h.get("cur", g.cur)
    out["unit"] = h.get("unit", g.unit)
    if "per" in h:
        out["per"] = h["per"]
    elif g.per is not None:
        out["per"] = g.per
    out["shares"] = jsonnum(g.shares)
    if g.avg is not None:
        out["avg"] = jsonnum(g.avg)
    if g.price is not None:
        out["price"] = jsonnum(g.price)
    out["monthAbs"] = h.get("monthAbs", 0)  # CSV に前月比が無いため既存値を維持
    return out


def build_holding_from_csv(g: Group) -> dict:
    """既存に無い銘柄を CSV だけから作る（code/整形名/monthAbs は補完不可のため既定値）。"""
    out: dict = {
        "cat": g.cat,
        "name": g.name,
        "code": g.ticker,  # 投信は "" になる（要キュレーション）
        "cur": g.cur,
        "unit": g.unit,
    }
    if g.per is not None:
        out["per"] = g.per
    out["shares"] = jsonnum(g.shares)
    if g.avg is not None:
        out["avg"] = jsonnum(g.avg)
    if g.price is not None:
        out["price"] = jsonnum(g.price)
    out["monthAbs"] = 0
    return out


def build_comment(date: str) -> str:
    year, month = date[:4], date[4:6]
    return (
        f"楽天証券 資産状況({year}/{month}時点)を反映。米国株はcur:USD(priceはドル)。"
        "投信はper:10000(1万口あたり基準価額)。同一銘柄の複数口座は合算済み。"
        "monthAbs=1単位あたり前月比だが、CSVに前月比が無いため既存値を維持している。"
    )


def convert(
    csv_path: Path, holdings_path: Path, date: str
) -> tuple[dict, list[str]]:
    """CSV と既存 holdings.json から、更新後の holdings dict と警告リストを返す。"""
    rows = read_csv_cp932(csv_path)
    detail = extract_holdings_rows(rows)
    groups = build_groups(detail)
    usd_rate = extract_usd_rate(rows)

    if holdings_path.is_file():
        existing_doc = json.loads(holdings_path.read_text(encoding="utf-8"))
        existing = list(existing_doc.get("holdings", []))
    else:
        existing_doc = {}
        existing = []

    warnings: list[str] = []
    used: set[int] = set()
    matched: dict[int, dict] = {}  # 既存インデックス -> 更新後エントリ

    # 各 CSV 集約を既存に突合。
    unmatched_groups: list[Group] = []
    for g in groups:
        idx = match_existing(g, existing, used)
        if idx is None:
            unmatched_groups.append(g)
        else:
            used.add(idx)
            matched[idx] = build_holding_from_existing(existing[idx], g)

    # 出力順: 既存の並びを保ちつつ、CSV に在った既存銘柄を更新反映。CSV に無い既存銘柄は除外。
    holdings: list[dict] = []
    for i, h in enumerate(existing):
        if i in matched:
            holdings.append(matched[i])
        else:
            name = (h.get("name") or "").strip() or "(無名)"
            warnings.append(f"除外: 既存銘柄「{name}」は CSV に無いため出力しません（売却等の可能性）。")

    # CSV にあり既存に無い銘柄を追加。
    for g in unmatched_groups:
        holdings.append(build_holding_from_csv(g))
        detail_note = "（投信のためコードが空。code/表示名/monthAbs を手動で補完してください）" if not g.ticker else ""
        warnings.append(f"追加: 新規銘柄「{g.name}」を CSV から追加しました{detail_note}。")

    # トップレベル項目。usdRateFallback は CSV の米ドルレートで更新（取れなければ既存維持）。
    usd_fallback = existing_doc.get("usdRateFallback", 0)
    if usd_rate is not None:
        usd_fallback = jsonnum(usd_rate)
    else:
        warnings.append("参考為替レートの米ドルが読めなかったため usdRateFallback は既存値のままです。")

    doc = {
        "_comment": build_comment(date),
        "usdRateFallback": usd_fallback,
        "holdings": holdings,
    }
    return doc, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="楽天証券 資産残高 CSV から data/holdings.json を生成（マージ更新）"
    )
    parser.add_argument("input", help="入力 CSV（Shift-JIS / CP932）")
    parser.add_argument(
        "--holdings",
        help="キュレーション情報源にする既存 holdings.json（既定: リポジトリの data/holdings.json）",
    )
    parser.add_argument(
        "--out", help="出力先 .json パス（省略時は --holdings と同じパスへ上書き）"
    )
    args = parser.parse_args(argv)

    csv_path = Path(args.input).resolve()
    if not csv_path.is_file():
        print(f"error: 入力ファイルが見つかりません: {csv_path}", file=sys.stderr)
        return 2

    holdings_path = Path(args.holdings).resolve() if args.holdings else DEFAULT_HOLDINGS
    out_path = Path(args.out).resolve() if args.out else holdings_path

    date = detect_date(csv_path)
    doc, warnings = convert(csv_path, holdings_path, date)

    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    out_path.write_text(text, encoding="utf-8")

    for w in warnings:
        print(f"[warn] {w}", file=sys.stderr)
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
