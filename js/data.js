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
    // === 楽天証券 資産状況(2026/06時点)を反映。data/holdings.json が読めない場合のフォールバック ===
    return {
      "usdRateFallback": 161.77,
      "holdings": [
        { "cat": "jp", "name": "任天堂", "code": "7974", "cur": "JPY", "unit": "株", "shares": 10, "avg": 8851, "price": 7000, "dayAbs": -76, "monthAbs": -148 },
        { "cat": "us", "name": "エヌビディア", "code": "NVDA", "cur": "USD", "unit": "株", "shares": 20, "avg": 117.115, "price": 210.69, "dayAbs": 0, "monthAbs": -0.45 },
        { "cat": "us", "name": "マイクロン テクノロジー", "code": "MU", "cur": "USD", "unit": "株", "shares": 5, "avg": 362.75, "price": 1133.99, "dayAbs": 0, "monthAbs": 162.99 },
        { "cat": "us", "name": "IonQ", "code": "IONQ", "cur": "USD", "unit": "株", "shares": 30, "avg": 35, "price": 56.55, "dayAbs": 0, "monthAbs": -15.52 },
        { "cat": "us", "name": "クレド・テクノロジー", "code": "CRDO", "cur": "USD", "unit": "株", "shares": 4, "avg": 165.92, "price": 271.83, "dayAbs": 0, "monthAbs": 35.80 },
        { "cat": "fund", "name": "eMAXIS Slim 米国株式(S&P500)", "code": "S&P500", "cur": "JPY", "unit": "口", "per": 10000, "shares": 1670403, "avg": 31232.59, "price": 44418, "dayAbs": 575, "monthAbs": 158 },
        { "cat": "fund", "name": "eMAXIS Slim 全世界株式(オール・カントリー)", "code": "オルカン", "cur": "JPY", "unit": "口", "per": 10000, "shares": 994683, "avg": 27982.79, "price": 38217, "dayAbs": 310, "monthAbs": 480 },
        { "cat": "fund", "name": "楽天・資産づくりファンド(なかなかコース)", "code": "らくらく", "cur": "JPY", "unit": "口", "per": 10000, "shares": 306463, "avg": 9789.11, "price": 14011, "dayAbs": 76, "monthAbs": 42 },
        { "cat": "fund", "name": "楽天・プラス・NASDAQ-100インデックス", "code": "楽天NASDAQ100", "cur": "JPY", "unit": "口", "per": 10000, "shares": 158445, "avg": 18934.01, "price": 19677, "dayAbs": 518, "monthAbs": null },
        { "cat": "fund", "name": "iFreeNEXT FANG+インデックス", "code": "FANG+", "cur": "JPY", "unit": "口", "per": 10000, "shares": 5848, "avg": 51299.59, "price": 95656, "dayAbs": 2975, "monthAbs": -1264 },
        { "cat": "fund", "name": "楽天・資産づくりファンド(じっくりコース)", "code": "らくらく", "cur": "JPY", "unit": "口", "per": 10000, "shares": 32024, "avg": 9367.97, "price": 12258, "dayAbs": 54, "monthAbs": 27 }
      ]
    };
  },
});
