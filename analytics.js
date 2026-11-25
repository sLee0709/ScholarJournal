const ScholarAnalytics = (() => {
    const CURRENT_YEAR = new Date().getFullYear();
    const QUARTILES = ["Q1", "Q2", "Q3", "Q4", "Unclassified"];
    const IF_BINS = [
        {label: "0–2", min: 0, max: 2},
        {label: "2–5", min: 2, max: 5},
        {label: "5–10", min: 5, max: 10},
        {label: "10–20", min: 10, max: 20},
        {label: "20–50", min: 20, max: 50},
        {label: "50+", min: 50, max: Infinity}
    ];
    const DEFAULT_FILTERS = Object.freeze({
        period: "all",
        startYear: null,
        endYear: null,
        journals: [],
        journalQuery: "",
        minIF: null,
        maxIF: null,
        quartiles: [],
        publicationTypes: [],
        minCitations: null,
        maxCitations: null,
        rankingMode: "total",
        rankingType: "all",
        rankingValue: null
    });

    function normalize(value) {
        return String(value ?? "").normalize("NFKC")
            .toLowerCase().replace(/\s+/g, " ").trim();
    }

    function numeric(value) {
        if (value == null || String(value).trim() === "") return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }

    function sum(values) {
        return values.reduce((a, b) => a + b, 0);
    }

    function mean(values) {
        return values.length ? sum(values) / values.length : null;
    }

    function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] :
            (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function percentage(n, total) {
        return total > 0 ? n / total * 100 : null;
    }

    function getJournal(p) {
        if (p.journalIdentity?.status === "non_journal") return null;
        return p.journalMetrics?.journal ||
            (p.journalIdentity?.journal_verified ? p.journalIdentity.journal : null);
    }

    function getJournalKey(p) {
        return normalize(getJournal(p));
    }

    function getQuartile(p) {
        const q = String(p.journalMetrics?.quartile || "").toUpperCase();
        return QUARTILES.includes(q) ? q : "Unclassified";
    }

    function getIF(p) {
        return numeric(p.journalMetrics?.jif);
    }

    function getPublicationType(p) {
        const type = p.journalIdentity?.type;
        if (type === "journal-article") return "journal";
        if (type === "proceedings-article") return "conference";
        if (type === "posted-content") return "preprint";
        if (["book", "book-chapter", "monograph"].includes(type)) return "book";
        if (type) return "other";
        if (p.journalMetrics) return "journal_inferred";
        return "unknown";
    }

    function getCitationsPerYear(p) {
        const year = numeric(p.year);
        const citations = numeric(p.citations);
        if (!year || year > CURRENT_YEAR || citations === null) return null;
        return citations / Math.max(1, CURRENT_YEAR - year + 1);
    }

    function getCitationScore(p, mode = "total") {
        return mode === "annual" ? getCitationsPerYear(p) : numeric(p.citations);
    }

    function sortByCitations(publications, mode = "total") {
        return [...publications].sort((a, b) =>
            (getCitationScore(b, mode) ?? -1) - (getCitationScore(a, mode) ?? -1) ||
            (b.citations ?? -1) - (a.citations ?? -1) ||
            (b.year ?? 0) - (a.year ?? 0) ||
            String(a.title).localeCompare(String(b.title)) ||
            String(a.id || "").localeCompare(String(b.id || ""))
        );
    }

    function filterPublications(publications, options = {}) {
        const f = {...DEFAULT_FILTERS, ...options};
        let start = numeric(f.startYear);
        let end = numeric(f.endYear);
        if (["3", "5", "10"].includes(String(f.period))) {
            start = CURRENT_YEAR - Number(f.period) + 1;
            end = CURRENT_YEAR;
        } else if (f.period !== "custom") {
            start = null;
            end = null;
        }

        const minIF = numeric(f.minIF), maxIF = numeric(f.maxIF);
        const minCites = numeric(f.minCitations), maxCites = numeric(f.maxCitations);
        const selectedJournals = new Set((f.journals || []).map(normalize));
        const query = normalize(f.journalQuery);

        let selected = publications.filter(p => {
            const year = numeric(p.year);
            const jif = getIF(p);
            const citations = numeric(p.citations);
            const journal = getJournalKey(p);
            const abbreviation = normalize(p.journalMetrics?.abbreviation ||
                p.journalIdentity?.abbreviation);

            if (start !== null && (year === null || year < start)) return false;
            if (end !== null && (year === null || year > end)) return false;
            if (selectedJournals.size && !selectedJournals.has(journal)) return false;
            if (query && !journal.includes(query) && !abbreviation.includes(query)) return false;
            if (minIF !== null && (jif === null || jif < minIF)) return false;
            if (maxIF !== null && (jif === null || jif > maxIF)) return false;
            if (minCites !== null && (citations === null || citations < minCites)) return false;
            if (maxCites !== null && (citations === null || citations > maxCites)) return false;
            if (f.quartiles.length && !f.quartiles.includes(getQuartile(p))) return false;
            if (f.publicationTypes.length &&
                !f.publicationTypes.includes(getPublicationType(p))) return false;
            return true;
        });

        const beforeRanking = selected.length;
        const rankable = selected.filter(p =>
            getCitationScore(p, f.rankingMode) !== null);
        const rankableCount = rankable.length;
        if (f.rankingType !== "all") {
            selected = sortByCitations(rankable, f.rankingMode);
            const value = numeric(f.rankingValue);
            if (value !== null && value > 0) {
                const n = f.rankingType === "percent"
                    ? Math.ceil(selected.length * Math.min(value, 100) / 100)
                    : Math.floor(value);
                selected = selected.slice(0, n);
            }
        }
        return {
            publications: selected,
            beforeRanking,
            rankableCount,
            total: publications.length,
            filters: f
        };
    }

    function summarizeOverview(publications) {
        const ifValues = publications.map(getIF).filter(v => v !== null);
        const citations = publications.map(p => numeric(p.citations))
            .filter(v => v !== null);
        const q1 = publications.filter(p => getQuartile(p) === "Q1").length;
        const classified = publications.filter(p =>
            getQuartile(p) !== "Unclassified").length;
        const journals = new Set(publications.map(getJournalKey).filter(Boolean));
        return {
            total: publications.length,
            journalPublications: publications.filter(p =>
                ["journal", "journal_inferred"].includes(getPublicationType(p))).length,
            identifiedJournals: publications.filter(p => Boolean(getJournal(p))).length,
            jcrMatched: publications.filter(p => Boolean(p.journalMetrics)).length,
            uniqueJournals: journals.size,
            classified,
            q1,
            q1Percentage: percentage(q1, classified),
            validIF: ifValues.length,
            missingIF: publications.length - ifValues.length,
            meanIF: mean(ifValues),
            medianIF: median(ifValues),
            maxIF: ifValues.length ? Math.max(...ifValues) : null,
            totalCitations: citations.length ? sum(citations) : null,
            meanCitations: mean(citations),
            medianCitations: median(citations),
            validCitations: citations.length,
            missingCitations: publications.length - citations.length
        };
    }

    function summarizeQuartiles(publications) {
        const counts = Object.fromEntries(QUARTILES.map(q => [q, 0]));
        for (const p of publications) counts[getQuartile(p)]++;
        return QUARTILES.map(q => ({
            quartile: q,
            count: counts[q],
            percentage: percentage(counts[q], publications.length)
        }));
    }

    function summarizeIF(publications) {
        const bins = IF_BINS.map(b => ({...b, count: 0}));
        let missing = 0;
        for (const p of publications) {
            const jif = getIF(p);
            if (jif === null) {
                missing++;
                continue;
            }
            const bin = bins.find(b => jif >= b.min && jif < b.max);
            if (bin) bin.count++;
        }
        return {
            valid: publications.length - missing,
            missing,
            bins
        };
    }

    function summarizeYears(publications) {
        const groups = new Map();
        let unknownYear = 0;
        for (const p of publications) {
            const year = numeric(p.year);
            if (!year || !Number.isInteger(year) || year > CURRENT_YEAR) {
                unknownYear++;
                continue;
            }
            if (!groups.has(year)) groups.set(year, []);
            groups.get(year).push(p);
        }
        const years = [...groups.keys()].sort((a, b) => a - b);
        const data = years.map(year => {
            const items = groups.get(year);
            const overview = summarizeOverview(items);
            const qs = Object.fromEntries(
                summarizeQuartiles(items).map(q => [q.quartile, q.count])
            );
            return {
                year,
                publications: items.length,
                citations: overview.totalCitations,
                meanIF: overview.meanIF,
                medianIF: overview.medianIF,
                validIF: overview.validIF,
                q1Percentage: overview.q1Percentage,
                currentYear: year === CURRENT_YEAR,
                ...qs
            };
        });
        return {data, unknownYear};
    }

    function summarizeJournals(publications) {
        const groups = new Map();
        for (const p of publications) {
            const name = getJournal(p);
            if (!name) continue;
            const key = normalize(name);
            if (!groups.has(key)) groups.set(key, {name, items: []});
            groups.get(key).items.push(p);
        }
        return [...groups.entries()].map(([key, group]) => {
            const items = group.items;
            const overview = summarizeOverview(items);
            const j = items.find(p => p.journalMetrics)?.journalMetrics;
            const years = items.map(p => numeric(p.year)).filter(y => y !== null);
            return {
                key,
                journal: group.name,
                publications: items.length,
                percentage: percentage(items.length, publications.length),
                jif: numeric(j?.jif),
                quartile: j?.quartile || null,
                citations: overview.totalCitations,
                meanCitations: overview.meanCitations,
                medianCitations: overview.medianCitations,
                firstYear: years.length ? Math.min(...years) : null,
                lastYear: years.length ? Math.max(...years) : null,
                annualPublications: summarizeYears(items).data
            };
        }).sort((a, b) =>
            b.publications - a.publications ||
            (b.citations ?? -1) - (a.citations ?? -1) ||
            a.journal.localeCompare(b.journal)
        );
    }

    function summarizeCitations(publications) {
        const ranked = sortByCitations(
            publications.filter(p => numeric(p.citations) !== null)
        );
        const values = ranked.map(p => Number(p.citations));
        const total = sum(values);
        const n = ranked.length;
        const topShare = count => percentage(sum(values.slice(0, count)), total);
        const concentration = [0, 1, 5, 10, 20, 25, 50, 75, 100].map(p => {
            const count = Math.ceil(n * p / 100);
            return {
                requestedPercent: p,
                papers: count,
                publicationShare: percentage(count, n),
                citationShare: topShare(count)
            };
        });
        const annualRanked = sortByCitations(
            publications.filter(p => getCitationsPerYear(p) !== null), "annual"
        );
        return {
            total: n ? total : null,
            valid: n,
            missing: publications.length - n,
            mean: mean(values),
            median: median(values),
            uncited: values.filter(v => v === 0).length,
            max: n ? values[0] : null,
            top10Share: topShare(Math.min(10, n)),
            top20Share: topShare(Math.min(20, n)),
            top1PercentShare: topShare(Math.ceil(n * 0.01)),
            top10PercentShare: topShare(Math.ceil(n * 0.1)),
            concentration,
            mostCited: ranked.slice(0, 20),
            mostCitedPerYear: annualRanked.slice(0, 20).map(p => ({
                ...p,
                citationsPerYear: getCitationsPerYear(p)
            }))
        };
    }

    function summarizePublicationTypes(publications) {
        const counts = {};
        for (const p of publications) {
            const type = getPublicationType(p);
            counts[type] = (counts[type] || 0) + 1;
        }
        return Object.entries(counts).map(([type, count]) => ({
            type,
            count,
            percentage: percentage(count, publications.length)
        })).sort((a, b) => b.count - a.count);
    }

    function summarize(publications) {
        return {
            overview: summarizeOverview(publications),
            quartiles: summarizeQuartiles(publications),
            impactFactor: summarizeIF(publications),
            years: summarizeYears(publications),
            journals: summarizeJournals(publications),
            citations: summarizeCitations(publications),
            publicationTypes: summarizePublicationTypes(publications)
        };
    }

    function analyze(snapshot, filters = {}) {
        const selection = filterPublications(snapshot.publications, filters);
        return {
            profile: snapshot.profile,
            complete: snapshot.complete,
            collectedAt: snapshot.collectedAt,
            totalPublications: selection.total,
            selectedPublications: selection.publications.length,
            beforeRanking: selection.beforeRanking,
            rankableCount: selection.rankableCount,
            filters: selection.filters,
            publications: selection.publications,
            statistics: summarize(selection.publications)
        };
    }

    return {
        DEFAULT_FILTERS, CURRENT_YEAR, QUARTILES, IF_BINS,
        getJournal, getJournalKey, getQuartile, getIF,
        getPublicationType, getCitationsPerYear,
        sortByCitations, filterPublications,
        summarizeOverview, summarizeQuartiles, summarizeIF,
        summarizeYears, summarizeJournals, summarizeCitations,
        summarizePublicationTypes, summarize, analyze
    };
})();