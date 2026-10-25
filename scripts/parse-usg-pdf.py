"""Convert the University System of Georgia SRPT405a PDF (in-state first-time freshmen
by Georgia county of origin, per institution) into a tidy CSV.

    python3 -m venv .venv && .venv/bin/pip install pypdf==5.1.0
    .venv/bin/python scripts/parse-usg-pdf.py data/raw/usg_srpt405a_ftf_fall2024.pdf data/raw/usg_ftf_county_fall2024.csv

Output columns: institution,county,count
The script checks every institution's county counts against the report's own
"<Institution> Total" line and the system total, and exits with an error on mismatch.
"""
import csv
import re
import sys

from pypdf import PdfReader

INSTITUTIONS = [
    "Augusta University", "Georgia Institute of Technology", "Georgia State University", "University of Georgia",
    "Georgia Southern University", "Kennesaw State University", "University of West Georgia", "Valdosta State University",
    "Albany State University", "Clayton State University", "Columbus State University", "Fort Valley State University",
    "Georgia College & State University", "Georgia Southwestern State University", "Middle Georgia State University",
    "Savannah State University", "University of North Georgia",
    "Abraham Baldwin Agricultural College", "Atlanta Metropolitan State College", "College of Coastal Georgia",
    "Dalton State College", "East Georgia State College", "Georgia Gwinnett College", "Georgia Highlands College",
    "Gordon State College", "South Georgia State College",
]
ROW = re.compile(r"^([A-Z][A-Za-z .']*?) ([\d,]+) ([\d.]+)$")
INT = re.compile(r"^[\d,]+$")


def main(src, dst):
    lines = [l.strip() for p in PdfReader(src).pages for l in p.extract_text().split("\n")]
    rows, totals, current, expect_total, system_total = [], {}, None, False, None
    for i, s in enumerate(lines):
        if s in INSTITUTIONS and s != current:
            current, expect_total = s, False
            continue
        if s == current or s.endswith(" Total") or s == "Total":
            expect_total = True
            if s == "System Total":
                system_total = int(lines[i + 1].replace(",", ""))
            continue
        if expect_total and INT.match(s):
            totals.setdefault(current, int(s.replace(",", "")))
            expect_total = False
            continue
        m = ROW.match(s)
        if m and current:
            rows.append((current, m.group(1).strip(), int(m.group(2).replace(",", ""))))

    sums = {}
    for inst, _, n in rows:
        sums[inst] = sums.get(inst, 0) + n
    bad = [(k, sums.get(k), totals.get(k)) for k in INSTITUTIONS if sums.get(k) != totals.get(k)]
    if bad:
        sys.exit(f"Count check failed (institution, parsed, reported): {bad}")
    if sum(sums.values()) != system_total:
        sys.exit(f"System total mismatch: parsed {sum(sums.values())}, reported {system_total}")

    with open(dst, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["institution", "county", "count"])
        w.writerows(rows)
    print(f"{len(rows)} rows, {len(sums)} institutions, {system_total} freshmen; all totals match the report.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
