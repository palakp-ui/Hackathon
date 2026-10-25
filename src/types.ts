// Shapes of the files in public/data/ (produced by scripts/build-data.mjs).
// See docs/DATA_SCHEMA.md for field definitions.

export type StateAbbr = 'MA' | 'GA';
export const STATE_NAMES: Record<StateAbbr, string> = { MA: 'Massachusetts', GA: 'Georgia' };

export interface ContextRecord {
  fips: string;
  name: string;
  state: StateAbbr;
  population: number | null;
  poverty_rate: number | null; // percent, 0-100
  poverty_rate_ci: [number | null, number | null];
  child_poverty_rate: number | null;
  median_hh_income: number | null;
  median_hh_income_ci: [number | null, number | null];
  bachelors_pct: number | null;
  rucc: number | null;
  rucc_desc: string | null;
  pop_center: [number, number] | null;
}
export type StateContext = Omit<ContextRecord, 'fips' | 'name' | 'state' | 'rucc' | 'rucc_desc' | 'pop_center'>;

export interface RateRecord {
  value: number | null; // proportion, 0-1
  graduates?: number;
  enrolled?: number;
  cohort?: number;
  schools?: number;
  schools_total?: number;
  coverage?: number | null;
  derived?: boolean;
}

export interface Destinations {
  basis: string;
  graduates: number;
  schools: number;
  coverage: number | null;
  four_year: number | null;
  two_year: number | null;
  public_4yr: number | null;
  private_4yr: number | null;
  public_2yr: number | null;
  private_2yr: number | null;
  umass?: number | null;
  ma_state_univ?: number | null;
  ma_comm_coll?: number | null;
}

export interface OutcomeRecord {
  college_going: RateRecord | null;
  grad_rate: RateRecord | null;
  low_income: RateRecord | null;
  non_low_income: RateRecord | null;
  destinations: Destinations | null;
  notes: string[];
}

export interface StateOutcomes {
  college_going: number | null;
  graduates: number | null;
  low_income: number | null;
  non_low_income: number | null;
  four_year: number | null;
  two_year: number | null;
  grad_rate: number | null;
  low_income_label: string;
}

export interface NearestRecord {
  nearest_miles: number;
  nearest: { id: number; name: string; state: string };
  within_radius: number;
}
export interface AccessRecord {
  origin: string;
  radius_miles: number;
  any: NearestRecord;
  public_2yr: NearestRecord;
  four_year: NearestRecord;
  public_4yr: NearestRecord;
  selective: NearestRecord;
}

export interface Institution {
  id: number;
  name: string;
  city: string;
  state: string;
  county_fips: string | null;
  lon: number;
  lat: number;
  sector: number;
  level: '4-year' | '2-year';
  control: string | null;
  selective: boolean;
  more_selective: boolean;
  hbcu: boolean;
  undergrads: number | null;
  pell_pct_undergrad: number | null; // percent 0-100
  pell_pct_ftft: number | null;
  pell_grad: {
    cohort: string;
    pell_n: number | null;
    pell_rate: number | null;
    nonpell_n: number | null;
    nonpell_rate: number | null;
    all_rate: number | null;
  } | null;
}

/** Optional, user-supplied college-access program locations (public/data/programs.json). */
export interface Program {
  name: string;
  county_fips: string;
  lon?: number;
  lat?: number;
  type?: string;
  source?: string;
}

export interface Source {
  name: string;
  year: string;
  url: string;
  notes: string;
}

export interface EliteCollege {
  id: number;
  name: string;
  city: string;
  control: string | null;
  undergrads: number;
  pell_n: number;
  pell_pct: number; // percent of undergraduates
  pell_pct_ftft: number | null;
}
export interface PellEliteState {
  statewide: { institutions: number; undergrads: number; pell_recipients: number; pell_pct: number };
  fsa: { recipients: number | null; total_awards_millions: number | null; year: string } | null;
  elite: { colleges: number; undergrads: number; pell_recipients: number; pell_pct: number | null };
  representation_ratio: number | null;
  colleges: EliteCollege[];
}
export interface PellElite {
  meta: { year: string; elite_definition: string; statewide_definition: string; ratio_definition: string; caution: string };
  states: Record<StateAbbr, PellEliteState>;
}

/** Georgia only: county-of-origin first-time freshmen at USG institutions (ga_destinations.json). */
export interface GaDestRecord {
  freshmen: number;
  elite_freshmen: number;
  elite_share: number | null; // proportion
  pell_dest_pct: number | null; // percent
  small: boolean;
  top: { name: string; n: number; elite: boolean; pell_pct: number | null }[];
  elite_vs_peers_pp?: number | null; // derived in load.ts
  peer_elite_share?: number | null;
}
export interface GaDest {
  meta: { year: string; elite_institutions: string[]; universe: string; min_freshmen: number };
  state: { freshmen: number; elite_freshmen: number; elite_share: number; pell_dest_pct: number };
  counties: Record<string, GaDestRecord>;
}

export interface Top50School {
  unitid: number; name: string; rank: string; state: string; control: string;
  added: boolean; freshmen: number; pell_pct_ftft: number | null; in_state: boolean;
}
export interface Top50State {
  recent_grad_freshmen: number; top50_freshmen: number; top50_share: number;
  strict_top50_freshmen: number; strict_top50_share: number;
  in_state_top50_freshmen: number; private_top50_freshmen: number;
  pell_at_top50: number; pell_at_all_destinations: number; schools: Top50School[];
}
export interface Top50 {
  meta: { year: string; list_definition: string; population: string; pell_definition: string; caution: string };
  states: Record<StateAbbr, Top50State>;
}

export interface PeerResult {
  peers: string[]; // fips
  expected: number | null; // graduate-weighted college-going of peers
  gap_pp: number | null; // observed - expected, percentage points
}

export interface County {
  fips: string;
  id: number;
  name: string;
  state: StateAbbr;
  label: string;
  ctx: ContextRecord;
  out: OutcomeRecord;
  access: AccessRecord | null;
  programs: Program[];
  peer: PeerResult;
  dest: GaDestRecord | null; // Georgia USG origin-to-destination; null for MA
}

export interface Dataset {
  geo: GeoJSON.FeatureCollection;
  counties: Map<string, County>;
  stateContext: Record<StateAbbr, StateContext>;
  stateOutcomes: Record<StateAbbr, StateOutcomes>;
  years: Record<StateAbbr, { college_going: string; grad_rate: string }>;
  outcomeMethod: string;
  accessMethod: string;
  institutions: Institution[];
  institutionMeta: { universe: string; selective_definition: string; small_cohort_rule: string; caution: string };
  programs: Program[] | null; // null = no program file supplied
  pellElite: PellElite | null; // null = pell_elite.json not built
  gaDest: GaDest | null; // null = ga_destinations.json not built
  top50: Top50 | null; // null = top50.json not built
  sources: Record<string, Source>;
  built: string;
}
