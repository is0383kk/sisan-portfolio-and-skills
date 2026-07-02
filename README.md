# sisan-portfolio-and-skills

楽天証券の資産状況を可視化する公開ポートフォリオ ダッシュボードと、資産データを生成・分析するためのエージェントスキルを同居させたリポジトリです。

🔗 **公開ダッシュボードサンプル**: https://is0383kk.github.io/sisan-portfolio-and-skills/

## 概要

- **ダッシュボード**（`index.html`）: 保有銘柄・資産構成・損益・資産推移・新NISA枠の使用状況をブラウザ上で可視化する単一ページアプリ。GitHub Pages で静的配信されます。
- **エージェントスキル**（`.claude/skills/rakuten-securities-analysis/`）: 楽天証券の資産データを扱う分析スキル。各種分析レポートの作成に利用します。

## ローカルでの確認方法

ダッシュボードはローカルで `data/*.json` を fetch するため、`file://` ではなく簡易HTTPサーバ経由での確認を推奨します。

```bash
python -m http.server # または`npx serve -l 8000`
# ブラウザで http://localhost:8000/ を開く
```

## ディレクトリ構成

```
.
├── index.html            # ダッシュボード本体
├── support.js            # DCランタイム
├── styles.css            # スタイル
├── js/                   # ロジック（window.PortfolioLogic 名前空間に分割）
│   ├── format.js         # 金額・%・色・価格・数量の整形ヘルパー
│   ├── data.js           # 為替・金スポットのライブ取得、履歴の localStorage 蓄積、内蔵フォールバック
│   ├── model.js          # 中核。ビューモデル構築（評価額集計・区分別ドーナツなど）
│   └── chart.js          # 資産推移グラフの SVG ジオメトリ生成
├── data/                 # ダッシュボードのデータソース
│   ├── holdings.json     # 保有銘柄
│   ├── nisa.json         # NISA枠（簿価ベース）
│   └── history.json      # 評価額の月次/日次スナップショット
├── og.png                # SNSシェア用 OGP 画像
└── .claude/skills/rakuten-securities-analysis/   # エージェントスキル
```

## エージェントスキル

`.claude/skills/rakuten-securities-analysis/`（`SKILL.md` がエントリ）。  
楽天証券の資産残高CSVを扱う4機能を、サブ手順書（`references/**`）と Python スクリプト（`scripts/**`）で提供します。

| 機能 | 概要 | スクリプト |
| --- | --- | --- |
| CSV → Markdown 変換 | 楽天証券のCSVを `楽天証券_資産状況_yyyymmdd.md` に整形 | `scripts/convert.py` |
| NISA生涯枠 算出 | 簿価ベースで新NISA非課税枠（生涯1,800万円・うち成長投資枠1,200万円）の使用状況を算出 | `scripts/nisa.py` |
| OGP画像生成 | `data/holdings.json` から資産構成ドーナツを再計算し `og.png`（1200×630）を Pillow で直接描画 | `scripts/make_og.py` |
| 保有銘柄分析 | ファンダメンタル/テクニカル分析レポートの作成 | — |

Python 依存は `scripts/requirements.txt` を参照してください。
