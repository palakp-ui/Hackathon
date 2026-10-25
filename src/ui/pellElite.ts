// "Pell Students at Elite Colleges": state-level comparison of the Pell share at each
// state's most selective colleges with the Pell share of all undergraduates enrolled there.
import type { Dataset, StateAbbr } from '../types';
import { STATE_NAMES } from '../types';
import { esc, fmtInt, fmtPct } from '../util/format';

const STATES: StateAbbr[] = ['MA', 'GA'];

function stateCard(ds: Dataset, st: StateAbbr): string {
  const s = ds.pellElite!.states[st];
  const max = 50;
  const bar = (label: string, v: number | null, cls: string, sub: string) => `
    <div class="pe-bar">
      <div class="pe-bar-label"><span>${esc(label)}</span><strong>${fmtPct(v)}</strong></div>
      <div class="pe-track"><span class="pe-fill ${cls}" style="width:${v == null ? 0 : Math.min(100, (v / max) * 100)}%"></span></div>
      <div class="fine">${esc(sub)}</div>
    </div>`;
  const ratio = s.representation_ratio;
  return `<article class="pe-card" aria-labelledby="pe-${st}">
    <h3 id="pe-${st}">${esc(STATE_NAMES[st])}</h3>
    ${bar('All undergraduates enrolled in the state', s.statewide.pell_pct, 'pe-all', `${fmtInt(s.statewide.pell_recipients)} Pell recipients of ${fmtInt(s.statewide.undergrads)} undergraduates at ${s.statewide.institutions} institutions (IPEDS)`)}
    ${bar('Undergraduates at the most selective colleges', s.elite.pell_pct, 'pe-elite', `${fmtInt(s.elite.pell_recipients)} of ${fmtInt(s.elite.undergrads)} at ${s.elite.colleges} colleges`)}
    <p class="pe-ratio"><span class="pe-ratio-num">${ratio == null ? 'n/a' : ratio.toFixed(2)}</span>
      <span>representation ratio <span class="tag tag-derived">derived</span><br><span class="muted small">${ratio == null ? '' : `Elite colleges enroll Pell students at ${Math.round(ratio * 100)}% of the statewide rate. 1.00 would be proportional.`}</span></span></p>
    ${s.fsa ? `<p class="fine">Federal Student Aid reports ${fmtInt(s.fsa.recipients)} Pell recipients and $${s.fsa.total_awards_millions?.toFixed(0)} million in awards at ${esc(STATE_NAMES[st])} colleges in ${esc(s.fsa.year)} (via EducationData.org). FSA and IPEDS count recipients differently, so FSA’s total runs higher; shares above use IPEDS for both numerator and denominator.</p>` : ''}
  </article>`;
}

function collegeChart(ds: Dataset, st: StateAbbr): string {
  const s = ds.pellElite!.states[st];
  const max = 50;
  const avgLeft = (s.statewide.pell_pct / max) * 100;
  const rows = [...s.colleges].sort((a, b) => b.pell_pct - a.pell_pct).map((c) => `
    <li class="pe-row">
      <span class="pe-name">${esc(c.name)}<span class="muted"> · ${esc(c.control ?? '')} · ${fmtInt(c.undergrads)} undergrads</span></span>
      <span class="pe-track"><span class="pe-fill pe-elite" style="width:${Math.min(100, (c.pell_pct / max) * 100)}%"></span><span class="pe-avg" style="left:${avgLeft}%"></span></span>
      <span class="pe-val">${fmtPct(c.pell_pct, 0)}</span>
    </li>`).join('');
  return `<figure class="pe-chart">
    <figcaption><strong>${esc(STATE_NAMES[st])}</strong>: share of undergraduates receiving Pell at each most-selective college
      <span class="pe-key"><span class="pe-avg-key"></span> state average ${fmtPct(s.statewide.pell_pct)}</span></figcaption>
    <ol class="pe-list" aria-label="${esc(STATE_NAMES[st])} most selective colleges ranked by Pell share">${rows}</ol>
  </figure>`;
}

export function renderPellElite(ds: Dataset): string {
  if (!ds.pellElite) return '<p class="unavailable">Pell / elite-college data have not been built. Run <code>npm run build:data</code>.</p>';
  const m = ds.pellElite.meta;
  const src = ['ipeds_sfa', 'ipeds_hd', 'fsa_pell_state'].map((id) => ds.sources[id]).filter(Boolean);
  return `
    <div class="pe-cards">${STATES.map((st) => stateCard(ds, st)).join('')}</div>
    <div class="callout">${esc(m.caution)} These are state-level, institution-based figures; they do not describe any county.</div>
    <div class="pe-charts">${STATES.map((st) => collegeChart(ds, st)).join('')}</div>
    <details class="pe-method"><summary>How this is calculated</summary>
      <ul>
        <li><strong>Elite colleges.</strong> ${esc(m.elite_definition)}</li>
        <li><strong>Statewide share.</strong> ${esc(m.statewide_definition)}</li>
        <li><strong>Representation ratio.</strong> ${esc(m.ratio_definition)}</li>
        <li><strong>Year.</strong> ${esc(m.year)}. Pell counts are undergraduates awarded Pell Grants (IPEDS SFA UPGRNTN ÷ SCUGRAD).</li>
      </ul>
      <p class="fine">Sources: ${src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>`).join('; ')}.</p>
    </details>`;
}
