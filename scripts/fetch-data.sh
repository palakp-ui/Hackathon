#!/usr/bin/env bash
# Downloads every raw public dataset used by the visualization into data/raw/.
# Re-run this, then `npm run build:data`, to refresh the app with newer releases.
# When a publisher changes a file name (GOSA and ERS do this between releases),
# update the URL here and the matching entry in scripts/build-data.mjs SOURCES.
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
UA="Mozilla/5.0 (research data download)"
get() { echo "-> $2"; curl -sSfL -m 300 -A "$UA" -o "$2" "$1"; }

# --- Geography: Census cartographic boundary counties (2023, 1:5m) ---
get "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_5m.zip" cb_2023_us_county_5m.zip
mkdir -p cb && unzip -o -q cb_2023_us_county_5m.zip -d cb
# County 2020 centers of population (used for straight-line distance to colleges)
get "https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO25.txt" cenpop_25.txt
get "https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO13.txt" cenpop_13.txt

# --- County context: USDA ERS county-level data sets (SAIPE, ACS, RUCC) ---
ERS="https://www.ers.usda.gov/media"
get "$ERS/5496/poverty-estimates-for-the-united-states-states-and-counties-2023.csv" ers_poverty.csv
get "$ERS/5495/educational-attainment-for-adults-age-25-and-older-for-the-united-states-states-and-counties-1970-2023.csv" ers_education.csv
get "$ERS/5499/population-estimates-for-the-united-states-states-and-counties-2020-23.csv" ers_population.csv
get "$ERS/5768/2023-rural-urban-continuum-codes.csv" ers_rucc2023.csv

# --- School directory: NCES Common Core of Data via Urban Institute Education Data API ---
get "https://educationdata.urban.org/api/v1/schools/ccd/directory/2022/?fips=25" ccd_25.json
get "https://educationdata.urban.org/api/v1/schools/ccd/directory/2022/?fips=13" ccd_13.json

# --- Massachusetts DESE via Education-to-Career Hub (Socrata) ---
E2C="https://educationtocareer.data.mass.gov/resource"
curl -sSfLG -m 300 -o ma_college.json "$E2C/kgrx-cg4a.json" \
  --data-urlencode "\$limit=50000" \
  --data-urlencode "\$where=sy='2024' AND attend_range='16 Months' AND in_out_state='All Colleges and Universities' AND stu_grp in ('All Students','Low Income')"
curl -sSfLG -m 300 -o ma_grad.json "$E2C/n2xa-p822.json" \
  --data-urlencode "\$limit=50000" \
  --data-urlencode "\$where=sy='2024' AND grad_rate_type='4-Year Graduation Rate' AND stu_grp in ('All Students','Low Income')"

# --- Georgia GOSA downloadable data repository ---
get "https://download.gosa.ga.gov/2025/C11_2025_2023_2026-02-19_00_27_20.csv" ga_c11_2023.csv
get "https://download.gosa.ga.gov/2023/Graduation_Rate_2022-23_2025-06-17_14_52_53.csv" ga_grad_2023.csv

# --- NCES IPEDS complete data files ---
IP="https://nces.ed.gov/ipeds/datacenter/data"
for f in HD2023 SFA2223 GR2023_PELL_SSL; do get "$IP/$f.zip" "$f.zip"; unzip -o -q "$f.zip"; rm "$f.zip"; done
mv -f HD2023.csv ipeds_hd2023.csv
get "$IP/EF2022C.zip" EF2022C.zip && unzip -o -q EF2022C.zip && rm EF2022C.zip && mv -f ef2022c_rv.csv ipeds_ef2022c.csv && rm -f ef2022c.csv
# U.S. News list: data/raw/usnews_national_universities_2027.csv is maintained by hand
# (rank, name, state, control, IPEDS unitid). Edit that file to change the list.
mv -f sfa2223.csv ipeds_sfa2223.csv
mv -f gr2023_pell_ssl.csv ipeds_gr2023_pell.csv
# --- University System of Georgia: first-time freshmen by county of origin (PDF -> CSV) ---
get "https://pxl-usgedu.terminalfour.net/prod01/channel_4/media/usg/research/documents/srpt405a_FTF_SER_Fall_2024.pdf" usg_srpt405a_ftf_fall2024.pdf
if [ ! -x ../../.venv/bin/python ]; then python3 -m venv ../../.venv && ../../.venv/bin/pip -q install pypdf==5.1.0; fi
../../.venv/bin/python ../../scripts/parse-usg-pdf.py usg_srpt405a_ftf_fall2024.pdf usg_ftf_county_fall2024.csv

echo "Done. Now run: npm run build:data"
