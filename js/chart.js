// ポートフォリオ・ロジック：資産推移グラフのビューモデル構築
// 履歴(readValHist)から SVG 幾何（エリア/ライン/ドット/軸）と期間トグルを生成。
window.PortfolioLogic = Object.assign(window.PortfolioLogic || {}, {
  buildChart() {
    const accent = '#5b9bd5';
    const range = this.state.chartRange | 0;
    const valOf = (s) => s.total;

    const RDEF = [{ k: 365, l: '1年' }, { k: 1095, l: '3年' }, { k: 1825, l: '5年' }, { k: 0, l: '全期間' }];
    const ranges = RDEF.map((rg) => ({
      label: rg.l, onClick: () => this.setState({ chartRange: rg.k, chartHover: null }),
      bg: range === rg.k ? 'var(--pf-toggle-active)' : 'transparent', color: range === rg.k ? 'var(--pf-on-accent)' : 'var(--pf-text-2)',
    }));

    const base = { ranges, accent };
    const rangeLabel = (RDEF.find((r) => r.k === range) || RDEF[3]).l;
    let series = this.readValHist().filter((s) => s && s.d && valOf(s) != null).sort((a, b) => (a.d < b.d ? -1 : 1));
    // 月次の等間隔で描くため、各月(YYYY-MM)の最新1点に集約する。
    // 過去の完了月は月末値、進行中の今月は直近の日次スナップショット＝右端が「今月の最新」になる。
    if (series.length) {
      const mmap = new Map();
      series.forEach((s) => mmap.set(String(s.d).slice(0, 7), s)); // 同月は後勝ち＝最新（series は昇順なので各月の最終点が残る）
      series = Array.from(mmap.values());
    }
    if (range > 0 && series.length) {
      const cut = new Date(series[series.length - 1].d).getTime() - range * 86400000;
      const f = series.filter((s) => new Date(s.d).getTime() >= cut);
      if (f.length >= 2) series = f; else series = series.slice(-2);
    }
    if (series.length < 2) {
      return Object.assign(base, {
        hasChart: false,
        emptyMsg: '履歴が2日分たまると推移グラフが表示されます。',
      });
    }

    const n = series.length, vals = series.map(valOf);
    const dataLo = Math.min.apply(null, vals), dataHi = Math.max.apply(null, vals);
    let lo = dataLo, hi = dataHi;
    if (lo === hi) { const e = Math.abs(lo) * 0.02 || 1; lo -= e; hi += e; }
    const padV = (hi - lo) * 0.14; lo -= padV; hi += padV;

    const VBW = 1000, VBH = 300, padL = 4, padR = 4, padT = 12, padB = 12;
    const iw = VBW - padL - padR, ih = VBH - padT - padB, yBot = padT + ih;
    const xOf = (i) => padL + iw * i / (n - 1);
    const yOf = (v) => padT + ih * (1 - (v - lo) / (hi - lo));
    const pts = series.map((s, i) => ({ x: +xOf(i).toFixed(1), y: +yOf(valOf(s)).toFixed(1) }));
    const linePts = pts.map((p) => p.x + ',' + p.y).join(' ');
    const areaPath = 'M' + pts[0].x + ',' + yBot + ' L' + pts.map((p) => p.x + ',' + p.y).join(' L') + ' L' + pts[n - 1].x + ',' + yBot + ' Z';
    const dots = pts.map((p) => ({ leftPct: (p.x / 10).toFixed(3) + '%', topPct: (p.y / 3).toFixed(3) + '%' }));

    // ホバー/タップ中の点だけに出す強調ドット＋ツールチップ（日付＋評価額）。
    // 位置は操作レイヤー(.pf-chart-hit)が最寄り点を chartHover に設定する。
    this._chartN = n;
    const hv = this.state.chartHover;
    let tip = null;
    if (hv != null && hv >= 0 && hv < n) {
      const s = series[hv], v = valOf(s), t = String(s.d).split('-');
      const below = pts[hv].y < 95; // 上端に近い点は下側へ出す
      const topPct = (pts[hv].y / 3).toFixed(2) + '%';
      // 前月（1つ前の月次点）比。差分を「+¥〇〇」で表示。先頭点は前月が無いので出さない。
      const prevV = hv > 0 ? valOf(series[hv - 1]) : null;
      const mom = prevV != null ? v - prevV : null;
      tip = {
        dotLeftPct: (pts[hv].x / 10).toFixed(2) + '%',
        dotTopPct: topPct,
        leftPct: Math.min(Math.max(pts[hv].x / 10, 9), 91).toFixed(2) + '%',
        topPct: topPct,
        transform: below ? 'translate(-50%, 13px)' : 'translate(-50%, calc(-100% - 13px))',
        dateTxt: (+t[0]) + '/' + (+t[1]) + '/' + (+t[2]),
        valTxt: this.yen(v),
        valColor: 'var(--pf-text)',
        momTxt: mom != null ? '前月比 ' + this.signYen(mom) : null,
        momColor: mom != null ? this.col(mom) : null,
      };
    }

    // X軸ラベル数は横幅に応じて増減（広いほど多く、モバイルは3つ）
    const vw = this.state.vw || 1200;
    const maxTicks = Math.min(n, vw < 680 ? 3 : Math.max(3, Math.min(12, Math.floor(vw / 150))));
    const idx = [];
    for (let k = 0; k < maxTicks; k++) idx.push(Math.round(k * (n - 1) / (maxTicks - 1)));
    // 年をまたぐ場合は YYYY/M、同年内は M/D
    const multiYear = String(series[0].d).slice(0, 4) !== String(series[n - 1].d).slice(0, 4);
    const fmtD = (d) => { const t = String(d).split('-'); return multiYear ? (t[0] + '/' + (+t[1])) : ((+t[1]) + '/' + (+t[2])); };
    const xticks = idx.filter((v, i, a) => a.indexOf(v) === i).map((i) => ({ label: fmtD(series[i].d) }));

    const first = vals[0], last = vals[n - 1], delta = last - first;
    return Object.assign(base, {
      hasChart: true, viewBox: '0 0 ' + VBW + ' ' + VBH, areaPath, linePts, dots, tip, showDots: n <= (vw < 680 ? 16 : 60),
      hit: { move: (e) => this.chartHoverAt(e), leave: () => { if (this.state.chartHover != null) this.setState({ chartHover: null }); } },
      deltaTxt: this.signYen(delta), deltaColor: this.col(delta), rangeLabel,
      deltaPctTxt: this.pct(first !== 0 ? delta / Math.abs(first) * 100 : 0),
      hiTxt: this.yenMan(dataHi), loTxt: this.yenMan(dataLo),
      spanTxt: fmtD(series[0].d) + '〜' + fmtD(series[n - 1].d), xticks,
    });
  },

  // 操作レイヤー上のポインタ位置から最寄りデータ点を求め chartHover に設定（丸ポチの有無に依らず動作）
  chartHoverAt(e) {
    const n = this._chartN | 0;
    if (n < 2 || !e || !e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    if (cx == null || !r.width) return;
    let frac = (cx - r.left) / r.width;
    frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    const i = Math.round(frac * (n - 1));
    if (i !== this.state.chartHover) this.setState({ chartHover: i });
  },

  // 資産構成の推移（積み上げ棒）：履歴の cats（カテゴリ別評価額）を月次/年次に集計
  niceCeil(v) {
    if (v <= 0) return 10000;
    const man = v / 10000, pow = Math.pow(10, Math.floor(Math.log10(man))), nrm = man / pow;
    const m = [1, 1.5, 2, 3, 4, 5, 7.5].find((s) => nrm <= s) || 10;
    return m * pow * 10000;
  },
  buildMixChart() {
    const CATS = this.categories();
    const period = this.state.chartMixPeriod || 'year';
    const periods = [{ k: 'month', l: '月次' }, { k: 'year', l: '年次' }].map((p) => ({
      label: p.l, onClick: () => this.setState({ chartMixPeriod: p.k, mixHover: null }),
      bg: period === p.k ? 'var(--pf-toggle-active)' : 'transparent', color: period === p.k ? 'var(--pf-on-accent)' : 'var(--pf-text-2)',
    }));
    const legend = CATS.map((c) => ({ name: c.name, color: c.color }));
    const base = { periods, legend, mixLeave: () => { if (this.state.mixHover != null) this.setState({ mixHover: null }); } };

    let series = this.readValHist().filter((s) => s && s.d && s.cats).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!series.length) return Object.assign(base, { hasBars: false, emptyMsg: '資産構成の履歴がたまると、構成の推移が表示されます。' });

    const bucketOf = (d) => period === 'year' ? String(d).slice(0, 4) : String(d).slice(0, 7);
    const map = new Map();
    series.forEach((s) => map.set(bucketOf(s.d), s)); // 各期間バケットの最新を採用
    let buckets = Array.from(map.values()); // 全期間を表示し、多い時は横スクロール（trackMinPx）で見せる

    const totalOf = (s) => CATS.reduce((a, c) => a + (s.cats[c.key] || 0), 0);
    const totals = buckets.map(totalOf);
    const niceMax = this.niceCeil(Math.max.apply(null, totals.concat([1])));
    const multiYear = String(buckets[0].d).slice(0, 4) !== String(buckets[buckets.length - 1].d).slice(0, 4);
    const labelOf = (d) => { const t = String(d).split('-'); return period === 'year' ? t[0] : (multiYear ? (t[0].slice(2) + '/' + (+t[1])) : ((+t[1]) + '月')); };

    const hv = this.state.mixHover, n = buckets.length;
    const bars = buckets.map((s, i) => {
      const tot = totals[i];
      return {
        label: labelOf(s.d),
        stackHeightPct: ((tot / niceMax) * 100).toFixed(2) + '%',
        segs: CATS.map((c) => ({ color: c.color, heightPct: tot ? (((s.cats[c.key] || 0) / tot) * 100).toFixed(2) + '%' : '0%' })).reverse(),
        onEnter: () => this.setState({ mixHover: i }),
        opacity: (hv == null || hv === i) ? '1' : '0.4',
      };
    });
    const yticks = [1, 0.75, 0.5, 0.25, 0].map((f) => ({ topPct: ((1 - f) * 100).toFixed(1) + '%', label: Math.round(niceMax * f / 10000).toLocaleString('en-US') }));

    // 棒1本あたり最小幅を確保（少なければ親幅にフィット、多ければ横スクロール）
    const trackMinPx = (n * 34) + 'px';

    let tip = null;
    if (hv != null && buckets[hv]) {
      const s = buckets[hv], t = String(s.d).split('-');
      // ツールチップ中心を「見えている範囲（スクロール表示域）」内へクランプして見切れを防ぐ。
      // スクロール位置・実寸・ツールチップ幅は DOM から取得（内側の棒は位置不変、表示域の端寄りの棒だけ内側へ寄せる）。
      const doc = (typeof document !== 'undefined') ? document : null;
      const tipEl = doc ? doc.querySelector('.pf-bars-tip') : null;
      const half = (tipEl && tipEl.offsetWidth) ? (tipEl.offsetWidth / 2 + 8) : 140; // ツールチップ片側幅(実測優先)
      let leftPct;
      const el = doc ? doc.querySelector('.pf-bars-scroll') : null;
      if (el && el.clientWidth && el.scrollWidth) {
        const W = el.clientWidth, SL = el.scrollLeft, SW = el.scrollWidth;
        const barCenter = (hv + 0.5) / n * SW;       // トラック内の棒中心(px)
        const lo = half, hi = W - half;
        let screenX = barCenter - SL;                // 表示域内での位置(px)
        screenX = hi > lo ? Math.min(Math.max(screenX, lo), hi) : W / 2;
        leftPct = ((SL + screenX) / SW * 100).toFixed(2) + '%';
      } else {
        // フォールバック（DOM未生成時）: カード内幅の概算でトラック幅を見積もりクランプ
        const vw = this.state.vw || 1200;
        const pagePad = Math.min(Math.max(vw * 0.035, 11), 20);
        const cardPad = Math.min(Math.max(vw * 0.04, 14), 20);
        const trackW = Math.max(n * 34, Math.min(vw - 2 * pagePad, 1160) - 2 * cardPad - 34);
        const lo = half, hi = trackW - half;
        let cpx = trackW * (hv + 0.5) / n;
        cpx = hi > lo ? Math.min(Math.max(cpx, lo), hi) : trackW / 2;
        leftPct = (cpx / trackW * 100).toFixed(2) + '%';
      }
      // 1つ前の期間（月次なら前月／年次なら前年）比。差分を「+¥〇〇」で表示。先頭は前期間が無いので出さない。
      const prevTot = hv > 0 ? totals[hv - 1] : null;
      const mom = prevTot != null ? totals[hv] - prevTot : null;
      const momLabel = period === 'year' ? '前年比' : '前月比';
      tip = {
        leftPct,
        dateTxt: period === 'year' ? (t[0] + '年') : (t[0] + '/' + (+t[1])),
        totalTxt: this.yen(totals[hv]),
        momTxt: mom != null ? momLabel + ' ' + this.signYen(mom) : null,
        momColor: mom != null ? this.col(mom) : null,
        rows: CATS.map((c) => ({ name: c.name, color: c.color, valTxt: this.yen(s.cats[c.key] || 0), pctTxt: this.ratioPct(totals[hv] ? (s.cats[c.key] || 0) / totals[hv] : 0) })),
      };
    }
    return Object.assign(base, { hasBars: true, bars, yticks, tip, trackMinPx });
  },
});
