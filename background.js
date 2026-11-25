const Crossref = (() => {
    const API = "https://api.crossref.org/works";
    const CACHE_PREFIX = "crossref:v2:";
    const DAY = 86400000;
    const CACHE_TTL = 90 * DAY;
    const NEGATIVE_TTL = DAY;
    const MAX_CACHE_ENTRIES = 3000;
    const MAX_CACHE_BYTES = 3 * 1024 * 1024;
    const REQUEST_TIMEOUT = 20000;
    const MAX_RETRIES = 2;
    const MAX_WAIT = 20000;
    const intervals = {doi: 250, title: 1100};
    const lastRequest = {doi: 0, title: 0};
    const pending = new Map();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let queue = Promise.resolve(), cacheQueue = Promise.resolve();
    let blockedUntil = 0, lastAnyRequest = 0, cacheWrites = 0;
    const stats = {
        requests: 0, successful: 0, failed: 0,
        retries: 0, rateLimited: 0, cacheHits: 0,
        cacheMisses: 0, deduplicated: 0,
        doiRequests: 0, titleRequests: 0
    };

    function normalizeTitle(title = "") {
        return String(title || "").normalize("NFKC").toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
    }

    function normalizeDOI(doi = "") {
        return String(doi || "").trim()
            .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
    }

    function parseMetadata(m) {
        const years = ["published", "published-print", "published-online", "issued"]
            .map(key => m[key]?.["date-parts"]?.[0]?.[0])
            .filter(Number.isInteger);
        return {
            doi: m.DOI || null,
            title: m.title?.[0] || null,
            journal: m["container-title"]?.[0] || null,
            abbreviation: m["short-container-title"]?.[0] || null,
            issn: m.ISSN || [],
            issn_type: m["issn-type"] || [],
            type: m.type || null,
            publisher: m.publisher || null,
            year: years[0] || null,
            years: [...new Set(years)],
            authors: (m.author || []).map(a => ({
                given: a.given || "", family: a.family || ""
            }))
        };
    }

    function buildResult(method, candidates = [], verified = false) {
        const valid = verified && candidates.length === 1;
        return {
            method, verified: valid,
            match: valid ? candidates[0] : null,
            candidates
        };
    }

    function updateRateLimits(response, type) {
        const limit = Number(response.headers.get("x-rate-limit-limit"));
        const raw = response.headers.get("x-rate-limit-interval") || "";
        const match = raw.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
        if (limit > 0 && match) {
            const interval = Number(match[1]) * 1000 / limit + 100;
            intervals[type] = Math.max(intervals[type], interval);
        }
    }

    function getRetryAfter(response, fallback) {
        const raw = response.headers.get("Retry-After");
        if (!raw) return fallback;
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const date = Date.parse(raw);
        return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
    }

    async function setCooldown(ms) {
        blockedUntil = Math.max(blockedUntil, Date.now() + ms);
        try {
            await chrome.storage.session.set({crossrefBlockedUntil: blockedUntil});
        } catch {}
    }

    async function waitForRequest(type) {
        try {
            const saved = await chrome.storage.session.get("crossrefBlockedUntil");
            blockedUntil = Math.max(blockedUntil, saved.crossrefBlockedUntil || 0);
        } catch {}
        const wait = Math.max(
            0,
            intervals[type] - (Date.now() - lastRequest[type]),
            250 - (Date.now() - lastAnyRequest),
            blockedUntil - Date.now()
        );
        if (wait > MAX_WAIT)
            throw new Error(`Crossref cooldown: ${Math.ceil(wait / 1000)}s remaining`);
        if (wait > 0) await sleep(wait);
        lastRequest[type] = lastAnyRequest = Date.now();
    }

    async function executeRequest(url, type) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            await waitForRequest(type);
            stats.requests++;
            stats[type === "doi" ? "doiRequests" : "titleRequests"]++;
            let response;
            try {
                response = await fetch(url, {
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
                    headers: {"Accept": "application/json"}
                });
            } catch (error) {
                stats.failed++;
                const temporary = ["TimeoutError", "AbortError", "TypeError"].includes(error.name);
                if (!temporary || attempt === MAX_RETRIES) throw error;
                stats.retries++;
                await setCooldown(2000 * 2 ** attempt + Math.random() * 500);
                continue;
            }

            updateRateLimits(response, type);
            if (response.ok) {
                const data = await response.json();
                stats.successful++;
                return data.message;
            }
            if (response.status === 404) return null;
            stats.failed++;
            if (response.status === 403) {
                await setCooldown(15 * 60 * 1000);
                throw new Error("Crossref HTTP 403: requests suspended for 15 minutes");
            }

            const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
            if (response.status === 429) {
                stats.rateLimited++;
                intervals[type] = Math.min(intervals[type] * 1.5, 10000);
            }
            if (retryable) {
                const fallback = 2000 * 2 ** attempt + Math.random() * 500;
                await setCooldown(Math.max(fallback, getRetryAfter(response, fallback)));
                if (attempt < MAX_RETRIES && blockedUntil - Date.now() <= MAX_WAIT) {
                    stats.retries++;
                    continue;
                }
            }
            throw new Error(`Crossref HTTP ${response.status}`);
        }
    }

    function request(url, type) {
        const task = queue.then(() => executeRequest(url, type));
        queue = task.catch(() => {});
        return task;
    }

    function isExpired(entry) {
        const ttl = entry?.result?.verified ? CACHE_TTL : NEGATIVE_TTL;
        return !entry?.timestamp || Date.now() - entry.timestamp > ttl;
    }

    async function getCache(key) {
        try {
            const data = await chrome.storage.local.get(key);
            const entry = data[key];
            if (!entry) return null;
            if (isExpired(entry)) {
                await chrome.storage.local.remove(key);
                return null;
            }
            return entry.result;
        } catch {
            return null;
        }
    }

    async function cleanupCache() {
        const data = await chrome.storage.local.get(null);
        const entries = Object.entries(data)
            .filter(([key]) => key.startsWith(CACHE_PREFIX));
        const remove = entries.filter(([, entry]) => isExpired(entry))
            .map(([key]) => key);
        const valid = entries.filter(([, entry]) => !isExpired(entry))
            .sort((a, b) => b[1].timestamp - a[1].timestamp);
        let bytes = 0;
        valid.forEach(([key, entry], i) => {
            bytes += new TextEncoder().encode(key + JSON.stringify(entry)).length;
            if (i >= MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES)
                remove.push(key);
        });
        if (remove.length) await chrome.storage.local.remove(remove);
        return remove.length;
    }

    function compactResult(result) {
        return {
            method: result.method,
            verified: result.verified,
            match: result.match,
            candidates: result.match ? [result.match] : []
        };
    }

    function setCache(key, result) {
        const task = cacheQueue.then(async () => {
            try {
                if (cacheWrites++ % 20 === 0) await cleanupCache();
                const entry = {timestamp: Date.now(), result: compactResult(result)};
                await chrome.storage.local.set({[key]: entry});
            } catch (error) {
                console.warn("[Crossref] Cache write failed:", error.message);
            }
        });
        cacheQueue = task.catch(() => {});
        return task;
    }

    async function cachedRequest(key, task) {
        key = CACHE_PREFIX + key;
        if (pending.has(key)) {
            stats.deduplicated++;
            return pending.get(key);
        }
        const promise = (async () => {
            const cached = await getCache(key);
            if (cached) {
                stats.cacheHits++;
                return {...cached, cached: true};
            }
            stats.cacheMisses++;
            const result = await task();
            await setCache(key, result);
            return {...result, cached: false};
        })();
        pending.set(key, promise);
        try {
            return await promise;
        } finally {
            pending.delete(key);
        }
    }

    async function lookupDOI(doi) {
        doi = normalizeDOI(doi);
        if (!/^10\.\d{4,9}\/\S+$/.test(doi))
            return buildResult("crossref_doi");
        return cachedRequest(`doi:${doi}`, async () => {
            const m = await request(`${API}/${encodeURIComponent(doi)}`, "doi");
            if (!m) return buildResult("crossref_doi");
            const metadata = parseMetadata(m);
            return buildResult("crossref_doi", [metadata], normalizeDOI(metadata.doi) === doi);
        });
    }

    async function lookupTitle(title, year = null) {
        const normalized = normalizeTitle(title);
        if (!normalized) return buildResult("crossref_title");
        return cachedRequest(`title:${normalized}:${year || ""}`, async () => {
            const params = new URLSearchParams({
                "query.bibliographic": title,
                "rows": "5",
                "select": "DOI,title,container-title,short-container-title,ISSN,issn-type,type,publisher,author,published,published-print,published-online,issued"
            });
            const m = await request(`${API}?${params}`, "title");
            const candidates = (m?.items || []).map(parseMetadata);
            const matched = candidates.filter(x =>
                normalizeTitle(x.title) === normalized &&
                (!year || !x.years.length || x.years.some(y => Math.abs(y - Number(year)) <= 1))
            );
            return {
                method: "crossref_title",
                verified: matched.length === 1,
                match: matched.length === 1 ? matched[0] : null,
                candidates
            };
        });
    }

    async function getStats() {
        const data = await chrome.storage.local.get(null);
        const keys = Object.keys(data).filter(k => k.startsWith(CACHE_PREFIX));
        const bytes = keys.length ? await chrome.storage.local.getBytesInUse(keys) : 0;
        const saved = await chrome.storage.session.get("crossrefBlockedUntil");
        return {
            ...stats,
            pendingRequests: pending.size,
            doiInterval: intervals.doi,
            titleInterval: intervals.title,
            cooldownSeconds: Math.max(0, Math.ceil((Math.max(blockedUntil, saved.crossrefBlockedUntil || 0) - Date.now()) / 1000)),
            cacheEntries: keys.length,
            cacheMB: Number((bytes / 1024 / 1024).toFixed(3))
        };
    }

    async function clearCache() {
        const data = await chrome.storage.local.get(null);
        const keys = Object.keys(data).filter(k => k.startsWith("crossref:"));
        if (keys.length) await chrome.storage.local.remove(keys);
        return {removed: keys.length};
    }

    return {lookupDOI, lookupTitle, getStats, clearCache};
})();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    let task;
    switch (message.type) {
        case "CROSSREF_DOI":
            task = Crossref.lookupDOI(message.doi);
            break;
        case "CROSSREF_TITLE":
            task = Crossref.lookupTitle(message.title, message.year);
            break;
        case "CROSSREF_STATS":
            task = Crossref.getStats();
            break;
        case "CROSSREF_CLEAR_CACHE":
            task = Crossref.clearCache();
            break;
        default:
            return;
    }
    task.then(result => sendResponse({success: true, ...result}))
        .catch(error => sendResponse({success: false, error: error.message}));
    return true;
});