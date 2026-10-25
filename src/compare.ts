// Georgia vs. Maryland: 2 x 2 county maps (income, destination Pell share) on one screen.
// Reads public/data/compare.json and geo/compare_counties.geojson (scripts/build-compare.mjs).
import './compare.css';
import type maplibregl from 'maplibre-gl';
import { loadEngine } from './map/engine';
import { esc, fmtInt, fmtPct, fmtUSD } from './util/format';

type St = 'GA' | 'MD';
const STATES: St[] = ['GA', 'MD'];
const NAMES: Record<St, string> = { GA: 'Georgia', MD: 'Maryland' };

interface CountyRec {
  fips: string; name: string; state: St; income: number | null; poverty: number | null;
  pell_dest: number | null; freshmen: number | null; top20_freshmen: number | null;
  top: { name: string; n: number; pell: number | null }[];
}
interface StateRec {
  income: number | null; recent_grad_freshmen: number; top20_freshmen: number; top20_share: number;
  pell_at_top20: number; pell_at_all: number; top_schools: { name: string; rank: string; n: number; pell: number | null }[];
}
interface Compare {
  meta: { income: { source: string; year: number }; pell: { definition: string; GA: string; MD: string; min_freshmen: number }; top20: { definition: string }; caution: string };
  states: Record<St, StateRec>;
  counties: Record<string, CountyRec>;
}

// One scale per row, shared by both states, so a color means the same value in GA and MD.
const SCALES = {
  income: {
    breaks: [55000, 65000, 75000, 90000, 110000],
    colors: ['#7c0f0c', '#bb2c1a', '#e4592f', '#f9914f', '#fcbf7f', '#fde7c4'], // darker = lower income
    label: (lo: number | null, hi: number | null) => (lo == null ? `< $${hi! / 1000}k` : hi == null ? `≥ $${lo / 1000}k` : `$${lo / 1000}k – ${hi / 1000}k`),
    get: (c: CountyRec) => c.income,
  },
  pell: {
    breaks: [27, 31, 35, 40, 50],
    colors: ['#e8e2fb', '#c6b8f3', '#a28ee8', '#7f63d8', '#5b3fb8', '#381f86'], // darker = higher Pell share
    label: (lo: number | null, hi: number | null) => (lo == null ? `< ${hi}%` : hi == null ? `≥ ${lo}%` : `${lo} – ${hi}%`),
    get: (c: CountyRec) => c.pell_dest,
  },
};
type Metric = keyof typeof SCALES;
const MISSING = '#3a3b3f';

const colorFor = (m: Metric, v: number | null) => {
  if (v == null) return MISSING;
  const s = SCALES[m];
  let i = 0;
  while (i < s.breaks.length && v >= s.breaks[i]) i++;
  return s.colors[i];
};

function legend(m: Metric) {
  const s = SCALES[m];
  const items = s.colors.map((c, i) => `<li><span class="sw" style="background:${c}"></span>${esc(s.label(i ? s.breaks[i - 1] : null, i < s.breaks.length ? s.breaks[i] : null))}</li>`).join('');
  return `<ul>${items}<li><span class="sw sw-na"></span>No data</li></ul>`;
}

function header(d: Compare, st: St) {
  const s = d.states[st];
  return `<h2>${NAMES[st]}</h2>
    <dl class="cp-stats">
      <div><dt>Median household income</dt><dd>${fmtUSD(s.income)}</dd></div>
      <div><dt>Freshmen at a top-20 university</dt><dd>${fmtPct(s.top20_share * 100)}</dd></div>
      <div><dt>Pell share: top-20 vs. all colleges</dt><dd>${fmtPct(s.pell_at_top20)} <span class="vs">vs.</span> ${fmtPct(s.pell_at_all)}</dd></div>
    </dl>
    <p class="cp-fine">${fmtInt(s.top20_freshmen)} of ${fmtInt(s.recent_grad_freshmen)} recent-graduate freshmen from ${NAMES[st]} (fall 2022) · top: ${s.top_schools.slice(0, 3).map((x) => esc(x.name)).join(', ')}</p>`;
}

function tooltip(c: CountyRec) {
  const top = c.top.slice(0, 3).map((t) => `<li>${esc(t.name)} <span class="muted">${t.n} · ${t.pell ?? '—'}% Pell</span></li>`).join('');
  const small = c.freshmen != null && c.freshmen < 30 ? '<p class="warn">Small number of freshmen; interpret with caution.</p>' : '';
  return `<p class="tt-name">${esc(c.name)}, ${c.state}</p>
    <dl>
      <dt>Median household income</dt><dd>${fmtUSD(c.income)}</dd>
      <dt>Poverty rate</dt><dd>${fmtPct(c.poverty)}</dd>
      <dt>Pell share at colleges attended</dt><dd>${c.pell_dest == null ? '<span class="warn">No data</span>' : fmtPct(c.pell_dest)}</dd>
      <dt>Freshmen counted</dt><dd>${fmtInt(c.freshmen)}</dd>
      ${c.state === 'MD' ? `<dt>At Johns Hopkins (top 20)</dt><dd>${fmtInt(c.top20_freshmen)}</dd>` : ''}
    </dl>
    ${top ? `<p class="tt-sub">Top destinations</p><ul>${top}</ul>` : ''}
    ${small}
    <p class="tt-foot">${c.state === 'GA' ? 'USG public colleges, Fall 2024' : 'MD four-year colleges, Fall 2025'} · Income SAIPE 2023</p>`;
}

function bbox(features: GeoJSON.Feature[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') { const [x, y] = c as number[]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    else (c as unknown[]).forEach(walk);
  };
  features.forEach((f) => walk((f.geometry as GeoJSON.Polygon).coordinates));
  return [x0, y0, x1, y1];
}

async function main() {
  const status = document.getElementById('cp-status')!;
  try {
    const [engine, d, geo] = await Promise.all([
      loadEngine(),
      fetch('/data/compare.json').then((r) => { if (!r.ok) throw new Error('compare.json not found. Run "node scripts/build-compare.mjs".'); return r.json() as Promise<Compare>; }),
      fetch('/data/geo/compare_counties.geojson').then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
    ]);
    STATES.forEach((st) => (document.getElementById(`head-${st}`)!.innerHTML = header(d, st)));
    document.getElementById('legend-income')!.innerHTML = legend('income');
    document.getElementById('legend-pell')!.innerHTML = legend('pell');
    document.getElementById('cp-foot')!.innerHTML = `
      <p><strong>Pell share at colleges attended.</strong> ${esc(d.meta.pell.definition)}</p>
      <p>${esc(d.meta.pell.GA)}</p><p>${esc(d.meta.pell.MD)}</p>
      <p><strong>Top 20.</strong> ${esc(d.meta.top20.definition)}</p>
      <p><strong>Income.</strong> ${esc(d.meta.income.source)}, ${d.meta.income.year}.</p>
      <p class="cp-caution">${esc(d.meta.caution)} Grey counties have too few freshmen (under ${d.meta.pell.min_freshmen}) to report, not zero.</p>`;

    const tip = document.getElementById('cp-tip')!;
    const maps: maplibregl.Map[] = [];
    for (const m of ['income', 'pell'] as Metric[]) {
      for (const st of STATES) {
        const feats = geo.features.filter((f) => f.properties?.state === st).map((f) => {
          const c = d.counties[f.properties!.fips];
          return { ...f, properties: { ...f.properties, color: colorFor(m, SCALES[m].get(c)) } };
        });
        const map = new engine.lib.Map({
          container: `map-${m}-${st}`, style: engine.style, bounds: bbox(feats), fitBoundsOptions: { padding: 16 },
          attributionControl: false, dragRotate: false, pitchWithRotate: false,
        });
        map.addControl(new engine.lib.AttributionControl({ compact: true, customAttribution: 'U.S. Census Bureau' }), 'bottom-right');
        maps.push(map);
        const init = () => {
          map.addSource('c', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
          map.addLayer({ id: 'fill', type: 'fill', source: 'c', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.92 } });
          map.addLayer({ id: 'line', type: 'line', source: 'c', paint: { 'line-color': '#f4efe6', 'line-opacity': 0.3, 'line-width': st === 'MD' ? 0.9 : 0.4 } });
          map.addLayer({ id: 'hover', type: 'line', source: 'c', paint: { 'line-color': '#fff', 'line-width': ['case', ['boolean', ['feature-state', 'h'], false], 2, 0] } });
          let hid: number | null = null;
          map.on('mousemove', 'fill', (e) => {
            const f = e.features?.[0];
            if (!f) return;
            if (hid != null) map.setFeatureState({ source: 'c', id: hid }, { h: false });
            hid = Number(f.id); map.setFeatureState({ source: 'c', id: hid }, { h: true });
            map.getCanvas().style.cursor = 'pointer';
            tip.innerHTML = tooltip(d.counties[String(f.properties.fips)]);
            tip.hidden = false;
            const r = map.getContainer().getBoundingClientRect();
            const x = r.left + e.point.x, y = r.top + e.point.y, w = tip.offsetWidth, h = tip.offsetHeight;
            tip.style.transform = `translate(${x + 14 + w > innerWidth ? x - w - 14 : x + 14}px, ${Math.max(8, Math.min(innerHeight - h - 8, y - h / 2))}px)`;
          });
          map.on('mouseleave', 'fill', () => { if (hid != null) map.setFeatureState({ source: 'c', id: hid }, { h: false }); hid = null; tip.hidden = true; map.getCanvas().style.cursor = ''; });
        };
        if (map.isStyleLoaded()) init(); else map.once('style.load', init);
      }
    }
    new ResizeObserver(() => maps.forEach((m) => m.resize())).observe(document.getElementById('main')!);
    status.hidden = true;
  } catch (e) {
    status.textContent = `Could not load: ${(e as Error).message}`;
    status.classList.add('err');
  }
}
main();
