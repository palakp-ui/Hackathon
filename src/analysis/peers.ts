// "Similar counties" comparison.
//
// For each county, peers are the k most similar counties IN THE SAME STATE on four
// measured characteristics: poverty rate, median household income (log),
// adults with a bachelor's degree, and rurality (RUCC). Each characteristic is
// standardized (z-score) across that state's counties and weighted equally;
// similarity is Euclidean distance.
//
// Expected rate = graduate-weighted college-going rate of the peers
//   (sum of peers' enrolled graduates / sum of peers' graduates).
// Gap = county rate - expected rate, in percentage points.
//
// This is a descriptive benchmark, not a model of what any county "should" achieve
// and not evidence about causes.
import type { County, StateAbbr } from '../types';

export const PEER_FEATURES = [
  { key: 'poverty_rate', label: 'Poverty rate', get: (c: County) => c.ctx.poverty_rate },
  { key: 'income', label: 'Median household income (log)', get: (c: County) => (c.ctx.median_hh_income ? Math.log(c.ctx.median_hh_income) : null) },
  { key: 'bachelors_pct', label: "Adults with a bachelor's degree", get: (c: County) => c.ctx.bachelors_pct },
  { key: 'rucc', label: 'Rurality (RUCC 2023)', get: (c: County) => c.ctx.rucc },
] as const;

export const peerCount = (n: number) => Math.max(3, Math.min(10, Math.round(n / 4)));

type Vec = number[];

export function standardize(list: County[]): Map<string, Vec> {
  const raw = list.map((c) => PEER_FEATURES.map((f) => f.get(c)));
  const stats = PEER_FEATURES.map((_, j) => {
    const vals = raw.map((r) => r[j]).filter((v): v is number => v !== null);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    return { mean, sd };
  });
  const out = new Map<string, Vec>();
  list.forEach((c, i) => {
    if (raw[i].some((v) => v === null)) return;
    out.set(c.fips, raw[i].map((v, j) => ((v as number) - stats[j].mean) / stats[j].sd));
  });
  return out;
}

export const distance = (a: Vec, b: Vec) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

export function computePeers(counties: Map<string, County>): void {
  for (const st of ['MA', 'GA'] as StateAbbr[]) {
    const list = [...counties.values()].filter((c) => c.state === st);
    const z = standardize(list);
    const eligible = list.filter((c) => z.has(c.fips) && c.out.college_going?.value != null);
    const k = peerCount(eligible.length);
    for (const c of list) {
      const zc = z.get(c.fips);
      if (!zc) continue;
      const peers = eligible
        .filter((p) => p.fips !== c.fips)
        .map((p) => ({ p, d: distance(zc, z.get(p.fips)!) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k)
        .map((x) => x.p);
      let g = 0, e = 0;
      for (const p of peers) { g += p.out.college_going!.graduates ?? 0; e += p.out.college_going!.enrolled ?? 0; }
      const expected = g > 0 ? e / g : null;
      const obs = c.out.college_going?.value ?? null;
      c.peer = {
        peers: peers.map((p) => p.fips),
        expected,
        gap_pp: obs !== null && expected !== null ? (obs - expected) * 100 : null,
      };
    }
  }
}

/** Most similar county in the other state, using pooled standardization across both states. */
export function mostSimilarElsewhere(target: County, all: County[]): County | null {
  const z = standardize(all);
  const zt = z.get(target.fips);
  if (!zt) return null;
  let best: County | null = null, bd = Infinity;
  for (const c of all) {
    if (c.state === target.state || !z.has(c.fips)) continue;
    const d = distance(zt, z.get(c.fips)!);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** Unweighted mean of the peers' values for a county-level context measure (each county counts once). */
export function peerMean(c: County, counties: Map<string, County>, get: (c: County) => number | null): number | null {
  const vals = c.peer.peers.map((f) => get(counties.get(f)!)).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
