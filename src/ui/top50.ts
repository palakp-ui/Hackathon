// "Where Each State Sends Students in the U.S. News Top 50" (state level, national destinations).
import type { Dataset, StateAbbr } from '../types';
import { STATE_NAMES } from '../types';
import { esc, fmtInt, fmtPct, fmtProp } from '../util/format';

const STATES: StateAbbr[] = ['MA', 'GA'];

function summary(ds: Dataset, st: StateAbbr): string {
  const s = ds.top50!.states[st];
  const uga = s.schools.find((x) => x.added);
  return `<article class="pe-card" aria-labelledby="t50-${st}">
    <h3 id="t50-${st}">${esc(STATE_NAMES[st])}</h3>
    <p class="t50-big"><strong>${fmtProp(s.top50_share)}</strong> of recent high school graduates who started college enrolled at a top-50 university (incl. UGA)</p>
    <ul class="t50-facts">
      <li>${fmtInt(s.top50_freshmen)} of ${fmtInt(s.recent_grad_freshmen)} first-time freshmen from ${esc(STATE_NAMES[st])}</li>
      <li>Strict top 50 only (without UGA): ${fmtProp(s.strict_top50_share)}${uga ? ` · UGA enrolled ${fmtInt(uga.freshmen)}` : ''}</li>
      <li>${fmtInt(s.in_state_top50_freshmen)} stayed in ${esc(STATE_NAMES[st])}; ${fmtInt(s.top50_freshmen - s.in_state_top50_freshmen)} went out of state</li>
      <li>${fmtInt(s.private_top50_freshmen)} at private and ${fmtInt(s.top50_freshmen - s.private_top50_freshmen)} at public universities</li>
    </ul>
    <div class="pe-bar"><div class="pe-bar-label"><span>Pell share at the top-50 schools they attend</span><strong>${fmtPct(s.pell_at_top50)}</strong></div>
      <div class="pe-track"><span class="pe-fill pe-elite" style="width:${(s.pell_at_top50 / 50) * 100}%"></span></div></div>
    <div class="pe-bar"><div class="pe-bar-label"><span>Pell share at all colleges they attend</span><strong>${fmtPct(s.pell_at_all_destinations)}</strong></div>
      <div class="pe-track"><span class="pe-fill pe-all" style="width:${(s.pell_at_all_destinations / 50) * 100}%"></span></div>
      <p class="fine">Enrollment-weighted share of first-time, full-time freshmen with Pell at each destination.</p></div>
  </article>`;
}

function list(ds: Dataset, st: StateAbbr): string {
  const s = ds.top50!.states[st];
  const sent = s.schools.filter((x) => x.freshmen > 0);
  const max = Math.max(...sent.map((x) => x.freshmen));
  const none = s.schools.filter((x) => x.freshmen === 0);
  const rows = sent.map((x) => `<li class="t50-row">
      <span class="t50-rank">${esc(x.rank)}</span>
      <span class="pe-name">${esc(x.name)}${x.added ? ' <span class="tag tag-elite">added</span>' : ''}<span class="muted"> · ${esc(x.state)} · ${esc(x.control)}</span></span>
      <span class="pe-track"><span class="pe-fill ${x.in_state ? 'pe-all' : 'pe-elite'}" style="width:${(x.freshmen / max) * 100}%"></span></span>
      <span class="pe-val">${fmtInt(x.freshmen)}</span>
      <span class="t50-pell" title="Share of this university's first-time full-time freshmen receiving Pell">${x.pell_pct_ftft == null ? '—' : x.pell_pct_ftft + '%'}</span>
    </li>`).join('');
  return `<figure class="pe-chart">
    <figcaption><strong>${esc(STATE_NAMES[st])}</strong> freshmen at each top-50 university
      <span class="pe-key"><span class="key pe-all"></span> in state <span class="key pe-elite"></span> out of state</span></figcaption>
    <div class="t50-head"><span>Rank</span><span>University</span><span></span><span>Freshmen</span><span>Pell</span></div>
    <ol class="pe-list t50-list" aria-label="Top-50 universities ranked by ${esc(STATE_NAMES[st])} freshmen">${rows}</ol>
    ${none.length ? `<p class="fine">No reported ${esc(STATE_NAMES[st])} freshmen: ${none.map((x) => esc(x.name)).join(', ')}.</p>` : ''}
  </figure>`;
}

export function renderTop50(ds: Dataset): string {
  if (!ds.top50) return '<p class="unavailable">Top-50 data have not been built. Run <code>npm run build:data</code>.</p>';
  const m = ds.top50.meta;
  const src = ['usnews_2027', 'ipeds_ef', 'ipeds_sfa'].map((id) => ds.sources[id]).filter(Boolean);
  return `<div class="pe-cards">${STATES.map((st) => summary(ds, st)).join('')}</div>
    <div class="callout">${esc(m.caution)}</div>
    <div class="pe-charts">${STATES.map((st) => list(ds, st)).join('')}</div>
    <details class="pe-method"><summary>How this is calculated</summary><ul>
      <li><strong>List.</strong> ${esc(m.list_definition)}</li>
      <li><strong>Students counted.</strong> ${esc(m.population)}</li>
      <li><strong>Pell share.</strong> ${esc(m.pell_definition)}</li>
      <li><strong>Years.</strong> ${esc(m.year)}.</li></ul>
      <p class="fine">Sources: ${src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>`).join('; ')}.</p>
    </details>`;
}
