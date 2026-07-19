// ポートフォリオ・ロジック：ドメイン計算（評価額・損益の集計、ドーナツ/凡例、サマリー）
// computeModel() がテンプレート全体へ供給するモデルを構築する中核。

// 銘柄名 → Yahoo!ファイナンス株価ページURL の対応表（単一情報源）。
// code は「らくらく」がなかなか/じっくり両コースで重複するため、一意な name をキーにする。
// enrich() が銘柄ごとに参照するため、再生成を避けてモジュールスコープの定数で保持する。
const QUOTE_URLS = {
  '任天堂': 'https://finance.yahoo.co.jp/quote/7974.T',
  'マイクロン テクノロジー': 'https://finance.yahoo.co.jp/quote/MU',
  'エヌビディア': 'https://finance.yahoo.co.jp/quote/NVDA',
  'IonQ': 'https://finance.yahoo.co.jp/quote/IONQ',
  'クレド・テクノロジー': 'https://finance.yahoo.co.jp/quote/CRDO',
  'eMAXIS Slim 米国株式(S&P500)': 'https://finance.yahoo.co.jp/quote/03311187',
  'eMAXIS Slim 全世界株式(オール・カントリー)': 'https://finance.yahoo.co.jp/quote/0331418A',
  'iFreeNEXT FANG+インデックス': 'https://finance.yahoo.co.jp/quote/04311181',
  '楽天・資産づくりファンド(なかなかコース)': 'https://finance.yahoo.co.jp/quote/9I313216',
  '楽天・資産づくりファンド(じっくりコース)': 'https://finance.yahoo.co.jp/quote/9I312216',
  '楽天・プラス・NASDAQ-100インデックス': 'https://finance.yahoo.co.jp/quote/9I314241',
};

window.PortfolioLogic = Object.assign(window.PortfolioLogic || {}, {
  // 3区分（国内株/米国株/投資信託）の定義。色・名称の単一情報源（model/chart 共用）。
  // 色は CSS 変数参照（styles.css で定義）。ライト/ダークで同一色相の別ステップへ切り替わり、
  // data-theme 切替に追従する。背景色(inline style)・ドーナツ stroke(inline style) いずれも CSS 文脈で解決される。
  categories() {
    return [
      { key: 'jp',   name: '国内株',   short: '国内', color: 'var(--pf-cat-jp)' },
      { key: 'us',   name: '米国株',   short: '米国', color: 'var(--pf-cat-us)' },
      { key: 'fund', name: '投資信託', short: '投信', color: 'var(--pf-cat-fund)' },
    ];
  },
  // 当日キー（YYYY-MM-DD）。日次蓄積・履歴差分で共用。
  todayKey() { return new Date().toISOString().slice(0, 10); },

  // 銘柄の株価ページURL。QUOTE_URLS（モジュール定数）を引く。対応が無ければ null（テンプレート側でリンクなし表示に分岐）。
  quoteUrlOf(h) { return QUOTE_URLS[h.name] || null; },

  computeModel() {
    // 設定・保有データ（data/holdings.json があれば優先、無ければ内蔵デフォルトと同一）
    const CFG = (this.state.holdingsData && Array.isArray(this.state.holdingsData.holdings))
      ? this.state.holdingsData : this.defaultConfig();
    const RATE = this.state.liveRate || (this.props && this.props.usdRate) || CFG.usdRateFallback || 160.83;
    const GOLD = 0; // 金（ゴールド）は現在保有なし
    const CATS = this.categories();
    const CATMONTH = { jp: 1650 }; // 国内株はポートフォリオ単位の前月比(実データ：7月69,800-6月68,150)

    const enrich = (h) => {
      const per = h.per || 1;
      const rate = h.cur === 'USD' ? RATE : 1;
      const quoteUrl = this.quoteUrlOf(h);
      const evalJPY = h.shares * h.price / per * rate;
      const costJPY = h.avg == null ? null : h.shares * h.avg / per * rate;
      const gain = costJPY == null ? null : evalJPY - costJPY;
      const gainPct = (costJPY == null || costJPY === 0) ? null : gain / costJPY * 100;
      const monthPct = h.monthAbs == null ? null : h.monthAbs / (h.price - h.monthAbs) * 100;
      const monthYen = h.monthAbs == null ? null : h.monthAbs * h.shares / per * rate;
      return Object.assign({}, h, {
        evalJPY, costJPY, gain, gainPct, monthPct, monthYen,
        quoteUrl, hasQuote: quoteUrl != null,
        priceTxt: this.priceFmt(h),
        qtyTxt: this.qtyFmt(h),
        evalTxt: this.yen(evalJPY),
        gainTxt: gain == null ? '—' : this.signYen(gain),
        gainPctTxt: gainPct == null ? '取得原価なし' : this.pct(gainPct),
        gainColor: this.col(gain),
        monthTxt: monthPct == null ? '—' : this.pct(monthPct),
        monthColor: this.col(monthPct),
        sortGain: gain == null ? -1e15 : gain,
        sortMonth: monthPct == null ? -1e15 : monthPct,
      });
    };

    const all = CFG.holdings.map(enrich);
    const total = all.reduce((s, h) => s + h.evalJPY, 0);

    // ----- カテゴリ内の銘柄の並び替え（state.sortKey / sortDir、データ無は常に末尾） -----
    const sortKey = this.state.sortKey || 'eval';
    const sortDir = this.state.sortDir || 'desc';
    const sortValOf = (h) => {
      if (sortKey === 'gain') return h.gain;
      if (sortKey === 'gainPct') return h.gainPct;
      if (sortKey === 'month') return h.monthPct;
      if (sortKey === 'price') return h.price;
      if (sortKey === 'name') return h.name;
      return h.evalJPY;
    };
    const holdingCmp = (a, b) => {
      const av = sortValOf(a), bv = sortValOf(b);
      if (sortKey === 'name') {
        const d = String(av).localeCompare(String(bv), 'ja');
        return sortDir === 'asc' ? d : -d;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    };

    // テーブルヘッダラベルをクリックして並び替え（同列再クリックで昇順/降順をトグル）
    const mkHead = (key) => ({
      onClick: () => this.setState((s) => {
        const cur = s.sortKey || 'eval';
        if (cur === key) return { sortDir: (s.sortDir || 'desc') === 'asc' ? 'desc' : 'asc' };
        return { sortKey: key, sortDir: key === 'name' ? 'asc' : 'desc' };
      }),
      arw: sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '↕',
      arwColor: sortKey === key ? 'var(--pf-text)' : 'var(--pf-faint)',
      labelColor: sortKey === key ? 'var(--pf-text)' : 'var(--pf-text-3)',
    });
    const sortCols = [
      { key: 'name', label: '銘柄' },
      { key: 'price', label: '現在値' },
      { key: 'eval', label: '評価額' },
      { key: 'gain', label: '評価損益' },
      { key: 'month', label: '前月比' },
    ];
    const sh = {};
    sortCols.forEach((c) => { sh[c.key] = Object.assign({ label: c.label }, mkHead(c.key)); });
    // モバイルのソートチップ：銘柄・現在値は省き、前日比・前月比・評価額・評価損益の4つに絞る（狭幅でのチップ数を抑える）。アクティブは濃色背景＋白文字で選択中を明示
    const sortChips = sortCols.filter((c) => c.key !== 'name' && c.key !== 'price').map((c) => {
      const active = sortKey === c.key;
      return Object.assign({}, sh[c.key], {
        chipBg: active ? 'var(--pf-toggle-active)' : 'var(--pf-surface)',
        chipBorder: active ? 'var(--pf-toggle-active)' : 'var(--pf-border)',
        chipColor: active ? 'var(--pf-on-accent)' : 'var(--pf-text-3)',
        chipArwColor: active ? 'var(--pf-on-accent)' : 'var(--pf-faint)',
      });
    });

    const cats = CATS.map((c) => {
      const hs = all.filter((h) => h.cat === c.key).sort(holdingCmp);
      const ev = hs.reduce((s, h) => s + h.evalJPY, 0);
      const gainArr = hs.filter((h) => h.gain != null);
      const gain = gainArr.length ? gainArr.reduce((s, h) => s + h.gain, 0) : null;
      const cost = gainArr.length ? gainArr.reduce((s, h) => s + h.costJPY, 0) : null;
      let monthYen = null;
      if (CATMONTH[c.key] != null) monthYen = CATMONTH[c.key];
      else { const mArr = hs.filter((h) => h.monthYen != null); monthYen = mArr.length ? mArr.reduce((s, h) => s + h.monthYen, 0) : null; }
      const ratio = total > 0 ? ev / total : 0;
      const monthPctCat = (monthYen == null || ev - monthYen === 0) ? null : monthYen / (ev - monthYen) * 100;
      const isOpen = this.state.focusCat === null || this.state.focusCat === c.key;
      const dim = this.state.focusCat !== null && this.state.focusCat !== c.key;
      return Object.assign({}, c, {
        holdings: hs,
        evalNum: ev, evalTxt: this.yen(ev),
        gainNum: gain, costNum: cost, // 暴落耐性分析(computeCrashTest)が参照する区分別の生値（損益/簿価。無ければnull）
        ratio, ratioTxt: this.ratioPct(ratio), barPct: this.ratioPct(ratio),
        gainTxt: gain == null ? '—' : this.signYen(gain),
        gainPctTxt: (gain == null || cost == null || cost === 0) ? '' : this.pct(gain / cost * 100),
        gainColor: this.col(gain),
        monthTxt: monthPctCat == null ? '—' : this.pct(monthPctCat), monthColor: this.col(monthPctCat),
        countTxt: hs.length + '銘柄', isOpen, dimOpacity: dim ? '0.42' : '1',
        onClick: () => this.toggleFocus(c.key),
        onEnter: () => this.setState({ hoverCat: c.key }),
      });
    });

    // ----- top donut: overview (categories) vs drill-down (holdings of focused category) -----
    const focusCat = this.state.focusCat;
    const makeDonut = (items, tot, r, cx, cy) => {
      const C = 2 * Math.PI * r;
      let cum = 0; const segs = []; const labels = [];
      items.forEach((it) => {
        const frac = tot > 0 ? it.value / tot : 0;
        const len = frac * C;
        const draw = Math.max(len - 3, 0);
        segs.push(Object.assign({}, it, { dash: draw.toFixed(2) + ' ' + (C - draw).toFixed(2), offset: (-cum).toFixed(2) }));
        const ang = ((cum + len / 2) / C * 360 - 90) * Math.PI / 180;
        if (frac >= 0.05) labels.push({ x: (cx + r * Math.cos(ang)).toFixed(1), y: (cy + r * Math.sin(ang)).toFixed(1), txt: (frac * 100).toFixed(frac < 0.1 ? 1 : 0) + '%' });
        cum += len;
      });
      return { segs, labels };
    };

    let donut, donutLabels, focusObj = null;
    if (focusCat) {
      const fc = cats.find((c) => c.key === focusCat);
      const items = fc.holdings.map((h, i) => ({ value: h.evalJPY, color: fc.color, op: Math.max(1 - i * 0.14, 0.32), key: 'h' + i }));
      const d = makeDonut(items, fc.evalNum, 86, 118, 118);
      donut = d.segs.map((s) => Object.assign(s, {
        opacity: (this.state.hoverCat == null || this.state.hoverCat === s.key) ? s.op : s.op * 0.4,
        onEnter: () => this.setState({ hoverCat: s.key }),
        onClick: () => {},
      }));
      donutLabels = d.labels;
      focusObj = Object.assign({}, fc, {
        holdingsLegend: fc.holdings.map((h, i) => ({
          name: h.name, code: h.code, quoteUrl: h.quoteUrl, hasQuote: h.hasQuote,
          pctTxt: this.ratioPct(fc.evalNum > 0 ? h.evalJPY / fc.evalNum : 0),
          evalTxt: h.evalTxt,
          swatchColor: fc.color, swatchOp: Math.max(1 - i * 0.14, 0.32).toFixed(2),
          onEnter: () => this.setState({ hoverCat: 'h' + i }),
        })),
      });
    } else {
      const d = makeDonut(cats.map((c) => ({ value: c.evalNum, color: c.color, key: c.key })), total, 86, 118, 118);
      donut = d.segs.map((s) => Object.assign(s, {
        opacity: (this.state.hoverCat == null || this.state.hoverCat === s.key) ? 1 : 0.32,
        onEnter: () => this.setState({ hoverCat: s.key }),
        onClick: () => this.toggleFocus(s.key),
      }));
      donutLabels = d.labels;
    }

    // ----- center text -----
    let center;
    const hc = this.state.hoverCat;
    if (focusCat) {
      const fc = cats.find((c) => c.key === focusCat);
      if (hc && typeof hc === 'string' && hc.charAt(0) === 'h') {
        const h = fc.holdings[parseInt(hc.slice(1), 10)];
        center = { label: h.name.length > 9 ? h.name.slice(0, 9) + '…' : h.name, value: this.ratioPct(fc.evalNum > 0 ? h.evalJPY / fc.evalNum : 0), sub: h.evalTxt, color: 'var(--pf-text-3)' };
      } else {
        center = { label: fc.name, value: fc.ratioTxt, sub: '全体構成比', color: 'var(--pf-muted)' };
      }
    } else if (hc) {
      const c = cats.find((x) => x.key === hc);
      center = { label: c.name, value: c.evalTxt, sub: (c.gainTxt === '—' ? '原価なし' : c.gainTxt), sub2: c.gainPctTxt, color: c.gainColor };
    } else {
      const ga = all.filter((h) => h.gain != null);
      const tg = ga.reduce((s, h) => s + h.gain, 0);
      const tc = ga.reduce((s, h) => s + h.costJPY, 0);
      center = { label: '評価額合計', value: this.yen(total), sub: this.signYen(tg), sub2: this.pct(tg / tc * 100), color: this.col(tg) };
    }

    // summary
    const gainArr = all.filter((h) => h.gain != null);
    const gain = gainArr.reduce((s, h) => s + h.gain, 0);
    const cost = gainArr.reduce((s, h) => s + h.costJPY, 0);

    // 試算（フォールバック）：各銘柄の値動きを合算
    const estMonthYen = cats.filter((c) => c.monthTxt !== '—').reduce((s, c) => {
      const cm = CATMONTH[c.key] != null ? CATMONTH[c.key] : c.holdings.filter((h) => h.monthYen != null).reduce((a, h) => a + h.monthYen, 0);
      return s + cm;
    }, 0);

    // 実測：日次スナップショット（累積保存した評価額合計）の差分から算出
    const vhist = this.readValHist();
    const vMonthTarget = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    let monthSnap = null;
    vhist.forEach((s) => {
      if (s.d <= vMonthTarget) monthSnap = s;
    });

    let monthYen, monthBase, monthLabel;
    if (monthSnap) { monthYen = total - monthSnap.total; monthBase = monthSnap.total; monthLabel = '前月比'; }
    else { monthYen = estMonthYen; monthBase = total - estMonthYen; monthLabel = '前月比（一部試算）'; }

    const summary = {
      gain, gainTxt: this.signYen(gain), gainColor: this.col(gain), gainPctTxt: this.pct(gain / cost * 100),
      monthLabel, monthTxt: this.signYen(monthYen), monthColor: this.col(monthYen), monthPctTxt: this.pct(monthBase ? monthYen / monthBase * 100 : 0),
    };

    return { cats, donut, donutLabels, center, focusObj, drill: focusCat !== null, total, totalTxt: this.yen(total), summary, sh, sortChips, RATE, GOLD };
  },

  toggleFocus(key) { this.setState((s) => ({ focusCat: s.focusCat === key ? null : key })); },

  // 新NISA 非課税枠（生涯）の使用状況。簿価(cost)ベースで枠ごとに集計し、テンプレートへ供給する。
  // frame: tsumitate=NISAつみたて投資枠 / growth=NISA成長投資枠。旧「つみたてNISA」は対象外（nisa.json に含めない）。
  // 生涯非課税限度額1800万のうち成長投資枠は1200万まで。つみたて投資枠は「総枠の残り」までフルに使える点に注意。
  computeNisa() {
    const NISA = (this.state.nisaData && Array.isArray(this.state.nisaData.entries))
      ? this.state.nisaData : this.defaultNisa();
    const lim = NISA.limits || { total: 18000000, growth: 12000000, tsumitate: 6000000 };
    const sumBy = (frame) => NISA.entries.filter((e) => e.frame === frame).reduce((s, e) => s + (e.cost || 0), 0);
    const tsumitateUsed = sumBy('tsumitate');
    const growthUsed = sumBy('growth');
    const totalUsed = tsumitateUsed + growthUsed;

    const TS_BLUE = '#5b9bd5', GR_PURPLE = '#9b8cd4';
    // 各枠バーの上限：成長1200万・つみたて600万（合計=生涯枠1800万）の固定枠で運用する。
    const tsumitateCap = lim.tsumitate || 6000000;
    const mkBar = (label, used, cap, color) => {
      const remain = Math.max(cap - used, 0);
      const pct = cap > 0 ? used / cap : 0;
      return {
        label, color,
        usedTxt: this.yenMan(used), remainTxt: this.yenMan(remain), capTxt: this.yenMan(cap),
        pctTxt: (pct * 100).toFixed(1) + '%', barPct: (Math.min(pct, 1) * 100).toFixed(1) + '%',
      };
    };

    const totalRemain = Math.max(lim.total - totalUsed, 0);
    const totalPct = lim.total > 0 ? totalUsed / lim.total : 0;
    return {
      bars: [
        mkBar('つみたて投資枠', tsumitateUsed, tsumitateCap, TS_BLUE),
        mkBar('成長投資枠', growthUsed, lim.growth, GR_PURPLE),
      ],
      total: {
        usedTxt: this.yenMan(totalUsed), remainTxt: this.yenMan(totalRemain), capTxt: this.yenMan(lim.total),
        pctTxt: (totalPct * 100).toFixed(1) + '%', barPct: (Math.min(totalPct, 1) * 100).toFixed(1) + '%',
        tsumitateColor: TS_BLUE, growthColor: GR_PURPLE,
        tsumitateW: (lim.total > 0 ? Math.min(tsumitateUsed / lim.total, 1) * 100 : 0).toFixed(2) + '%',
        growthW: (lim.total > 0 ? Math.min(growthUsed / lim.total, 1) * 100 : 0).toFixed(2) + '%',
      },
    };
  },

  // controlled input の onInput から生の入力値を取り出す。イベント(e.target.value)にも生値にも対応する。
  inputVal(e) { return (e && e.target) ? e.target.value : e; },

  // 入力文字列を数値化し、非数・空欄は下限値へ、下限未満は下限へクランプする（分析パネル各入力の共通サニタイズ）。
  clampNum(raw, min) {
    const lo = min == null ? 0 : min;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(lo, n) : lo;
  },

  // 暴落耐性分析のデフォルト値。state 未設定時のフォールバックと「デフォルトに戻す」の基準として単一情報源にする。
  crashDefaults() {
    return {
      drops: [10, 20, 30], // 下落シナリオ(%)。A/B 共通。
      // β=「市場が1%下がるとき各区分が何%下がるか」の想定値。根拠は下記の前提に基づく概算で厳密な実測ではない:
      //   jp(国内株)=1.0   … 市場（TOPIX/日経）とほぼ連動する想定の基準値。
      //   us(米国株)=1.15  … 指数連動に加え、株安局面で進みやすい円高（円換算目減り）を上乗せした保守的な想定。
      //   fund(投信)=0.85  … 投信は債券・分散を含む前提で株式より下落を抑えめに見積もる概算。
      betas: { jp: 1.0, us: 1.15, fund: 0.85 },
    };
  },

  // 暴落耐性分析：市場が下落したときの評価額・下落額・含み益の消失を試算する。
  // 引数 m は computeModel() の戻り値（cats/total を参照）。renderVals() から computeModel() を1度だけ呼び共有する。
  // 下落率シナリオ(drops)とβ(betas)は state から読み、編集で即再計算される（未設定時は crashDefaults() を使用）。
  //
  // 2つの下落モデルを併記する（いずれも「試算」であり将来を保証しない）:
  //  - A. 一律（uniform）: 全資産に市場下落率をそのまま適用。区分の性質を区別しない単純な下限イメージ。
  //  - B. 区分別感応度（beta）: 区分ごとの下落感応度(β)を市場下落率に乗じて適用。
  //       ※ 実際の保有内容により感応度は変わるため、この係数は目安。既定値の根拠は crashDefaults() を参照。
  computeCrashTest(m) {
    const total = m.total;
    if (!(total > 0)) return { has: false };

    const def = this.crashDefaults();
    const betaState = this.state.crashBetas || def.betas;
    const BETA = {
      jp: betaState.jp != null ? betaState.jp : def.betas.jp,
      us: betaState.us != null ? betaState.us : def.betas.us,
      fund: betaState.fund != null ? betaState.fund : def.betas.fund,
    };
    // 下落率(%)を小数へ。未設定・非数はデフォルトへフォールバック。
    const dropsPct = (Array.isArray(this.state.crashDrops) && this.state.crashDrops.length) ? this.state.crashDrops : def.drops;
    const DROPS = dropsPct.map((p) => (Number.isFinite(p) ? p : 0) / 100);

    // 評価額と含み益(gain)から取得原価(cost)を復元。原価不明の区分は評価額=原価とみなし損益ゼロ扱い。
    const catList = m.cats.map((c) => ({
      key: c.key, name: c.name, color: c.color,
      evalNum: c.evalNum,
      gainNum: c.gainNum == null ? 0 : c.gainNum,
      beta: BETA[c.key] != null ? BETA[c.key] : 1.0,
    }));
    const totalCost = catList.reduce((s, c) => s + (c.evalNum - c.gainNum), 0);
    const totalGain = catList.reduce((s, c) => s + c.gainNum, 0);

    // model: 'uniform'（A・βを無視して一律）/ 'beta'（B・区分別β）
    const buildScenario = (drop, model) => {
      let dropYen = 0;
      const catRows = catList.map((c) => {
        const eff = model === 'beta' ? drop * c.beta : drop; // 区分ごとの実効下落率
        const d = c.evalNum * eff;
        dropYen += d;
        return { key: c.key, name: c.name, color: c.color, dropYen: d };
      });
      const afterTotal = total - dropYen;
      const afterGain = afterTotal - totalCost; // 下落後の含み損益（原価は不変）
      return {
        dropTxt: (drop * 100).toFixed(0) + '%',
        afterTotalTxt: this.yen(afterTotal),
        dropYenTxt: this.signYen(-dropYen),
        dropPctTxt: this.pct(total > 0 ? -dropYen / total * 100 : 0),
        afterGainTxt: this.signYen(afterGain),
        afterGainColor: this.col(afterGain),
        // 含み益が残っているうちは緑、含み損に転落したら赤で「取得原価割れ」を明示
        turnsLossTxt: afterGain < 0 ? '取得原価割れ' : '含み益を維持',
        turnsLossColor: afterGain < 0 ? this.col(-1) : this.col(1),
        barPct: this.ratioPct(Math.min(dropYen / total, 1)),
        cats: catRows.map((r) => ({
          name: r.name, color: r.color,
          dropYenTxt: this.signYen(-r.dropYen),
        })),
      };
    };

    const models = [
      { key: 'uniform', label: 'A. 一律下落', desc: '全資産に下落率を一律適用' },
      { key: 'beta', label: 'B. 区分別感応度', desc: '区分ごとの下落感応度(β)を反映' },
    ].map((md) => ({
      label: md.label, desc: md.desc,
      scenarios: DROPS.map((d) => buildScenario(d, md.key)),
    }));

    return {
      has: true,
      models,
      currentTotalTxt: this.yen(total),
      currentGainTxt: this.signYen(totalGain),
      currentGainColor: this.col(totalGain),
      // A/B 共通：下落率(%)の編集入力。変更で即 setState → 再計算。
      dropInputs: dropsPct.map((p, i) => ({
        value: p,
        onInput: (e) => this.setCrashDrop(i, this.inputVal(e)),
      })),
      // B：区分別βの編集入力（凡例を兼ねる）。
      betaInputs: catList.map((c) => ({
        key: c.key, name: c.name, color: c.color,
        value: c.beta,
        onInput: (e) => this.setCrashBeta(c.key, this.inputVal(e)),
      })),
      resetFn: () => this.resetCrash(),
    };
  },

  // 下落シナリオ(%)の i 番目を更新。空欄・非数は 0 として扱い、負値は 0 で下限クランプ。
  setCrashDrop(i, raw) {
    const def = this.crashDefaults();
    const v = this.clampNum(raw, 0);
    this.setState((s) => {
      const base = (Array.isArray(s.crashDrops) && s.crashDrops.length) ? s.crashDrops : def.drops;
      const next = base.slice();
      next[i] = v;
      return { crashDrops: next };
    });
  },

  // 区分別βを更新。空欄・非数は 0、負値は 0 で下限クランプ。
  setCrashBeta(key, raw) {
    const def = this.crashDefaults();
    const v = this.clampNum(raw, 0);
    this.setState((s) => {
      const base = Object.assign({}, def.betas, s.crashBetas);
      return { crashBetas: Object.assign({}, base, { [key]: v }) };
    });
  },

  // 下落率・βを既定値へ戻す。
  resetCrash() {
    const def = this.crashDefaults();
    this.setState({ crashDrops: def.drops.slice(), crashBetas: Object.assign({}, def.betas) });
  },

  // 将来シミュレーションのデフォルト値。state 未設定時のフォールバックと「デフォルトに戻す」の基準。
  // init(初期元本)は null のとき現在評価額合計を使うため、既定は null。
  futureDefaults() {
    return { mode: 'forward', rate: 5, monthly: 30000, years: 20, init: null, target: 10000000 };
  },

  // 将来シミュレーション：初期元本＋毎月積立を年率で毎月複利運用したときの将来評価額を試算する。
  // 2モード（state.futureMode）:
  //  - forward（順算）: 毎月積立から将来評価額を求める。
  //  - reverse（逆算）: 目標金額から、達成に必要な毎月積立額を逆算する。
  // 引数 m は computeModel() の戻り値（total を初期元本の既定に使う）。入力は state から読み、編集で即再計算。
  //
  // 計算前提（いずれも「試算」であり将来を保証しない）:
  //  - 月利 = 年率 / 12（近似。厳密な (1+年率)^(1/12)-1 ではなく、一般的な積立計算に合わせた単純化）。
  //  - 積立は毎月末に行う期末型。初月から years×12 ヶ月ぶん拠出する。
  //  - 税・手数料・為替・インフレは考慮しない。
  computeFuture(m) {
    const def = this.futureDefaults();
    const st = this.state;
    const mode = st.futureMode || def.mode;
    const rate = Number.isFinite(st.futureRate) ? st.futureRate : def.rate;      // 想定年率(%)
    const years = Number.isFinite(st.futureYears) ? st.futureYears : def.years;   // 期間(年)
    const init = (st.futureInit == null) ? (m.total || 0) : st.futureInit;        // 初期元本(円)。未指定は現在評価額。
    const target = Number.isFinite(st.futureTarget) ? st.futureTarget : def.target; // 目標金額(円・逆算用)

    const months = Math.max(0, Math.round(years * 12));
    const mRate = rate / 100 / 12;
    const growthFactor = Math.pow(1 + mRate, months); // 初期元本が期末までに成長する倍率

    // 毎月積立額を決める。forward は入力値、reverse は目標から逆算。
    let monthly, reachableNote = '';
    if (mode === 'reverse') {
      if (months <= 0) {
        monthly = 0;
      } else if (mRate === 0) {
        monthly = (target - init) / months; // 年率0：単純割り
      } else {
        // 期末型年金終価係数 annuity = ((1+r)^n - 1) / r。FV = init*growth + monthly*annuity を monthly について解く。
        const annuity = (growthFactor - 1) / mRate;
        monthly = (target - init * growthFactor) / annuity;
      }
      if (monthly < 0) { monthly = 0; reachableNote = '初期元本の運用だけで目標に到達する見込みです（積立は不要）。'; }
    } else {
      monthly = Number.isFinite(st.futureMonthly) ? st.futureMonthly : def.monthly;
    }

    // 毎月複利で元本推移を積み上げ、期末ごとの評価額を記録（グラフ用）。
    let bal = init;
    const points = [{ year: 0, value: bal }];
    for (let i = 1; i <= months; i++) {
      bal = bal * (1 + mRate) + monthly; // 期末に運用益を付与し、積立を加算
      if (i % 12 === 0) points.push({ year: i / 12, value: bal });
    }
    // 期間が年の整数倍でない場合、最終月を末尾に補完
    if (months % 12 !== 0) points.push({ year: years, value: bal });

    const contributed = init + monthly * months; // 投下元本（初期＋積立総額）
    const finalVal = bal;
    const profit = finalVal - contributed;       // 運用収益

    // 折れ線グラフのジオメトリ（評価額推移）。既存 buildChart と同じ viewBox 0..1000 x 0..300。
    const W = 1000, H = 300, PAD = 6;
    const maxV = points.reduce((mx, p) => Math.max(mx, p.value), 1);
    const n = points.length;
    const xOf = (i) => n <= 1 ? 0 : (i / (n - 1)) * W;
    const yOf = (v) => H - PAD - (v / maxV) * (H - PAD * 2);
    const linePts = points.map((p, i) => xOf(i).toFixed(1) + ',' + yOf(p.value).toFixed(1)).join(' ');
    const areaPath = 'M0,' + H + ' ' + points.map((p, i) => 'L' + xOf(i).toFixed(1) + ',' + yOf(p.value).toFixed(1)).join(' ') + ' L' + W + ',' + H + ' Z';
    const accent = '#5cc4a3';

    // X軸目盛：0年・中間・最終の3点
    const xticks = n <= 1 ? [] : [0, Math.floor((n - 1) / 2), n - 1].map((i) => ({ label: points[i].year + '年' }));

    const contribRatio = finalVal > 0 ? contributed / finalVal : 0;

    return {
      has: months > 0,
      isForward: mode !== 'reverse', isReverse: mode === 'reverse',
      // モード切替タブ
      modeTabs: [{ k: 'forward', l: '積立から将来額' }, { k: 'reverse', l: '目標から必要積立' }].map((t) => ({
        label: t.l, onClick: () => this.setState({ futureMode: t.k }),
        bg: mode === t.k ? 'var(--pf-toggle-active)' : 'transparent',
        color: mode === t.k ? 'var(--pf-on-accent)' : 'var(--pf-text-2)',
      })),
      // 入力バインド（変更で即 setState → 再計算）
      rateInput: { value: rate, onInput: (e) => this.setFutureField('futureRate', this.inputVal(e)) },
      monthlyInput: { value: monthly, onInput: (e) => this.setFutureField('futureMonthly', this.inputVal(e)) },
      yearsInput: { value: years, onInput: (e) => this.setFutureField('futureYears', this.inputVal(e)) },
      initInput: { value: Math.round(init), onInput: (e) => this.setFutureField('futureInit', this.inputVal(e)) },
      targetInput: { value: Math.round(target), onInput: (e) => this.setFutureField('futureTarget', this.inputVal(e)) },
      resetFn: () => this.resetFuture(),
      // サマリー
      finalTxt: this.yen(finalVal),
      targetTxt: this.yen(target),
      monthlyOutTxt: this.yen(Math.max(0, Math.round(monthly))), // 逆算結果の必要毎月積立額
      reachableNote,
      contributedTxt: this.yen(contributed),
      profitTxt: this.signYen(profit),
      profitColor: this.col(profit),
      profitPctTxt: this.pct(contributed > 0 ? profit / contributed * 100 : 0),
      yearsTxt: years + '年後',
      // 元本／収益の割合バー
      contribW: this.ratioPct(Math.min(contribRatio, 1)),
      profitW: this.ratioPct(Math.max(1 - contribRatio, 0)),
      // グラフ
      chart: { hasChart: n >= 2, accent, linePts, areaPath, xticks },
    };
  },

  // 将来シミュレーションの数値フィールドを更新。空欄・非数・負値は 0 へクランプ。
  setFutureField(field, raw) {
    this.setState({ [field]: this.clampNum(raw, 0) });
  },

  // 将来シミュレーションを既定値へ戻す（初期元本も現在評価額の既定へ戻す。モードは維持）。
  resetFuture() {
    const def = this.futureDefaults();
    this.setState({ futureRate: def.rate, futureMonthly: def.monthly, futureYears: def.years, futureInit: def.init, futureTarget: def.target });
  },

  // リバランス提案分析：目標配分(%)を入力すると、現状とのズレと必要な売買額を提示する。
  // 引数 m は computeModel() の戻り値（total と区分別 evalNum を参照）。
  // 目標配分の既定は「現在の配分」＝初期状態はズレゼロ。入力した％は合計が100でなくても、
  // 内部で合計比に正規化して評価額へ按分するため、売買額の総和は常にゼロ（総額を維持したリバランス）になる。
  computeRebalance(m) {
    const total = m.total;
    if (!(total > 0)) return { has: false };
    const st = this.state;
    const tg = st.rebalTargets || {};

    const cats = m.cats.map((c) => {
      const curPct = c.evalNum / total * 100;
      const tRaw = Number.isFinite(tg[c.key]) ? tg[c.key] : curPct; // 未設定は現在配分を既定
      return { key: c.key, name: c.name, color: c.color, evalNum: c.evalNum, curPct, tRaw };
    });
    const sumT = cats.reduce((s, c) => s + c.tRaw, 0);

    const rows = cats.map((c) => {
      const targetEval = sumT > 0 ? total * (c.tRaw / sumT) : 0; // 合計比で正規化して按分
      const diff = targetEval - c.evalNum; // >0 買い増し / <0 売却
      const actionTxt = Math.abs(diff) < 1 ? '調整不要' : (diff > 0 ? '買い増し' : '売却');
      return {
        name: c.name, color: c.color,
        curPctTxt: this.ratioPct(c.curPct / 100), curEvalTxt: this.yen(c.evalNum),
        targetInput: { value: +c.tRaw.toFixed(1), onInput: (e) => this.setRebalTarget(c.key, this.inputVal(e)) },
        targetEvalTxt: this.yen(targetEval),
        diffTxt: this.signYen(diff), diffColor: this.col(diff), actionTxt,
      };
    });

    return {
      has: true, rows, totalTxt: this.yen(total),
      sumTxt: sumT.toFixed(1) + '%',
      normalized: Math.abs(sumT - 100) > 0.05, // 合計が100%でないとき注記を出す
      resetFn: () => this.setState({ rebalTargets: null }),
    };
  },

  // リバランス目標配分(%)を更新。空欄・非数は 0、負値は 0 で下限クランプ。
  setRebalTarget(key, raw) {
    const v = this.clampNum(raw, 0);
    this.setState((s) => ({ rebalTargets: Object.assign({}, s.rebalTargets || {}, { [key]: v }) }));
  },

  // ドローダウン / 変動性分析：評価額の月次履歴から、最大下落幅・現在の下落幅・月次リターンのばらつきを算出する。
  // buildChart と同じく各月(YYYY-MM)の最新1点へ集約した系列を使う（暴落耐性分析の「実測版」）。
  // 履歴が2点未満のときは hasData=false でメッセージ表示。
  computeDrawdown() {
    // カテゴリ切替：全体（評価額 total）または各区分（cats[key]）を系列値に使う。state.ddCat（既定 'all'）。
    // 「全体」を残しつつ、国内株/米国株/投資信託の区分ごとにドローダウン・変動性を算出できる。
    const CATS = this.categories();
    const cat = this.state.ddCat || 'all';
    const catDefs = [{ k: 'all', l: '全体' }].concat(CATS.map((c) => ({ k: c.key, l: c.short })));
    const catTabs = catDefs.map((t) => ({
      label: t.l, onClick: () => this.setState({ ddCat: t.k, ddHover: null }),
      bg: cat === t.k ? 'var(--pf-toggle-active)' : 'transparent',
      color: cat === t.k ? 'var(--pf-on-accent)' : 'var(--pf-text-2)',
    }));
    const catName = cat === 'all' ? '全体' : ((CATS.find((c) => c.key === cat) || {}).name || '');
    // 全体は total、区分別は cats[key]。区分別で値が 0 以下の点＝その区分を未保有だった期間は対象外にする
    // （ゼロ期間を含めると 0→初回保有 の立ち上がりが擬似的な巨大リターンとなり、DD・ボラが歪むため）。
    const valOf = (s) => {
      if (cat === 'all') return s.total;
      if (!s.cats) return null;
      const v = s.cats[cat];
      return v > 0 ? v : null;
    };
    const base = { has: true, catTabs, catName };

    let series = this.readValHist().filter((s) => s && s.d && valOf(s) != null).sort((a, b) => (a.d < b.d ? -1 : 1));
    series = this.aggregateByMonth(series);
    if (series.length < 2) {
      return Object.assign(base, {
        hasData: false,
        emptyMsg: (cat === 'all' ? '月次の評価額履歴' : catName + 'の月次履歴') + 'が2点以上たまると、ドローダウンと変動性を分析できます。',
      });
    }

    const vals = series.map(valOf);
    // 過去最高値(running peak)からの下落率を各点で算出し、最大ドローダウンとその区間を記録。
    let peak = vals[0], curPeakIdx = 0, maxDD = 0, ddPeakIdx = 0, ddTroughIdx = 0;
    const ddSeries = [];
    vals.forEach((v, i) => {
      if (v > peak) { peak = v; curPeakIdx = i; }
      const dd = peak > 0 ? (peak - v) / peak : 0;
      ddSeries.push(dd);
      if (dd > maxDD) { maxDD = dd; ddPeakIdx = curPeakIdx; ddTroughIdx = i; }
    });
    const allHigh = Math.max.apply(null, vals);
    const last = vals[vals.length - 1];
    const curDD = allHigh > 0 ? (allHigh - last) / allHigh : 0;

    // 月次リターンの平均・標準偏差（母集団）・年率換算ボラティリティ（×√12）。
    const rets = [];
    for (let i = 1; i < vals.length; i++) { if (vals[i - 1] > 0) rets.push((vals[i] - vals[i - 1]) / vals[i - 1]); }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const variance = rets.length ? rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length : 0;
    const std = Math.sqrt(variance);
    const annVol = std * Math.sqrt(12);
    const best = rets.length ? Math.max.apply(null, rets) : 0;
    const worst = rets.length ? Math.min.apply(null, rets) : 0;

    // アンダーウォーター図（ドローダウンの深さ推移）。上端=0%、下へ行くほど深い。既存 chart と同じ viewBox。
    const W = 1000, H = 300, PAD = 6, n = ddSeries.length;
    const maxPlot = Math.max(maxDD, 0.01);
    const xOf = (i) => n <= 1 ? 0 : i / (n - 1) * W;
    const yOf = (dd) => PAD + (dd / maxPlot) * (H - 2 * PAD);
    const pts = ddSeries.map((dd, i) => ({ x: +xOf(i).toFixed(1), y: +yOf(dd).toFixed(1) }));
    const linePts = pts.map((p) => p.x + ',' + p.y).join(' ');
    const areaPath = 'M0,' + PAD + ' ' + pts.map((p) => 'L' + p.x + ',' + p.y).join(' ') + ' L' + W + ',' + PAD + ' Z';
    const fmtD = (d) => { const t = String(d).split('-'); return t[0] + '/' + (+t[1]); };
    const xticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => ({ label: fmtD(series[i].d) }));

    // ホバー/タップ中の点だけに出す強調ドット＋ツールチップ（年月・下落率・評価額）。
    // 位置は操作レイヤー(.pf-chart-hit)が最寄り点を ddHover に設定する。既存の資産推移グラフと同じ座標系(/10, /3)。
    this._ddN = n;
    const hv = this.state.ddHover;
    let tip = null;
    if (hv != null && hv >= 0 && hv < n) {
      const dd = ddSeries[hv], t = String(series[hv].d).split('-');
      const below = pts[hv].y < 95; // 上端(浅いDD)に近い点はツールチップを下側へ出す
      const topPct = (pts[hv].y / 3).toFixed(2) + '%';
      tip = {
        dotLeftPct: (pts[hv].x / 10).toFixed(2) + '%',
        dotTopPct: topPct,
        leftPct: Math.min(Math.max(pts[hv].x / 10, 9), 91).toFixed(2) + '%',
        topPct: topPct,
        transform: below ? 'translate(-50%, 13px)' : 'translate(-50%, calc(-100% - 13px))',
        dateTxt: (+t[0]) + '/' + (+t[1]),
        valTxt: this.pct(-dd * 100), // 最高値比の下落率（0=最高値更新中）
        valColor: this.col(-dd),
        momTxt: '評価額 ' + this.yen(vals[hv]),
        momColor: 'var(--pf-text-2)',
      };
    }

    return Object.assign(base, {
      hasData: true,
      maxDDTxt: this.pct(-maxDD * 100),
      maxDDRangeTxt: fmtD(series[ddPeakIdx].d) + ' → ' + fmtD(series[ddTroughIdx].d),
      curDDTxt: this.pct(-curDD * 100), curDDColor: this.col(-curDD),
      avgRetTxt: this.pct(mean * 100),
      volTxt: (annVol * 100).toFixed(1) + '%', volMonthTxt: (std * 100).toFixed(1) + '%',
      bestTxt: this.pct(best * 100), worstTxt: this.pct(worst * 100),
      pointsTxt: series.length + '点（月次）',
      accent: '#d75049', hasChart: n >= 2, linePts, areaPath, xticks, tip,
      // ホバーは資産推移グラフと共通の hoverNearest を使う（最寄り点を ddHover へ設定）。
      hit: { move: (e) => this.hoverNearest(e, this._ddN | 0, 'ddHover'), leave: () => { if (this.state.ddHover != null) this.setState({ ddHover: null }); } },
    });
  },

  // 分析パネル（アコーディオン）。各項目を独立に開閉でき、複数同時展開も可能（state.openPanels）。デフォルトは全て閉じ。
  // 分析機能を増やす場合はこの配列に定義を足し、index.html に対応する本文 sc-if を追加する。
  buildAnalysisPanels(m) {
    const openMap = this.state.openPanels || {};
    const defs = [
      { key: 'crash', title: '暴落耐性分析', sub: '市場下落時の評価額シミュレーション' },
      { key: 'future', title: '将来シミュレーション分析', sub: '積立から将来額／目標から必要積立を試算' },
      { key: 'rebalance', title: 'リバランス提案分析', sub: '目標配分とのズレと必要な売買額' },
      { key: 'drawdown', title: 'ドローダウン / 変動性分析', sub: '過去の最大下落幅と月次リターンのばらつき' },
    ];
    return defs.map((d) => {
      const open = !!openMap[d.key];
      return {
        key: d.key, title: d.title, sub: d.sub,
        isOpen: open,
        isCrash: d.key === 'crash', isFuture: d.key === 'future',
        isRebal: d.key === 'rebalance', isDrawdown: d.key === 'drawdown',
        caret: open ? '▲' : '▼',
        // クリックで該当項目だけを開閉トグル（他項目の状態は保持＝複数同時展開可）。
        onClick: () => this.setState((s) => {
          const cur = s.openPanels || {};
          return { openPanels: Object.assign({}, cur, { [d.key]: !cur[d.key] }) };
        }),
      };
    });
  },
});
