const ScholarProfileCache = (() => {
    const PREFIX = "scholarjournal:profile:v1:";
    const TTL = 24 * 60 * 60 * 1000;
    const MAX_PROFILES = 20;
    const MAX_BYTES = 3 * 1024 * 1024;
    let writeQueue = Promise.resolve();

    function getKey(profileId) {
        if (!profileId) throw new Error("Missing researcher ID");
        return PREFIX + profileId;
    }

    function isExpired(entry) {
        return !entry?.savedAt || Date.now() - entry.savedAt >= TTL;
    }

    function getJournalIdentity(result) {
        if (!result) return null;
        const j = result.journal;
        const m = result.metadata;
        return {
            status: result.status,
            method: result.method,
            article_verified: Boolean(result.article_verified),
            journal_verified: Boolean(result.journal_verified),
            journal: j?.journal || m?.journal || null,
            abbreviation: j?.abbreviation || m?.abbreviation || null,
            issn: j?.issn || null,
            eissn: j?.eissn || null,
            external_issn: m?.issn || [],
            doi: result.doi || m?.doi || null,
            type: m?.type || null,
            publisher: m?.publisher || j?.publisher || null,
            api_error: result.api_error || null,
            remote_deferred: Boolean(result.remote_deferred)
        };
    }

    function buildSnapshot(profileData, articleRecords) {
        const recordIndex = new Map();
        for (const record of articleRecords.values()) {
            const article = record.article;
            if (article.pageType !== "profile" || !article.element.isConnected) continue;
            const key = article.id || `${article.title}|${article.year}`;
            recordIndex.set(key, record);
        }
        const publications = profileData.publications.map(article => {
            const key = article.id || `${article.title}|${article.year}`;
            const record = recordIndex.get(key);
            return {
                ...article,
                phase: record?.phase || "pending",
                journalIdentity: getJournalIdentity(record?.result)
            };
        });
        const pending = publications.filter(p =>
            ["pending", "local", "queued", "running"].includes(p.phase)
        ).length;
        const unresolved = publications.filter(p =>
            !p.journalIdentity?.journal_verified &&
            p.journalIdentity?.status !== "non_journal"
        ).length;
        const apiErrors = publications.filter(p => p.journalIdentity?.api_error).length;
        const deferred = publications.filter(p =>
            p.phase === "deferred" || p.journalIdentity?.remote_deferred
        ).length;
        return {
            schemaVersion: 1,
            profile: profileData.profile,
            complete: profileData.complete,
            evidence: profileData.evidence,
            collectedAt: profileData.collectedAt,
            savedAt: Date.now(),
            publications,
            stats: {
                total: publications.length,
                pending,
                unresolved,
                apiErrors,
                deferred
            }
        };
    }

    async function load(profileId, {allowExpired = false} = {}) {
        const key = getKey(profileId);
        const data = await chrome.storage.local.get(key);
        const entry = data[key];
        if (!entry || entry.schemaVersion !== 1) return null;
        if (isExpired(entry) && !allowExpired) return null;
        return {
            ...entry,
            expired: isExpired(entry),
            ageHours: (Date.now() - entry.savedAt) / 3600000
        };
    }

    async function cleanup() {
        const data = await chrome.storage.local.get(null);
        const entries = Object.entries(data)
            .filter(([key]) => key.startsWith(PREFIX))
            .sort((a, b) => b[1].savedAt - a[1].savedAt);
        const remove = [];
        let count = 0, bytes = 0;
        for (const [key, entry] of entries) {
            const size = new TextEncoder().encode(key + JSON.stringify(entry)).length;
            if (isExpired(entry) || count >= MAX_PROFILES || bytes + size > MAX_BYTES) {
                remove.push(key);
                continue;
            }
            count++;
            bytes += size;
        }
        if (remove.length) await chrome.storage.local.remove(remove);
        return remove.length;
    }

    function save(snapshot) {
        const task = writeQueue.then(async () => {
            if (!snapshot?.profile?.id)
                throw new Error("Invalid profile snapshot");
            if (!snapshot.complete)
                return {saved: false, reason: "Incomplete profile"};
            if (snapshot.stats.pending > 0)
                return {saved: false, reason: "Journal identification is still running"};
            if (snapshot.stats.apiErrors > 0 || snapshot.stats.deferred > 0)
                return {saved: false, reason: "Some remote lookups are incomplete"};
            const key = getKey(snapshot.profile.id);
            const entry = {...snapshot, savedAt: Date.now()};
            const bytes = new TextEncoder().encode(key + JSON.stringify(entry)).length;
            if (bytes > MAX_BYTES)
                return {saved: false, reason: "Profile exceeds cache capacity"};
            await cleanup();
            await chrome.storage.local.set({[key]: entry});
            await cleanup();
            const stored = await chrome.storage.local.get(key);
            return {
                saved: Boolean(stored[key]),
                profileId: snapshot.profile.id,
                publications: snapshot.publications.length,
                bytes
            };
        });
        writeQueue = task.catch(() => {});
        return task;
    }

    async function remove(profileId) {
        await chrome.storage.local.remove(getKey(profileId));
    }

    async function clear() {
        await writeQueue;
        const data = await chrome.storage.local.get(null);
        const keys = Object.keys(data).filter(key => key.startsWith(PREFIX));
        if (keys.length) await chrome.storage.local.remove(keys);
        return {removed: keys.length};
    }

    async function getStats() {
        const data = await chrome.storage.local.get(null);
        const entries = Object.entries(data).filter(([key]) => key.startsWith(PREFIX));
        const keys = entries.map(([key]) => key);
        const bytes = keys.length ? await chrome.storage.local.getBytesInUse(keys) : 0;
        return {
            profiles: entries.length,
            validProfiles: entries.filter(([, entry]) => !isExpired(entry)).length,
            expiredProfiles: entries.filter(([, entry]) => isExpired(entry)).length,
            publications: entries.reduce((n, [, entry]) => n + entry.publications.length, 0),
            cacheMB: Number((bytes / 1024 / 1024).toFixed(3))
        };
    }

    function restoreJournal(publication) {
        const identity = publication.journalIdentity;
        if (!identity || identity.status === "non_journal") return null;
        if (!identity.journal_verified) return null;
        const issns = [
            identity.issn,
            identity.eissn,
            ...identity.external_issn
        ].filter(Boolean);
        if (issns.length) {
            const match = JournalMatcher.matchISSN(issns);
            if (match.verified) return match.journal;
            if (match.candidates.length > 1) return null;
        }
        if (identity.journal) {
            const match = JournalMatcher.matchName(identity.journal);
            if (match.verified) return match.journal;
            if (match.candidates.length > 1) return null;
        }
        if (identity.abbreviation) {
            const match = JournalMatcher.matchName(identity.abbreviation);
            if (match.verified) return match.journal;
        }
        return null;
    }

    function hydrate(snapshot) {
        return {
            ...snapshot,
            publications: snapshot.publications.map(publication => ({
                ...publication,
                journalMetrics: restoreJournal(publication)
            }))
        };
    }

    return {
        buildSnapshot, load, save, remove, clear,
        cleanup, getStats, restoreJournal, hydrate
    };
})();