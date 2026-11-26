const Crossref = (() => {
    const API = "https://api.crossref.org/works";
    const CACHE_PREFIX = "crossref:v4:";
    const DAY = 86400000;
    const CACHE_TTL = 90 * DAY;
    const NEGATIVE_TTL = DAY;
    const MAX_CACHE_ENTRIES = 3000;
    const MAX_CACHE_BYTES = 3 * 1024 * 1024;
    const REQUEST_TIMEOUT = 20000;
    const MAX_RETRIES = 2;
    const MAX_WAIT = 20000;
    const SETTINGS_KEY = "scholarjournal_settings";
    const POOL_CONFIG = Object.freeze({
        public: {doi: 250, title: 1100, global: 250, concurrency: 1},
        polite: {doi: 120, title: 380, global: 120, concurrency: 3}
    });
    const intervals = {...POOL_CONFIG.public};
    const lastRequest = {doi: 0, title: 0};
    const pending = new Map();
    const requestQueue = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let cacheQueue = Promise.resolve(), accessQueue = Promise.resolve();
    let blockedUntil = 0, lastAnyRequest = 0, cacheWrites = 0;
    let activeRequests = 0, schedulerRunning = false;
    let apiPool = "public", contactEmail = "", poolConfirmed = false;
    let accessVersion = 0;
    const stats = {
        requests: 0, successful: 0, failed: 0,
        retries: 0, rateLimited: 0, cacheHits: 0,
        cacheMisses: 0, deduplicated: 0,
        doiRequests: 0, titleRequests: 0
    };

    function normalizeEmail(value = "") {
        return typeof value === "string" ? value.trim() : "";
    }

    function isValidEmail(value) {
        const email = normalizeEmail(value);
        return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function serializeAccess(task) {
        const result = accessQueue.then(task);
        accessQueue = result.catch(() => {});
        return result;
    }

    function applyPool(pool, email = "", confirmed = false) {
        const changed = apiPool !== pool || contactEmail !== email;
        apiPool = pool;
        contactEmail = email;
        poolConfirmed = confirmed;
        if (changed) {
            Object.assign(intervals, POOL_CONFIG[pool]);
            accessVersion++;
        }
    }

    function getAccess() {
        return {
            pool: apiPool,
            confirmed: poolConfirmed,
            email: contactEmail,
            doiInterval: intervals.doi,
            titleInterval: intervals.title,
            maxConcurrent: intervals.concurrency,
            activeRequests,
            queuedRequests: requestQueue.length
        };
    }

    function getResponsePool(response) {
        const value = (response.headers.get("x-api-pool") || "").toLowerCase().trim();
        if (/^polite(?:-|$)/.test(value)) return "polite";
        if (/^public(?:-|$)/.test(value)) return "public";
        return null;
    }

    function buildRequestURL(url, email = contactEmail) {
        const target = new URL(url);
        if (email) target.searchParams.set("mailto", email);
        return target.toString();
    }

    async function loadContactEmail() {
        const data = await chrome.storage.local.get(SETTINGS_KEY);
        const email = normalizeEmail(data[SETTINGS_KEY]?.crossrefEmail);
        return isValidEmail(email) ? email : "";
    }

    async function saveContactEmail(email) {
        const data = await chrome.storage.local.get(SETTINGS_KEY);
        await chrome.storage.local.set({
            [SETTINGS_KEY]: {...(data[SETTINGS_KEY] || {}), crossrefEmail: email}
        });
    }

    function normalizeTitle(title = "") {
        return String(title || "").normalize("NFKC").toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
    }

    function normalizeText(value = "") {
        return String(value || "").normalize("NFKC").toLowerCase()
            .replace(/&amp;/g, "&")
            .replace(/&/g, " and ")
            .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    }

    function matchTitle(candidateTitle, scholarTitle) {
        const candidate = normalizeTitle(candidateTitle);
        const source = normalizeTitle(scholarTitle);
        if (!candidate || !source) return "none";
        if (candidate === source) return "exact";
        const truncated = /(?:…|\.{3,})\s*$/.test(scholarTitle || "");
        if (truncated && source.length >= 40 &&
            candidate.length > source.length && candidate.startsWith(source))
            return "truncated";
        return "none";
    }

    function normalizeVenue(value = "") {
        return normalizeText(value).replace(/^the\s+/, "");
    }

    function matchVenue(candidate, venue = "", publication = "") {
        const source = normalizeVenue(venue);
        const raw = normalizeVenue(publication);
        const names = [candidate.journal, candidate.abbreviation]
            .map(normalizeVenue).filter(Boolean);
        for (const name of names) {
            if (source === name) return 3;
            if (name.length >= 10 && source.startsWith(name + " ")) return 2;
            if (name.length >= 10 && (raw === name || raw.startsWith(name + " "))) return 1;
        }
        return 0;
    }

    function matchAuthors(candidate, authors = "") {
        const source = normalizeText(authors);
        if (!source || !candidate.authors?.length) return 0;
        const tokens = new Set(source.split(" "));
        const families = [...new Set(candidate.authors
            .map(a => normalizeText(a.family))
            .filter(Boolean))];
        let score = 0;
        for (const family of families) {
            if (family.split(" ").every(token => tokens.has(token))) score++;
        }
        return score;
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

    function updateRateLimits(response, type, version = accessVersion) {
        if (version !== accessVersion) return;
        const reportedPool = getResponsePool(response);
        if (apiPool === "polite" && reportedPool === "public") {
            applyPool("public", contactEmail, false);
        }
        const limit = Number(response.headers.get("x-rate-limit-limit"));
        const raw = response.headers.get("x-rate-limit-interval") || "";
        const match = raw.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
        if (limit > 0 && match) {
            const minimum = Number(match[1]) * 1000 / limit;
            const interval = apiPool === "public"
                ? minimum + 100
                : Math.ceil(minimum * 1.1);
            intervals[type] = Math.max(intervals[type], interval);
        }
        const concurrency = Number(response.headers.get("x-concurrency-limit"));
        if (Number.isInteger(concurrency) && concurrency > 0) {
            intervals.concurrency = Math.min(intervals.concurrency, concurrency);
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

    async function restoreCooldown() {
        try {
            const saved = await chrome.storage.session.get("crossrefBlockedUntil");
            blockedUntil = Math.max(blockedUntil, saved.crossrefBlockedUntil || 0);
        } catch {}
    }

    function getRequestWait(type) {
        const now = Date.now();
        return Math.max(
            0,
            intervals[type] - (now - lastRequest[type]),
            intervals.global - (now - lastAnyRequest),
            blockedUntil - now
        );
    }

    async function pumpQueue() {
        if (schedulerRunning) return;
        schedulerRunning = true;
        try {
            await restoreCooldown();
            while (requestQueue.length && activeRequests < intervals.concurrency) {
                const job = requestQueue[0];
                const wait = getRequestWait(job.type);
                if (wait > MAX_WAIT) {
                    requestQueue.shift();
                    job.reject(new Error(`Crossref cooldown: ${Math.ceil(wait / 1000)}s remaining`));
                    continue;
                }
                if (wait > 0) {
                    await sleep(wait);
                    continue;
                }
                requestQueue.shift();
                activeRequests++;
                lastRequest[job.type] = lastAnyRequest = Date.now();
                const version = accessVersion;
                Promise.resolve()
                    .then(() => job.run(version))
                    .then(job.resolve, job.reject)
                    .finally(() => {
                        activeRequests--;
                        pumpQueue();
                    });
            }
        } finally {
            schedulerRunning = false;
            if (requestQueue.length && activeRequests < intervals.concurrency)
                pumpQueue();
        }
    }

    function scheduleRequest(type, run) {
        return new Promise((resolve, reject) => {
            requestQueue.push({type, run, resolve, reject});
            pumpQueue();
        });
    }

    async function executeRequest(url, type, options = {}) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const result = await scheduleRequest(type, async version => {
                stats.requests++;
                stats[type === "doi" ? "doiRequests" : "titleRequests"]++;
                let response;
                try {
                    const email = options.email ?? contactEmail;
                    response = await fetch(buildRequestURL(url, email), {
                        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
                        headers: {"Accept": "application/json"}
                    });
                } catch (error) {
                    stats.failed++;
                    const temporary = ["TimeoutError", "AbortError", "TypeError"].includes(error.name);
                    if (!temporary || attempt === MAX_RETRIES) throw error;
                    await setCooldown(2000 * 2 ** attempt + Math.random() * 500);
                    return {retry: true};
                }
                if (!options.probe) updateRateLimits(response, type, version);
                if (response.ok) {
                    const data = await response.json();
                    stats.successful++;
                    return {
                        retry: false,
                        message: data.message,
                        pool: getResponsePool(response),
                        headers: response.headers
                    };
                }
                if (response.status === 404)
                    return {retry: false, message: null, pool: getResponsePool(response)};
                stats.failed++;
                if (response.status === 403) {
                    await setCooldown(15 * 60 * 1000);
                    throw new Error("Crossref HTTP 403: requests suspended for 15 minutes");
                }
                const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
                if (response.status === 429) {
                    stats.rateLimited++;
                    intervals[type] = Math.max(intervals[type], Math.min(intervals[type] * 1.5, 10000));
                    intervals.concurrency = Math.max(1, intervals.concurrency - 1);
                }
                if (retryable) {
                    const fallback = 2000 * 2 ** attempt + Math.random() * 500;
                    await setCooldown(Math.max(fallback, getRetryAfter(response, fallback)));
                    if (attempt < MAX_RETRIES && blockedUntil - Date.now() <= MAX_WAIT)
                        return {retry: true};
                }
                throw new Error(`Crossref HTTP ${response.status}`);
            });
            if (!result.retry) return result;
            stats.retries++;
        }
        throw new Error("Crossref request failed after retries");
    }

    async function request(url, type) {
        await initializeAccess();
        const result = await executeRequest(url, type);
        return result.message;
    }

    async function verifyPolitePool(email) {
        const params = new URLSearchParams({
            rows: "1",
            select: "DOI"
        });
        const result = await executeRequest(`${API}?${params}`, "title", {
            email,
            probe: true
        });
        if (result.pool !== "polite")
            throw new Error("Crossref did not confirm Polite Pool access.");
        return result;
    }

    async function activatePolitePool(email, persist = true) {
        email = normalizeEmail(email);
        if (!isValidEmail(email))
            throw new Error("Please provide a valid contact email address.");
        const result = await verifyPolitePool(email);
        if (persist) await saveContactEmail(email);
        applyPool("polite", email, true);
        updateRateLimits({headers: result.headers}, "title");
        pumpQueue();
        return {access: getAccess()};
    }

    let initializationPromise = null;

    function initializeAccess() {
        if (!initializationPromise) {
            initializationPromise = (async () => {
                await restoreCooldown();
                const email = await loadContactEmail();
                if (!email) {
                    applyPool("public", "", false);
                    return;
                }
                applyPool("public", email, false);
                try {
                    await activatePolitePool(email, false);
                } catch {
                    applyPool("public", email, false);
                }
            })().catch(() => {
                applyPool("public", "", false);
            });
        }
        return initializationPromise;
    }

    async function connect(email) {
        await initializeAccess();
        return serializeAccess(async () => {
            return activatePolitePool(email, true);
        });
    }

    async function disconnect() {
        await initializeAccess();
        return serializeAccess(async () => {
            await saveContactEmail("");
            applyPool("public", "", false);
            pumpQueue();
            return {access: getAccess()};
        });
    }

    async function accessStatus() {
        await initializeAccess();
        await accessQueue;
        return {access: getAccess()};
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
        const previous = normalizeEmail(changes[SETTINGS_KEY].oldValue?.crossrefEmail);
        const current = normalizeEmail(changes[SETTINGS_KEY].newValue?.crossrefEmail);
        if (previous === current) return;
        if (!current) {
            applyPool("public", "", false);
            pumpQueue();
        } else if (current !== contactEmail) {
            applyPool("public", current, false);
            pumpQueue();
        }
    });

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
            candidates: result.match ? [result.match] : [],
            reason: result.reason || null,
            evidence: result.evidence || []
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

    function resolveTitleCandidates(candidates, title, year = null, context = {}) {
        const unique = [...new Map(
            candidates.filter(x => x.doi)
                .map(x => [normalizeDOI(x.doi), x])
        ).values()];

        let matched = unique.map(candidate => ({
            candidate,
            titleMatch: matchTitle(candidate.title, title),
            venueScore: matchVenue(candidate, context.journal, context.publication),
            authorScore: matchAuthors(candidate, context.authors),
            yearScore: !year ? 1 :
                candidate.years.includes(Number(year)) ? 3 :
                candidate.years.some(y => Math.abs(y - Number(year)) <= 1) ? 2 :
                !candidate.years.length ? 1 : 0
        })).filter(x => x.titleMatch !== "none");

        if (!matched.length)
            return {matched: [], reason: "title_mismatch"};

        matched = matched.filter(x => x.yearScore > 0);
        if (!matched.length)
            return {matched: [], reason: "year_mismatch"};

        matched = matched.filter(x =>
            x.titleMatch === "exact" ||
            (x.yearScore === 3 && (x.venueScore >= 2 || x.authorScore >= 2)) ||
            (x.yearScore === 2 && x.venueScore >= 2 && x.authorScore >= 2)
        );
        if (!matched.length)
            return {matched: [], reason: "insufficient_title_evidence"};

        const exactTitles = matched.filter(x => x.titleMatch === "exact");
        if (exactTitles.length) matched = exactTitles;

        const bestVenue = Math.max(...matched.map(x => x.venueScore));
        if (bestVenue >= 2)
            matched = matched.filter(x => x.venueScore === bestVenue);

        const bestYear = Math.max(...matched.map(x => x.yearScore));
        matched = matched.filter(x => x.yearScore === bestYear);

        if (matched.length > 1) {
            const bestAuthor = Math.max(...matched.map(x => x.authorScore));
            if (bestAuthor >= 2)
                matched = matched.filter(x => x.authorScore === bestAuthor);
        }

        return {
            matched: matched.map(x => x.candidate),
            reason: matched.length === 1 ? "verified" : "ambiguous",
            evidence: matched.map(x => ({
                doi: x.candidate.doi,
                title: x.titleMatch,
                year: x.yearScore,
                venue: x.venueScore,
                authors: x.authorScore
            }))
        };
    }

    async function buildTitleCacheKey(title, year, context = {}) {
        const payload = JSON.stringify([
            normalizeTitle(title),
            /(?:…|\.{3,})\s*$/.test(title || ""),
            year || "",
            normalizeVenue(context.journal),
            normalizeText(context.publication),
            normalizeText(context.authors)
        ]);
        const digest = await crypto.subtle.digest(
            "SHA-256", new TextEncoder().encode(payload)
        );
        const hash = Array.from(new Uint8Array(digest))
            .map(x => x.toString(16).padStart(2, "0")).join("");
        return `title:${hash}`;
    }

    async function lookupTitle(title, year = null, context = {}) {
        const normalized = normalizeTitle(title);
        if (!normalized)
            return {...buildResult("crossref_title"), reason: "empty_title"};

        const key = await buildTitleCacheKey(title, year, context);
        return cachedRequest(key, async () => {
            const select = "DOI,title,container-title,short-container-title,ISSN,issn-type,type,publisher,author,published,published-print,published-online,issued";
            async function search(field) {
                const params = new URLSearchParams({
                    [field]: title,
                    rows: "5",
                    select
                });
                const m = await request(`${API}?${params}`, "title");
                return (m?.items || []).map(parseMetadata);
            }

            let candidates = await search("query.title");
            let result = resolveTitleCandidates(candidates, title, year, context);

            if (result.matched.length === 0) {
                const additional = await search("query.bibliographic");
                candidates = [...new Map(
                    [...candidates, ...additional]
                        .filter(x => x.doi)
                        .map(x => [normalizeDOI(x.doi), x])
                ).values()];
                result = resolveTitleCandidates(candidates, title, year, context);
            }

            const verified = result.matched.length === 1;
            return {
                method: "crossref_title",
                verified,
                match: verified ? result.matched[0] : null,
                candidates,
                reason: candidates.length ? result.reason : "no_candidates",
                evidence: result.evidence || []
            };
        });
    }

    async function getStats() {
        await initializeAccess();
        const data = await chrome.storage.local.get(null);
        const keys = Object.keys(data).filter(k => k.startsWith(CACHE_PREFIX));
        const bytes = keys.length ? await chrome.storage.local.getBytesInUse(keys) : 0;
        const saved = await chrome.storage.session.get("crossrefBlockedUntil");
        return {
            ...stats,
            pendingRequests: pending.size,
            activeRequests,
            queuedRequests: requestQueue.length,
            doiInterval: intervals.doi,
            titleInterval: intervals.title,
            maxConcurrent: intervals.concurrency,
            apiPool,
            poolConfirmed,
            cooldownSeconds: Math.max(0, Math.ceil(
                (Math.max(blockedUntil, saved.crossrefBlockedUntil || 0) - Date.now()) / 1000
            )),
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

    return {
        lookupDOI, lookupTitle, getStats, clearCache,
        connect, disconnect, accessStatus
    };
})();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    let task;
    switch (message.type) {
        case "CROSSREF_DOI":
            task = Crossref.lookupDOI(message.doi);
            break;
        case "CROSSREF_TITLE":
            task = Crossref.lookupTitle(message.title, message.year, {
                journal: message.journal || "",
                publication: message.publication || "",
                authors: message.authors || ""
            });
            break;
        case "CROSSREF_STATS":
            task = Crossref.getStats();
            break;
        case "CROSSREF_CLEAR_CACHE":
            task = Crossref.clearCache();
            break;
        case "CROSSREF_ACCESS_STATUS":
            task = Crossref.accessStatus();
            break;
        case "CROSSREF_CONNECT":
            task = Crossref.connect(message.email);
            break;
        case "CROSSREF_DISCONNECT":
            task = Crossref.disconnect();
            break;
        default:
            return;
    }
    task.then(result => sendResponse({success: true, ...result}))
        .catch(error => sendResponse({success: false, error: error.message}));
    return true;
});