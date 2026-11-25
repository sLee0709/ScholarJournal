const JournalMatcher = (() => {
    function strictNormalize(value = "") {
        return String(value).normalize("NFKC").toLowerCase()
            .replace(/[‐‑‒–—−]/g, "-")
            .replace(/\s+/g, " ").trim();
    }

    function normalize(value = "") {
        return strictNormalize(value)
            .replace(/&/g, " and ")
            .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    }

    function normalizeISSN(value = "") {
        const key = String(value).toUpperCase().replace(/[^0-9X]/g, "");
        return /^\d{7}[\dX]$/.test(key) ? key : "";
    }

    function escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    const strictIndex = new Map();
    const normalizedIndex = new Map();
    const abbreviationIndex = new Map();
    const issnIndex = new Map();

    function addIndex(index, key, journal) {
        if (!key) return;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(journal);
    }

    for (const journal of JOURNALS) {
        addIndex(strictIndex, strictNormalize(journal.journal), journal);
        addIndex(normalizedIndex, normalize(journal.journal), journal);
        addIndex(abbreviationIndex, normalize(journal.abbreviation), journal);
        addIndex(issnIndex, normalizeISSN(journal.issn), journal);
        addIndex(issnIndex, normalizeISSN(journal.eissn), journal);
    }

    function getCandidates(index, key) {
        return [...(index.get(key) || [])];
    }

    function buildResult(method, candidates, verified = false) {
        return {
            method,
            verified: verified && candidates.length === 1,
            journal: verified && candidates.length === 1 ? candidates[0] : null,
            candidates
        };
    }

    function matchTruncated(name) {
        const parts = name.split(/…|\.{3,}/).map(x => escapeRegex(normalize(x)));
        if (!parts.some(Boolean)) return [];
        const pattern = new RegExp("^" + parts.join(".*") + "$");
        const candidates = new Set();
        for (const [key, records] of normalizedIndex) {
            if (pattern.test(key)) {
                for (const journal of records) candidates.add(journal);
            }
        }
        return [...candidates];
    }

    function matchName(name = "") {
        if (!name.trim()) return buildResult("unmatched", []);
        if (/…|\.{3,}/.test(name))
            return buildResult("truncated", matchTruncated(name));

        let candidates = getCandidates(strictIndex, strictNormalize(name));
        if (candidates.length)
            return buildResult("strict", candidates, true);

        candidates = getCandidates(normalizedIndex, normalize(name));
        if (candidates.length)
            return buildResult("normalized", candidates, true);

        candidates = getCandidates(abbreviationIndex, normalize(name));
        if (candidates.length)
            return buildResult("abbreviation", candidates, true);

        return buildResult("unmatched", []);
    }

    function matchISSN(values = []) {
        if (!Array.isArray(values)) values = [values];
        const candidates = new Set();
        for (const value of values) {
            const records = getCandidates(issnIndex, normalizeISSN(value));
            for (const journal of records) candidates.add(journal);
        }
        return buildResult("issn", [...candidates], true);
    }

    function stats() {
        const conflicts = index =>
            [...index.entries()].filter(([key, records]) => records.size > 1).length;
        return {
            totalJournals: JOURNALS.length,
            strictKeys: strictIndex.size,
            strictConflicts: conflicts(strictIndex),
            normalizedKeys: normalizedIndex.size,
            normalizedConflicts: conflicts(normalizedIndex),
            abbreviationKeys: abbreviationIndex.size,
            abbreviationConflicts: conflicts(abbreviationIndex),
            issnKeys: issnIndex.size,
            issnConflicts: conflicts(issnIndex)
        };
    }

    return {matchName, matchISSN, stats};
})();