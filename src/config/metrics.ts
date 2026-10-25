// Metric registry. Each map metric declares how to read its value from a joined
// County record, its unit, provenance, and how it should be coloured. Adding a
// metric = adding an entry here (plus the field in the data build).
import type { County, Dataset, StateAbbr } from '../types';
import { fmtMiles, fmtPct, fmtPP, fmtUSD, fmtInt, fmtProp } from '../util/format';

export type MetricGroup = 'Educational outcomes' | 'Pell Grants & elite colleges' | 'Access to nearby colleges' | 'County economic context';
export type ScaleKind = 'seq' | 'div' | 'ord';

export interface MetricDef {
  id: string;
  label: string;
  group: MetricGroup;
  /** observed = published by the source; derived = calculated here from observed values */
  kind: 'observed' | 'derived';
  scale: ScaleKind;
  /** Which end of a sequential scale gets the darkest colour */
  emphasis?: 'low' | 'high';
  legendNote: string;
  definition: string;
  denominator: string;
  get: (c: County) => number | null;
  format: (v: number | null) => string;
  /** Statewide benchmark in the same units, when one exists */
  benchmark?: (ds: Dataset, st: StateAbbr) => number | null;
  /** Count / denominator line for tooltips */
  detail?: (c: County, ds: Dataset) => string | null;
  sources: (st: StateAbbr) => string[];
  year: (ds: Dataset, st: StateAbbr) => string;
  /** Explanation used when a state (or both) has no valid observations */
  unavailable?: Partial<Record<StateAbbr | 'all', string>>;
}

const pct = (v: number | null | undefined) => (v == null ? null : v * 100);
const OUT_SRC = { MA: ['ma_dese_college', 'nces_ccd'], GA: ['ga_gosa_c11', 'nces_ccd'] };
const cgYear = (ds: Dataset, st: StateAbbr) => ds.years[st].college_going;
const cgDetail = (c: County) => {
  const r = c.out.college_going;
  if (!r) return null;
  return `${fmtInt(r.enrolled)} of ${fmtInt(r.graduates)} graduates enrolled · ${r.schools} of ${r.schools_total} high schools reported`;
};

export const METRICS: MetricDef[] = [
  {
    id: 'college_going', label: 'College attending rate', group: 'Educational outcomes', kind: 'observed', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = lower share of graduates enrolled in college',
    definition: 'Share of public high school graduates who enrolled at any college or university within 16 months of graduating.',
    denominator: 'Public high school graduates in schools located in the county (unsuppressed results only).',
    get: (c) => pct(c.out.college_going?.value), format: (v) => fmtPct(v),
    benchmark: (ds, st) => pct(ds.stateOutcomes[st].college_going),
    detail: cgDetail, sources: (st) => OUT_SRC[st], year: cgYear,
  },
  {
    id: 'cg_vs_peers', label: 'College-going vs. similar counties', group: 'Educational outcomes', kind: 'derived', scale: 'div',
    legendNote: 'Orange = below the rate of economically and geographically similar counties in the same state; teal = above',
    definition: 'County college-going rate minus the graduate-weighted rate of its most similar counties in the same state (poverty, income, adult education, rurality). Descriptive comparison only.',
    denominator: 'Percentage points. Peer rate = peers’ enrolled graduates / peers’ graduates.',
    get: (c) => c.peer.gap_pp, format: (v) => fmtPP(v),
    detail: (c, ds) => (c.peer.expected == null ? null : `Similar-county rate ${fmtProp(c.peer.expected)} across ${c.peer.peers.length} counties: ${c.peer.peers.map((f) => ds.counties.get(f)!.name.replace(' County', '')).join(', ')}`),
    sources: (st) => [...OUT_SRC[st], 'ers_poverty', 'ers_education', 'ers_rucc'], year: cgYear,
  },
  {
    id: 'cg_vs_state', label: 'College-going vs. state average', group: 'Educational outcomes', kind: 'derived', scale: 'div',
    legendNote: 'Orange = below the statewide rate; teal = above',
    definition: 'County college-going rate minus the statewide rate published by the state agency.',
    denominator: 'Percentage points.',
    get: () => null, // replaced in bindMetrics() once statewide benchmarks are loaded
    format: (v) => fmtPP(v), detail: cgDetail, sources: (st) => OUT_SRC[st], year: cgYear,
  },
  {
    id: 'li_cg', label: 'College-going: low-income graduates', group: 'Educational outcomes', kind: 'observed', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = lower share of low-income graduates enrolled',
    definition: 'College-going rate among graduates identified as low-income (MA: DESE “Low Income”; GA: GOSA economically disadvantaged / FRL field). The two states define this group differently.',
    denominator: 'Low-income graduates in schools whose subgroup results are not suppressed.',
    get: (c) => pct(c.out.low_income?.value), format: (v) => fmtPct(v),
    benchmark: (ds, st) => pct(ds.stateOutcomes[st].low_income),
    detail: (c) => (c.out.low_income ? `${fmtInt(c.out.low_income.enrolled)} of ${fmtInt(c.out.low_income.graduates)} low-income graduates enrolled` : null),
    sources: (st) => OUT_SRC[st], year: cgYear,
  },
  {
    id: 'li_gap', label: 'Income gap in college-going', group: 'Educational outcomes', kind: 'derived', scale: 'seq', emphasis: 'high',
    legendNote: 'Darker = larger gap between other graduates and low-income graduates',
    definition: 'College-going rate of graduates not identified as low-income minus the rate of low-income graduates. Non-low-income counts are derived as all graduates minus low-income graduates.',
    denominator: 'Percentage points; only schools reporting both groups.',
    get: (c) => (c.out.low_income?.value != null && c.out.non_low_income?.value != null ? (c.out.non_low_income.value - c.out.low_income.value) * 100 : null),
    format: (v) => (v == null ? fmtPP(v) : `${v.toFixed(1)} pts`),
    benchmark: (ds, st) => {
      const s = ds.stateOutcomes[st];
      return s.low_income != null && s.non_low_income != null ? (s.non_low_income - s.low_income) * 100 : null;
    },
    detail: (c) => (c.out.low_income && c.out.non_low_income ? `Low-income ${fmtProp(c.out.low_income.value)} vs. other graduates ${fmtProp(c.out.non_low_income.value)}` : null),
    sources: (st) => OUT_SRC[st], year: cgYear,
  },
  {
    id: 'four_year', label: 'Graduates attending four-year colleges', group: 'Educational outcomes', kind: 'observed', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = lower share of graduates at four-year institutions',
    definition: 'Share of all high school graduates enrolled at a public or private four-year institution within 16 months.',
    denominator: 'Public high school graduates in schools with unsuppressed destination results.',
    get: (c) => pct(c.out.destinations?.four_year), format: (v) => fmtPct(v),
    benchmark: (ds, st) => pct(ds.stateOutcomes[st].four_year),
    detail: (c) => (c.out.destinations ? `${fmtInt(c.out.destinations.graduates)} graduates in ${c.out.destinations.schools} schools with destination detail` : null),
    sources: () => ['ma_dese_college', 'nces_ccd'], year: cgYear,
    unavailable: { GA: 'GOSA’s public C11 file reports total college enrollment only. It does not split two-year and four-year enrollment.' },
  },
  {
    id: 'grad_rate', label: 'High school graduation rate', group: 'Educational outcomes', kind: 'observed', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = lower 4-year graduation rate',
    definition: '4-year adjusted cohort graduation rate, aggregated from schools located in the county.',
    denominator: 'Students in the 4-year graduation cohort.',
    get: (c) => pct(c.out.grad_rate?.value), format: (v) => fmtPct(v),
    benchmark: (ds, st) => pct(ds.stateOutcomes[st].grad_rate),
    detail: (c) => (c.out.grad_rate ? `Cohort of ${fmtInt(c.out.grad_rate.cohort)} students in ${c.out.grad_rate.schools} schools` : null),
    sources: (st) => (st === 'MA' ? ['ma_dese_grad', 'nces_ccd'] : ['ga_gosa_grad', 'nces_ccd']),
    year: (ds, st) => ds.years[st].grad_rate,
  },
  {
    id: 'elite_share', label: 'Freshmen at elite public universities (UGA, Georgia Tech)', group: 'Pell Grants & elite colleges', kind: 'derived', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = smaller share of the county’s public-university freshmen at UGA or Georgia Tech',
    definition: 'Of a county’s in-state first-time freshmen at University System of Georgia institutions (Fall 2024), the share enrolled at the system’s “more selective” universities: University of Georgia and Georgia Tech.',
    denominator: 'County’s first-time freshmen at the 26 USG institutions (excludes technical, private, and out-of-state colleges). Hidden when under 10 freshmen.',
    get: (c) => pct(c.dest?.elite_share), format: (v) => fmtPct(v),
    benchmark: (ds) => pct(ds.gaDest?.state.elite_share),
    detail: (c) => (c.dest ? `${fmtInt(c.dest.elite_freshmen)} of ${fmtInt(c.dest.freshmen)} USG freshmen${c.dest.small ? ' · small number, interpret with caution' : ''}` : null),
    sources: () => ['usg_srpt405a', 'ipeds_hd'], year: () => 'Fall 2024 freshmen',
    unavailable: { MA: 'Massachusetts does not publish college enrollment by students’ county or town of origin. See “Pell at Elite Colleges” below for the statewide Massachusetts comparison.' },
  },
  {
    id: 'elite_vs_peers', label: 'Elite-university share vs. economically similar counties', group: 'Pell Grants & elite colleges', kind: 'derived', scale: 'div',
    legendNote: 'Orange = fewer freshmen at UGA/Georgia Tech than counties with similar poverty, income, adult education, and rurality; teal = more',
    definition: 'County share of USG freshmen at UGA or Georgia Tech minus the pooled share of its most similar Georgia counties. Compares places with similar measured economic conditions; it is descriptive, not causal.',
    denominator: 'Percentage points. Peer share = peers’ elite freshmen / peers’ USG freshmen.',
    get: (c) => c.dest?.elite_vs_peers_pp ?? null, format: (v) => fmtPP(v),
    detail: (c) => (c.dest?.peer_elite_share != null ? `County ${fmtProp(c.dest.elite_share)} vs. similar counties ${fmtProp(c.dest.peer_elite_share)}` : null),
    sources: () => ['usg_srpt405a', 'ipeds_hd', 'ers_poverty', 'ers_education', 'ers_rucc'], year: () => 'Fall 2024 freshmen',
    unavailable: { MA: 'Massachusetts does not publish college enrollment by students’ county of origin.' },
  },
  {
    id: 'pell_dest', label: 'Pell representation at target colleges', group: 'Pell Grants & elite colleges', kind: 'derived', scale: 'seq', emphasis: 'high',
    legendNote: 'Darker = the county’s freshmen attend colleges where a larger share of freshmen receive Pell',
    definition: 'Average share of first-time, full-time freshmen receiving Pell Grants at the USG colleges this county’s freshmen attended, weighted by how many of the county’s freshmen enrolled at each. Describes the destination colleges, not whether this county’s own students received Pell.',
    denominator: 'County’s USG first-time freshmen; Pell shares from IPEDS SFA 2022–23. Hidden when under 10 freshmen.',
    get: (c) => c.dest?.pell_dest_pct ?? null, format: (v) => fmtPct(v),
    benchmark: (ds) => ds.gaDest?.state.pell_dest_pct ?? null,
    detail: (c) => (c.dest?.top.length ? `Top destination: ${c.dest.top[0].name} (${c.dest.top[0].n} freshmen, ${c.dest.top[0].pell_pct ?? '—'}% Pell)` : null),
    sources: () => ['usg_srpt405a', 'ipeds_sfa'], year: () => 'Fall 2024 freshmen; Pell 2022–23',
    unavailable: { MA: 'Massachusetts does not publish college enrollment by students’ county of origin. See “Pell at Elite Colleges” below for the statewide Massachusetts comparison.' },
  },
  {
    id: 'dist_public4', label: 'Distance to nearest public four-year college', group: 'Access to nearby colleges', kind: 'derived', scale: 'seq', emphasis: 'high',
    legendNote: 'Darker = farther (straight-line miles from the county population center)',
    definition: 'Straight-line miles from the county’s 2020 population center to the nearest public four-year institution in any state.',
    denominator: 'Miles. Does not reflect travel time, transit, or admission.',
    get: (c) => c.access?.public_4yr.nearest_miles ?? null, format: (v) => fmtMiles(v),
    detail: (c) => (c.access ? `Nearest: ${c.access.public_4yr.nearest.name} (${c.access.public_4yr.nearest.state})` : null),
    sources: () => ['ipeds_hd', 'census_cenpop'], year: () => 'IPEDS 2023–24',
  },
  {
    id: 'dist_selective', label: 'Distance to nearest selective college', group: 'Access to nearby colleges', kind: 'derived', scale: 'seq', emphasis: 'high',
    legendNote: 'Darker = farther (straight-line miles)',
    definition: 'Straight-line miles from the county population center to the nearest institution classified as selective or more selective (Carnegie 2021 Undergraduate Profile).',
    denominator: 'Miles.',
    get: (c) => c.access?.selective.nearest_miles ?? null, format: (v) => fmtMiles(v),
    detail: (c) => (c.access ? `Nearest: ${c.access.selective.nearest.name} (${c.access.selective.nearest.state})` : null),
    sources: () => ['ipeds_hd', 'census_cenpop'], year: () => 'IPEDS 2023–24; Carnegie 2021',
  },
  {
    id: 'near_4yr', label: 'Four-year colleges within 30 miles', group: 'Access to nearby colleges', kind: 'derived', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = fewer public or nonprofit four-year colleges nearby',
    definition: 'Number of public and private nonprofit four-year institutions within 30 straight-line miles of the county population center.',
    denominator: 'Count of institutions.',
    get: (c) => c.access?.four_year.within_radius ?? null, format: (v) => (v == null ? fmtInt(v) : `${v} colleges`),
    sources: () => ['ipeds_hd', 'census_cenpop'], year: () => 'IPEDS 2023–24',
  },
  {
    id: 'poverty', label: 'Poverty rate', group: 'County economic context', kind: 'observed', scale: 'seq', emphasis: 'high',
    legendNote: 'Darker = higher share of residents below the poverty line',
    definition: 'Estimated share of all residents with income below the federal poverty threshold (SAIPE).',
    denominator: 'All residents for whom poverty status is determined.',
    get: (c) => c.ctx.poverty_rate, format: (v) => fmtPct(v),
    benchmark: (ds, st) => ds.stateContext[st].poverty_rate,
    detail: (c) => `90% confidence interval ${fmtPct(c.ctx.poverty_rate_ci[0])} – ${fmtPct(c.ctx.poverty_rate_ci[1])}`,
    sources: () => ['ers_poverty'], year: () => '2023',
  },
  {
    id: 'child_poverty', label: 'Child poverty rate (ages 0–17)', group: 'County economic context', kind: 'observed', scale: 'seq', emphasis: 'high',
    legendNote: 'Darker = higher share of children in poverty',
    definition: 'Estimated share of children ages 0–17 living below the poverty threshold (SAIPE).',
    denominator: 'Children ages 0–17.',
    get: (c) => c.ctx.child_poverty_rate, format: (v) => fmtPct(v),
    benchmark: (ds, st) => ds.stateContext[st].child_poverty_rate,
    sources: () => ['ers_poverty'], year: () => '2023',
  },
  {
    id: 'income', label: 'Median household income', group: 'County economic context', kind: 'observed', scale: 'seq', emphasis: 'low',
    legendNote: 'Darker = lower median household income',
    definition: 'Estimated median household income (SAIPE), in 2023 dollars.',
    denominator: 'Households.',
    get: (c) => c.ctx.median_hh_income, format: (v) => fmtUSD(v),
    benchmark: (ds, st) => ds.stateContext[st].median_hh_income,
    detail: (c) => `90% confidence interval ${fmtUSD(c.ctx.median_hh_income_ci[0])} – ${fmtUSD(c.ctx.median_hh_income_ci[1])}`,
    sources: () => ['ers_poverty'], year: () => '2023',
  },
  {
    id: 'bachelors', label: "Adults with a bachelor's degree or higher", group: 'County economic context', kind: 'observed', scale: 'seq', emphasis: 'low',
    legendNote: "Darker = lower share of adults with a bachelor's degree",
    definition: "Share of adults age 25+ with a bachelor's degree or higher (ACS 5-year).",
    denominator: 'Adults age 25 and older.',
    get: (c) => c.ctx.bachelors_pct, format: (v) => fmtPct(v),
    benchmark: (ds, st) => ds.stateContext[st].bachelors_pct,
    sources: () => ['ers_education'], year: () => '2019–2023',
  },
  {
    id: 'rurality', label: 'Rurality (Rural-Urban Continuum Code)', group: 'County economic context', kind: 'observed', scale: 'ord',
    legendNote: 'Code 1 = large metro … 9 = most rural, not adjacent to a metro area',
    definition: 'USDA ERS 2023 Rural-Urban Continuum Code. 1–3 metropolitan; 4–9 nonmetropolitan by urban population and adjacency to a metro area.',
    denominator: 'Classification (not a rate).',
    get: (c) => c.ctx.rucc, format: (v) => (v == null ? fmtInt(v) : `RUCC ${v}`),
    detail: (c) => c.ctx.rucc_desc, sources: () => ['ers_rucc'], year: () => '2023',
  },
];

// College-going vs. state needs the dataset for its benchmark; bind it once data are loaded.
export function bindMetrics(ds: Dataset) {
  const m = METRICS.find((x) => x.id === 'cg_vs_state')!;
  m.get = (c) => {
    const v = c.out.college_going?.value, s = ds.stateOutcomes[c.state].college_going;
    return v == null || s == null ? null : (v - s) * 100;
  };
}

export const metricById = (id: string) => METRICS.find((m) => m.id === id)!;

/** Metrics offered in the map menu, in display order. Other definitions remain for reference/data use. */
export const MENU_METRIC_IDS = [
  'college_going', 'pell_dest', 'dist_public4', 'dist_selective', 'income', 'bachelors', 'rurality',
];
export const MENU_METRICS = MENU_METRIC_IDS.map(metricById);

/** A metric is shown for a state only if at least one county in that state has a valid value. */
export function availability(m: MetricDef, ds: Dataset): Record<StateAbbr, boolean> {
  const has = { MA: false, GA: false } as Record<StateAbbr, boolean>;
  for (const c of ds.counties.values()) if (m.get(c) != null) has[c.state] = true;
  return has;
}

export const RURALITY_GROUPS = [
  { id: 'metro', label: 'Metropolitan (RUCC 1–3)', test: (r: number | null) => r != null && r <= 3 },
  { id: 'nonmetro_urban', label: 'Nonmetro with a town of 5,000+ (RUCC 4–7)', test: (r: number | null) => r != null && r >= 4 && r <= 7 },
  { id: 'rural', label: 'Most rural (RUCC 8–9)', test: (r: number | null) => r != null && r >= 8 },
];
