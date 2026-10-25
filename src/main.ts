import './styles.css';
import { loadDataset } from './data/load';
import { loadEngine } from './map/engine';
import { StatePanel, PELL_BINS, type CountyStyle } from './map/statePanel';
import { buildScale, MISSING_COLOR, type Scale } from './map/scale';
import { availability, bindMetrics, MENU_METRICS, metricById, RURALITY_GROUPS, type MetricDef } from './config/metrics';
import { renderDetail } from './ui/detail';
import { SupportView } from './ui/support';
import { renderMethods } from './ui/methods';
import { renderPellElite } from './ui/pellElite';
import { renderTop50 } from './ui/top50';
import { STATE_NAMES, type County, type Dataset, type StateAbbr } from './types';
import { esc, fmtProp } from './util/format';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const STATES: StateAbbr[] = ['MA', 'GA'];

interface AppState {
  metric: string;
  view: 'both' | StateAbbr;
  rural: string;
  econ: 'all' | 'above' | 'not_above';
  selected: string | null;
  compare: string | null;
  colleges: boolean;
  selectiveOnly: boolean;
  extrude: boolean;
  markBelow: boolean;
}

const state: AppState = {
  metric: 'college_going', view: 'both', rural: 'all', econ: 'all', selected: null, compare: null,
  colleges: false, selectiveOnly: false, extrude: false, markBelow: false,
};

let ds: Dataset;
let panels: Record<StateAbbr, StatePanel>;
let scale: Scale | null = null;

function setStatus(msg: string | null, isError = false) {
  const el = $('#status');
  el.hidden = !msg;
  el.textContent = msg ?? '';
  el.classList.toggle('error', isError);
}

// ------------------------------------------------------------------ filters
function econAbove(c: County) {
  const lo = c.ctx.poverty_rate_ci[0], s = ds.stateContext[c.state].poverty_rate;
  return lo != null && s != null && lo > s;
}
function passesFilters(c: County) {
  if (state.rural !== 'all' && !RURALITY_GROUPS.find((g) => g.id === state.rural)!.test(c.ctx.rucc)) return false;
  if (state.econ === 'above' && !econAbove(c)) return false;
  if (state.econ === 'not_above' && econAbove(c)) return false;
  return true;
}

// ------------------------------------------------------------------ rendering
function currentMetric(): MetricDef { return metricById(state.metric); }

async function renderMaps() {
  const m = currentMetric();
  const all = [...ds.counties.values()];
  scale = buildScale(m, all); // shared across both states
  const n = scale?.bins.length ?? 1;
  const styles = new Map<string, CountyStyle>();
  for (const c of all) {
    const v = m.get(c);
    const cls = scale ? scale.classOf(v) : -1;
    styles.set(c.fips, {
      color: scale?.colorFor(v) ?? null,
      dim: !passesFilters(c),
      height: cls < 0 ? 0 : ((cls + 1) / n) * (c.state === 'MA' ? 22000 : 38000),
      below: (c.peer.gap_pp ?? 0) <= -3,
    });
  }
  await Promise.all(STATES.map((s) => panels[s].render(styles, { extrude: state.extrude, markBelow: state.markBelow })));
  const inst = state.colleges ? ds.institutions.filter((i) => !state.selectiveOnly || i.more_selective) : null;
  STATES.forEach((s) => panels[s].setColleges(inst));
  renderLegend(m);
  renderCaptions(m);
  renderMetricInfo(m);
}

function renderCaptions(m: MetricDef) {
  const avail = availability(m, ds);
  for (const s of STATES) {
    const bench = m.benchmark?.(ds, s);
    const counties = [...ds.counties.values()].filter((c) => c.state === s);
    const missing = counties.filter((c) => m.get(c) == null).length;
    $(`#cap-${s}`).innerHTML = `<span class="cap-state">${STATE_NAMES[s]}</span>
      <span class="cap-meta">${avail[s] ? `${esc(m.year(ds, s))}${bench != null ? ` · state ${esc(m.format(bench))}` : ''}${missing ? ` · ${missing} of ${counties.length} counties without data` : ''}` : '<span class="cap-na">Not available for this state</span>'}</span>`;
    $(`#panel-${s}`).classList.toggle('is-unavailable', !avail[s]);
  }
}

function renderLegend(m: MetricDef) {
  const el = $('#legend');
  if (!scale) { el.innerHTML = `<p class="legend-title">${esc(m.label)}</p><p class="muted small">No valid observations in either state.</p>`; return; }
  const items = scale.bins.map((b) => `<li><span class="sw" style="background:${b.color}"></span>${esc(b.label)}</li>`).join('');
  const unit = m.scale === 'div' ? 'percentage points' : m.id.startsWith('dist') ? 'miles' : m.id === 'income' ? 'dollars' : m.scale === 'ord' ? 'RUCC code' : m.id === 'near_4yr' ? 'institutions' : 'percent';
  el.innerHTML = `<p class="legend-title">${esc(m.label)}</p>
    <p class="legend-unit">${esc(unit)} · same scale in both states</p>
    <ul class="legend-bins">${items}<li><span class="sw sw-missing" style="background:${MISSING_COLOR}"></span>No data</li></ul>
    ${state.colleges ? `<p class="legend-title sub">Colleges: % undergraduates with Pell</p><ul class="legend-bins dots">${PELL_BINS.map((b) => `<li><span class="sw round" style="background:${b.color}"></span>${b.label}</li>`).join('')}<li><span class="sw round ring"></span>Most selective (elite)</li></ul><p class="fine">Size = undergraduate enrollment. Institutional data, not county-of-origin.</p>` : ''}
    ${state.markBelow ? '<p class="fine"><span class="sw dash"></span> ≥ 3 pts below similar counties</p>' : ''}
    <p class="fine">${esc(m.legendNote)}</p>`;
}

function renderMetricInfo(m: MetricDef) {
  const avail = availability(m, ds);
  const why = (s: StateAbbr) => m.unavailable?.[s] ?? m.unavailable?.all;
  const notes = STATES.filter((s) => !avail[s] && why(s)).map((s) => `<p class="unavailable"><strong>${STATE_NAMES[s]}:</strong> ${esc(why(s)!)}</p>`).join('');
  $('#metric-info').innerHTML = `<p><span class="tag tag-${m.kind}">${m.kind}</span> ${esc(m.definition)}</p>${notes}`;
}

function renderStory() {
  const so = ds.stateOutcomes;
  const below = (s: StateAbbr) => [...ds.counties.values()].filter((c) => c.state === s && (c.peer.gap_pp ?? 0) <= -3).length;
  const gap = (s: StateAbbr) => ((so[s].non_low_income! - so[s].low_income!) * 100).toFixed(0);
  $('#story').innerHTML = `
    <p class="eyebrow">Geographic opportunity map</p>
    <p class="intro">A student’s chances of enrolling in college can be associated with the community around them: local economic conditions, how many adults hold degrees, how far the nearest campus is, family finances, and access to advising.</p>
    <ul class="facts">
      <li><strong>${fmtProp(so.MA.college_going, 0)}</strong> of Massachusetts and <strong>${fmtProp(so.GA.college_going, 0)}</strong> of Georgia public high school graduates enrolled in college within 16 months.</li>
      <li>Low-income graduates enrolled at rates <strong>${gap('MA')}</strong> (MA) and <strong>${gap('GA')}</strong> (GA) points below other graduates.</li>
      <li><strong>${below('GA')}</strong> Georgia and <strong>${below('MA')}</strong> Massachusetts counties are at least 3 points below counties with similar economic and geographic conditions.</li>
    </ul>
    <p class="fine">Hover a county for its values, or click it for a full profile. Hatched = no data, never zero.</p>`;
}

// ------------------------------------------------------------------ tooltip
function showTooltip(fips: string | null, at?: { x: number; y: number }) {
  const tt = $('#tooltip');
  if (!fips || !at) { tt.hidden = true; return; }
  const c = ds.counties.get(fips)!;
  const m = currentMetric();
  const v = m.get(c);
  const bench = m.benchmark?.(ds, c.state);
  const cg = c.out.college_going;
  const popLine = m.group === 'Educational outcomes' && cg ? `${cg.graduates?.toLocaleString()} graduates represented` : `Population ${c.ctx.population?.toLocaleString() ?? 'n/a'}`;
  let cmp = '';
  if (v != null && bench != null && m.scale !== 'div') {
    const d = v - bench;
    const unit = m.id === 'income' ? '' : m.id === 'li_gap' ? ' pts' : ' pts';
    cmp = m.id === 'income' ? `${d >= 0 ? '+' : '−'}$${Math.abs(Math.round(d)).toLocaleString()} vs. state` : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}${unit} vs. state (${m.format(bench)})`;
  }
  const detail = v != null ? m.detail?.(c, ds) : null;
  const missingNote = v == null ? (m.unavailable?.[c.state] ?? m.unavailable?.all ?? c.out.notes[0] ?? 'Not reported or suppressed for this county. Not zero.') : '';
  const relNote = v != null && m.group === 'Educational outcomes' ? (c.out.notes[0] ?? ((cg?.graduates ?? 999) < 150 ? 'Small graduating class; rates vary year to year.' : '')) : '';
  const srcs = m.sources(c.state).map((id) => ds.sources[id]?.name.split(',')[0].split('(')[0].trim()).filter(Boolean);
  tt.innerHTML = `<p class="tt-name">${esc(c.label)}</p>
    <p class="tt-metric">${esc(m.label)}</p>
    <p class="tt-val">${v == null ? '<span class="na">No data</span>' : esc(m.format(v))} <span class="tag tag-${m.kind}">${m.kind}</span></p>
    ${cmp ? `<p class="tt-cmp">${esc(cmp)}</p>` : ''}
    ${detail ? `<p class="tt-detail">${esc(detail)}</p>` : ''}
    ${missingNote ? `<p class="tt-warn">${esc(missingNote)}</p>` : ''}
    ${relNote ? `<p class="tt-warn">${esc(relNote)}</p>` : ''}
    <p class="tt-foot">${esc(popLine)} · ${esc(m.year(ds, c.state))}<br>${esc([...new Set(srcs)].join('; '))}</p>
    <p class="tt-hint">Click for county profile</p>`;
  tt.hidden = false;
  const w = tt.offsetWidth, h = tt.offsetHeight;
  const x = at.x + 16 + w > window.innerWidth ? at.x - w - 16 : at.x + 16;
  const y = Math.min(window.innerHeight - h - 8, Math.max(8, at.y - h / 2));
  tt.style.transform = `translate(${x}px, ${y}px)`;
}

// ------------------------------------------------------------------ detail panel
function select(fips: string | null, opts: { fly?: boolean } = {}) {
  state.selected = fips;
  if (fips && state.compare && ds.counties.get(state.compare)?.state === ds.counties.get(fips)?.state) state.compare = null;
  STATES.forEach((s) => panels[s].setSelected(fips));
  const panel = $('#detail');
  if (!fips) { panel.hidden = true; document.body.classList.remove('has-detail'); return; }
  const c = ds.counties.get(fips)!;
  $('#detail-body').innerHTML = renderDetail(c, ds, state.compare);
  panel.hidden = false;
  panel.scrollTop = 0;
  document.body.classList.add('has-detail');
  if (state.view !== 'both' && state.view !== c.state) setView(c.state);
  if (opts.fly) panels[c.state].flyTo(fips);
  $('#detail-title').focus({ preventScroll: true });
  if (location.hash !== '#explore' && opts.fly) document.getElementById('explore')!.scrollIntoView({ behavior: 'smooth' });
}

function setView(v: AppState['view']) {
  state.view = v;
  $('#maps').dataset.view = v;
  (document.querySelector(`input[name="view"][value="${v}"]`) as HTMLInputElement).checked = true;
  requestAnimationFrame(() => STATES.forEach((s) => panels[s].fit()));
}

// ------------------------------------------------------------------ controls
function buildControls() {
  const groups = [...new Set(MENU_METRICS.map((m) => m.group))];
  $('#metric').innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">${MENU_METRICS.filter((m) => m.group === g).map((m) => {
    const a = availability(m, ds);
    const none = !a.MA && !a.GA;
    const suffix = none ? ' — not available' : !a.GA ? ' (MA only)' : !a.MA ? ' (GA only)' : '';
    return `<option value="${m.id}" ${none ? 'disabled' : ''} ${m.id === state.metric ? 'selected' : ''}>${esc(m.label + suffix)}</option>`;
  }).join('')}</optgroup>`).join('');
  $('#metric').addEventListener('change', (e) => { state.metric = (e.target as HTMLSelectElement).value; renderMaps(); });

  $('#f-rural').innerHTML += RURALITY_GROUPS.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
  $('#f-rural').addEventListener('change', (e) => { state.rural = (e.target as HTMLSelectElement).value; renderMaps(); });
  $('#f-econ').addEventListener('change', (e) => { state.econ = (e.target as HTMLSelectElement).value as AppState['econ']; renderMaps(); });

  document.querySelectorAll<HTMLInputElement>('input[name="view"]').forEach((r) => r.addEventListener('change', () => setView(r.value as AppState['view'])));

  const sorted = [...ds.counties.values()].sort((a, b) => a.label.localeCompare(b.label));
  $('#county-list').innerHTML = sorted.map((c) => `<option value="${esc(c.label)}"></option>`).join('');
  const search = $<HTMLInputElement>('#search');
  const trySelect = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const hit = sorted.find((c) => c.label.toLowerCase() === q) ?? sorted.find((c) => c.label.toLowerCase().startsWith(q)) ?? sorted.find((c) => c.label.toLowerCase().includes(q));
    if (hit) { search.value = hit.label; select(hit.fips, { fly: true }); }
  };
  search.addEventListener('change', trySelect);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySelect(); });

  const toggle = (id: string, key: 'colleges' | 'selectiveOnly' | 'extrude' | 'markBelow') =>
    $(id).addEventListener('change', (e) => {
      state[key] = (e.target as HTMLInputElement).checked;
      if (key === 'colleges') $<HTMLInputElement>('#l-selective').disabled = !state.colleges;
      renderMaps();
    });
  toggle('#l-colleges', 'colleges'); toggle('#l-selective', 'selectiveOnly'); toggle('#l-3d', 'extrude'); toggle('#l-below', 'markBelow');

  $('#detail-close').addEventListener('click', () => select(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selected) select(null); });
  $('#detail').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-select]');
    if (b) select(b.dataset.select!, { fly: true });
  });
  $('#detail').addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.id === 'compare-select') { state.compare = t.value; const y = $('#detail').scrollTop; select(state.selected); $('#detail').scrollTop = y; }
  });
}

// ------------------------------------------------------------------ boot
async function main() {
  try {
    const [engine, data] = await Promise.all([loadEngine(), loadDataset()]);
    ds = data;
    bindMetrics(ds);
    setStatus('Drawing county boundaries…');
    panels = {
      MA: new StatePanel(engine, $('#map-MA'), 'MA', ds.geo, { onHover: showTooltip, onSelect: (f) => select(f) }),
      GA: new StatePanel(engine, $('#map-GA'), 'GA', ds.geo, { onHover: showTooltip, onSelect: (f) => select(f) }),
    };
    buildControls();
    renderStory();
    await renderMaps();
    new SupportView($('#support-root'), ds, (f) => select(f, { fly: true }));
    $('#pell-elite-root').innerHTML = renderPellElite(ds);
    $('#top50-root').innerHTML = renderTop50(ds);
    $('#methods-root').innerHTML = renderMethods(ds);
    $('#build-info').textContent = `Map: ${engine.kind === 'mapbox' ? 'Mapbox GL JS' : 'MapLibre GL JS'}, basemap ${engine.basemapLabel}.`;
    setStatus(null);
  } catch (err) {
    console.error(err);
    setStatus(`The visualization could not load: ${(err as Error).message}`, true);
  }
}
main();
