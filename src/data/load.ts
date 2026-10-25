// Loads the separate data files and joins them on 5-digit county FIPS.
// No values are created here: missing inputs stay null.
import type {
  AccessRecord, ContextRecord, County, Dataset, GaDest, Institution, OutcomeRecord, PellElite, Program, Source, Top50,
  StateAbbr, StateContext, StateOutcomes,
} from '../types';
import { computePeers } from '../analysis/peers';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJSON<T>(file: string, optional = false): Promise<T | null> {
  const res = await fetch(BASE + file);
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`Could not load ${file} (HTTP ${res.status}). Run "npm run build:data".`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    if (optional) return null;
    throw new Error(`${file} is not valid JSON.`);
  }
}

export async function loadDataset(): Promise<Dataset> {
  const [geo, context, outcomes, access, inst, sources, programs, pellElite, gaDest, top50] = await Promise.all([
    getJSON<GeoJSON.FeatureCollection>('geo/counties.geojson'),
    getJSON<{ states: Record<StateAbbr, StateContext>; counties: Record<string, ContextRecord> }>('county_context.json'),
    getJSON<{
      meta: { years: Dataset['years']; method: string };
      states: Record<StateAbbr, StateOutcomes>;
      counties: Record<string, OutcomeRecord>;
    }>('college_outcomes.json'),
    getJSON<{ meta: { method: string }; counties: Record<string, AccessRecord | null> }>('county_access.json'),
    getJSON<{ meta: Dataset['institutionMeta']; institutions: Institution[] }>('institutions.json'),
    getJSON<{ built: string; sources: Record<string, Source> }>('sources.json'),
    getJSON<{ programs: Program[] }>('programs.json', true),
    getJSON<PellElite>('pell_elite.json', true),
    getJSON<GaDest>('ga_destinations.json', true),
    getJSON<Top50>('top50.json', true),
  ]);
  if (!geo || !context || !outcomes || !access || !inst || !sources) throw new Error('A required data file is missing.');

  const programList = Array.isArray(programs?.programs) ? programs!.programs.filter((p) => /^\d{5}$/.test(String(p.county_fips))) : null;

  const counties = new Map<string, County>();
  for (const f of geo.features) {
    const fips = String(f.properties?.fips);
    const ctx = context.counties[fips];
    if (!ctx) throw new Error(`County ${fips} has a boundary but no context record.`);
    const emptyOutcome: OutcomeRecord = { college_going: null, grad_rate: null, low_income: null, non_low_income: null, destinations: null, notes: ['No outcome record.'] };
    counties.set(fips, {
      fips,
      id: Number(fips),
      name: ctx.name,
      state: ctx.state,
      label: `${ctx.name}, ${ctx.state}`,
      ctx,
      out: outcomes.counties[fips] ?? emptyOutcome,
      access: access.counties[fips] ?? null,
      programs: programList ? programList.filter((p) => p.county_fips === fips) : [],
      peer: { peers: [], expected: null, gap_pp: null },
      dest: gaDest?.counties[fips] ? { ...gaDest.counties[fips] } : null,
    });
  }
  computePeers(counties);

  // Elite-college share vs. economically similar counties (same peer sets as college-going).
  // Peer share is pooled: peers' elite freshmen / peers' USG freshmen.
  for (const c of counties.values()) {
    if (!c.dest) continue;
    let t = 0, e = 0;
    for (const f of c.peer.peers) {
      const d = counties.get(f)?.dest;
      if (d) { t += d.freshmen; e += d.elite_freshmen; }
    }
    c.dest.peer_elite_share = t > 0 ? e / t : null;
    c.dest.elite_vs_peers_pp = c.dest.elite_share != null && c.dest.peer_elite_share != null ? (c.dest.elite_share - c.dest.peer_elite_share) * 100 : null;
  }

  return {
    geo,
    counties,
    stateContext: context.states,
    stateOutcomes: outcomes.states,
    years: outcomes.meta.years,
    outcomeMethod: outcomes.meta.method,
    accessMethod: access.meta.method,
    institutions: inst.institutions,
    institutionMeta: inst.meta,
    programs: programList,
    pellElite,
    gaDest,
    top50,
    sources: sources.sources,
    built: sources.built,
  };
}
