// ポートフォリオ・ロジック：ドメイン計算（評価額・損益の集計、ドーナツ/凡例、サマリー）
// computeModel() がテンプレート全体へ供給するモデルを構築する中核。
window.PortfolioLogic = Object.assign(window.PortfolioLogic || {}, {
  // 3区分（国内株/米国株/投資信託）の定義。色・名称の単一情報源（model/chart 共用）。
  categories() {
    return [
      { key: 'jp',   name: '国内株',   short: '国内', color: '#5b9bd5' },
      { key: 'us',   name: '米国株',   short: '米国', color: '#5cc4a3' },
      { key: 'fund', name: '投資信託', short: '投信', color: '#9b8cd4' },
    ];
  },
  // 当日キー（YYYY-MM-DD）。日次蓄積・履歴差分で共用。
  todayKey() { return new Date().toISOString().slice(0, 10); },

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
      const evalJPY = h.shares * h.price / per * rate;
      const costJPY = h.avg == null ? null : h.shares * h.avg / per * rate;
      const gain = costJPY == null ? null : evalJPY - costJPY;
      const gainPct = (costJPY == null || costJPY === 0) ? null : gain / costJPY * 100;
      const monthPct = h.monthAbs == null ? null : h.monthAbs / (h.price - h.monthAbs) * 100;
      const monthYen = h.monthAbs == null ? null : h.monthAbs * h.shares / per * rate;
      return Object.assign({}, h, {
        evalJPY, costJPY, gain, gainPct, monthPct, monthYen,
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

    // ----- 損益率ランキング（ベスト/ワースト）: 評価損益率で並べた上位・下位3銘柄 -----
    const catColor = {}; CATS.forEach((c) => { catColor[c.key] = c.color; });
    const moverRow = (h) => ({
      name: h.name, code: h.code, color: catColor[h.cat],
      gainPctTxt: this.pct(h.gainPct), gainTxt: this.signYen(h.gain), gainColor: this.col(h.gain),
    });
    const ranked = all.filter((h) => h.gainPct != null).sort((a, b) => b.gainPct - a.gainPct);
    const mk = Math.min(3, Math.floor(ranked.length / 2)); // best/worst が重複しない最大件数（銘柄が少ない時の重複を防ぐ）
    const movers = mk >= 1
      ? { has: true, best: ranked.slice(0, mk).map(moverRow), worst: ranked.slice(ranked.length - mk).reverse().map(moverRow) }
      : { has: false };

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
          name: h.name, code: h.code,
          pctTxt: this.ratioPct(fc.evalNum > 0 ? h.evalJPY / fc.evalNum : 0),
          evalTxt: h.evalTxt,
          swatch: this.hexA(fc.color, Math.max(1 - i * 0.14, 0.32)),
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

    return { cats, donut, donutLabels, center, focusObj, drill: focusCat !== null, total, totalTxt: this.yen(total), summary, movers, sh, sortChips, RATE, GOLD };
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
});
