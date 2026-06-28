// ポートフォリオ・ロジック：整形ヘルパー（金額・%・色・価格・数量）
// PortfolioLogic 名前空間へ登録し、インライン Component の prototype に合成される。
// 各メソッドの this は呼び出し元の Component インスタンス（this.props 等を参照）。
window.PortfolioLogic = Object.assign(window.PortfolioLogic || {}, {
  // ---------- formatting ----------
  yen(n) { return '¥' + Math.round(n).toLocaleString('en-US'); },
  yenMan(n) { return Math.abs(n) >= 10000 ? '¥' + Math.round(n / 10000).toLocaleString('en-US') + '万' : this.yen(n); },
  signYen(n) { return (n >= 0 ? '+' : '-') + '¥' + Math.round(Math.abs(n)).toLocaleString('en-US'); },
  pct(n) { return (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(2) + '%'; },
  ratioPct(n) { return (n * 100).toFixed(1) + '%'; },
  hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  },
  colorsSet() {
    // up/down（損益の赤緑）はデータ可視化色のためテーマ非依存。neu（変化なし）は背景に応じて切替（var）。
    // プラス=緑 / マイナス=赤（米国式）で表示する。
    const jp = { up: '#1f8a5b', down: '#d75049', neu: 'var(--pf-muted)' };
    const us = { up: '#2e9e6e', down: '#d75049', neu: 'var(--pf-muted)' };
    return (this.props && this.props.gainStyle === 'us') ? us : jp;
  },
  col(n) { if (n == null) return 'var(--pf-faint)'; const c = this.colorsSet(); return n > 0 ? c.up : (n < 0 ? c.down : c.neu); },
  priceFmt(h) {
    if (h.cur === 'USD') return '$' + h.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '¥' + h.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  },
  qtyFmt(h) {
    if (h.unit === 'g') return h.shares.toLocaleString('en-US', { maximumFractionDigits: 5 }) + 'g';
    return h.shares.toLocaleString('en-US') + h.unit;
  },
});
