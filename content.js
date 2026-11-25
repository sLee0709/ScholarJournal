const ScholarJournal = (() => {
    const processed = new WeakSet();
    const results = new Map();
    const articleRecords = new Map();
    const remoteQueue = [];
    const MAX_REMOTE_WORKERS = 5;
    let activeRemoteWorkers = 0;
    let settings = {...ScholarSettings.DEFAULTS};

    function isPageEnabled(article = null) {
        if (!settings.enabled) return false;
        const pageType = article?.pageType || ScholarParser.getPageType();
        return ["search", "profile"].includes(pageType);
    }

    function canUseCrossref(article) {
        return isPageEnabled(article) && settings.enableCrossref;
    }

    function normalizeTitle(title = "") {
        return String(title || "").normalize("NFKC").toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
    }

    function buildResult(article, status, method, options = {}) {
        return {
            id: article.id,
            title: article.title,
            original_journal: article.journal,
            doi: article.doi,
            issn: article.issn,
            status,
            method,
            article_verified: false,
            journal_verified: false,
            jcr_matched: false,
            journal: null,
            metadata: null,
            candidates: [],
            ...options
        };
    }

    function localResult(article, match) {
        return buildResult(article, "matched", `local_${match.method}`, {
            journal_verified: true,
            jcr_matched: true,
            journal: match.journal,
            candidates: match.candidates
        });
    }

    async function requestCrossref(message) {
        try {
            const response = await chrome.runtime.sendMessage(message);
            if (response?.success) return response;
            console.warn("[ScholarJournal] Crossref request failed", {
                request: message,
                error: response?.error || "Empty response"
            });
            return response || {success: false, error: "Empty response"};
        } catch (error) {
            console.warn("[ScholarJournal] Crossref communication failed:", error.message);
            return {success: false, error: error.message};
        }
    }

    function matchCrossref(article, response) {
        if (!response?.success || !response.verified || !response.match) return null;
        const m = response.match;
        if (!m.title || normalizeTitle(m.title) !== normalizeTitle(article.title)) return null;
        const options = {
            article_verified: true,
            metadata: m,
            doi: m.doi || article.doi
        };
        if (m.type !== "journal-article") {
            return buildResult(article, "non_journal", response.method, options);
        }
        let match = JournalMatcher.matchISSN(m.issn || []);
        if (!match.verified && match.candidates.length > 1) {
            return buildResult(article, "ambiguous", response.method, {
                ...options,
                candidates: match.candidates
            });
        }
        if (!match.verified && m.journal)
            match = JournalMatcher.matchName(m.journal);
        if (!match.verified && !match.candidates.length && m.abbreviation)
            match = JournalMatcher.matchName(m.abbreviation);
        return buildResult(article, match.verified ? "matched" : "not_in_database", response.method, {
            ...options,
            journal_verified: Boolean(m.journal || match.verified),
            jcr_matched: match.verified,
            journal: match.journal,
            candidates: match.candidates
        });
    }

    function identifyLocal(article) {
        if (article.issn) {
            const match = JournalMatcher.matchISSN(article.issn);
            if (match.verified) return localResult(article, match);
        }
        const nameMatch = JournalMatcher.matchName(article.journal || "");
        if (nameMatch.verified) return localResult(article, nameMatch);
        return null;
    }
    function remoteFallback(article, error = null, deferred = false) {
        const match = JournalMatcher.matchName(article.journal || "");
        return buildResult(
            article,
            match.candidates.length ? "unverified" : "unmatched",
            match.method, {
                candidates: match.candidates,
                api_error: error,
                remote_deferred: deferred
            }
        );
    }

    async function identifyRemote(article) {
        if (!canUseCrossref(article))
            return remoteFallback(article, null, true);

        if (article.doi) {
            const response = await requestCrossref({
                type: "CROSSREF_DOI",
                doi: article.doi
            });
            const result = matchCrossref(article, response);
            if (result) return result;
            if (!response?.success)
                return remoteFallback(article, response?.error || "DOI lookup failed");
        }
        if (!canUseCrossref(article))
            return remoteFallback(article, null, true);

        if (article.title) {
            const response = await requestCrossref({
                type: "CROSSREF_TITLE",
                title: article.title,
                year: article.year
            });
            const result = matchCrossref(article, response);
            if (result) return result;
            if (!response?.success)
                return remoteFallback(article, response?.error || "Title lookup failed");
        }
        return remoteFallback(article);
    }

    async function identifyArticle(article) {
        return identifyLocal(article) || await identifyRemote(article);
    }

    function createBadge(text, className = "") {
        const badge = document.createElement("span");
        badge.className = `sj-badge ${className}`;
        badge.textContent = text;
        return badge;
    }

    function interpolateColor(start, end, t) {
        t = Math.max(0, Math.min(1, t));
        const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x, 16));
        const a = rgb(start), b = rgb(end);
        return a.map((v, i) => Math.round(v + (b[i] - v) * t));
    }

    function createMetricBadge(text, className, start, end, t) {
        const badge = createBadge(text, className);
        const rgb = interpolateColor(start, end, t);
        const linear = rgb.map(v => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        badge.style.backgroundColor = `rgb(${rgb.join(",")})`;
        badge.style.color = luminance > 0.179 ? "#202124" : "#ffffff";
        return badge;
    }

    function showJournalModal(j, result) {
        document.querySelector(".sj-modal")?.remove();
        const modal = document.createElement("dialog");
        modal.className = "sj-modal";
        modal.setAttribute("aria-label", "Journal information");
        modal.innerHTML = `
            <div class="sj-modal-header">
                <div>
                    <div class="sj-modal-title"></div>
                    <div class="sj-modal-subtitle"></div>
                </div>
                <button class="sj-modal-close" aria-label="Close">×</button>
            </div>
            <div class="sj-modal-body">
                <div class="sj-modal-metrics"></div>
                <div class="sj-modal-section">JCR Categories</div>
                <table class="sj-modal-table">
                    <thead>
                        <tr><th>Category</th><th>Quartile</th><th>Rank</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
                <div class="sj-modal-extra"></div>
            </div>
            <div class="sj-modal-footer">
                <button class="sj-modal-button">Close</button>
            </div>
        `;
        const value = v => v == null || ["", "-", "n/a", "na", "nan", "null", "undefined"].includes(String(v).trim().toLowerCase()) ? "—" : String(v);
        modal.querySelector(".sj-modal-title").textContent = j.journal;
        modal.querySelector(".sj-modal-subtitle").textContent = `${value(j.publisher)} · JCR ${value(j.year)}`;

        const metrics = [
            ["Impact Factor", j.jif],
            ["5-year IF", j.jif5],
            ["JCI", j.jci],
            ["JCR Quartile", j.quartile],
            ["JIF Percentile", j.percentile],
            ["IF without self-cites", j.jif_no_self]
        ];
        const metricsEl = modal.querySelector(".sj-modal-metrics");
        for (const [label, val] of metrics) {
            const card = document.createElement("div");
            card.className = "sj-modal-metric";
            const name = document.createElement("div");
            name.className = "sj-modal-metric-label";
            name.textContent = label;
            const number = document.createElement("div");
            number.className = "sj-modal-metric-value";
            number.textContent = value(val);
            card.append(name, number);
            metricsEl.appendChild(card);
        }

        const tbody = modal.querySelector("tbody");
        const categories = String(j.category_details || "").split(/\s*\|\s*/).filter(Boolean);
        for (const category of categories) {
            const match = category.match(/^(.*?)\s*:\s*(Q[1-4])\s*(.*)$/i);
            const fields = match ? [match[1], match[2], match[3]] : [category, "—", "—"];
            const tr = document.createElement("tr");
            fields.forEach((field, i) => {
                const td = document.createElement("td");
                td.textContent = field;
                if (i === 1 && /^Q[1-4]$/i.test(field)) {
                    const badge = createMetricBadge(field, "sj-quartile", "#e6f4ea", "#137333", (4 - Number(field.slice(1))) / 3);
                    td.replaceChildren(badge);
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
        if (!categories.length) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 3;
            td.textContent = "No category information available";
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        const extra = modal.querySelector(".sj-modal-extra");
        for (const [label, val] of [
            ["ISSN", j.issn], ["eISSN", j.eissn],
            ["Abbreviation", j.abbreviation], ["Category Rank", j.rank]
        ]) {
            const row = document.createElement("div");
            const name = document.createElement("span");
            name.textContent = `${label}: `;
            const text = document.createElement("strong");
            text.textContent = value(val);
            row.append(name, text);
            extra.appendChild(row);
        }

        modal.querySelector(".sj-modal-close").onclick = () => modal.close();
        modal.querySelector(".sj-modal-button").onclick = () => modal.close();
        modal.addEventListener("click", e => {
            if (e.target === modal) {
                const r = modal.getBoundingClientRect();
                if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
                    modal.close();
            }
        });
        modal.addEventListener("close", () => modal.remove(), {once: true});
        document.body.appendChild(modal);
        modal.showModal();
    }

    function renderLoading(article) {
        const container = document.createElement("div");
        container.className = `sj-info sj-loading${article.pageType === "profile" ? " sj-profile" : ""}`;
        container.appendChild(createBadge("Identifying journal..."));
        if (article.pageType === "profile") {
            const publicationEl = article.element.querySelector(".gsc_a_t .gs_gray:last-of-type");
            const titleCell = article.element.querySelector(".gsc_a_t");
            if (publicationEl) publicationEl.after(container);
            else if (titleCell) titleCell.appendChild(container);
        } else {
            const metadataEl = article.element.querySelector(".gs_a");
            if (metadataEl) metadataEl.after(container);
            else article.element.appendChild(container);
        }
        return container;
    }
    function renderResult(container, result) {
        container.replaceChildren();
        const isProfile = container.classList.contains("sj-profile");
        container.className = `sj-info sj-status-${result.status}${isProfile ? " sj-profile" : ""}`;
        container.removeAttribute("title");

        function hasValue(value) {
            return value != null && !["", "-", "n/a", "na", "nan", "null", "undefined"]
                .includes(String(value).trim().toLowerCase());
        }

        if (result.status === "matched") {
            const j = result.journal;
            if (settings.showJournal)
                container.appendChild(createBadge(j.journal, "sj-journal"));

            if (settings.showJIF && hasValue(j.jif) && Number.isFinite(Number(j.jif))) {
                const t = Math.log1p(Math.max(0, Number(j.jif))) / Math.log1p(50);
                container.appendChild(createMetricBadge(
                    `IF ${j.jif}`, "sj-jif", "#fce8e6", "#801710", t
                ));
            }
            if (settings.showQuartile && hasValue(j.quartile) && /^Q[1-4]$/i.test(j.quartile)) {
                const t = (4 - Number(j.quartile.slice(1))) / 3;
                container.appendChild(createMetricBadge(
                    `JCR ${j.quartile}`, "sj-quartile", "#e6f4ea", "#137333", t
                ));
            }
            if (settings.showPercentile && hasValue(j.percentile) && Number.isFinite(Number(j.percentile))) {
                const top = Math.max(0, Math.min(100, 100 - Number(j.percentile)));
                const t = 1 - Math.log1p(top) / Math.log1p(100);
                container.appendChild(createMetricBadge(
                    `Top ${Number(top.toFixed(1))}%`, "sj-percentile", "#f3e8fd", "#50158a", t
                ));
            }
            if (settings.showJIF5 && hasValue(j.jif5))
                container.appendChild(createBadge(`5-year IF ${j.jif5}`, "sj-secondary-metric"));
            if (settings.showJCI && hasValue(j.jci))
                container.appendChild(createBadge(`JCI ${j.jci}`, "sj-secondary-metric"));
            if (settings.showRank && hasValue(j.rank))
                container.appendChild(createBadge(`Rank ${j.rank}`, "sj-secondary-metric"));

            if (settings.showDetails) {
                const detailBadge = document.createElement("button");
                detailBadge.type = "button";
                detailBadge.className = "sj-badge sj-details";
                detailBadge.textContent = "ⓘ";
                detailBadge.setAttribute("aria-label", "View journal details");
                detailBadge.addEventListener("click", e => {
                    e.preventDefault();
                    e.stopPropagation();
                    showJournalModal(j, result);
                });
                container.appendChild(detailBadge);
            }
        } else if (result.status === "non_journal") {
            if (settings.showJournal)
                container.appendChild(createBadge(
                    result.metadata?.journal || "Non-journal publication",
                    "sj-non-journal"
                ));
            container.appendChild(createBadge(
                result.metadata?.type === "proceedings-article" ? "Conference" :
                result.metadata?.type === "posted-content" ? "Preprint" :
                result.metadata?.type || "Non-journal",
                "sj-publication-type"
            ));
        } else if (result.status === "not_in_database") {
            if (settings.showJournal)
                container.appendChild(createBadge(
                    result.metadata?.journal || "Unknown journal", "sj-journal"
                ));
            container.appendChild(createBadge("Not in JCR database", "sj-unmatched"));
        } else if (result.status === "error") {
            container.appendChild(createBadge("Identification failed", "sj-unmatched"));
        } else if (result.candidates.length) {
            container.appendChild(createBadge(
                `${result.candidates.length} candidate(s)`, "sj-unverified"
            ));
            container.title = result.candidates.map(j => j.journal).join("\n");
        } else {
            container.appendChild(createBadge("Unmatched", "sj-unmatched"));
        }
    }
    function renderRecord(record) {
        const {article, container, result, phase} = record;
        if (!container.isConnected) return;
        if (!isPageEnabled(article)) {
            container.hidden = true;
            return;
        }
        if (phase === "queued" || phase === "running") {
            container.replaceChildren(createBadge("Querying Crossref..."));
            container.hidden = false;
            return;
        }
        if (!result) {
            container.hidden = true;
            return;
        }
        const unmatched = ["unmatched", "unverified", "ambiguous", "not_in_database", "error"]
            .includes(result.status);
        if (settings.hideUnmatched && unmatched) {
            container.hidden = true;
            return;
        }
        renderResult(container, result);
        container.hidden = container.childElementCount === 0;
    }

    function finishArticle(record, result) {
        record.result = result;
        record.phase = result.remote_deferred ? "deferred" : "done";
        results.set(record.article.id || record.article.title, result);
        renderRecord(record);
        ScholarFilters.onRecordUpdated(record);
        console.log("[ScholarJournal]", result);
    }

    function deferRemote(record) {
        finishArticle(record, remoteFallback(record.article, null, true));
    }

    function processRemoteQueue() {
        while (activeRemoteWorkers < MAX_REMOTE_WORKERS && remoteQueue.length) {
            const record = remoteQueue.shift();
            if (!record.container.isConnected || record.phase !== "queued") continue;
            if (!canUseCrossref(record.article)) {
                deferRemote(record);
                continue;
            }
            activeRemoteWorkers++;
            record.phase = "running";
            renderRecord(record);
            Promise.resolve()
                .then(() => identifyRemote(record.article))
                .then(result => finishArticle(record, result))
                .catch(error => {
                    finishArticle(record, buildResult(record.article, "error", "error", {
                        api_error: error.message
                    }));
                    console.error("[ScholarJournal]", record.article.title, error);
                })
                .finally(() => {
                    activeRemoteWorkers--;
                    processRemoteQueue();
                });
        }
    }

    function processArticle(article) {
        if (processed.has(article.element) || !isPageEnabled(article)) return;
        processed.add(article.element);
        const container = renderLoading(article);
        const record = {
            article,
            container,
            result: null,
            phase: "local"
        };
        articleRecords.set(article.element, record);
        try {
            const result = identifyLocal(article);
            if (result) {
                finishArticle(record, result);
                return;
            }
            if (!canUseCrossref(article)) {
                deferRemote(record);
                return;
            }
            record.phase = "queued";
            remoteQueue.push(record);
            renderRecord(record);
            processRemoteQueue();
        } catch (error) {
            finishArticle(record, buildResult(article, "error", "error", {
                api_error: error.message
            }));
            console.error("[ScholarJournal]", article.title, error);
        }
    }

    function processPage() {
        for (const [element] of articleRecords) {
            if (!element.isConnected)
                articleRecords.delete(element);
        }
        if (!isPageEnabled()) {
            ScholarFilters.unmount();
            ScholarAnalyticsUI.unmountButton();
            return;
        }
        for (const article of ScholarParser.parsePage()) {
            if (!processed.has(article.element) && isPageEnabled(article))
                processArticle(article);
        }
        if (settings.showFilters)
            ScholarFilters.mount(articleRecords);
        else
            ScholarFilters.unmount();

        if (ScholarParser.getPageType() === "profile")
            ScholarAnalyticsUI.mountButton();
        else
            ScholarAnalyticsUI.unmountButton();
    }

    function applySettings(newSettings) {
        settings = {...ScholarSettings.DEFAULTS, ...newSettings};
        remoteQueue.length = 0;

        for (const [element, record] of articleRecords) {
            if (!element.isConnected) {
                articleRecords.delete(element);
                continue;
            }
            if (record.phase === "queued" && !canUseCrossref(record.article))
                deferRemote(record);

            if (record.phase === "deferred" && canUseCrossref(record.article))
                record.phase = "queued";

            if (record.phase === "queued")
                remoteQueue.push(record);

            renderRecord(record);
        }
        const pageEnabled = isPageEnabled();
        if (!pageEnabled || !settings.showDetails)
            document.querySelector(".sj-modal[open]")?.close();

        processPage();
        processRemoteQueue();
    }

    async function init() {
        try {
            const loaded = await ScholarSettings.load();
            applySettings(loaded);
            console.log("[ScholarJournal] Settings initialized:", loaded);
        } catch (error) {
            console.error("[ScholarJournal] Failed to load settings:", error);
            return;
        }

        ScholarSettings.subscribe(newSettings => {
            console.log("[ScholarJournal] Settings changed:", newSettings);
            applySettings(newSettings);
        });

        let timer = null;
        const observer = new MutationObserver(mutations => {
            const hasNewArticles = mutations.some(m =>
                [...m.addedNodes].some(node =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node.matches(".gsc_a_tr, .gs_r.gs_or.gs_scl") ||
                     node.querySelector(".gsc_a_tr, .gs_r.gs_or.gs_scl"))
                )
            );
            if (!hasNewArticles) return;
            clearTimeout(timer);
            timer = setTimeout(processPage, 100);
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }

    return {
        init, processPage, identifyArticle, results,
        articleRecords, applySettings
    };
})();

ScholarJournal.init();