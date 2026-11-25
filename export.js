const ScholarExport = (() => {
    const HEADERS = [
        "Title", "Authors", "Publication_Year", "Citations", "DOI", "Article_URL",
        "Journal", "Abbreviation", "ISSN", "eISSN", "Publisher",
        "JIF", "JCR_Quartile", "JIF_Percentile", "Top_Percent",
        "JIF_5_Year", "JCI", "JIF_Without_Self_Citations",
        "Category", "Category_Rank", "Category_Details", "JCR_Database_Year",
        "Publication_Type", "Match_Status"
    ];

    function clean(value) {
        if (value == null) return "";
        const text = String(value).trim();
        return ["-", "n/a", "na", "nan", "null", "undefined"].includes(text.toLowerCase())
            ? "" : text;
    }

    function escapeCSV(value) {
        let text = clean(value);
        if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text))
            text = "'" + text;
        return `"${text.replace(/"/g, '""')}"`;
    }

    function getAuthors(article) {
        if (article.authors) return article.authors;
        return article.metadata?.split(/\s+[-–—]\s+/)[0]?.trim() || "";
    }

    function getCitations(article) {
        const el = article.element;
        if (article.pageType === "profile") {
            const text = el.querySelector(".gsc_a_c")?.textContent.trim();
            return text ? text.replace(/[,\s\u00a0]/g, "") : "";
        }
        const link = el.querySelector('.gs_fl a[href*="cites="]');
        const text = link?.textContent.trim() || "";
        const number = text.match(/\d[\d,\s\u00a0]*/);
        return number ? number[0].replace(/[,\s\u00a0]/g, "") : "";
    }

    function getTopPercent(journal) {
        const raw = clean(journal?.percentile);
        if (!raw) return "";
        const percentile = Number(raw);
        if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100)
            return "";
        return Number((100 - percentile).toFixed(1));
    }

    function getISSN(metadata, type) {
        return (metadata?.issn_type || [])
            .filter(x => x.type === type)
            .map(x => x.value).join("; ");
    }

    function buildRow(record) {
        const {article, result} = record;
        const j = result?.journal || {};
        const m = result?.metadata || {};
        return [
            article.title,
            getAuthors(article),
            article.year || m.year,
            getCitations(article),
            result?.doi || article.doi || m.doi,
            article.url,
            j.journal || m.journal || article.journal,
            j.abbreviation || m.abbreviation,
            j.issn || getISSN(m, "print"),
            j.eissn || getISSN(m, "electronic"),
            j.publisher || m.publisher,
            j.jif,
            j.quartile,
            j.percentile,
            getTopPercent(j),
            j.jif5,
            j.jci,
            j.jif_no_self,
            j.category,
            j.rank,
            j.category_details,
            j.year,
            m.type,
            result?.status || record.phase
        ];
    }

    function buildCSV(records) {
        const rows = [
            HEADERS.map(escapeCSV).join(","),
            ...records.map(record => buildRow(record).map(escapeCSV).join(","))
        ];
        return "\uFEFF" + rows.join("\r\n");
    }

    function getRecords(articleRecords, scope = "all") {
        const selector = ".gsc_a_tr, .gs_r.gs_or.gs_scl";
        const elements = [...document.querySelectorAll(selector)];
        const selected = elements.filter(el =>
            scope !== "filtered" || !el.classList.contains("sj-filter-hidden")
        );
        const records = selected.map(el => articleRecords.get(el));
        const pending = records.filter(r =>
            !r || !r.result || ["local", "queued", "running"].includes(r.phase)
        ).length;
        return {records: records.filter(Boolean), pending};
    }

    function downloadCSV(csv, filename) {
        const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportCSV(articleRecords, scope = "all") {
        const {records, pending} = getRecords(articleRecords, scope);
        if (pending) {
            return {
                success: false,
                message: `${pending} publication(s) are still being identified. Please try again when completed.`
            };
        }
        if (!records.length) {
            return {success: false, message: "No publications to export."};
        }
        const pageType = ScholarParser.getPageType() || "scholar";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `ScholarJournal_${pageType}_${scope}_${timestamp}.csv`;
        downloadCSV(buildCSV(records), filename);
        return {
            success: true,
            count: records.length,
            filename,
            message: `${records.length} publications exported.`
        };
    }

    function exportAnalyticsCSV(publications, profile = {}) {
        if (!publications?.length)
            return {success: false, message: "No publications to export."};

        const headers = [
            ...HEADERS,
            "Citations_Per_Year",
            "Publication_Type_Evidence"
        ];
        const rows = publications.map(p => {
            const j = p.journalMetrics || {};
            const m = p.journalIdentity || {};
            const type = ScholarAnalytics.getPublicationType(p);
            return [
                p.title,
                p.authors,
                p.year,
                p.citations,
                m.doi || p.doi,
                p.url,
                j.journal || m.journal || p.journal,
                j.abbreviation || m.abbreviation,
                j.issn || m.issn,
                j.eissn || m.eissn,
                j.publisher || m.publisher,
                j.jif,
                j.quartile,
                j.percentile,
                getTopPercent(j),
                j.jif5,
                j.jci,
                j.jif_no_self,
                j.category,
                j.rank,
                j.category_details,
                j.year,
                m.type,
                m.status || p.phase,
                ScholarAnalytics.getCitationsPerYear(p)?.toFixed(2),
                type
            ];
        });
        const csv = "\uFEFF" + [
            headers.map(escapeCSV).join(","),
            ...rows.map(row => row.map(escapeCSV).join(","))
        ].join("\r\n");
        const name = String(profile.name || profile.id || "Researcher")
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `ScholarJournal_Analytics_${name}_${timestamp}.csv`;
        downloadCSV(csv, filename);
        return {
            success: true,
            count: publications.length,
            filename,
            message: `${publications.length} publications exported.`
        };
    }

    return {
        exportCSV, buildCSV, getRecords,
        exportAnalyticsCSV
    };
})();