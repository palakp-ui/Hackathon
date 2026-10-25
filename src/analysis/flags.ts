// Transparent screening criteria for "Where Support May Be Needed".
// Each criterion is a yes / no / not-assessable test with a stated threshold.
// They are NOT combined into a score; the table reports how many were met out of
// how many could be assessed with available data.
import type { County, Dataset } from '../types';
import { fmtMiles, fmtPct, fmtPP, fmtProp } from '../util/format';

export const THRESHOLDS = {
  belowPeersPP: 3, // college-going at least this many points below similar counties
  accessMiles: 30, // nearest public four-year college farther than this
  minLowIncomeGraduates: 30,
  minLowIncomeCoverage: 0.8,
};

export interface FlagResult { met: boolean | null; text: string }
export interface FlagDef {
  id: string;
  label: string;
  definition: string;
  evaluate: (c: County, ds: Dataset) => FlagResult;
}

export const FLAGS: FlagDef[] = [
  {
    id: 'econ',
    label: 'Economic disadvantage',
    definition: 'Lower bound of the county’s 90% confidence interval for the poverty rate (SAIPE 2023) is above the statewide poverty rate, i.e. poverty is measurably higher than the state.',
    evaluate: (c, ds) => {
      const lo = c.ctx.poverty_rate_ci[0], st = ds.stateContext[c.state].poverty_rate;
      if (lo == null || st == null) return { met: null, text: 'Poverty estimate unavailable' };
      return { met: lo > st, text: `Poverty ${fmtPct(c.ctx.poverty_rate)} (90% CI from ${fmtPct(lo)}) vs. state ${fmtPct(st)}` };
    },
  },
  {
    id: 'below_peers',
    label: 'Below similar counties',
    definition: `College-going rate is at least ${THRESHOLDS.belowPeersPP} percentage points below the graduate-weighted rate of the most similar counties in the same state.`,
    evaluate: (c) => {
      if (c.peer.gap_pp == null) return { met: null, text: 'College-going rate or peer comparison unavailable' };
      return { met: c.peer.gap_pp <= -THRESHOLDS.belowPeersPP, text: `${fmtPP(c.peer.gap_pp)} vs. similar counties (${fmtProp(c.peer.expected)})` };
    },
  },
  {
    id: 'access',
    label: 'Distance to a public four-year college',
    definition: `Nearest public four-year institution (any state) is more than ${THRESHOLDS.accessMiles} straight-line miles from the county’s population center.`,
    evaluate: (c) => {
      const d = c.access?.public_4yr.nearest_miles;
      if (d == null) return { met: null, text: 'Distance unavailable' };
      return { met: d > THRESHOLDS.accessMiles, text: `${fmtMiles(d)} to ${c.access!.public_4yr.nearest.name}` };
    },
  },
  {
    id: 'income_gap',
    label: 'Income gap larger than the state’s',
    definition: `The college-going gap between other graduates and low-income graduates is larger than the statewide gap. Assessed only where at least ${THRESHOLDS.minLowIncomeGraduates} low-income graduates and ${THRESHOLDS.minLowIncomeCoverage * 100}% of them are in unsuppressed results.`,
    evaluate: (c, ds) => {
      const li = c.out.low_income, nl = c.out.non_low_income, s = ds.stateOutcomes[c.state];
      if (!li || !nl || li.value == null || nl.value == null || s.low_income == null || s.non_low_income == null)
        return { met: null, text: 'Low-income results suppressed or unavailable' };
      if ((li.graduates ?? 0) < THRESHOLDS.minLowIncomeGraduates || (li.coverage ?? 0) < THRESHOLDS.minLowIncomeCoverage)
        return { met: null, text: 'Too few low-income graduates reported to assess' };
      const gap = (nl.value - li.value) * 100, sg = (s.non_low_income - s.low_income) * 100;
      return { met: gap > sg, text: `Gap ${gap.toFixed(1)} pts vs. state ${sg.toFixed(1)} pts` };
    },
  },
  {
    id: 'programs',
    label: 'No listed college-access program',
    definition: 'No college-access or advising program is listed for the county in the supplied program-location file (public/data/programs.json).',
    evaluate: (c, ds) => {
      if (!ds.programs) return { met: null, text: 'No program-location data supplied' };
      return { met: c.programs.length === 0, text: c.programs.length ? `${c.programs.length} listed program(s)` : 'None listed in supplied file' };
    },
  },
];

export function evaluateFlags(c: County, ds: Dataset) {
  const results = FLAGS.map((f) => ({ def: f, ...f.evaluate(c, ds) }));
  return {
    results,
    met: results.filter((r) => r.met === true).length,
    assessed: results.filter((r) => r.met !== null).length,
  };
}
