# ScholarJournal

**A Chrome extension for journal metrics, publication filtering, and researcher publication analytics on Google Scholar.**

ScholarJournal is a lightweight research assistance tool designed to enrich Google Scholar with journal-level bibliometric information and interactive publication analysis. It helps researchers explore scientific literature, identify publication venues, filter publications by journal metrics, export bibliographic data, and analyze researchers' publication records.

ScholarJournal follows a local-first architecture. Journal identification is primarily performed using a locally generated journal database, with Crossref metadata retrieval as a fallback when local matching is insufficient.

No dedicated backend server is required.

## Features

### Journal Metrics

Display journal information directly on Google Scholar search results and researcher profile pages:

- Journal name
- Journal Impact Factor (JIF)
- Journal Citation Reports (JCR) quartile
- JIF percentile-based top percentage
- Five-year Impact Factor
- Journal Citation Indicator (JCI)
- Journal category ranking

Journal metrics are displayed using color gradients to facilitate visual comparison. Detailed journal information, including ISSN, eISSN, publisher, and category-specific rankings, is available through an interactive information dialog.

### Intelligent Journal Identification

ScholarJournal employs multiple complementary matching strategies:

- Exact and normalized journal name matching
- Journal abbreviation matching
- ISSN and eISSN matching
- DOI and ISSN extraction from publication URLs
- Crossref metadata retrieval using DOI or publication title
- Candidate identification for truncated journal names

Local matching and remote metadata retrieval are processed independently, allowing locally matched journal information to appear without waiting for external API requests.

Uncertain matches are not assigned definitive journal metrics.

### Publication Filtering

Filter publications directly on Google Scholar search results and researcher profile pages using:

- Minimum and maximum Impact Factor
- Multiple JCR quartiles
- Journal name or abbreviation
- Inclusion or exclusion of publications with missing metrics

Multiple filtering conditions can be combined. Filtering operates on currently loaded publications without modifying Google Scholar's original search query.

### CSV Export

Export currently loaded or filtered publications to CSV files, including:

- Publication title, authors, publication year, and citation count
- DOI and publication URL, when available
- Journal name, abbreviation, ISSN, eISSN, and publisher
- JIF, JCR quartile, percentile, five-year JIF, and JCI
- Category rankings and detailed category information
- Publication type and matching status

CSV files are encoded in UTF-8 with BOM for compatibility with Excel, R, Python, and other data analysis tools.

### Researcher Publication Analytics

ScholarJournal provides a dedicated interactive analytics dashboard on Google Scholar researcher profile pages.

Unlike analyses restricted to the initially displayed publications, ScholarJournal attempts to load the complete public publication list of a researcher before performing analysis.

The dashboard supports:

**Global analysis filters**

- Entire publication history
- Publications within the last 3, 5, or 10 years
- Custom publication year ranges
- Top N most cited publications
- Top percentage of publications ranked by citations
- Ranking by cumulative citations or approximate citations per year
- Single or multiple journal selection
- Impact Factor ranges
- JCR quartiles
- Citation count ranges
- Publication types

**Overview**

- Total publications and unique journals
- Total citations
- Journal database matching coverage
- Q1 publication proportion
- Mean, median, and maximum Impact Factor
- Annual publication trends
- JCR quartile distribution
- Impact Factor distribution
- Annual distribution of current journal metrics
- Publication type distribution

**Journal Analysis**

- Most frequently published journals
- Journal-specific publication counts
- Journal-specific citation statistics
- Journal Impact Factors and quartiles
- Annual publication trends for individual journals
- Interactive journal selection and analysis

**Citation Analysis**

- Citation count distribution
- Citation concentration curves
- Citation contributions from highly cited publications
- Top 10 and Top 20 most cited publications
- Top 1% and Top 10% citation contributions
- Rankings based on cumulative citations or citations per year

**Publication Records**

- Searchable and sortable publication tables
- Publication title, author, and journal searches
- Sorting by publication year, Impact Factor, quartile, and citations
- Pagination for large publication datasets
- CSV export of selected publication records

Complete researcher profiles can be cached locally to avoid repeated data collection. Loading progress, cancellation, and incomplete-profile warnings are provided during profile preparation.

### Customizable Settings

The extension popup allows users to:

- Enable or disable ScholarJournal
- Select which journal metrics are displayed
- Enable or disable publication filters
- Hide unmatched journal labels
- Enable or disable Crossref metadata retrieval
- Manage the Crossref metadata cache
- Restore default settings

Settings are automatically saved locally and applied to supported Google Scholar pages.

## Installation

ScholarJournal is currently distributed as source code and can be installed manually as an unpacked Chrome extension.

### 1. Clone the Repository

```bash
git clone https://github.com/sLee0709/ScholarJournal.git
cd ScholarJournal
```

Alternatively, download the repository as a ZIP archive from GitHub and extract it locally.

### 2. Install Python Dependencies

Python is required only for preparing the local journal database. It is not required for running the Chrome extension itself.

Install the necessary Python packages:

```bash
pip install pandas openpyxl
```

### 3. Prepare the Journal Database

**Important: Neither the original journal metrics dataset nor the generated `journals.js` database is included in this repository.**

Users must obtain journal metrics data through legitimate and authorized sources, such as Clarivate's Journal Citation Reports (JCR), accessible through Web of Science or an authorized institutional subscription.

Official resources:

- [Web of Science](https://www.webofscience.com/)
- [Journal Citation Reports](https://jcr.clarivate.com/)
- [Clarivate](https://clarivate.com/)

Users are responsible for ensuring that their acquisition, processing, and local use of journal metrics comply with the applicable licensing agreements and data usage policies.

#### 3.1 Prepare the Input File

The provided `convert.py` script expects an Excel file named:

```text
2025_journal_info.xlsx
```

Place the Excel file in the root directory of the ScholarJournal repository.

If your dataset has a different filename, modify the `INPUT` variable in `convert.py` accordingly:

```python
BASE = Path(__file__).resolve().parent
INPUT = BASE / "2025_journal_info.xlsx"
OUTPUT = BASE / "journals.js"
```

For example:

```python
INPUT = BASE / "my_journal_data.xlsx"
```

The input file should contain one row per journal record.

#### 3.2 Configure Column Mapping

The original conversion script was developed using an Excel dataset with Chinese column headers. If your dataset uses English headers or another naming convention, modify `COLUMN_MAP` in `convert.py` to match your actual Excel column names.

The dictionary keys represent the original Excel column names, while the dictionary values represent the internal fields used by ScholarJournal.

| Internal field | Description | Original Excel column |
|---|---|---|
| `journal` | Full journal name | 期刊名称 |
| `abbreviation` | Journal abbreviation | 期刊缩写 |
| `issn` | Print ISSN | ISSN |
| `eissn` | Electronic ISSN | eISSN |
| `publisher` | Publisher | 出版商 |
| `category` | Subject category | 学科类别 |
| `jif` | Journal Impact Factor | 影响因子JIF |
| `quartile` | JCR quartile | JIF分区 |
| `percentile` | JIF percentile | JIF百分位 |
| `rank` | JIF category rank | JIF排名 |
| `jci` | Journal Citation Indicator | JCI |
| `jif5` | Five-year Impact Factor | 5年影响因子 |
| `jif_no_self` | JIF excluding journal self-citations | 去自引影响因子 |
| `category_details` | Category-specific quartiles and rankings | 各学科分区详情 |
| `year` | Journal metrics data year or release version | 数据年份 |

For example, if your Excel file contains English column headers, the mapping could be modified as follows:

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

The English column names above are illustrative examples and may not correspond exactly to the headers in an official JCR export. Adjust them according to your own dataset.

Keep the internal field names on the right-hand side unchanged to maintain compatibility with the extension.

The current conversion script requires all columns specified in `COLUMN_MAP` to exist in the input Excel file. If certain metrics are unavailable, create the corresponding columns with empty values rather than entering artificial numerical values.

Recommended value formats:

| Field | Example format |
|---|---|
| ISSN / eISSN | `1234-5678` |
| JIF | `8.5` |
| JCR quartile | `Q1` |
| JIF percentile | `95.2` |
| Category rank | `5/100` |
| Data year | `2025` |
| Category details | `CATEGORY A(SCIE):Q1 5/100 \| CATEGORY B(SCIE):Q2 20/80` |

For journals assigned to multiple JCR categories, users should define a consistent rule for the summary quartile, percentile, and rank fields. Category-specific information can be retained in `category_details`.

If the required metrics are distributed across multiple files or category-level records, additional preprocessing may be necessary before running the conversion script.

#### 3.3 Generate `journals.js`

Run:

```bash
python convert.py
```

The conversion script performs journal name normalization, ISSN normalization, duplicate detection, and conversion of the Excel dataset into a JavaScript-compatible database.

The generated file should be:

```text
journals.js
```

The resulting database uses the following structure:

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

The example above contains no actual proprietary journal metrics.

Keep the generated `journals.js` file in the root directory of the repository.

Both the source Excel file and the generated database are excluded from version control through `.gitignore`.

#### 3.4 Update the Journal Database

To update journal metrics in the future:

1. Obtain an updated dataset through an authorized source.
2. Prepare the Excel file and adjust `COLUMN_MAP` if necessary.
3. Update the dataset year or release information.
4. Run `python convert.py` again.
5. Reload the Chrome extension.

The database year and journal record count displayed in `popup.html` should also be updated to reflect the new dataset.

### 4. Load the Chrome Extension

After generating `journals.js`:

1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the ScholarJournal project directory.
6. Open or refresh Google Scholar.

The extension should now display journal information alongside supported publications.

## Usage

### Google Scholar Search Results

Open [Google Scholar](https://scholar.google.com/) and perform a literature search as usual.

ScholarJournal automatically identifies publication venues and displays the available journal metrics below each publication's bibliographic information.

Click the information icon to view detailed journal metrics.

Use the ScholarJournal Filters panel to filter publications by Impact Factor, JCR quartile, or journal name. The Export CSV function allows all currently loaded publications or filtered results to be exported.

### Researcher Profiles

Open a Google Scholar researcher profile.

ScholarJournal automatically annotates the displayed publications with journal metrics. Additional publications are processed when the Google Scholar publication list is expanded.

Click **Publication Analytics** to open the researcher analytics dashboard.

If a valid complete-profile cache is available, the dashboard can load the previously collected data directly. Otherwise, ScholarJournal attempts to collect the complete public publication list and identify the corresponding journals.

Once the data are available, use the global analysis filters and navigate between the Overview, Journals, Citations, and Papers tabs.

### Extension Settings

Click the ScholarJournal icon in the Chrome toolbar to open the settings popup.

Display preferences and other settings can be modified without reinstalling the extension.

## Technical Overview

ScholarJournal is implemented using JavaScript, HTML, CSS, and Chrome Extension Manifest V3.

The extension does not require a dedicated backend server or external JavaScript visualization libraries.

The general journal identification workflow is:

```text
Google Scholar publication information
                |
                v
      Publication metadata parsing
                |
                v
       Local journal identification
                |
         Match available?
           /          \
         Yes           No
          |             |
          |      Crossref metadata retrieval
          |             |
          |      Local database matching
          |             |
          +-------------+
                |
                v
     Journal metrics and publication tools
```

The main components include:

| File | Description |
|---|---|
| `convert.py` | Journal database preparation |
| `journals.js` | Locally generated journal database (not distributed) |
| `matcher.js` | Journal identification and matching |
| `parser.js` | Google Scholar publication metadata parsing |
| `background.js` | Crossref API requests, rate limiting, retries, and caching |
| `content.js` | Core extension logic and page integration |
| `settings.js` | Local settings management |
| `popup.html`, `popup.js`, `popup.css` | Extension settings interface |
| `filters.js` | Publication filtering |
| `export.js` | CSV export |
| `profile_loader.js` | Researcher profile collection |
| `profile_cache.js` | Researcher profile caching |
| `analytics.js` | Publication filtering and statistical analysis |
| `analytics_ui.js`, `analytics.css` | Interactive researcher analytics dashboard |
| `manifest.json` | Chrome extension configuration |
| `test.html` | Journal matching test interface |

Crossref requests are managed through a centralized background service worker with request queuing, rate limiting, automatic retries, and persistent metadata caching.

Researcher profile collection and journal identification are performed independently, reducing the impact of network requests on local journal matching.

## Data Sources

ScholarJournal integrates information from three sources:

- **Google Scholar:** Publication titles, author information, publication years, citation counts, and publication links.
- **Crossref:** External bibliographic metadata used to support journal identification.
- **User-provided journal database:** Journal-level metrics and rankings obtained independently by the user.

More information about Crossref and its REST API is available at:

- [Crossref](https://www.crossref.org/)
- [Crossref REST API Documentation](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

Crossref is used for bibliographic metadata retrieval, not for obtaining proprietary Journal Impact Factors or JCR rankings.

## Privacy

ScholarJournal primarily processes and stores information locally within the user's browser.

User preferences, Crossref metadata caches, and researcher profile caches are stored using Chrome's local extension storage.

When local journal identification is insufficient, publication titles or DOIs may be transmitted to the Crossref REST API for metadata retrieval. Users can disable Crossref metadata lookup through the extension settings.

ScholarJournal does not require user registration, does not operate a dedicated data collection server, and does not intentionally collect Google account credentials.

## Data Licensing and Disclaimer

This repository distributes the ScholarJournal implementation and database preparation scripts. It does not distribute proprietary Journal Citation Reports datasets or journal metrics derived from restricted-access datasets.

Users must independently obtain any required journal metrics through legitimate and authorized channels and comply with the relevant licensing agreements.

The generated journal database should not be redistributed unless the user has the appropriate rights to do so.

## Contact and Feedback

ScholarJournal was developed as a research assistance tool to improve literature exploration and publication analysis workflows.

If you encounter any issues, have suggestions, or need assistance with preparing the journal database, please feel free to contact the developer through GitHub.

- **Developer:** Li Shen
- **GitHub:** [sLee0709](https://github.com/sLee0709)
- **Repository:** [ScholarJournal](https://github.com/sLee0709/ScholarJournal)
- **Bug reports and suggestions:** [GitHub Issues](https://github.com/sLee0709/ScholarJournal/issues)

Feedback and suggestions from the research community are welcome.
