// ポートフォリオ・ロジック：データ取得・永続化・既定データ
// 為替/金スポットのライブ取得、localStorage への日次蓄積、内蔵デフォルト保有データ。
window.PortfolioLogic = Object.assign(window.PortfolioLogic || {}, {
  // ---------- data fetch ----------
  fetchRate() {
    if (this.state.rateStatus !== 'live') this.setState({ rateStatus: 'loading' });
    fetch('https://open.er-api.com/v6/latest/USD')
      .then((r) => r.json())
      .then((d) => {
        const jpy = d && d.rates && d.rates.JPY;
        if (Number.isFinite(jpy) && jpy > 0) this.setState({ liveRate: jpy, rateTime: new Date(), rateStatus: 'live' });
        else this.setState({ rateStatus: 'error' });
      })
      .catch(() => this.setState({ rateStatus: this.state.liveRate ? 'live' : 'error' }));
  },
  fetchGold() {
    fetch('https://api.gold-api.com/price/XAU')
      .then((r) => r.json())
      .then((d) => {
        if (d && Number.isFinite(d.price) && d.price > 0) this.setState({ goldSpotUsd: d.price, goldTime: new Date() }, () => this.captureGold());
      })
      .catch(() => {});
  },

  // ---------- persistence (localStorage 日次蓄積) ----------
  captureGold() {
    try {
      const rate = this.state.liveRate || (this.props && this.props.usdRate) || 160.83;
      const cur = Math.round(this.state.goldSpotUsd / 31.1035 * rate);
      const today = this.todayKey();
      let hist = []; try { hist = JSON.parse(localStorage.getItem('pf_gold_hist_v1') || '[]'); } catch (e) {}
      hist = hist.filter((h) => h.d !== today);
      hist.push({ d: today, p: cur });
      hist.sort((a, b) => (a.d < b.d ? -1 : 1));
      if (hist.length > 45) hist = hist.slice(-45);
      localStorage.setItem('pf_gold_hist_v1', JSON.stringify(hist));
    } catch (e) {}
  },
  readGoldHist() { try { return JSON.parse(localStorage.getItem('pf_gold_hist_v1') || '[]'); } catch (e) { return []; } },
  readValHist() {
    if (Array.isArray(this.state.valHistRemote) && this.state.valHistRemote.length) return this.state.valHistRemote;
    try { return JSON.parse(localStorage.getItem('pf_value_hist_v1') || '[]'); } catch (e) { return []; }
  },
  captureValue() {
    try {
      const m = this.computeModel();
      const total = Math.round(m.total);
      if (this._lastCap === total) return; // 値が変わった時だけ更新
      this._lastCap = total;
      const today = this.todayKey();
      let hist = this.readValHist();
      hist = hist.filter((s) => s.d !== today);
      const cats = {}; (m.cats || []).forEach((c) => { cats[c.key] = Math.round(c.evalNum); });
      hist.push({ d: today, total: total, gain: Math.round(m.summary.gain), cats: cats });
      hist.sort((a, b) => (a.d < b.d ? -1 : 1));
      if (hist.length > 400) hist = hist.slice(-400);
      localStorage.setItem('pf_value_hist_v1', JSON.stringify(hist));
    } catch (e) {}
  },

  // ---------- 内蔵デフォルト保有データ（data/holdings.json が無い時の代替） ----------
  defaultConfig() {
    // === 楽天証券 資産状況(2026/07時点)を反映。data/holdings.json が読めない場合のフォールバック ===
    return {
      "usdRateFallback": 162.69,
      "holdings": [
        { "cat": "jp", "name": "任天堂", "code": "7974", "cur": "JPY", "unit": "株", "shares": 10, "avg": 8851, "price": 6980, "monthAbs": -20 },
        { "cat": "us", "name": "エヌビディア", "code": "NVDA", "cur": "USD", "unit": "株", "shares": 20, "avg": 117.115, "price": 200.09, "monthAbs": -10.6 },
        { "cat": "us", "name": "マイクロン テクノロジー", "code": "MU", "cur": "USD", "unit": "株", "shares": 5, "avg": 362.75, "price": 1154.29, "monthAbs": 20.3 },
        { "cat": "us", "name": "IonQ", "code": "IONQ", "cur": "USD", "unit": "株", "shares": 30, "avg": 35, "price": 53.26, "monthAbs": -3.29 },
        { "cat": "us", "name": "クレド・テクノロジー", "code": "CRDO", "cur": "USD", "unit": "株", "shares": 4, "avg": 165.92, "price": 271.95, "monthAbs": 0.12 },
        { "cat": "fund", "name": "eMAXIS Slim 米国株式(S&P500)", "code": "S&P500", "cur": "JPY", "unit": "口", "per": 10000, "shares": 1670403, "avg": 31232.59, "price": 44399, "monthAbs": -19 },
        { "cat": "fund", "name": "eMAXIS Slim 全世界株式(オール・カントリー)", "code": "オルカン", "cur": "JPY", "unit": "口", "per": 10000, "shares": 994683, "avg": 27982.79, "price": 38017, "monthAbs": -200 },
        { "cat": "fund", "name": "楽天・資産づくりファンド(なかなかコース)", "code": "らくらく", "cur": "JPY", "unit": "口", "per": 10000, "shares": 306463, "avg": 9789.11, "price": 14016, "monthAbs": 5 },
        { "cat": "fund", "name": "楽天・プラス・NASDAQ-100インデックス", "code": "楽天NASDAQ100", "cur": "JPY", "unit": "口", "per": 10000, "shares": 158445, "avg": 18934.01, "price": 19414, "monthAbs": -263 },
        { "cat": "fund", "name": "iFreeNEXT FANG+インデックス", "code": "FANG+", "cur": "JPY", "unit": "口", "per": 10000, "shares": 5848, "avg": 51299.59, "price": 91888, "monthAbs": -3768 },
        { "cat": "fund", "name": "楽天・資産づくりファンド(じっくりコース)", "code": "らくらく", "cur": "JPY", "unit": "口", "per": 10000, "shares": 32024, "avg": 9367.97, "price": 12273, "monthAbs": 15 }
      ]
    };
  },

  // ---------- 内蔵デフォルト NISA データ（data/nisa.json が無い時の代替） ----------
  defaultNisa() {
    // === 新NISAの非課税枠（生涯）使用状況。cost=取得価額(簿価)[円]=時価評価額-評価損益（楽天証券レポート基準）。 ===
    // frame: tsumitate=NISAつみたて投資枠 / growth=NISA成長投資枠。旧「つみたてNISA」は対象外。
    return {
      "limits": { "total": 18000000, "growth": 12000000, "tsumitate": 6000000 },
      "entries": [
        { "frame": "tsumitate", "name": "eMAXIS Slim 米国株式(S&P500)", "cost": 1782001 },
        { "frame": "tsumitate", "name": "eMAXIS Slim 全世界株式(オール・カントリー)", "cost": 1781400 },
        { "frame": "growth", "name": "任天堂", "cost": 88510 },
        { "frame": "growth", "name": "エヌビディア", "cost": 356890 },
        { "frame": "growth", "name": "マイクロン テクノロジー", "cost": 287388 },
        { "frame": "growth", "name": "IonQ", "cost": 165648 },
        { "frame": "growth", "name": "クレド・テクノロジー", "cost": 106560 },
        { "frame": "growth", "name": "楽天・プラス・NASDAQ-100インデックス", "cost": 300000 },
        { "frame": "growth", "name": "eMAXIS Slim 米国株式(S&P500)", "cost": 3135100 },
        { "frame": "growth", "name": "eMAXIS Slim 全世界株式(オール・カントリー)", "cost": 1002000 },
        { "frame": "growth", "name": "iFreeNEXT FANG+インデックス", "cost": 30000 }
      ]
    };
  },
});
