import pandas as pd
import json
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
INPUT = BASE / "2025_journal_info.xlsx"
OUTPUT = BASE / "journals.js"

COLUMN_MAP = {
    "期刊名称": "journal",
    "期刊缩写": "abbreviation",
    "ISSN": "issn",
    "eISSN": "eissn",
    "出版商": "publisher",
    "学科类别": "category",
    "影响因子JIF": "jif",
    "JIF分区": "quartile",
    "JIF百分位": "percentile",
    "JIF排名": "rank",
    "JCI": "jci",
    "5年影响因子": "jif5",
    "去自引影响因子": "jif_no_self",
    "各学科分区详情": "category_details",
    "数据年份": "year"
}

def normalize_name(name):
    name = unicodedata.normalize("NFKC", str(name)).lower()
    name = name.replace("&", " and ")
    return re.sub(r"[\W_]+", " ", name).strip()

def normalize_issn(value):
    value = re.sub(r"[^0-9X]", "", str(value).upper())
    if re.fullmatch(r"\d{7}[\dX]", value):
        return value[:4] + "-" + value[4:]
    return ""

df = pd.read_excel(INPUT, dtype=str).fillna("")
df.columns = df.columns.str.strip()
missing = set(COLUMN_MAP) - set(df.columns)
if missing:
    raise ValueError(f"Missing columns: {missing}")

df = df[list(COLUMN_MAP)].rename(columns=COLUMN_MAP)
df = df.apply(lambda x: x.str.strip())
df = df[df["journal"] != ""].drop_duplicates().reset_index(drop=True)
df["issn"] = df["issn"].apply(normalize_issn)
df["eissn"] = df["eissn"].apply(normalize_issn)
df["journal_normalized"] = df["journal"].apply(normalize_name)
df["abbreviation_normalized"] = df["abbreviation"].apply(normalize_name)

records = df.to_dict(orient="records")
OUTPUT.write_text(
    "const JOURNALS = " + json.dumps(records, ensure_ascii=False, separators=(",", ":")) + ";",
    encoding="utf-8"
)

print(f"Total journal records: {len(df)}")
print(f"Unique journal names: {df['journal_normalized'].nunique()}")
print(f"Records with ISSN: {(df['issn'] != '').sum()}")
print(f"Records with eISSN: {(df['eissn'] != '').sum()}")
print(f"Records with abbreviation: {(df['abbreviation'] != '').sum()}")
print(f"Database size: {OUTPUT.stat().st_size / 1024**2:.2f} MB")
print(f"Output: {OUTPUT}")

# Check potential matching conflicts
for col in ["journal_normalized", "abbreviation_normalized", "issn", "eissn"]:
    valid = df[df[col] != ""]
    duplicates = valid[valid.duplicated(col, keep=False)]
    print(f"\nDuplicated {col}: {duplicates[col].nunique()}")
    if not duplicates.empty:
        print(duplicates[["journal", "abbreviation", "issn", "eissn"]].to_string(index=False))