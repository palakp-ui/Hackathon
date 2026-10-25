"""Convert the Maryland Higher Education Commission "Enrollment by Place of Residence"
PDF (Fall 2025) into a tidy CSV of enrollment by Maryland county of residence and institution.

    .venv/bin/python scripts/parse-mhec-pdf.py data/raw/mhec_enrollment_by_residence_fall2025.pdf data/raw/mhec_county_institution_fall2025.csv

Output columns: county,institution,new_ft,total
  new_ft = new (first-time) full-time undergraduates; total = all enrollment.

Each count row has up to 8 numbers with blanks for zero:
  NewUG_FT | UG_FT UG_PT UG_Total | Grad_FT Grad_PT Grad_Total | Total
Blanks are dropped in the PDF text, so numbers are assigned to columns using the
table's own arithmetic. A row is kept only if every valid assignment agrees on
new_ft and total. Each county's institution rows are then checked against that
county's GRAND TOTAL row; the script exits with an error on any mismatch.
"""
import csv
import itertools
import sys

from pypdf import PdfReader

COLS = ["new_ft", "ug_ft", "ug_pt", "ug_total", "grad_ft", "grad_pt", "grad_total", "total"]
# Spellings exactly as printed in the PDF (curly apostrophes, "Saint Mary’s").
COUNTIES = [
    "Allegany", "Anne Arundel", "Baltimore City", "Baltimore County", "Calvert", "Caroline", "Carroll", "Cecil",
    "Charles", "Dorchester", "Frederick", "Garrett", "Harford", "Howard", "Kent", "Montgomery", "Prince George’s",
    "Queen Anne’s", "Somerset", "Saint Mary’s", "Talbot", "Washington", "Wicomico", "Worcester",
]
PRINTED = {"Baltimore County": "Baltimore"}  # label used in the PDF when it differs
SUBTOTALS = {"Independent4YR", "Public2YR", "Public4YR", "GRAND TOTAL"}


def valid(a):
    d = dict(zip(COLS, a))
    return (d["ug_total"] == d["ug_ft"] + d["ug_pt"] and d["grad_total"] == d["grad_ft"] + d["grad_pt"]
            and d["total"] == d["ug_total"] + d["grad_total"] and d["new_ft"] <= d["ug_ft"] and d["total"] > 0)


def resolve(nums):
    keys = set()
    for slots in itertools.combinations(range(8), len(nums)):
        a = [0] * 8
        for s, n in zip(slots, nums):
            a[s] = n
        if valid(a):
            keys.add((a[0], a[7]))
    return keys


def main(src, dst):
    reader = PdfReader(src)
    order = sorted(COUNTIES, key=lambda c: len(PRINTED.get(c, c)), reverse=True)
    rows, grand, unresolved = [], {}, []
    for page in reader.pages:
        for line in page.extract_text().split("\n"):
            line = line.strip()
            if "%" in line:
                continue  # percent tables repeat the counts
            # Longest printed county label wins, so "Baltimore City Community College of Baltimore County"
            # is Baltimore City residents at CCBC, and "Baltimore Baltimore City Community College" is
            # Baltimore County residents at BCCC. The GRAND TOTAL check below confirms this.
            county = next((c for c in order if line.startswith(PRINTED.get(c, c) + " ")), None)
            prefix = PRINTED.get(county, county) + " " if county else ""
            if not county:
                continue
            toks = line[len(prefix):].split(" ")
            i = len(toks)
            while i > 0 and toks[i - 1].replace(",", "").isdigit():
                i -= 1
            name = " ".join(toks[:i]).strip()
            nums = [int(t.replace(",", "")) for t in toks[i:]]
            if not name or not nums:
                continue
            keys = resolve(nums)
            if len(keys) != 1:
                unresolved.append((county, name, nums, sorted(keys)))
                continue
            new_ft, total = keys.pop()
            if name == "GRAND TOTAL":
                grand[county] = (new_ft, total)
            elif name not in SUBTOTALS:
                rows.append({"county": county, "institution": name, "new_ft": new_ft, "total": total})

    errors = []
    if unresolved:
        errors.append(f"{len(unresolved)} rows could not be resolved, e.g. {unresolved[:3]}")
    for c in COUNTIES:
        if c not in grand:
            errors.append(f"No GRAND TOTAL row for {c}")
            continue
        s_new = sum(r["new_ft"] for r in rows if r["county"] == c)
        s_tot = sum(r["total"] for r in rows if r["county"] == c)
        if (s_new, s_tot) != grand[c]:
            errors.append(f"{c}: parsed new_ft/total {s_new}/{s_tot} vs GRAND TOTAL {grand[c][0]}/{grand[c][1]}")
    if errors:
        sys.exit("Validation failed:\n  " + "\n  ".join(errors))

    with open(dst, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["county", "institution", "new_ft", "total"])
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} rows, {len(grand)} counties; every county matches its GRAND TOTAL "
          f"({sum(g[0] for g in grand.values())} new full-time undergraduates).")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
