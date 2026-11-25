const ScholarParser = (() => {
    function extractJournal(text) {
        if (!text) return null;
        const parts = text.trim().split(/\s+[-–—]\s+/);
        if (parts.length < 3) return null;
        const source = parts.slice(1, -1).join(" - ").trim();
        const journal = source.replace(/,\s*(?:19|20)\d{2}\s*$/, "").trim();
        if (!journal || /^(?:19|20)\d{2}$/.test(journal)) return null;
        return journal;
    }

    function normalizeArticleUrl(rawUrl) {
        if (!rawUrl) return null;
        try {
            let url = new URL(rawUrl);
            for (let i = 0; i < 3; i++) {
                const redirect = url.searchParams.get("redirect_uri");
                if (!redirect) break;
                url = new URL(redirect);
            }
            if (!["http:", "https:"].includes(url.protocol)) return null;
            return url.origin + url.pathname;
        } catch {
            return null;
        }
    }

    function extractDOI(rawUrl) {
        const url = normalizeArticleUrl(rawUrl);
        if (!url) return null;
        try {
            const path = decodeURIComponent(new URL(url).pathname);
            const doi = path.match(/10\.\d{4,9}\/[^\s?#]+/i);
            if (doi) return doi[0].replace(/\.pdf$/i, "");
            const nature = url.match(/^https?:\/\/(?:www\.)?nature\.com\/articles\/(s\d{5}-\d{2,4}-\d+-[\dx])(?:\.pdf)?$/i);
            if (nature) return `10.1038/${nature[1]}`;
            return null;
        } catch {
            return null;
        }
    }

    function extractISSN(rawUrl) {
        const url = normalizeArticleUrl(rawUrl);
        if (!url) return null;
        const parsed = new URL(url);
        if (!/(^|\.)(cell\.com|sciencedirect\.com|elsevier\.com)$/i.test(parsed.hostname)) return null;
        const pii = parsed.pathname.match(/\/S(\d{4})-?(\d{3}[\dX])(?=\d|\()/i);
        if (!pii) return null;
        const digits = (pii[1] + pii[2]).toUpperCase();
        const sum = [...digits].reduce((s, c, i) => s + (c === "X" ? 10 : Number(c)) * (8 - i), 0);
        return sum % 11 === 0 ? `${pii[1]}-${pii[2].toUpperCase()}` : null;
    }

    function parseArticle(el) {
        const titleEl = el.querySelector(".gs_rt");
        const metadata = el.querySelector(".gs_a")?.textContent.trim() || "";
        const title = (titleEl?.textContent.trim() || "").replace(/^(?:\[(?:PDF|HTML|BOOK|CITATION|图书|引用)\]\s*)+/i, "");
        const rawUrl = titleEl?.querySelector("a")?.href || null;
        const url = normalizeArticleUrl(rawUrl);
        const externalUrls = [...el.querySelectorAll(".gs_or_ggsm a")]
            .map(a => normalizeArticleUrl(a.href))
            .filter(u => u && !/^https?:\/\/scholar\./i.test(u));
        const urls = [...new Set([url, ...externalUrls].filter(Boolean))];
        const yearMatches = metadata.match(/(?:19|20)\d{2}(?=\s+[-–—]\s+)/g);
        return {
            id: el.getAttribute("data-cid") || null,
            title,
            metadata,
            journal: extractJournal(metadata),
            year: yearMatches ? Number(yearMatches.at(-1)) : null,
            url,
            doi: urls.map(extractDOI).find(Boolean) || null,
            issn: urls.map(extractISSN).find(Boolean) || null
        };
    }

    function extractProfileJournal(publication, year = null) {
        if (!publication) return null;
        let source = publication.replace(/\s+/g, " ").trim();
        if (year && /^\d{4}$/.test(String(year))) {
            source = source.replace(new RegExp(`,?\\s+${year}$`), "").trim();
        }
        if (!source || /^\d{4}$/.test(source)) return null;
        const candidates = [source];
        const volume = source.match(/^(.+?)\s+\d+(?:\s*\([^)]*\))?\s*(?:,|$)/);
        if (volume) candidates.push(volume[1].trim());
        const pages = source.match(/^(.+?),\s*(?:pp?\.\s*)?[A-Za-z]?\d[\w.\-–—]*(?:\s*[-–—]\s*\w+)?\s*$/i);
        if (pages) candidates.push(pages[1].trim());
        for (const candidate of candidates) {
            if (JournalMatcher.matchName(candidate).verified) return candidate;
        }
        return candidates[1] || candidates[0];
    }

    function parseProfileArticle(el) {
        const titleEl = el.querySelector(".gsc_a_at");
        const metadata = [...el.querySelectorAll(".gs_gray")];
        const title = titleEl?.textContent.trim() || "";
        const authors = metadata[0]?.textContent.trim() || "";
        const publication = metadata[1]?.textContent.trim() || "";
        const yearText = el.querySelector(".gsc_a_y")?.textContent.trim() || "";
        const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
        const rawUrl = titleEl?.href || null;
        const url = rawUrl ? new URL(rawUrl) : null;
        return {
            id: url?.searchParams.get("citation_for_view") || null,
            title,
            authors,
            metadata: publication,
            journal: extractProfileJournal(publication, year),
            year,
            url: rawUrl,
            doi: null,
            issn: null,
            pageType: "profile"
        };
    }

    function getPageType() {
        const url = new URL(window.location.href);
        if (url.pathname === "/citations" &&
            url.searchParams.has("user") &&
            document.querySelector("#gsc_a_t"))
            return "profile";
        if (document.querySelector("#gs_res_ccl_mid"))
            return "search";
        return null;
    }

    function parsePage() {
        const pageType = getPageType();
        if (pageType === "profile") {
            return [...document.querySelectorAll(".gsc_a_tr")]
                .map(el => ({element: el, ...parseProfileArticle(el)}))
                .filter(article => article.title);
        }
        if (pageType === "search") {
            return [...document.querySelectorAll(".gs_r.gs_or.gs_scl")]
                .map(el => ({element: el, ...parseArticle(el), pageType: "search"}))
                .filter(article => article.title);
        }
        return [];
    }

    return {
        extractJournal, extractProfileJournal, normalizeArticleUrl,
        extractDOI, extractISSN, parseArticle, parseProfileArticle,
        parsePage, getPageType
    };
})();