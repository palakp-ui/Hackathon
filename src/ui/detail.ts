// County detail panel: context -> outcomes -> possible explanations -> next steps.
import type { County, Dataset, StateAbbr } from '../types';
import { STATE_NAMES } from '../types';
import { interpret } from '../analysis/interpret';
import { evaluateFlags } from '../analysis/flags';
import { mostSimilarElsewhere, peerMean } from '../analysis/peers';
import { bars, pairedBars, scatter } from './charts';
import { esc, fmtInt, fmtMiles, fmtPct, fmtPP, fmtProp, fmtUSD } from '../util/format';
import { miles } from '../util/geo';

interface Row { label: string; county: string; peers: string; state: string; kind: 'observed' | 'derived'; missing?: boolean }

const kindTag = (k: 'observed' | 'derived') => `<span class="tag tag-${k}" title="${k === 'observed' ? 'Published by the source agency' : 'Calculated in this tool from published values'}">${k}</span>`;

function table(rows: Row[], caption: string) {
  return `<table class="cmp"><caption class="sr-only">${esc(caption)}</caption>
    <thead><tr><th scope="col">Measure</th><th scope="col">County</th><th scope="col">Similar counties</th><th scope="col">State</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${r.missing ? ' class="is-missing"' : ''}><th scope="row">${esc(r.label)} ${kindTag(r.kind)}</th><td>${r.county}</td><td>${r.peers}</td><td>${r.state}</td></tr>`).join('')}</tbody></table>`;
}

function completeness(c: County, ds: Dataset) {
  const o = c.out;
  const item = (label: string, status: 'ok' | 'partial' | 'missing', note: string) =>
    `<li class="cm cm-${status}"><span class="cm-dot" aria-hidden="true"></span><span><strong>${esc(label)}</strong> <span class="muted">${esc(note)}</span></span></li>`;
  const cov = (v: number | null | undefined) => (v == null ? '' : `${Math.round(v * 100)}% of graduates`);
  return `<ul class="completeness" aria-label="Data completeness">
    ${item('Economic context', c.ctx.poverty_rate != null ? 'ok' : 'missing', 'SAIPE 2023, ACS 2019–23, RUCC 2023')}
    ${item('College-going', o.college_going ? ((o.college_going.coverage ?? 1) < 0.9 ? 'partial' : 'ok') : 'missing', o.college_going ? cov(o.college_going.coverage) : 'not reported')}
    ${item('Low-income results', o.low_income ? ((o.low_income.coverage ?? 1) < 0.8 ? 'partial' : 'ok') : 'missing', o.low_income ? `${Math.round((o.low_income.coverage ?? 0) * 100)}% of low-income graduates` : 'suppressed (small groups) or unavailable')}
    ${item('Two-/four-year destinations', o.destinations ? 'ok' : 'missing', o.destinations ? cov(o.destinations.coverage) : c.state === 'GA' ? 'not published by GOSA' : 'suppressed')}
    ${c.dest
      ? item('Elite-university & destination Pell', c.dest.elite_share == null ? 'missing' : c.dest.small ? 'partial' : 'ok', `${c.dest.freshmen} USG freshmen (Fall 2024)${c.dest.small ? ', small number' : ''}`)
      : item('Elite-university & destination Pell', 'missing', 'MA does not publish enrollment by county of origin')}
    ${item('Pell status of students from this county', 'missing', 'not public in either state')}
    ${item('College-access programs', ds.programs ? 'ok' : 'missing', ds.programs ? `${c.programs.length} listed` : 'no program file supplied')}
  </ul>`;
}

function eliteSection(c: County, ds: Dataset): string {
  const pe = ds.pellElite?.states[c.state];
  const stateLine = pe ? `<p class="fine">Statewide (${esc(STATE_NAMES[c.state])}): ${fmtPct(pe.elite.pell_pct)} of undergraduates at the most selective colleges receive Pell vs. ${fmtPct(pe.statewide.pell_pct)} of all undergraduates (ratio ${pe.representation_ratio?.toFixed(2) ?? 'n/a'}). <a class="link" href="#pell-elite">See state comparison</a></p>` : '';
  if (!c.dest || !ds.gaDest) {
    return `<p class="unavailable">Massachusetts does not publish where students from each county or town enroll in college, so county-level elite-college and destination-Pell measures are not available.</p>${stateLine}`;
  }
  const d = c.dest, s = ds.gaDest.state;
  if (d.elite_share == null) return `<p class="unavailable">Only ${d.freshmen} first-time freshmen from this county enrolled at USG institutions in Fall 2024, too few to report shares.</p>${stateLine}`;
  const rows: Row[] = [
    { label: 'USG freshmen at UGA or Georgia Tech', kind: 'derived', county: fmtProp(d.elite_share), peers: fmtProp(d.peer_elite_share), state: fmtProp(s.elite_share) },
    { label: 'Pell share at colleges attended', kind: 'derived', county: fmtPct(d.pell_dest_pct), peers: '—', state: fmtPct(s.pell_dest_pct) },
  ];
  const max = Math.max(...d.top.map((t) => t.n));
  const top = d.top.map((t) => `<div class="bar-row"><span class="bar-label">${esc(t.name.replace('University of', 'U.').replace(' University', ''))}${t.elite ? ' <span class="tag tag-elite">elite</span>' : ''}</span><span class="bar-track"><span class="bar-fill${t.elite ? ' bar-elite' : ''}" style="width:${(t.n / max) * 100}%"></span></span><span class="bar-val">${t.n}</span></div>`).join('');
  return `${table(rows, 'Elite university enrollment and destination Pell share compared with similar counties and the state')}
    <p class="fine">${fmtInt(d.elite_freshmen)} of ${fmtInt(d.freshmen)} in-state first-time freshmen (Fall 2024) from this county enrolled at UGA or Georgia Tech. ${d.elite_vs_peers_pp != null ? `That is ${fmtPP(d.elite_vs_peers_pp)} relative to economically similar counties.` : ''}${d.small ? ' Small number: interpret with caution.' : ''}</p>
    <h4 class="sub-h">Where this county’s USG freshmen enrolled</h4>
    <div class="bars">${top}</div>
    <p class="fine">Counts of freshmen. Pell share at each destination is shown on hover in the colleges layer. Covers the 26 USG public institutions only (no technical, private, or out-of-state colleges). The destination Pell share describes those colleges’ freshmen, not whether students from this county received Pell.</p>
    ${stateLine}`;
}

export function renderDetail(c: County, ds: Dataset, compareFips: string | null): string {
  const so = ds.stateOutcomes[c.state], sc = ds.stateContext[c.state];
  const pm = (get: (x: County) => number | null) => peerMean(c, ds.counties, get);
  const peersWeighted = (key: 'low_income' | 'non_low_income') => {
    let g = 0, e = 0;
    for (const f of c.peer.peers) { const r = ds.counties.get(f)!.out[key]; if (r?.value != null) { g += r.graduates ?? 0; e += r.enrolled ?? 0; } }
    return g ? e / g : null;
  };
  const it = interpret(c, ds);
  const flags = evaluateFlags(c, ds);
  const liGap = (x: { low_income: number | null; non_low_income: number | null }) => (x.low_income != null && x.non_low_income != null ? (x.non_low_income - x.low_income) * 100 : null);
  const cLi = c.out.low_income?.value ?? null, cNl = c.out.non_low_income?.value ?? null;
  const pLi = peersWeighted('low_income'), pNl = peersWeighted('non_low_income');

  const outcomes: Row[] = [
    { label: 'College-going rate', kind: 'observed', county: fmtProp(c.out.college_going?.value), peers: fmtProp(c.peer.expected), state: fmtProp(so.college_going), missing: !c.out.college_going },
    { label: `College-going: ${c.state === 'MA' ? 'low-income' : 'econ. disadvantaged'}`, kind: 'observed', county: fmtProp(cLi), peers: fmtProp(pLi), state: fmtProp(so.low_income), missing: cLi == null },
    { label: 'College-going: other graduates', kind: 'derived', county: fmtProp(cNl), peers: fmtProp(pNl), state: fmtProp(so.non_low_income), missing: cNl == null },
    { label: 'Income gap (points)', kind: 'derived', county: fmtPP(liGap({ low_income: cLi, non_low_income: cNl })), peers: fmtPP(liGap({ low_income: pLi, non_low_income: pNl })), state: fmtPP(liGap(so)), missing: cLi == null },
    { label: 'Graduates at four-year colleges', kind: 'observed', county: fmtProp(c.out.destinations?.four_year), peers: fmtProp(pm((x) => x.out.destinations?.four_year ?? null)), state: fmtProp(so.four_year), missing: c.out.destinations == null },
    { label: 'HS graduation rate (4-year)', kind: 'observed', county: fmtProp(c.out.grad_rate?.value), peers: fmtProp(pm((x) => x.out.grad_rate?.value ?? null)), state: fmtProp(so.grad_rate), missing: !c.out.grad_rate },
  ];
  const a = c.access;
  const context: Row[] = [
    { label: 'Poverty rate', kind: 'observed', county: fmtPct(c.ctx.poverty_rate), peers: fmtPct(pm((x) => x.ctx.poverty_rate)), state: fmtPct(sc.poverty_rate) },
    { label: 'Child poverty (0–17)', kind: 'observed', county: fmtPct(c.ctx.child_poverty_rate), peers: fmtPct(pm((x) => x.ctx.child_poverty_rate)), state: fmtPct(sc.child_poverty_rate) },
    { label: 'Median household income', kind: 'observed', county: fmtUSD(c.ctx.median_hh_income), peers: fmtUSD(pm((x) => x.ctx.median_hh_income)), state: fmtUSD(sc.median_hh_income) },
    { label: "Adults with bachelor's+", kind: 'observed', county: fmtPct(c.ctx.bachelors_pct), peers: fmtPct(pm((x) => x.ctx.bachelors_pct)), state: fmtPct(sc.bachelors_pct) },
    { label: 'Rurality (RUCC, 1–9)', kind: 'observed', county: c.ctx.rucc == null ? 'n/a' : String(c.ctx.rucc), peers: (pm((x) => x.ctx.rucc) ?? 0).toFixed(1), state: '—' },
    { label: 'Miles to public four-year', kind: 'derived', county: fmtMiles(a?.public_4yr.nearest_miles), peers: fmtMiles(pm((x) => x.access?.public_4yr.nearest_miles ?? null)), state: '—' },
    { label: 'Miles to public two-year', kind: 'derived', county: fmtMiles(a?.public_2yr.nearest_miles), peers: fmtMiles(pm((x) => x.access?.public_2yr.nearest_miles ?? null)), state: '—' },
    { label: 'Miles to selective college', kind: 'derived', county: fmtMiles(a?.selective.nearest_miles), peers: fmtMiles(pm((x) => x.access?.selective.nearest_miles ?? null)), state: '—' },
    { label: 'Four-year colleges ≤ 30 mi', kind: 'derived', county: fmtInt(a?.four_year.within_radius), peers: (pm((x) => x.access?.four_year.within_radius ?? null) ?? 0).toFixed(1), state: '—' },
  ];

  // Scatter charts within the state
  const stateCounties = [...ds.counties.values()].filter((x) => x.state === c.state && x.out.college_going?.value != null);
  const peerSet = new Set(c.peer.peers);
  const pts = (getX: (x: County) => number | null) => stateCounties.filter((x) => getX(x) != null).map((x) => ({
    x: getX(x)!, y: x.out.college_going!.value! * 100, label: x.label, highlight: x.fips === c.fips, peer: peerSet.has(x.fips),
  }));
  const charts = c.out.college_going ? `
    <div class="chart-grid">
      <figure><figcaption>College-going vs. poverty, ${esc(STATE_NAMES[c.state])} counties</figcaption>
      ${scatter(pts((x) => x.ctx.poverty_rate), { title: 'College-going rate versus poverty rate', xLabel: 'Poverty rate (%)', yLabel: 'College-going (%)', xFmt: (v) => `${v.toFixed(0)}%`, yFmt: (v) => `${v.toFixed(0)}%`, refY: so.college_going != null ? so.college_going * 100 : null, refLabel: 'state rate' })}</figure>
      <figure><figcaption>College-going vs. median household income</figcaption>
      ${scatter(pts((x) => x.ctx.median_hh_income), { title: 'College-going rate versus median household income', xLabel: 'Median household income', yLabel: 'College-going (%)', xFmt: (v) => `$${Math.round(v / 1000)}k`, yFmt: (v) => `${v.toFixed(0)}%`, refY: so.college_going != null ? so.college_going * 100 : null, refLabel: 'state rate' })}</figure>
    </div>
    <p class="fine"><span class="key-dot sel"></span> this county <span class="key-dot peer"></span> similar counties <span class="key-dot"></span> other counties. Each dot is a county; patterns are associations, not causes.</p>` : '';

  const d = c.out.destinations;
  const dest = d
    ? bars([
      { label: 'Public four-year', value: d.public_4yr, compare: null },
      { label: 'Private four-year', value: d.private_4yr },
      { label: 'Public two-year', value: d.public_2yr },
      { label: 'Private two-year', value: d.private_2yr },
      ...(c.state === 'MA' ? [
        { label: 'UMass campuses', value: d.umass ?? null },
        { label: 'MA state universities', value: d.ma_state_univ ?? null },
        { label: 'MA community colleges', value: d.ma_comm_coll ?? null },
      ] : []),
    ], { title: 'College destinations as share of all graduates', max: 0.6 }) + `<p class="fine">Share of all ${fmtInt(d.graduates)} graduates (not only those who enrolled). Categories within MA overlap the public totals.</p>`
    : `<p class="unavailable">${c.state === 'GA' ? 'GOSA’s public files report whether graduates enrolled, not whether they enrolled at two-year or four-year colleges. A destination breakdown would require a data request (e.g., GA•AWARDS).' : 'Destination detail is suppressed for this county’s schools.'}</p>`;

  // Institutional Pell context near the county
  let nearby: { i: typeof ds.institutions[number]; d: number }[] = [];
  if (c.ctx.pop_center) {
    nearby = ds.institutions.map((i) => ({ i, d: miles(c.ctx.pop_center!, [i.lon, i.lat]) })).filter((x) => x.d <= 30).sort((x, y) => (y.i.undergrads ?? 0) - (x.i.undergrads ?? 0));
  }
  const withRates = nearby.filter((x) => x.i.pell_grad && (x.i.pell_grad.pell_rate != null || x.i.pell_grad.nonpell_rate != null)).slice(0, 6);
  const ugSum = nearby.reduce((s, x) => s + (x.i.pell_pct_undergrad != null ? x.i.undergrads ?? 0 : 0), 0);
  const pellW = ugSum ? nearby.reduce((s, x) => s + (x.i.pell_pct_undergrad != null ? (x.i.undergrads ?? 0) * x.i.pell_pct_undergrad : 0), 0) / ugSum : null;
  const pell = `
    <div class="callout">These figures describe students <em>enrolled at</em> nearby institutions, from anywhere. They are not the share of this county’s students who receive Pell Grants or enroll in college.</div>
    <p>${nearby.length} degree-granting colleges within 30 miles of the population center${nearby.length ? `; across them, ${fmtPct(pellW, 0)} of undergraduates were awarded Pell Grants in 2022–23 (enrollment-weighted).` : '.'}</p>
    ${pairedBars(withRates.map((x) => ({ label: x.i.name, sub: `${fmtMiles(x.d)} · ${x.i.pell_pct_undergrad ?? '—'}% Pell`, a: x.i.pell_grad!.pell_rate, b: x.i.pell_grad!.nonpell_rate })), { title: 'Completion rates of Pell recipients versus other students at nearby colleges', aLabel: 'Pell recipients', bLabel: 'Other students' })}
    <p class="fine">Completion within 150% of normal time for full-time, first-time entrants (IPEDS GR2023_PELL_SSL). Rates for groups under 30 students are withheld.</p>`;

  // Cross-state comparison
  const all = [...ds.counties.values()];
  const other: StateAbbr = c.state === 'MA' ? 'GA' : 'MA';
  const suggested = mostSimilarElsewhere(c, all);
  const cmp = compareFips ? ds.counties.get(compareFips) : suggested;
  const opts = all.filter((x) => x.state === other).sort((x, y) => x.name.localeCompare(y.name))
    .map((x) => `<option value="${x.fips}"${x.fips === cmp?.fips ? ' selected' : ''}>${esc(x.name)}${x.fips === suggested?.fips ? ' (most similar)' : ''}</option>`).join('');
  const cmpRow = (label: string, f: (x: County) => string) => `<tr><th scope="row">${esc(label)}</th><td>${f(c)}</td><td>${cmp ? f(cmp) : '—'}</td></tr>`;
  const cross = `
    <label class="field"><span>Compare with a ${esc(STATE_NAMES[other])} county</span><select id="compare-select">${opts}</select></label>
    <table class="cmp"><thead><tr><th></th><th scope="col">${esc(c.name)}</th><th scope="col">${esc(cmp?.name ?? '—')}</th></tr></thead><tbody>
      ${cmpRow('Poverty rate', (x) => fmtPct(x.ctx.poverty_rate))}
      ${cmpRow('Median household income', (x) => fmtUSD(x.ctx.median_hh_income))}
      ${cmpRow("Adults with bachelor's+", (x) => fmtPct(x.ctx.bachelors_pct))}
      ${cmpRow('Rurality (RUCC)', (x) => String(x.ctx.rucc ?? 'n/a'))}
      ${cmpRow('College-going rate', (x) => fmtProp(x.out.college_going?.value))}
      ${cmpRow('… vs. own state', (x) => { const v = x.out.college_going?.value, s = ds.stateOutcomes[x.state].college_going; return v == null || s == null ? 'n/a' : fmtPP((v - s) * 100); })}
      ${cmpRow('… vs. similar counties', (x) => fmtPP(x.peer.gap_pp))}
      ${cmpRow('Low-income college-going', (x) => fmtProp(x.out.low_income?.value))}
      ${cmpRow('Miles to public four-year', (x) => fmtMiles(x.access?.public_4yr.nearest_miles))}
    </tbody></table>
    <p class="fine">Cross-state comparisons are approximate: the states use different low-income definitions, graduating classes (MA 2024, GA 2023), and reporting systems. “Vs. own state” differences are more comparable than raw rates.</p>`;

  const srcIds = new Set<string>(['ers_poverty', 'ers_education', 'ers_rucc', 'ers_population', 'nces_ccd', 'ipeds_hd', 'ipeds_sfa', 'ipeds_gr_pell', 'census_cenpop',
    ...(c.state === 'MA' ? ['ma_dese_college', 'ma_dese_grad'] : ['ga_gosa_c11', 'ga_gosa_grad'])]);

  return `
  <header class="detail-head">
    <p class="eyebrow">${esc(STATE_NAMES[c.state])} · FIPS ${c.fips}</p>
    <h2 id="detail-title" tabindex="-1">${esc(c.name)}</h2>
    <p class="muted">Population ${fmtInt(c.ctx.population)} (2023) · ${esc(c.ctx.rucc_desc ?? 'Rurality n/a')}</p>
    <p class="flagline">Screening criteria met: <strong>${flags.met}</strong> of ${flags.assessed} assessable <a href="#support" class="link">what’s this?</a></p>
  </header>

  <section class="d-sec" aria-labelledby="h-read">
    <h3 id="h-read">Reading this county</h3>
    <div class="q"><h4><span class="qnum">1</span> What is the observed disparity? <span class="tag tag-observation">data-supported observation</span></h4><ul>${it.observed.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
    <div class="q"><h4><span class="qnum">2</span> What factors may be associated with it? <span class="tag tag-hypothesis">measured differences &amp; hypotheses</span></h4><ul>${it.factors.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
    <div class="q"><h4><span class="qnum">3</span> What should a nonprofit investigate next? <span class="tag tag-next">suggested next steps</span></h4><ul>${it.next.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
    ${it.reliability.length ? `<details class="reliab"><summary>Reliability notes (${it.reliability.length})</summary><ul>${it.reliability.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
  </section>

  <section class="d-sec" aria-labelledby="h-comp"><h3 id="h-comp">Data completeness</h3>${completeness(c, ds)}</section>

  <section class="d-sec" aria-labelledby="h-out"><h3 id="h-out">College access outcomes</h3>
    <p class="fine">${esc(ds.years[c.state].college_going)} · ${esc(so.low_income_label)}</p>
    ${table(outcomes, 'College access outcomes compared with similar counties and the state')}
    <p class="fine">Similar counties: ${c.peer.peers.map((f) => `<button class="chip" data-select="${f}">${esc(ds.counties.get(f)!.name.replace(' County', ''))}</button>`).join(' ') || 'n/a'}. Peers are matched on poverty, income, adult education, and rurality within ${esc(STATE_NAMES[c.state])}; peer college-going rates are graduate-weighted.</p>
  </section>

  <section class="d-sec" aria-labelledby="h-ctx"><h3 id="h-ctx">Economic and geographic context</h3>
    ${table(context, 'Economic and geographic context compared with similar counties and the state')}
    <p class="fine">Distances are straight-line miles from the 2020 population center to colleges in any state. Peer values are simple averages across peer counties.</p>
    ${charts}
  </section>

  <section class="d-sec" aria-labelledby="h-dest"><h3 id="h-dest">Where graduates enrolled</h3>${dest}</section>

  <section class="d-sec" aria-labelledby="h-elite"><h3 id="h-elite">Elite universities &amp; Pell at destination colleges</h3>${eliteSection(c, ds)}</section>

  <section class="d-sec" aria-labelledby="h-pell"><h3 id="h-pell">Pell Grant context at nearby colleges</h3>${pell}</section>

  <section class="d-sec" aria-labelledby="h-flags"><h3 id="h-flags">Screening criteria</h3>
    <ul class="flaglist">${flags.results.map((r) => `<li class="fl fl-${r.met === null ? 'na' : r.met ? 'yes' : 'no'}"><span class="fl-mark" aria-hidden="true">${r.met === null ? '–' : r.met ? '●' : '○'}</span><span><strong>${esc(r.def.label)}</strong>: ${r.met === null ? 'not assessable' : r.met ? 'met' : 'not met'}<br><span class="muted">${esc(r.text)}</span></span></li>`).join('')}</ul>
  </section>

  <section class="d-sec" aria-labelledby="h-x"><h3 id="h-x">Compare across states</h3>${cross}</section>

  <section class="d-sec" aria-labelledby="h-src"><h3 id="h-src">Sources</h3>
    <ul class="srcs">${[...srcIds].map((id) => ds.sources[id]).filter(Boolean).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> <span class="muted">(${esc(s.year)})</span></li>`).join('')}</ul>
  </section>`;
}
