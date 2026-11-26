# ScholarJournal

[English](README.md) | [中文版](README.zh-CN.md)

**A Chrome extension for journal metrics, publication filtering, CSV export, and researcher publication analytics on Google Scholar.**

ScholarJournal enriches Google Scholar with journal-level bibliometric information and interactive publication analysis. Its local-first architecture uses a user-provided journal database and retrieves bibliographic metadata from Crossref when local matching is insufficient. No dedicated backend server is required.

## Features

### Journal Metrics

Display journal names, Journal Impact Factors (JIF), JCR quartiles, percentile-based top percentages, five-year JIF, Journal Citation Indicators (JCI), and category rankings on search results and researcher profiles. Color gradients facilitate comparison; an information dialog provides ISSN, eISSN, publisher and category-specific details.

### Intelligent Journal Identification

- Exact and normalized journal names, abbreviations, ISSN and eISSN matching.
- DOI and ISSN extraction from supported publication URLs.
- Candidate identification for truncated journal names.
- Crossref retrieval by DOI, title, and bibliographic query when local matching is insufficient.
- Context-aware verification using title, publication year, venue and available author information.
- Verification of explicitly truncated titles when sufficient supporting evidence exists.
- Disambiguation of same-title publications, including different publication versions.
- Diagnostic reasons for unresolved or ambiguous results.

Local matches are displayed independently of remote requests. Uncertain results are not assigned definitive journal metrics.

### Crossref API Access

Both access modes are free and use the same metadata cache and identification logic.

| Setting | Public Pool | Polite Pool |
|---|---|---|
| Account / API key | Not required | Not required |
| Contact email | Not required | Required |
| Default DOI request interval | 250 ms | 120 ms |
| Default title request interval | 1100 ms | 380 ms |
| Configured maximum concurrency | 1 | 3 |

Public Pool is the default. To enable Polite Pool, open the extension popup, locate **Crossref API Access**, enter a valid contact email, and click **Connect to Polite Pool**. Enhanced scheduling is enabled after pool confirmation. Click **Disconnect** to return to Public Pool. This is not account authentication and does not require a password or email verification.

The intervals above are extension defaults, not guaranteed API throughput. The scheduler adjusts limits according to response headers and applies backoff when necessary.

**Performance note:** Remote identification may take several minutes for large researcher profiles because Crossref request limits, response latency, retries, fallback queries and cache availability affect processing time. Polite Pool permits higher throughput but does not guarantee a specific speedup.

See [Crossref API access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/).

### Publication Filtering

Filter loaded records by minimum and maximum IF, multiple JCR quartiles, journal name or abbreviation, and inclusion of records with missing metrics. Filters can be combined without changing the original Google Scholar query.

### CSV Export

Export loaded or filtered publications, including titles, authors, years, citations, available DOI and URLs, journal names and identifiers, publisher, journal metrics, category details, publication type and matching status. CSV uses UTF-8 with BOM for compatibility with Excel, R and Python.

### Researcher Publication Analytics

The dashboard attempts to collect the complete public publication list rather than restricting analysis to the initially displayed records.

**Global analysis filters**
- All years, last 3/5/10 years, or a custom year range.
- Top N or top percentage by total citations or approximate annual citations.
- Single or multiple journals, IF range, JCR quartiles, citation range and publication types.

**Overview**
- Publication and unique journal counts, total citations, JCR matching coverage and Q1 proportion.
- Mean, median and maximum IF; annual publication trends; JCR and IF distributions; annual mean of current IF; publication type distribution.

**Journals**
- Journal-level publication counts, citation statistics, IF and quartiles.
- Most frequent journals, annual publication trends and interactive journal-specific analysis.

**Citations**
- Citation distribution and concentration curves.
- Citation contributions of top 10/20 papers and top 1%/10% papers.
- Rankings by total or approximate annual citations.

**Papers**
- Search, sorting, pagination and CSV export of selected publications or table search results.
- Independent publication type, identification status and JCR availability.
- Filters for identification and JCR status; diagnostic information on hover and searchable verification reasons.
- Distinction between verified, locally matched, pending, deferred, ambiguous, unresolved and API-error records.

A verified journal article may have no JCR metrics if the journal is absent from the installed database. Pending records are not equivalent to failed identification. Complete profiles can be cached locally; progress, cancellation, timeout and partial-analysis options are available.

### Customizable Settings

Enable or disable the extension, choose displayed metrics, toggle filters and Crossref lookup, hide unmatched labels, configure optional Polite Pool access, view request-rate and concurrency settings, manage the metadata cache, and restore defaults. Settings are saved locally.

## Installation

Install ScholarJournal as an unpacked Chrome extension from source.

### 1. Download the Repository

```bash
git clone https://github.com/sLee0709/ScholarJournal.git
cd ScholarJournal
```

Alternatively, download and extract the ZIP archive from GitHub.

### 2. Install Python Dependencies

Python is needed only for database preparation, not for extension runtime.

```bash
pip install pandas openpyxl
```

### 3. Prepare the Journal Database

**Neither the proprietary source dataset nor the generated `journals.js` is distributed with this repository.** Obtain journal metrics independently through authorized channels, such as institutional access to [Journal Citation Reports](https://jcr.clarivate.com/) via [Web of Science](https://www.webofscience.com/). Follow [Clarivate](https://clarivate.com/) licensing and data-use requirements.

#### 3.1 Input File

Place `2025_journal_info.xlsx` in the project root, with one row per journal. For another filename, adjust `INPUT` in `convert.py`:

```python
BASE = Path(__file__).resolve().parent
INPUT = BASE / "my_journal_data.xlsx"
OUTPUT = BASE / "journals.js"
```

#### 3.2 Column Mapping

Adjust the keys of `COLUMN_MAP` to your Excel headers while preserving its internal field names (values). The original mapping uses Chinese headers:

| Internal field | Description | Original Excel column |
|---|---|---|
| `journal` | Full journal name | 期刊名称 |
| `abbreviation` | Abbreviation | 期刊缩写 |
| `issn` | Print ISSN | ISSN |
| `eissn` | Electronic ISSN | eISSN |
| `publisher` | Publisher | 出版商 |
| `category` | Subject category | 学科类别 |
| `jif` | Impact Factor | 影响因子JIF |
| `quartile` | JCR quartile | JIF分区 |
| `percentile` | JIF percentile | JIF百分位 |
| `rank` | Category rank | JIF排名 |
| `jci` | Journal Citation Indicator | JCI |
| `jif5` | Five-year JIF | 5年影响因子 |
| `jif_no_self` | JIF excluding self-citations | 去自引影响因子 |
| `category_details` | Category-specific rankings | 各学科分区详情 |
| `year` | Dataset year or release | 数据年份 |

Example mapping for English headers (adjust to your dataset):

```python
COLUMN_MAP = {
    "Journal Name": "journal",
    "Journal Abbreviation": "abbreviation",
    "ISSN": "issn",
    "eISSN": "eissn",
    "Publisher": "publisher",
    "Category": "category",
    "Journal Impact Factor": "jif",
    "JIF Quartile": "quartile",
    "JIF Percentile": "percentile",
    "JIF Rank": "rank",
    "JCI": "jci",
    "5-Year Impact Factor": "jif5",
    "JIF Without Self-Citations": "jif_no_self",
    "Category Details": "category_details",
    "Data Year": "year"
}
```

All mapped columns must exist. Use empty columns for unavailable metrics rather than invented values. Example English headers may differ from official exports.

| Field | Example |
|---|---|
| ISSN / eISSN | `1234-5678` |
| JIF | `8.5` |
| JCR quartile | `Q1` |
| JIF percentile | `95.2` |
| Category rank | `5/100` |
| Data year | `2025` |
| Category details | `CATEGORY A(SCIE):Q1 5/100 \| CATEGORY B(SCIE):Q2 20/80` |

For journals in multiple categories, use a consistent rule for summary quartile, percentile and rank, retaining category-level details in `category_details`. Preprocessing may be required for multiple files or category-level records.

#### 3.3 Generate `journals.js`

```bash
python convert.py
```

The script normalizes names and ISSNs, detects duplicates and generates the database. Example structure (no proprietary metrics):

```javascript
const JOURNALS = [
    {
        "journal": "Example Journal",
        "abbreviation": "EXAMPLE J",
        "issn": "",
        "eissn": "",
        "publisher": "",
        "category": "",
        "jif": "",
        "quartile": "",
        "percentile": "",
        "rank": "",
        "jci": "",
        "jif5": "",
        "jif_no_self": "",
        "category_details": "",
        "year": "",
        "journal_normalized": "example journal",
        "abbreviation_normalized": "example j"
    }
];
```

Keep `journals.js` in the project root. The Excel source and generated database should remain excluded from version control via `.gitignore`.

#### 3.4 Update the Journal Database

Obtain updated authorized data, adjust column mapping and dataset year, rerun `python convert.py`, update the database year and record count in `popup.html`, then reload the extension.

### 4. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the ScholarJournal project directory.
5. Open or refresh Google Scholar.

## Usage

### Search Results

Search [Google Scholar](https://scholar.google.com/) normally. Available metrics appear automatically. Use the information icon for details, the Filters panel for selection, and Export CSV to download records.

### Researcher Profiles

The extension annotates displayed and newly expanded publications. Click **Publication Analytics** to open the dashboard. A valid complete-profile cache is reused when available; otherwise the extension attempts to collect and identify the complete public publication list. Use the global filters and Overview, Journals, Citations and Papers tabs. Papers provides additional identification and JCR status filters.

### Extension Settings

Click the ScholarJournal toolbar icon to adjust display preferences, manage caches or configure Crossref access without reinstalling the extension.

## Technical Overview

Implemented with JavaScript, HTML, CSS and Chrome Extension Manifest V3, without a dedicated backend or external JavaScript visualization libraries.

```text
Google Scholar metadata
        |
        v
    Local matching
      /     \
   Matched   Unmatched
     |          |
     |     Crossref (Public / Polite)
     |          |
     |     Identity verification and disambiguation
     |     (title, year, venue, authors)
     |          |
     |     Publication type and JCR matching
     |          |
     +----------+
          |
          v
   Metrics, filters, export and analytics
```

A centralized service worker manages request scheduling, dynamic concurrency, rate limiting, retries and persistent caches. Title cache keys incorporate bibliographic context to reduce incorrect reuse across same-title, same-year publications. Verification outcomes and failure reasons are retained in analysis snapshots. Profile collection and remote identification can proceed independently.

| File | Role |
|---|---|
| `convert.py` | Database preparation |
| `journals.js` | Locally generated database (not distributed) |
| `matcher.js` / `parser.js` | Matching and metadata parsing |
| `background.js` | Crossref retrieval, verification, scheduling and cache |
| `content.js` | Page integration and identification |
| `settings.js` | Settings storage |
| `popup.html` / `popup.js` / `popup.css` | Settings interface |
| `filters.js` / `export.js` | Filtering and CSV export |
| `profile_loader.js` / `profile_cache.js` | Profile collection and caching |
| `analytics.js` | Statistical analysis |
| `analytics_ui.js` / `analytics.css` | Interactive dashboard |
| `manifest.json` | Extension configuration |
| `style.css` | Page styles |
| `test.html` | Matching test interface |

## Data Sources

- **Google Scholar:** Public publication titles, authors, years, citations and links.
- **Crossref:** Bibliographic metadata for identity verification; see the [REST API documentation](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
- **User-provided database:** Independently authorized journal metrics and rankings.

Crossref is not used to obtain proprietary JIF or JCR rankings.

## Privacy

Preferences, metadata caches and profile caches are stored in Chrome local extension storage. When local matching is insufficient, publication titles or DOIs may be sent to Crossref; remote lookup can be disabled in settings. With optional Polite Pool access, the contact email is stored locally and sent to Crossref through the `mailto` parameter. Disconnecting or restoring defaults removes the saved email. ScholarJournal requires no user account, operates no dedicated data collection server, and does not intentionally collect Google account credentials.

## Known Limitations

- Google Scholar metadata may be incomplete, truncated or non-standardized.
- Crossref coverage is not comprehensive; some older or regional publications and records registered with other DOI agencies may be unavailable.
- Same-title publications and different versions may remain ambiguous if supporting evidence is insufficient.
- Identified journals may be absent from the local JCR database; missing metrics do not necessarily indicate identification failure.
- Partial analyses may contain pending records; request limits and network latency may affect speed.
- Metrics reflect the installed database, not historical publication-year JCR values. Journal metrics and citations are not direct measures of research quality.

ScholarJournal prioritizes reliable identification over maximum coverage and leaves metrics unassigned when a match cannot be established reliably.

## Data Licensing and Disclaimer

The repository distributes implementation code and database preparation scripts, not proprietary JCR datasets or restricted journal metrics. Users must obtain authorized data independently and comply with applicable licenses. Do not redistribute the generated database without appropriate rights.

## Contact and Feedback

- Developer: Li Shen
- GitHub: [sLee0709](https://github.com/sLee0709)
- Repository: [ScholarJournal](https://github.com/sLee0709/ScholarJournal)
- Bugs and suggestions: [GitHub Issues](https://github.com/sLee0709/ScholarJournal/issues)

Feedback from the research community is welcome.
