// Data for the Georgia vs. Maryland comparison screen (compare.html).
//   node scripts/build-compare.mjs      (after scripts/build-data.mjs, which writes ga_destinations.json)
//
// Writes public/data/compare.json and public/data/geo/compare_counties.geojson.
// No values are imputed; anything missing is null.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shapefile from 'shapefile';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');
const STATES = { '13': 'GA', '24': 'MD' };
const MIN_N = 10; // hide destination Pell share for counties with fewer freshmen

const read = (f) => fs.readFileSync(path.join(RAW, f), 'utf8').replace(/^\uFEFF/, '');
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().replace(/^#/, ''));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const num = (v) => { const s = String(v ?? '').trim(); if (!s || /^(TFS|\.|-)$/.test(s)) return null; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const norm = (s) => s.toLowerCase().replace(/’/g, "'").replace(/\bsaint\b/g, 'st').replace(/ county$/, '').replace(/[^a-z]/g, '');
const write = (f, o) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); console.log(`  wrote ${f} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`); };

// ---- geography
const fc = await shapefile.read(path.join(RAW, 'cb/cb_2023_us_county_5m.shp'), path.join(RAW, 'cb/cb_2023_us_county_5m.dbf'));
const rc = (c) => (typeof c[0] === 'number' ? [round(c[0], 4), round(c[1], 4)] : c.map(rc));
const features = fc.features.filter((f) => STATES[f.properties.STATEFP]).map((f) => ({
  type: 'Feature', id: Number(f.properties.GEOID),
  properties: { fips: f.properties.GEOID, name: f.properties.NAMELSAD, state: STATES[f.properties.STATEFP] },
  geometry: { type: f.geometry.type, coordinates: rc(f.geometry.coordinates) },
}));
const nGA = features.filter((f) => f.properties.state === 'GA').length, nMD = features.filter((f) => f.properties.state === 'MD').length;
if (nGA !== 159 || nMD !== 24) throw new Error(`Unexpected county counts GA ${nGA}, MD ${nMD}`);

// ---- income (SAIPE 2023 via ERS)
const inc = {};
for (const r of parseCSV(read('ers_poverty.csv'))) {
  const f = String(r.FIPS_Code).padStart(5, '0');
  if (!['13', '24'].includes(f.slice(0, 2))) continue;
  if (r.Attribute === 'MEDHHINC_2023') (inc[f] ||= {}).income = num(r.Value);
  if (r.Attribute === 'PCTPOVALL_2023') (inc[f] ||= {}).poverty = num(r.Value);
}

// ---- IPEDS
const hd = parseCSV(read('ipeds_hd2023.csv'));
const sfa = Object.fromEntries(parseCSV(read('ipeds_sfa2223.csv')).map((r) => [r.UNITID, r]));
const pellOf = (u) => num(sfa[u]?.PGRNT_P);

// ---- Georgia: USG county-of-origin destinations (built by build-data.mjs)
const gaDest = JSON.parse(fs.readFileSync(path.join(OUT, 'ga_destinations.json'), 'utf8'));

// ---- Maryland: MHEC enrollment by county of residence, four-year institutions only
const MD_ALIASES = { 'cecilcommunitycollege': 'cecilcollege' };
const mdHd = hd.filter((r) => r.STABBR === 'MD');
const top20 = parseCSV(read('usnews_national_universities_2027.csv')).filter((r) => num(r.rank) <= 20);
const top20Ids = new Set(top20.map((r) => r.unitid));
const mdInst = {};
const unmatched = new Set();
for (const r of parseCSV(read('mhec_county_institution_fall2025.csv'))) {
  const key = MD_ALIASES[norm(r.institution)] || norm(r.institution);
  const h = mdHd.find((x) => norm(x.INSTNM) === key) || mdHd.find((x) => norm(x.INSTNM).startsWith(key));
  if (!h) { unmatched.add(r.institution); continue; }
  mdInst[h.UNITID] ||= { unitid: Number(h.UNITID), name: h.INSTNM, sector: num(h.SECTOR), pell: pellOf(h.UNITID), top20: top20Ids.has(h.UNITID) };
  r.unitid = h.UNITID;
}
const mdRows = parseCSV(read('mhec_county_institution_fall2025.csv'));
const mdByCounty = {};
for (const r of mdRows) {
  const key = MD_ALIASES[norm(r.institution)] || norm(r.institution);
  const h = mdHd.find((x) => norm(x.INSTNM) === key) || mdHd.find((x) => norm(x.INSTNM).startsWith(key));
  if (!h || !num(r.new_ft)) continue;
  const i = mdInst[h.UNITID];
  if (!(i.sector === 1 || i.sector === 2)) continue; // four-year public and private nonprofit only
  (mdByCounty[norm(r.county)] ||= []).push({ i, n: num(r.new_ft) });
}

// ---- county records
const counties = {};
for (const f of features) {
  const { fips, name, state } = f.properties;
  const rec = { fips, name, state, income: inc[fips]?.income ?? null, poverty: inc[fips]?.poverty ?? null, pell_dest: null, freshmen: null, top20_freshmen: null, top: [] };
  if (state === 'GA') {
    const d = gaDest.counties[fips];
    if (d) { rec.freshmen = d.freshmen; rec.pell_dest = d.pell_dest_pct; rec.top = d.top.slice(0, 5).map((t) => ({ name: t.name, n: t.n, pell: t.pell_pct })); rec.top20_freshmen = 0; }
  } else {
    const list = mdByCounty[norm(name)] || [];
    const T = list.reduce((a, x) => a + x.n, 0);
    const wp = list.filter((x) => x.i.pell != null), W = wp.reduce((a, x) => a + x.n, 0);
    rec.freshmen = T;
    rec.pell_dest = W >= MIN_N ? round(wp.reduce((a, x) => a + x.n * x.i.pell, 0) / W) : null;
    rec.top20_freshmen = list.filter((x) => x.i.top20).reduce((a, x) => a + x.n, 0);
    rec.top = [...list].sort((a, b) => b.n - a.n).slice(0, 5).map((x) => ({ name: x.i.name, n: x.n, pell: x.i.pell }));
  }
  counties[fips] = rec;
}
const missingMD = features.filter((f) => f.properties.state === 'MD' && !counties[f.properties.fips].freshmen).map((f) => f.properties.name);
if (missingMD.length) throw new Error(`MD counties with no MHEC rows: ${missingMD.join(', ')}`);

// ---- state cards: top-20 national universities (IPEDS residence of recent-grad freshmen)
const ef = {};
for (const r of parseCSV(read('ipeds_ef2022c.csv'))) (ef[r.UNITID] ||= {})[r.EFCSTATE] = num(r.EFRES02) ?? 0;
const statesOut = {};
for (const [fp, st] of Object.entries(STATES)) {
  let total = 0, pA = 0, pN = 0;
  for (const [u, by] of Object.entries(ef)) { const n = by[fp] || 0; if (!n) continue; total += n; const p = pellOf(u); if (p != null) { pA += n * p; pN += n; } }
  const schools = top20.map((s) => ({ name: s.name, rank: s.display_rank, state: s.state, n: ef[s.unitid]?.[fp] || 0, pell: pellOf(s.unitid) })).sort((a, b) => b.n - a.n);
  const T = schools.reduce((a, s) => a + s.n, 0);
  const wp = schools.filter((s) => s.n && s.pell != null);
  statesOut[st] = {
    income: inc[`${fp}000`]?.income ?? null,
    recent_grad_freshmen: total, top20_freshmen: T, top20_share: total ? T / total : null,
    pell_at_top20: round(wp.reduce((a, s) => a + s.n * s.pell, 0) / wp.reduce((a, s) => a + s.n, 0)),
    pell_at_all: round(pA / pN),
    top_schools: schools.slice(0, 5),
  };
}

write('geo/compare_counties.geojson', { type: 'FeatureCollection', features });
write('compare.json', {
  meta: {
    income: { source: 'U.S. Census Bureau SAIPE via USDA ERS', year: 2023, definition: 'Median household income.' },
    pell: {
      definition: 'Average share of first-time, full-time freshmen receiving Pell Grants (IPEDS 2022–23) at the in-state colleges a county’s new freshmen attended, weighted by how many enrolled at each. Describes those colleges, not whether the county’s own students received Pell.',
      GA: 'Georgia: in-state first-time freshmen at the 26 University System of Georgia institutions, Fall 2024 (USG SRPT405a). Excludes technical, private, and out-of-state colleges.',
      MD: 'Maryland: new full-time undergraduates at Maryland four-year public and private nonprofit institutions, Fall 2025 (MHEC Enrollment by Place of Residence). Excludes community colleges and out-of-state colleges.',
      min_freshmen: MIN_N,
    },
    top20: {
      definition: `U.S. News 2027 Best National Universities ranked #1–#20 (${top20.length} schools incl. ties). Freshmen who graduated high school in the past 12 months, by state of residence, at every U.S. college (IPEDS EF2022C, fall 2022).`,
    },
    md_unmatched_institutions: [...unmatched],
    caution: 'The two states’ county data come from different agencies, years, and sets of colleges, so county Pell values are best compared within a state. Income uses the same source and scale for both.',
  },
  states: statesOut,
  counties,
});
console.log(`MD unmatched institutions (excluded): ${[...unmatched].join('; ') || 'none'}`);
