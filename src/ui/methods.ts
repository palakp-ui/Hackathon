import type { Dataset } from '../types';
import { availability, MENU_METRICS as METRICS } from '../config/metrics';
import { FLAGS } from '../analysis/flags';
import { PEER_FEATURES } from '../analysis/peers';
import { esc } from '../util/format';

export function renderMethods(ds: Dataset): string {
  const k = (st: 'MA' | 'GA') => Math.max(0, ...[...ds.counties.values()].filter((c) => c.state === st).map((c) => c.peer.peers.length));
  const sources = Object.entries(ds.sources).map(([id, s]) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a><br><code>${esc(id)}</code></td><td>${esc(s.year)}</td><td>${esc(s.notes)}</td></tr>`).join('');
  const metrics = METRICS.map((m) => {
    const a = availability(m, ds);
    const avail = a.MA && a.GA ? 'MA, GA' : a.MA ? 'MA only' : a.GA ? 'GA only' : 'Not available';
    const why = m.unavailable?.all ?? m.unavailable?.GA ?? m.unavailable?.MA ?? '';
    return `<tr><th scope="row">${esc(m.label)} <span class="tag tag-${m.kind}">${m.kind}</span></th><td>${esc(m.definition)}${why ? `<br><span class="muted">${esc(why)}</span>` : ''}</td><td>${esc(m.denominator)}</td><td>${avail}</td></tr>`;
  }).join('');
  return `
  <div class="methods-grid">
    <article>
      <h3>How county college-going rates are built</h3>
      <p>${esc(ds.outcomeMethod)}</p>
      <p>Each public high school is placed in the county where it is located using the NCES school directory. A school’s graduates may live in neighboring counties, especially for regional, vocational, and charter schools.</p>
      <p>Subgroup counts for “other” (non-low-income) graduates are derived as all graduates minus low-income graduates, using only schools that report both.</p>
    </article>
    <article>
      <h3>Similar-county comparison</h3>
      <p>For each county, “similar counties” are its nearest neighbors <em>in characteristics</em>, not geography, within the same state: ${PEER_FEATURES.map((f) => esc(f.label)).join(', ')}. Each is standardized across the state’s counties and weighted equally. Massachusetts uses ${k('MA')} peers per county (14 counties); Georgia uses ${k('GA')} (159 counties).</p>
      <p>The comparison rate is the peers’ total enrolled graduates divided by their total graduates. A county below its peers has a lower rate than places with similar measured conditions. That is a descriptive gap. It is not a prediction, a performance rating, or evidence of a cause.</p>
    </article>
    <article>
      <h3>Access to nearby colleges</h3>
      <p>${esc(ds.accessMethod)}</p>
      <p>${esc(ds.institutionMeta.universe)} ${esc(ds.institutionMeta.selective_definition)}</p>
    </article>
    <article>
      <h3>Pell Grant statistics</h3>
      <p>Pell data are reported by institutions about the students they enroll: the share of undergraduates awarded Pell Grants, and completion rates for Pell recipients compared with all other students. ${esc(ds.institutionMeta.small_cohort_rule)}</p>
      <p><strong>${esc(ds.institutionMeta.caution)}</strong> No public dataset links students’ home county, Pell status, and destination college, so the map does not show county-level Pell measures.</p>
    </article>
    <article>
      <h3>Screening criteria</h3>
      <ul>${FLAGS.map((f) => `<li><strong>${esc(f.label)}.</strong> ${esc(f.definition)}</li>`).join('')}</ul>
      <p>No composite index is calculated.</p>
    </article>
    <article>
      <h3>Known data gaps</h3>
      <ul>
        <li>Elite-college enrollment by county: available for Georgia from the USG county-of-origin report (public universities only). Massachusetts publishes no county-of-origin enrollment data.</li>
        <li>Georgia two-year vs. four-year enrollment by high school: not in GOSA’s public C11 file.</li>
        <li>Pell recipients’ county of origin and destination: not public (would require NSC / state data-system research agreements).</li>
        <li>College-access and advising program locations: not loaded. Add <code>public/data/programs.json</code> to enable that criterion.</li>
        <li>Years differ across sources (MA class of 2024; GA class of 2023; SAIPE 2023; ACS 2019–23; IPEDS 2022–23 aid year).</li>
      </ul>
    </article>
  </div>
  <h3>Metric definitions</h3>
  <div class="table-wrap"><table class="defs"><thead><tr><th scope="col">Metric</th><th scope="col">Definition</th><th scope="col">Denominator</th><th scope="col">Coverage</th></tr></thead><tbody>${metrics}</tbody></table></div>
  <h3>Data sources</h3>
  <div class="table-wrap"><table class="defs"><thead><tr><th scope="col">Source</th><th scope="col">Year</th><th scope="col">Notes</th></tr></thead><tbody>${sources}</tbody></table></div>
  <p class="fine">Data files built ${esc(new Date(ds.built).toLocaleString())}. To update, see <code>README.md</code> and <code>docs/DATA_SCHEMA.md</code>.</p>`;
}
