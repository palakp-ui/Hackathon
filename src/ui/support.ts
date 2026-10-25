// "Where Support May Be Needed": transparent, sortable screening table.
import type { County, Dataset, StateAbbr } from '../types';
import { evaluateFlags, FLAGS } from '../analysis/flags';
import { esc, fmtMiles, fmtPct, fmtPP, fmtProp } from '../util/format';

type SortKey = 'name' | 'poverty' | 'cg' | 'peers' | 'gap' | 'miles' | 'met';
interface Row { c: County; poverty: number | null; cg: number | null; peers: number | null; gap: number | null; miles: number | null; met: number; assessed: number; flags: ReturnType<typeof evaluateFlags>['results'] }

const COLS: { key: SortKey; label: string; title: string; fmt: (r: Row) => string }[] = [
  { key: 'name', label: 'County', title: 'County name', fmt: (r) => `<button class="link" data-select="${r.c.fips}">${esc(r.c.name)}</button> <span class="muted">${r.c.state}</span>` },
  { key: 'poverty', label: 'Poverty', title: 'Poverty rate, SAIPE 2023', fmt: (r) => fmtPct(r.poverty) },
  { key: 'cg', label: 'College-going', title: 'College-going rate within 16 months', fmt: (r) => fmtProp(r.cg) },
  { key: 'peers', label: 'vs. similar', title: 'Points above/below similar counties in the same state', fmt: (r) => fmtPP(r.peers) },
  { key: 'gap', label: 'Income gap', title: 'Other graduates minus low-income graduates, points', fmt: (r) => (r.gap == null ? '<span class="muted">n/a</span>' : `${r.gap.toFixed(1)} pts`) },
  { key: 'miles', label: 'Mi. to public 4-yr', title: 'Straight-line miles to nearest public four-year college', fmt: (r) => fmtMiles(r.miles) },
  { key: 'met', label: 'Criteria met', title: 'Number of screening criteria met, of those assessable with available data', fmt: (r) => `<span class="met">${r.flags.map((f) => `<span class="pip pip-${f.met === null ? 'na' : f.met ? 'yes' : 'no'}" title="${esc(f.def.label)}: ${f.met === null ? 'not assessable' : f.met ? 'met' : 'not met'} — ${esc(f.text)}"></span>`).join('')}</span> ${r.met}/${r.assessed}` },
];

export class SupportView {
  private sortKey: SortKey = 'met';
  private dir: 1 | -1 = -1;
  private required = new Set<string>(['econ', 'below_peers']);
  private stateFilter: 'both' | StateAbbr = 'both';
  private rows: Row[];

  constructor(private root: HTMLElement, private ds: Dataset, private onSelect: (fips: string) => void) {
    this.rows = [...ds.counties.values()].map((c) => {
      const f = evaluateFlags(c, ds);
      const li = c.out.low_income?.value, nl = c.out.non_low_income?.value;
      return {
        c, poverty: c.ctx.poverty_rate, cg: c.out.college_going?.value ?? null, peers: c.peer.gap_pp,
        gap: li != null && nl != null ? (nl - li) * 100 : null, miles: c.access?.public_4yr.nearest_miles ?? null,
        met: f.met, assessed: f.assessed, flags: f.results,
      };
    });
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sel = t.closest<HTMLElement>('[data-select]');
      if (sel) { this.onSelect(sel.dataset.select!); return; }
      const sort = t.closest<HTMLElement>('[data-sort]');
      if (sort) {
        const k = sort.dataset.sort as SortKey;
        this.dir = this.sortKey === k ? (this.dir === 1 ? -1 : 1) : k === 'name' || k === 'cg' || k === 'peers' ? 1 : -1;
        this.sortKey = k;
        this.renderTable();
      }
    });
    this.root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'req') { t.checked ? this.required.add(t.value) : this.required.delete(t.value); this.renderTable(); }
      if (t.name === 'sup-state') { this.stateFilter = t.value as typeof this.stateFilter; this.renderTable(); }
    });
    this.renderShell();
    this.renderTable();
  }

  private renderShell() {
    this.root.innerHTML = `
      <fieldset class="criteria"><legend>Show counties that meet all checked criteria</legend>
        ${FLAGS.map((f) => {
          const unavailable = f.id === 'programs' && !this.ds.programs;
          return `<label class="crit${unavailable ? ' crit-off' : ''}"><input type="checkbox" name="req" value="${f.id}" ${this.required.has(f.id) ? 'checked' : ''} ${unavailable ? 'disabled' : ''}>
          <span><strong>${esc(f.label)}</strong><br><span class="muted small">${esc(f.definition)}${unavailable ? ' <em>Not assessable: no program-location file has been supplied.</em>' : ''}</span></span></label>`;
        }).join('')}
      </fieldset>
      <div class="sup-bar">
        <div role="radiogroup" aria-label="State" class="seg">
          ${(['both', 'MA', 'GA'] as const).map((s) => `<label><input type="radio" name="sup-state" value="${s}" ${this.stateFilter === s ? 'checked' : ''}><span>${s === 'both' ? 'Both states' : s}</span></label>`).join('')}
        </div>
        <p class="muted small" id="sup-count" aria-live="polite"></p>
      </div>
      <div class="table-wrap"><table class="sup" aria-describedby="sup-count"><thead><tr></tr></thead><tbody></tbody></table></div>
      <p class="fine">Pips show each criterion in order: ${FLAGS.map((f) => esc(f.label)).join(' · ')}. Filled = met, hollow = not met, grey = not assessable with available data. Criteria are counted, not weighted or combined into a score; a county meeting more criteria is not “more underserved.”</p>`;
  }

  private renderTable() {
    const head = this.root.querySelector('thead tr')!;
    head.innerHTML = COLS.map((c) => {
      const aria = this.sortKey === c.key ? (this.dir === 1 ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" aria-sort="${aria}"><button data-sort="${c.key}" title="${esc(c.title)}">${esc(c.label)}<span class="sort-ind" aria-hidden="true">${aria === 'ascending' ? '▲' : aria === 'descending' ? '▼' : ''}</span></button></th>`;
    }).join('');
    const rows = this.rows
      .filter((r) => this.stateFilter === 'both' || r.c.state === this.stateFilter)
      .filter((r) => [...this.required].every((id) => r.flags.find((f) => f.def.id === id)?.met === true));
    const k = this.sortKey, d = this.dir;
    rows.sort((a, b) => {
      if (k === 'name') return d * a.c.name.localeCompare(b.c.name);
      const av = a[k], bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // missing always last
      if (bv == null) return -1;
      return d * ((av as number) - (bv as number)) || (b.met - a.met);
    });
    this.root.querySelector('tbody')!.innerHTML = rows.length
      ? rows.map((r) => `<tr>${COLS.map((c) => `<td>${c.fmt(r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length}" class="muted">No counties meet all checked criteria with available data.</td></tr>`;
    this.root.querySelector('#sup-count')!.textContent = `${rows.length} of ${this.rows.filter((r) => this.stateFilter === 'both' || r.c.state === this.stateFilter).length} counties shown`;
  }
}
