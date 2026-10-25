// Data pipeline: data/raw/*  ->  public/data/*.json
//
// Every number the interface shows comes from this script's output. It never
// generates or imputes values: anything that is suppressed, missing, or not
// reported by the publisher is written as null together with a coverage note.
//
// Run: npm run build:data   (after scripts/fetch-data.sh)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shapefile from 'shapefile';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');
fs.mkdirSync(OUT, { recursive: true });

const STATES = { '25': { abbr: 'MA', name: 'Massachusetts' }, '13': { abbr: 'GA', name: 'Georgia' } };
// Institutions in neighbouring states are kept so border counties get honest nearest-college distances.
const INSTITUTION_STATES = new Set(['MA', 'GA', 'CT', 'RI', 'NH', 'VT', 'NY', 'FL', 'AL', 'TN', 'NC', 'SC']);
const SMALL_COHORT = 30; // IPEDS Pell/non-Pell graduation rates with fewer students are withheld (reliability rule)
const NEAR_MILES = 30;

// ---------------------------------------------------------------- helpers
const read = (f) => fs.readFileSync(path.join(RAW, f), 'utf8').replace(/^\uFEFF/, '');
const readJSON = (f) => JSON.parse(read(f));

/** RFC-4180-ish CSV parser (quoted fields, embedded commas/newlines). Keys and values trimmed. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().replace(/^#/, ''));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Numeric parse; publisher suppression codes ("TFS", "", ".", "*") become null. */
const num = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || /^(TFS|\*|\.|NA|N\/A|-)$/i.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 4) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const ratio = (a, b) => (b > 0 ? round(a / b) : null);
const pad5 = (f) => String(f).padStart(5, '0');
const write = (name, obj) => {
  const p = path.join(OUT, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  console.log(`  wrote ${name} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
};
function milesBetween([lon1, lat1], [lon2, lat2]) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------- sources (metadata shown in the UI)
const SOURCES = {
  census_cb: {
    name: 'U.S. Census Bureau, Cartographic Boundary Files: Counties (1:5,000,000)', year: '2023',
    url: 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_5m.zip',
    notes: 'County polygons keyed by 5-digit FIPS (GEOID). Generalized for display; not for legal boundary use.',
  },
  census_cenpop: {
    name: 'U.S. Census Bureau, 2020 County Centers of Population', year: '2020',
    url: 'https://www.census.gov/geographies/reference-files/time-series/geo/centers-population.html',
    notes: 'Population-weighted county centers. Used only as the origin point for straight-line distances.',
  },
  ers_poverty: {
    name: 'USDA ERS County-Level Data Sets: Poverty (from Census SAIPE)', year: '2023',
    url: 'https://www.ers.usda.gov/data-products/county-level-data-sets/county-level-data-sets-download-data',
    notes: 'Small Area Income and Poverty Estimates: model-based estimates with 90% confidence intervals.',
  },
  ers_education: {
    name: 'USDA ERS County-Level Data Sets: Educational Attainment (from ACS 5-year)', year: '2019–2023',
    url: 'https://www.ers.usda.gov/data-products/county-level-data-sets/county-level-data-sets-download-data',
    notes: 'Adults age 25 and older. American Community Survey 5-year estimates.',
  },
  ers_population: {
    name: 'USDA ERS County-Level Data Sets: Population Estimates (from Census PEP)', year: '2023',
    url: 'https://www.ers.usda.gov/data-products/county-level-data-sets/county-level-data-sets-download-data',
    notes: 'July 1, 2023 resident population estimate.',
  },
  ers_rucc: {
    name: 'USDA ERS Rural-Urban Continuum Codes', year: '2023',
    url: 'https://www.ers.usda.gov/data-products/rural-urban-continuum-codes',
    notes: 'Codes 1–3 metropolitan; 4–9 nonmetropolitan by urban population and metro adjacency.',
  },
  nces_ccd: {
    name: 'NCES Common Core of Data school directory (via Urban Institute Education Data Portal)', year: '2022–23',
    url: 'https://educationdata.urban.org/documentation/schools.html',
    notes: 'Used only to assign each public high school to the county where it is located.',
  },
  ma_dese_college: {
    name: 'Massachusetts DESE, High School Graduates Attending Higher Education (E2C Hub)', year: 'Class of 2024',
    url: 'https://educationtocareer.data.mass.gov/d/kgrx-cg4a',
    notes: 'Public high school graduates matched to National Student Clearinghouse enrollment within 16 months. Results under 15 enrollments suppressed. "Low Income" uses the DESE definition in effect since 2022.',
  },
  ma_dese_grad: {
    name: 'Massachusetts DESE, High School Graduation Rates (E2C Hub)', year: 'Cohort of 2024',
    url: 'https://educationtocareer.data.mass.gov/d/n2xa-p822',
    notes: '4-year adjusted cohort graduation rate.',
  },
  ga_gosa_c11: {
    name: 'Georgia GOSA, C11 report: High School Graduates Enrolled in College within 16 Months', year: 'Class of 2023 (reported 2025)',
    url: 'https://download.gosa.ga.gov/2025/',
    notes: 'Counts of graduates and graduates enrolled in college; "TFS" (too few students) suppressed. Economically disadvantaged uses the GOSA FRL field. No two-year/four-year split is published in this file.',
  },
  ga_gosa_grad: {
    name: 'Georgia GOSA, 4-Year Graduation Rate', year: '2022–23',
    url: 'https://download.gosa.ga.gov/2023/',
    notes: '4-year adjusted cohort graduation rate.',
  },
  ipeds_hd: {
    name: 'NCES IPEDS Institutional Characteristics (HD2023) incl. Carnegie 2021 Undergraduate Profile', year: '2023–24',
    url: 'https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx',
    notes: 'Location, sector, and Carnegie undergraduate profile (used to define "selective").',
  },
  ipeds_sfa: {
    name: 'NCES IPEDS Student Financial Aid (SFA2223)', year: '2022–23',
    url: 'https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx',
    notes: 'Share of undergraduates (all, and full-time first-time) awarded Pell Grants at each institution.',
  },
  usg_srpt405a: {
    name: 'University System of Georgia, SRPT405a: In-State First-Time Freshmen by County of Origin and Institution', year: 'Fall 2024',
    url: 'https://www.usg.edu/research/enrollment-reports/',
    notes: 'Published PDF converted to CSV by scripts/parse-usg-pdf.py; every institution total is checked against the report. Covers the 26 USG public institutions only.',
  },
  usnews_2027: {
    name: 'U.S. News & World Report, 2027 Best National Universities (archived list)', year: '2027 edition (Sept. 2026)',
    url: 'https://web.archive.org/web/20260912160248/https://www.usnews.com/best-colleges/rankings/national-universities',
    notes: 'Used only to define the list of top-50 universities (plus UGA). Matched to IPEDS by the IPEDS ID that U.S. News publishes for each school.',
  },
  ipeds_ef: {
    name: 'NCES IPEDS Fall Enrollment: Residence of First-Time Freshmen (EF2022C)', year: 'Fall 2022',
    url: 'https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx',
    notes: 'First-time freshmen who graduated high school in the past 12 months, by state of residence, at every U.S. institution.',
  },
  fsa_pell_state: {
    name: 'U.S. Dept. of Education, Federal Student Aid: Pell Grant recipients by state (compiled by EducationData.org)', year: '2022–23',
    url: 'https://educationdata.org/pell-grant-statistics',
    notes: 'State totals of Pell recipients and dollars. Secondary compilation of FSA data; counts appear to be by the state where students attend college (e.g., large online universities inflate NH and AZ). Shown for context only; shares are computed from IPEDS.',
  },
  ipeds_gr_pell: {
    name: 'NCES IPEDS Graduation Rates for Pell Grant Recipients (GR2023_PELL_SSL)', year: '2017 cohort (4-yr) / 2020 cohort (2-yr), status Aug 2023',
    url: 'https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx',
    notes: 'Completion within 150% of normal time for full-time, first-time students; Pell recipients vs. all other students.',
  },
};

// ---------------------------------------------------------------- 1. geography
async function buildGeography() {
  console.log('Geography');
  const fc = await shapefile.read(path.join(RAW, 'cb/cb_2023_us_county_5m.shp'), path.join(RAW, 'cb/cb_2023_us_county_5m.dbf'));
  const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0], 4), round(c[1], 4)] : c.map(roundCoords));
  const features = fc.features
    .filter((f) => STATES[f.properties.STATEFP])
    .map((f) => ({
      type: 'Feature',
      id: Number(f.properties.GEOID),
      properties: { fips: f.properties.GEOID, name: f.properties.NAMELSAD, state: STATES[f.properties.STATEFP].abbr },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    }));
  const counts = features.reduce((a, f) => ((a[f.properties.state] = (a[f.properties.state] || 0) + 1), a), {});
  if (counts.MA !== 14 || counts.GA !== 159) throw new Error(`Unexpected county counts ${JSON.stringify(counts)}`);
  write('geo/counties.geojson', { type: 'FeatureCollection', features });
  return features;
}

// ---------------------------------------------------------------- 2. county context
function buildContext(features) {
  console.log('County context');
  const want = new Set(features.map((f) => f.properties.fips).concat(['25000', '13000']));
  const long = (file, fipsKey) => {
    const m = {};
    for (const r of parseCSV(read(file))) {
      const f = pad5(r[fipsKey]);
      if (!want.has(f)) continue;
      (m[f] ||= {})[r.Attribute] = r.Value;
    }
    return m;
  };
  const pov = long('ers_poverty.csv', 'FIPS_Code');
  const edu = long('ers_education.csv', 'FIPS Code');
  const pop = long('ers_population.csv', 'FIPStxt');
  const rucc = long('ers_rucc2023.csv', 'FIPS');
  const cenpop = {};
  for (const s of ['25', '13']) for (const r of parseCSV(read(`cenpop_${s}.txt`))) cenpop[r.STATEFP + r.COUNTYFP] = [num(r.LONGITUDE), num(r.LATITUDE)];

  const record = (f) => {
    const p = pov[f] || {}, e = edu[f] || {}, q = pop[f] || {};
    return {
      population: num(q.POP_ESTIMATE_2023),
      poverty_rate: num(p.PCTPOVALL_2023),
      poverty_rate_ci: [num(p.CI90LBALLP_2023), num(p.CI90UBALLP_2023)],
      child_poverty_rate: num(p.PCTPOV017_2023),
      median_hh_income: num(p.MEDHHINC_2023),
      median_hh_income_ci: [num(p.CI90LBINC_2023), num(p.CI90UBINC_2023)],
      bachelors_pct: round(num(e["Percent of adults with a bachelor's degree or higher, 2019-23"]), 2),
    };
  };
  const counties = {};
  for (const ft of features) {
    const f = ft.properties.fips, r = rucc[f] || {};
    counties[f] = {
      fips: f, name: ft.properties.name, state: ft.properties.state, ...record(f),
      rucc: num(r.RUCC_2023), rucc_desc: r.Description || null,
      pop_center: cenpop[f] || null,
    };
  }
  const states = { MA: record('25000'), GA: record('13000') };
  write('county_context.json', {
    meta: { sources: ['ers_poverty', 'ers_education', 'ers_population', 'ers_rucc', 'census_cenpop'], years: { poverty: 2023, income: 2023, education: '2019-23', population: 2023, rucc: 2023 } },
    states, counties,
  });
  return counties;
}

// ---------------------------------------------------------------- 3. school -> county crosswalk
function buildCrosswalk() {
  const schools = {}, districtCounty = {};
  for (const s of ['25', '13']) {
    const tally = {};
    for (const x of readJSON(`ccd_${s}.json`).results) {
      if (!x.seasch || !x.county_code) continue;
      const county = pad5(x.county_code);
      const key = s === '25' ? x.seasch.split('-')[1] : x.seasch; // MA: 8-digit DESE org code; GA: "district-school"
      schools[`${s}:${key}`] = county;
      const lea = x.state_leaid?.split('-')[1];
      if (lea) ((tally[lea] ||= {})[county] = (tally[lea][county] || 0) + (x.enrollment > 0 ? x.enrollment : 1));
    }
    for (const [lea, t] of Object.entries(tally)) districtCounty[`${s}:${lea}`] = Object.entries(t).sort((a, b) => b[1] - a[1])[0][0];
  }
  return { schools, districtCounty };
}

// ---------------------------------------------------------------- 4. school-level college-going -> counties
function buildCollegeOutcomes(counties) {
  console.log('College-going outcomes');
  const xw = buildCrosswalk();
  const locate = (s, schoolKey, districtKey) => {
    if (xw.schools[`${s}:${schoolKey}`]) return { fips: xw.schools[`${s}:${schoolKey}`], via: 'school' };
    if (xw.districtCounty[`${s}:${districtKey}`]) return { fips: xw.districtCounty[`${s}:${districtKey}`], via: 'district' };
    return null;
  };
  const unlocated = [];
  const schoolRows = [];
  const agg = {};
  const A = (f) => (agg[f] ||= {
    grads_total: 0, schools_total: 0,
    cg: { grads: 0, enrolled: 0, schools: 0 },
    li: { grads: 0, enrolled: 0, schools: 0 }, nonli: { grads: 0, enrolled: 0, schools: 0 },
    li_grads_total: 0,
    dest: { grads: 0, pub4: 0, priv4: 0, pub2: 0, priv2: 0, umass: 0, stuniv: 0, cc: 0, schools: 0 },
    gr: { cohort: 0, grads: 0, schools: 0, cohort_total: 0 },
  });

  // Massachusetts (DESE). Two rows per school: percentages "by High School Grad" and "by College Attendee".
  const ma = readJSON('ma_college.json').filter((r) => r.org_type === 'School');
  const byKey = {};
  for (const r of ma) (byKey[r.org_code] ||= {})[`${r.stu_grp}|${r.percent_by}`] = r;
  for (const [code, g] of Object.entries(byKey)) {
    const all = g['All Students|High School Grad'];
    if (!all) continue;
    const loc = locate('25', code, code.slice(0, 4));
    if (!loc) { unlocated.push(`MA ${all.org_name}`); continue; }
    const a = A(loc.fips), grads = num(all.hs_grad_cnt) || 0, enr = num(all.attend_coll_cnt);
    a.grads_total += grads; a.schools_total++;
    if (enr !== null && grads > 0) { a.cg.grads += grads; a.cg.enrolled += enr; a.cg.schools++; }
    const p = ['pub_4yr_pct', 'priv_4yr_pct', 'pub_2yr_pct', 'priv_2yr_pct', 'ma_umass_pct', 'ma_st_univ_pct', 'ma_comm_coll_pct'].map((k) => num(all[k]));
    if (p.every((v) => v !== null) && grads > 0) {
      a.dest.grads += grads; a.dest.schools++;
      ['pub4', 'priv4', 'pub2', 'priv2', 'umass', 'stuniv', 'cc'].forEach((k, i) => (a.dest[k] += p[i] * grads));
    }
    const li = g['Low Income|High School Grad'];
    const liG = num(li?.hs_grad_cnt), liE = num(li?.attend_coll_cnt);
    if (liG) a.li_grads_total += liG;
    if (liG && liE !== null && enr !== null) {
      a.li.grads += liG; a.li.enrolled += liE; a.li.schools++;
      if (grads - liG > 0) { a.nonli.grads += grads - liG; a.nonli.enrolled += enr - liE; a.nonli.schools++; }
    }
    schoolRows.push({ state: 'MA', id: code, name: all.org_name, district: all.dist_name, fips: loc.fips, located_via: loc.via, hs_grads: grads, enrolled: enr, low_income_grads: liG, low_income_enrolled: liE });
  }
  for (const r of readJSON('ma_grad.json').filter((x) => x.org_type === 'School' && x.stu_grp === 'All Students')) {
    const loc = locate('25', r.org_code, r.org_code.slice(0, 4));
    if (!loc) continue;
    const c = num(r.cohort_cnt), p = num(r.grad_pct), a = A(loc.fips);
    if (c) a.gr.cohort_total += c;
    if (c && p !== null) { a.gr.cohort += c; a.gr.grads += p * c; a.gr.schools++; }
  }

  // Georgia (GOSA C11). One row per school with counts by subgroup.
  for (const r of parseCSV(read('ga_c11_2023.csv')).filter((x) => x.INSTN_NUMBER !== 'ALL')) {
    const loc = locate('13', `${r.SCHOOL_DISTRCT_CD}-${r.INSTN_NUMBER}`, r.SCHOOL_DISTRCT_CD);
    if (!loc) { unlocated.push(`GA ${r.INSTN_NAME}`); continue; }
    const a = A(loc.fips), grads = num(r.TOTAL_HS_GRADS), enr = num(r.TOTAL_ENROLLED_IN_COLLEGE);
    if (grads) { a.grads_total += grads; a.schools_total++; }
    if (grads && enr !== null) { a.cg.grads += grads; a.cg.enrolled += enr; a.cg.schools++; }
    const liG = num(r.FRL_HS_GRADS), liE = num(r.FRL_IN_COLLEGE);
    if (liG) a.li_grads_total += liG;
    if (liG && liE !== null && grads && enr !== null) {
      a.li.grads += liG; a.li.enrolled += liE; a.li.schools++;
      if (grads - liG > 0) { a.nonli.grads += grads - liG; a.nonli.enrolled += enr - liE; a.nonli.schools++; }
    }
    schoolRows.push({ state: 'GA', id: `${r.SCHOOL_DISTRCT_CD}-${r.INSTN_NUMBER}`, name: r.INSTN_NAME, district: r.SCHOOL_DSTRCT_NM, fips: loc.fips, located_via: loc.via, hs_grads: grads, enrolled: enr, low_income_grads: liG, low_income_enrolled: liE });
  }
  const gaGrad = parseCSV(read('ga_grad_2023.csv'));
  for (const r of gaGrad.filter((x) => x.DETAIL_LVL_DESC === 'School' && x.LABEL_LVL_1_DESC === 'Grad Rate -ALL Students')) {
    const loc = locate('13', `${r.SCHOOL_DSTRCT_CD}-${r.INSTN_NUMBER}`, r.SCHOOL_DSTRCT_CD);
    if (!loc) continue;
    const c = num(r.TOTAL_COUNT), g = num(r.PROGRAM_TOTAL), a = A(loc.fips);
    if (c) a.gr.cohort_total += c;
    if (c && g !== null) { a.gr.cohort += c; a.gr.grads += g; a.gr.schools++; }
  }

  // County records. Rates are graduate-weighted (sum of enrolled / sum of graduates), never averages of school percentages.
  const out = {};
  for (const f of Object.keys(counties)) {
    const a = agg[f];
    if (!a) { out[f] = { college_going: null, grad_rate: null, low_income: null, non_low_income: null, destinations: null, notes: ['No public high school graduates reported for schools located in this county.'] }; continue; }
    const notes = [];
    const cov = ratio(a.cg.grads, a.grads_total);
    if (cov !== null && cov < 0.9) notes.push(`College-going rate covers ${(cov * 100).toFixed(0)}% of graduates; the rest are in suppressed school results.`);
    const liCov = ratio(a.li.grads, a.li_grads_total);
    if (a.li_grads_total && (liCov ?? 0) < 0.9) notes.push(`Low-income college-going covers ${((liCov ?? 0) * 100).toFixed(0)}% of low-income graduates because of small-group suppression.`);
    out[f] = {
      college_going: a.cg.grads ? { value: ratio(a.cg.enrolled, a.cg.grads), graduates: a.cg.grads, enrolled: a.cg.enrolled, schools: a.cg.schools, schools_total: a.schools_total, coverage: cov } : null,
      grad_rate: a.gr.cohort ? { value: ratio(a.gr.grads, a.gr.cohort), cohort: a.gr.cohort, schools: a.gr.schools, coverage: ratio(a.gr.cohort, a.gr.cohort_total) } : null,
      low_income: a.li.grads >= 10 ? { value: ratio(a.li.enrolled, a.li.grads), graduates: a.li.grads, enrolled: a.li.enrolled, schools: a.li.schools, coverage: liCov } : null,
      non_low_income: a.nonli.grads >= 10 && a.li.grads >= 10 ? { value: ratio(a.nonli.enrolled, a.nonli.grads), graduates: a.nonli.grads, enrolled: a.nonli.enrolled, derived: true } : null,
      destinations: a.dest.grads ? {
        basis: 'share of all high school graduates', graduates: a.dest.grads, schools: a.dest.schools, coverage: ratio(a.dest.grads, a.grads_total),
        four_year: ratio(a.dest.pub4 + a.dest.priv4, a.dest.grads), two_year: ratio(a.dest.pub2 + a.dest.priv2, a.dest.grads),
        public_4yr: ratio(a.dest.pub4, a.dest.grads), private_4yr: ratio(a.dest.priv4, a.dest.grads),
        public_2yr: ratio(a.dest.pub2, a.dest.grads), private_2yr: ratio(a.dest.priv2, a.dest.grads),
        umass: ratio(a.dest.umass, a.dest.grads), ma_state_univ: ratio(a.dest.stuniv, a.dest.grads), ma_comm_coll: ratio(a.dest.cc, a.dest.grads),
      } : null,
      notes,
    };
  }

  // Statewide benchmarks straight from the publishers' state rows (not re-aggregated).
  const maS = readJSON('ma_college.json').filter((r) => r.org_type === 'State');
  const pick = (grp, by) => maS.find((r) => r.stu_grp === grp && r.percent_by === by);
  const mAll = pick('All Students', 'High School Grad'), mLi = pick('Low Income', 'High School Grad');
  const maGrad = readJSON('ma_grad.json').find((r) => r.org_type === 'State' && r.stu_grp === 'All Students');
  const gaAll = parseCSV(read('ga_c11_2023.csv')).find((x) => x.SCHOOL_DISTRCT_CD === 'ALL');
  const gaGradState = gaGrad.find((x) => x.DETAIL_LVL_DESC === 'State' && x.LABEL_LVL_1_DESC === 'Grad Rate -ALL Students');
  const nonli = (g, e, lg, le) => ratio(e - le, g - lg);
  const states = {
    MA: {
      college_going: num(mAll.attend_coll_pct), graduates: num(mAll.hs_grad_cnt),
      low_income: num(mLi.attend_coll_pct), non_low_income: nonli(num(mAll.hs_grad_cnt), num(mAll.attend_coll_cnt), num(mLi.hs_grad_cnt), num(mLi.attend_coll_cnt)),
      four_year: round(num(mAll.pub_4yr_pct) + num(mAll.priv_4yr_pct), 3), two_year: round(num(mAll.pub_2yr_pct) + num(mAll.priv_2yr_pct), 3),
      grad_rate: num(maGrad.grad_pct),
      low_income_label: 'Low Income (DESE)',
    },
    GA: {
      college_going: ratio(num(gaAll.TOTAL_ENROLLED_IN_COLLEGE), num(gaAll.TOTAL_HS_GRADS)), graduates: num(gaAll.TOTAL_HS_GRADS),
      low_income: ratio(num(gaAll.FRL_IN_COLLEGE), num(gaAll.FRL_HS_GRADS)),
      non_low_income: nonli(num(gaAll.TOTAL_HS_GRADS), num(gaAll.TOTAL_ENROLLED_IN_COLLEGE), num(gaAll.FRL_HS_GRADS), num(gaAll.FRL_IN_COLLEGE)),
      four_year: null, two_year: null,
      grad_rate: ratio(num(gaGradState.PROGRAM_TOTAL), num(gaGradState.TOTAL_COUNT)),
      low_income_label: 'Economically disadvantaged (GOSA FRL field)',
    },
  };
  write('college_outcomes.json', {
    meta: {
      sources: { MA: ['ma_dese_college', 'ma_dese_grad', 'nces_ccd'], GA: ['ga_gosa_c11', 'ga_gosa_grad', 'nces_ccd'] },
      years: { MA: { college_going: 'Class of 2024', grad_rate: 'Cohort of 2024' }, GA: { college_going: 'Class of 2023', grad_rate: 'Cohort of 2023 (2022–23)' } },
      method: 'Schools are assigned to the county where they are located (NCES CCD). County rates are graduate-weighted: total enrolled / total graduates over schools with unsuppressed results. Coverage = graduates in unsuppressed schools / all graduates in the county.',
      unlocated_schools: unlocated,
    },
    states, counties: out,
  });
  write('schools.json', { meta: { note: 'School-level inputs to county aggregation, after locating each school in a county.' }, schools: schoolRows });
  console.log(`  ${schoolRows.length} schools aggregated, ${unlocated.length} could not be located: ${unlocated.join('; ')}`);
}

// ---------------------------------------------------------------- 5. institutions, Pell statistics, proximity
function buildInstitutions(counties) {
  console.log('Institutions & Pell');
  const SELECTIVE = new Set([8, 9, 12, 13, 14, 15]);
  const hd = parseCSV(read('ipeds_hd2023.csv'));
  const sfa = Object.fromEntries(parseCSV(read('ipeds_sfa2223.csv')).map((r) => [r.UNITID, r]));
  const gr = {};
  for (const r of parseCSV(read('ipeds_gr2023_pell.csv'))) (gr[r.UNITID] ||= {})[r.PSGRTYPE] = r;

  const universe = [];
  for (const r of hd) {
    const sector = num(r.SECTOR);
    if (num(r.CYACTIVE) !== 1 || num(r.UGOFFER) !== 1 || num(r.DEGGRANT) !== 1 || !(sector >= 1 && sector <= 6)) continue;
    const lon = num(r.LONGITUD), lat = num(r.LATITUDE);
    if (lon === null || lat === null) continue;
    const ugprof = num(r.C21UGPRF);
    if (ugprof === 0) continue; // exclusively graduate
    universe.push({ r, sector, ugprof, lon, lat });
  }
  const inst = [];
  for (const { r, sector, ugprof, lon, lat } of universe) {
    if (!INSTITUTION_STATES.has(r.STABBR)) continue;
    const s = sfa[r.UNITID] || {};
    const g = gr[r.UNITID] || {};
    const four = num(r.ICLEVEL) === 1;
    const c = four ? g['1'] : g['4'];
    let grad = null;
    if (c) {
      const pN = num(c.PGADJCT), pC = num(c.PGCMTOT), tN = num(c.TTADJCT), tC = num(c.TTCMTOT);
      if (tN) grad = {
        cohort: four ? 'Full-time first-time entering 2017, completion within 6 years' : 'Full-time first-time entering 2020, completion within 3 years',
        pell_n: pN, pell_rate: pN >= SMALL_COHORT ? ratio(pC, pN) : null,
        nonpell_n: tN - (pN || 0), nonpell_rate: tN - (pN || 0) >= SMALL_COHORT ? ratio(tC - (pC || 0), tN - (pN || 0)) : null,
        all_rate: ratio(tC, tN),
      };
    }
    inst.push({
      id: Number(r.UNITID), name: r.INSTNM, city: r.CITY, state: r.STABBR, county_fips: r.COUNTYCD ? pad5(r.COUNTYCD) : null,
      lon: round(lon, 4), lat: round(lat, 4), sector, level: four ? '4-year' : '2-year',
      control: ['', 'Public', 'Private nonprofit', 'Private for-profit'][num(r.CONTROL)] || null,
      selective: SELECTIVE.has(ugprof), more_selective: ugprof === 14 || ugprof === 15, hbcu: num(r.HBCU) === 1,
      undergrads: num(s.SCUGRAD), pell_pct_undergrad: num(s.UPGRNTP), pell_pct_ftft: num(s.PGRNT_P),
      pell_grad: grad,
    });
  }

  // County proximity: straight-line miles from the 2020 population center to the nearest institution of each type (any state).
  const types = {
    any: (u) => true,
    public_2yr: (u) => u.sector === 4,
    four_year: (u) => u.sector === 1 || u.sector === 2,
    public_4yr: (u) => u.sector === 1,
    selective: (u) => SELECTIVE.has(u.ugprof),
  };
  const access = {};
  for (const [f, c] of Object.entries(counties)) {
    if (!c.pop_center) { access[f] = null; continue; }
    const rec = { origin: 'county 2020 population center', radius_miles: NEAR_MILES };
    for (const [t, test] of Object.entries(types)) {
      let best = null, n = 0;
      for (const u of universe) {
        if (!test(u)) continue;
        const d = milesBetween(c.pop_center, [u.lon, u.lat]);
        if (d <= NEAR_MILES) n++;
        if (!best || d < best.d) best = { d, id: Number(u.r.UNITID), name: u.r.INSTNM, state: u.r.STABBR };
      }
      rec[t] = { nearest_miles: round(best.d, 1), nearest: { id: best.id, name: best.name, state: best.state }, within_radius: n };
    }
    access[f] = rec;
  }
  buildPellElite(hd, sfa);
  buildGaDestinations(hd, sfa, counties);
  buildTop50(hd, sfa);

  write('institutions.json', {
    meta: {
      sources: ['ipeds_hd', 'ipeds_sfa', 'ipeds_gr_pell'],
      universe: 'Active, degree-granting, undergraduate-serving institutions (IPEDS sectors 1–6) in MA, GA, and neighbouring states.',
      selective_definition: 'Carnegie 2021 Undergraduate Profile classes 8, 9, 12–15 ("selective" or "more selective", based on first-year test scores).',
      small_cohort_rule: `Pell / non-Pell graduation rates withheld when the subgroup cohort is under ${SMALL_COHORT}.`,
      caution: 'These are statistics about students enrolled at each institution. They do not describe students from any county.',
    },
    institutions: inst,
  });
  write('county_access.json', {
    meta: { sources: ['ipeds_hd', 'census_cenpop'], method: `Great-circle (straight-line) miles from the county's 2020 population center to the nearest institution of each type, in any state. Counts are institutions within ${NEAR_MILES} miles. Travel time, transit, and admissions are not considered.` },
    counties: access,
  });
}

// ---------------------------------------------------------------- 6. Pell students at elite colleges (state level)
// Compares the share of undergraduates receiving Pell at a state's most selective
// colleges with the share across ALL undergraduates enrolled in that state.
// Both sides count students where they are enrolled, so the comparison is consistent.
// Numerator and denominator come from IPEDS SFA; FSA recipient totals are shown alongside.
function buildPellElite(hd, sfa) {
  console.log('Pell at elite colleges');
  const ELITE = new Set([14, 15]); // Carnegie 2021 UG Profile: four-year, full-time, MORE selective
  const fsa = Object.fromEntries(parseCSV(read('fsa_pell_by_state.csv')).map((r) => [r.state, r]));
  const out = {};
  for (const st of ['MA', 'GA']) {
    let pell = 0, ug = 0, institutions = 0;
    const elite = [];
    for (const r of hd) {
      if (r.STABBR !== st || num(r.CYACTIVE) !== 1 || num(r.UGOFFER) !== 1) continue;
      const s = sfa[r.UNITID];
      if (!s) continue;
      const p = num(s.UPGRNTN), u = num(s.SCUGRAD);
      if (p === null || !u) continue;
      pell += p; ug += u; institutions++;
      if (ELITE.has(num(r.C21UGPRF)) && num(r.DEGGRANT) === 1) {
        elite.push({
          id: Number(r.UNITID), name: r.INSTNM, city: r.CITY,
          control: ['', 'Public', 'Private nonprofit', 'Private for-profit'][num(r.CONTROL)] || null,
          undergrads: u, pell_n: p, pell_pct: round((p / u) * 100, 1),
          pell_pct_ftft: num(s.PGRNT_P), more_selective: true,
        });
      }
    }
    const eu = elite.reduce((a, e) => a + e.undergrads, 0), ep = elite.reduce((a, e) => a + e.pell_n, 0);
    const statePct = (pell / ug) * 100, elitePct = eu ? (ep / eu) * 100 : null;
    const f = fsa[st];
    out[st] = {
      statewide: { institutions, undergrads: ug, pell_recipients: pell, pell_pct: round(statePct, 1) },
      fsa: f ? { recipients: num(f.pell_recipients), total_awards_millions: num(f.total_awards_millions), year: f.award_year } : null,
      elite: { colleges: elite.length, undergrads: eu, pell_recipients: ep, pell_pct: round(elitePct, 1) },
      representation_ratio: elitePct == null ? null : round(elitePct / statePct, 2),
      colleges: elite.sort((a, b) => b.undergrads - a.undergrads),
    };
  }
  write('pell_elite.json', {
    meta: {
      sources: ['ipeds_sfa', 'ipeds_hd', 'fsa_pell_state'],
      year: '2022–23 aid year',
      elite_definition: 'Carnegie 2021 Undergraduate Profile classes 14–15: four-year, full-time, "more selective" (first-year test scores in roughly the top fifth of baccalaureate institutions).',
      statewide_definition: 'All active, undergraduate-serving IPEDS institutions located in the state that reported Pell recipients (UPGRNTN) and undergraduates (SCUGRAD) in SFA2223.',
      ratio_definition: 'Representation ratio = Pell share at elite colleges ÷ Pell share of all undergraduates enrolled in the state. 1.00 = proportional.',
      caution: 'Counts students by where they enroll, not where they live. Pell receipt reflects students who enrolled and applied for aid; it is not Pell eligibility.',
    },
    states: out,
  });
}

// ---------------------------------------------------------------- 7. Georgia county -> USG destination (origin-linked)
// USG SRPT405a counts in-state first-time freshmen by Georgia county of origin at each
// USG institution. Joined to IPEDS for selectivity and each destination's Pell share.
function buildGaDestinations(hd, sfa, counties) {
  console.log('Georgia county-of-origin destinations (USG)');
  const file = 'usg_ftf_county_fall2024.csv';
  if (!fs.existsSync(path.join(RAW, file))) { console.log(`  skipped: ${file} not found (run scripts/parse-usg-pdf.py)`); return; }
  const norm = (s) => s.toLowerCase().replace(/ county$/, '').replace(/[^a-z]/g, '');
  const fipsByName = Object.fromEntries(Object.values(counties).filter((c) => c.state === 'GA').map((c) => [norm(c.name), c.fips]));
  const gaHd = hd.filter((r) => r.STABBR === 'GA' && num(r.CYACTIVE) === 1);
  const instCache = {};
  const ipedsFor = (name) => {
    if (instCache[name]) return instCache[name];
    const n = norm(name);
    const r = gaHd.find((x) => norm(x.INSTNM) === n) || gaHd.find((x) => norm(x.INSTNM).startsWith(n));
    if (!r) throw new Error(`USG institution not found in IPEDS: ${name}`);
    const s = sfa[r.UNITID] || {};
    return (instCache[name] = {
      name, unitid: Number(r.UNITID), more_selective: [14, 15].includes(num(r.C21UGPRF)),
      pell_pct_ftft: num(s.PGRNT_P), pell_pct_undergrad: num(s.UPGRNTP),
    });
  };
  const by = {};
  for (const r of parseCSV(read(file))) {
    const f = fipsByName[norm(r.county)];
    if (!f) throw new Error(`USG county not matched: ${r.county}`);
    (by[f] ||= []).push({ inst: ipedsFor(r.institution), n: num(r.count) });
  }
  const MIN_N = 10;
  const out = {};
  for (const c of Object.values(counties).filter((x) => x.state === 'GA')) {
    const list = by[c.fips] || [];
    const total = list.reduce((a, x) => a + x.n, 0);
    const elite = list.filter((x) => x.inst.more_selective).reduce((a, x) => a + x.n, 0);
    const withPell = list.filter((x) => x.inst.pell_pct_ftft != null);
    const pn = withPell.reduce((a, x) => a + x.n, 0);
    out[c.fips] = {
      freshmen: total, elite_freshmen: elite,
      elite_share: total >= MIN_N ? ratio(elite, total) : null,
      pell_dest_pct: pn >= MIN_N ? round(withPell.reduce((a, x) => a + x.n * x.inst.pell_pct_ftft, 0) / pn, 1) : null,
      small: total < 30,
      top: [...list].sort((a, b) => b.n - a.n).slice(0, 8).map((x) => ({ name: x.inst.name, n: x.n, elite: x.inst.more_selective, pell_pct: x.inst.pell_pct_ftft })),
    };
  }
  const all = Object.values(by).flat();
  const T = all.reduce((a, x) => a + x.n, 0), E = all.filter((x) => x.inst.more_selective).reduce((a, x) => a + x.n, 0);
  const P = all.filter((x) => x.inst.pell_pct_ftft != null);
  write('ga_destinations.json', {
    meta: {
      sources: ['usg_srpt405a', 'ipeds_hd', 'ipeds_sfa'], year: 'Fall 2024 first-time freshmen; IPEDS 2022–23 aid year',
      elite_institutions: Object.values(instCache).filter((i) => i.more_selective).map((i) => i.name),
      universe: 'In-state first-time freshmen at the 26 University System of Georgia institutions. Excludes technical colleges (TCSG), private colleges, and out-of-state enrollment.',
      min_freshmen: MIN_N,
    },
    state: { freshmen: T, elite_freshmen: E, elite_share: ratio(E, T), pell_dest_pct: round(P.reduce((a, x) => a + x.n * x.inst.pell_pct_ftft, 0) / P.reduce((a, x) => a + x.n, 0), 1) },
    institutions: Object.values(instCache),
    counties: out,
  });
}

// ---------------------------------------------------------------- 8. Where each state sends students in the U.S. News top 50
// IPEDS EF2022C: first-time freshmen who graduated high school in the prior 12 months
// (EFRES02), by state of residence, at every U.S. institution. Joined to the U.S. News
// 2027 National Universities list (top 50 incl. ties, plus UGA) and IPEDS Pell shares.
function buildTop50(hd, sfa) {
  console.log('U.S. News top 50 destinations');
  const list = parseCSV(read('usnews_national_universities_2027.csv'));
  const hdBy = Object.fromEntries(hd.map((r) => [r.UNITID, r]));
  const ef = {};
  for (const r of parseCSV(read('ipeds_ef2022c.csv'))) (ef[r.UNITID] ||= {})[r.EFCSTATE] = num(r.EFRES02) ?? 0;
  const FIPS = { MA: '25', GA: '13' };
  const pellOf = (u) => num(sfa[u]?.PGRNT_P);
  const out = {};
  for (const [st, fp] of Object.entries(FIPS)) {
    let total = 0, pA = 0, pN = 0;
    for (const [u, byState] of Object.entries(ef)) {
      const n = byState[fp] || 0;
      if (!n) continue;
      total += n;
      const p = pellOf(u);
      if (p != null) { pA += n * p; pN += n; }
    }
    const schools = list.map((s) => {
      const n = ef[s.unitid]?.[fp] || 0;
      return { unitid: Number(s.unitid), name: s.name, rank: s.display_rank, state: s.state, control: s.control, added: s.inclusion !== 'top50', freshmen: n, pell_pct_ftft: pellOf(s.unitid), in_state: s.state === st };
    });
    const sent = schools.filter((s) => s.freshmen > 0);
    const T = sent.reduce((a, s) => a + s.freshmen, 0);
    const wp = sent.filter((s) => s.pell_pct_ftft != null);
    const sumN = (f) => sent.filter(f).reduce((a, s) => a + s.freshmen, 0);
    out[st] = {
      recent_grad_freshmen: total,
      top50_freshmen: T,
      top50_share: ratio(T, total),
      strict_top50_freshmen: sumN((s) => !s.added),
      strict_top50_share: ratio(sumN((s) => !s.added), total),
      in_state_top50_freshmen: sumN((s) => s.in_state),
      private_top50_freshmen: sumN((s) => s.control !== 'public'),
      pell_at_top50: round(wp.reduce((a, s) => a + s.freshmen * s.pell_pct_ftft, 0) / wp.reduce((a, s) => a + s.freshmen, 0), 1),
      pell_at_all_destinations: round(pA / pN, 1),
      schools: schools.sort((a, b) => b.freshmen - a.freshmen),
    };
  }
  write('top50.json', {
    meta: {
      sources: ['usnews_2027', 'ipeds_ef', 'ipeds_sfa'],
      year: 'Fall 2022 first-time freshmen (IPEDS); U.S. News 2027 ranking; Pell shares 2022–23',
      list_definition: `U.S. News & World Report 2027 Best National Universities ranked #1–#49 (${list.filter((s) => s.inclusion === 'top50').length} schools, including ties), plus the University of Georgia (#52), added for this analysis.`,
      population: 'Freshmen who graduated high school in the previous 12 months, counted by state of residence, at every U.S. college reporting to IPEDS (public and private schools).',
      pell_definition: 'Share of each college’s first-time, full-time freshmen receiving Pell Grants (all students at that college, from any state).',
      caution: 'Counts residents of each state by where they enrolled; the Pell share describes each college’s whole freshman class, not the Massachusetts or Georgia students specifically. The ranking year (2027) is later than the enrollment year (fall 2022).',
    },
    states: out,
  });
}

// ---------------------------------------------------------------- run
const features = await buildGeography();
const counties = buildContext(features);
buildCollegeOutcomes(counties);
buildInstitutions(counties);
write('sources.json', { built: new Date().toISOString(), sources: SOURCES });
console.log('Data build complete.');
