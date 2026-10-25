// Rule-based, evidence-linked reading of one county. Every sentence is generated
// from measured values; statements about causes are explicitly framed as
// hypotheses to investigate.
import type { County, Dataset } from '../types';
import { fmtMiles, fmtPct, fmtPP, fmtProp, fmtUSD, median } from '../util/format';
import { evaluateFlags, THRESHOLDS } from './flags';
import { peerMean } from './peers';

export interface Interpretation {
  observed: string[];
  factors: string[];
  next: string[];
  reliability: string[];
}

export function interpret(c: County, ds: Dataset): Interpretation {
  const so = ds.stateOutcomes[c.state], sc = ds.stateContext[c.state];
  const cg = c.out.college_going;
  const observed: string[] = [], factors: string[] = [], next: string[] = [], reliability: string[] = [];
  const stateCounties = [...ds.counties.values()].filter((x) => x.state === c.state);
  const yr = ds.years[c.state].college_going;

  // 1. Observed disparity
  if (cg?.value == null) {
    observed.push('No county college-going rate is available, so no disparity can be measured here. Missing data should not be read as zero enrollment.');
  } else {
    const vsState = so.college_going != null ? (cg.value - so.college_going) * 100 : null;
    observed.push(`${fmtProp(cg.value)} of ${cg.graduates?.toLocaleString()} public high school graduates (${yr}) enrolled in college within 16 months, ${fmtPP(vsState)} relative to the ${c.state} rate of ${fmtProp(so.college_going)}.`);
    if (c.peer.gap_pp != null)
      observed.push(`Compared with the ${c.peer.peers.length} most similar ${c.state} counties (rate ${fmtProp(c.peer.expected)}), the difference is ${fmtPP(c.peer.gap_pp)}.`);
    const li = c.out.low_income, nl = c.out.non_low_income;
    if (li?.value != null && nl?.value != null && so.low_income != null && so.non_low_income != null) {
      const g = (nl.value - li.value) * 100, sg = (so.non_low_income - so.low_income) * 100;
      observed.push(`Low-income graduates enrolled at ${fmtProp(li.value)} vs. ${fmtProp(nl.value)} for other graduates, a ${g.toFixed(1)}-point gap (statewide gap ${sg.toFixed(1)} points).`);
    }
    if (c.out.destinations?.four_year != null && so.four_year != null)
      observed.push(`${fmtProp(c.out.destinations.four_year)} of graduates enrolled at four-year institutions (state ${fmtProp(so.four_year)}).`);
  }

  // 2. Factors that differ (measured associations, not causes)
  const pov = c.ctx.poverty_rate;
  if (pov != null && sc.poverty_rate != null && Math.abs(pov - sc.poverty_rate) >= 3)
    factors.push(`Poverty is ${pov > sc.poverty_rate ? 'higher' : 'lower'} than the state: ${fmtPct(pov)} vs. ${fmtPct(sc.poverty_rate)} (child poverty ${fmtPct(c.ctx.child_poverty_rate)}).`);
  const inc = c.ctx.median_hh_income;
  if (inc != null && sc.median_hh_income != null && Math.abs(inc / sc.median_hh_income - 1) >= 0.1)
    factors.push(`Median household income is ${fmtUSD(inc)}, ${Math.round(Math.abs(inc / sc.median_hh_income - 1) * 100)}% ${inc > sc.median_hh_income ? 'above' : 'below'} the state (${fmtUSD(sc.median_hh_income)}).`);
  const ba = c.ctx.bachelors_pct;
  if (ba != null && sc.bachelors_pct != null && Math.abs(ba - sc.bachelors_pct) >= 5)
    factors.push(`${fmtPct(ba)} of adults hold a bachelor’s degree, vs. ${fmtPct(sc.bachelors_pct)} statewide.`);
  if (c.ctx.rucc != null && c.ctx.rucc >= 4) factors.push(`The county is nonmetropolitan (${c.ctx.rucc_desc}).`);
  if (c.access) {
    const medDist = median(stateCounties.map((x) => x.access?.public_4yr.nearest_miles));
    const d = c.access.public_4yr.nearest_miles;
    if (d > THRESHOLDS.accessMiles || (medDist != null && d >= medDist * 1.5 && d > 15))
      factors.push(`The nearest public four-year college (${c.access.public_4yr.nearest.name}) is ${fmtMiles(d)} away in a straight line; the median ${c.state} county is ${fmtMiles(medDist)}. ${c.access.four_year.within_radius} public or nonprofit four-year colleges and ${c.access.public_2yr.within_radius} public two-year colleges are within 30 miles.`);
  }
  const gr = c.out.grad_rate?.value;
  if (gr != null && so.grad_rate != null && Math.abs(gr - so.grad_rate) >= 0.03)
    factors.push(`The high school graduation rate is ${fmtProp(gr)} vs. ${fmtProp(so.grad_rate)} statewide, which changes who is counted among graduates.`);
  if (c.peer.peers.length && c.peer.gap_pp != null && Math.abs(c.peer.gap_pp) >= THRESHOLDS.belowPeersPP) {
    const pPov = peerMean(c, ds.counties, (x) => x.ctx.poverty_rate);
    factors.push(`Its similar counties have comparable measured conditions (average poverty ${fmtPct(pPov)}), so the ${fmtPP(c.peer.gap_pp)} difference from them is not accounted for by poverty, income, adult education, or rurality alone. Hypothesis: unmeasured factors such as counseling capacity, dual-enrollment access, local labor markets, military enlistment, or reporting differences may contribute.`);
  }
  if (!factors.length) factors.push('The measured economic and geographic characteristics are close to the state. Any gap here is not distinguished by these measures and would need local information to understand.');

  // 3. What a nonprofit could investigate next
  const flags = evaluateFlags(c, ds);
  const met = (id: string) => flags.results.find((r) => r.def.id === id)?.met === true;
  if (met('income_gap')) next.push('Review FAFSA completion and financial-aid awareness among low-income seniors with school counselors; the income gap is wider than the state’s.');
  if (met('access')) next.push('Assess transportation, online, and dual-enrollment pathways, and whether graduates enroll at the nearest two-year or technical college.');
  if (met('below_peers')) next.push('Contact local high schools to confirm the pattern across several graduating classes and learn about advising staffing and caseloads.');
  if (met('econ') && !met('income_gap')) next.push('Consider whether scholarship or emergency-aid programs reach students in this county, given higher measured poverty.');
  if (!ds.programs) next.push('Map existing college-access and advising programs here (no program-location data are loaded) before concluding there is a service gap.');
  if (!next.length) next.push('No screening criteria were met. Validate with multiple years and student-level partners before drawing conclusions.');

  // Reliability
  if (cg && (cg.graduates ?? 0) < 150) reliability.push(`Small graduating class (${cg.graduates} graduates): one-year rates can shift substantially from year to year.`);
  reliability.push(...c.out.notes);
  if (c.ctx.poverty_rate_ci[0] != null) reliability.push(`Poverty is a model-based estimate (90% CI ${fmtPct(c.ctx.poverty_rate_ci[0])}–${fmtPct(c.ctx.poverty_rate_ci[1])}).`);

  return { observed, factors, next, reliability };
}
