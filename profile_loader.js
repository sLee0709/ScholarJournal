const ScholarProfileLoader = (() => {
    const CONFIG = Object.freeze({
        POLL_INTERVAL: 150,
        BATCH_INTERVAL: 1200,
        BATCH_TIMEOUT: 20000,
        STABLE_DURATION: 1500,
        MAX_BATCHES: 100,
        MAX_ARTICLES: 10000
    });
    let active = false;
    let controller = null;

    function getProfileInfo() {
        const url = new URL(location.href);
        return {
            id: url.searchParams.get("user"),
            name: document.querySelector("#gsc_prf_in")?.textContent.trim() || "",
            affiliation: document.querySelector(".gsc_prf_il")?.textContent.trim() || "",
            url: `${url.origin}/citations?user=${encodeURIComponent(url.searchParams.get("user") || "")}`
        };
    }

    function getState() {
        const button = document.querySelector("#gsc_bpf_more");
        const pagination = document.querySelector("#gsc_a_nn")?.textContent.trim() || "";
        const numbers = pagination.match(/\d+/g)?.map(Number) || [];
        return {
            loaded: document.querySelectorAll(".gsc_a_tr").length,
            pagination,
            paginationEnd: numbers.length ? numbers.at(-1) : null,
            buttonExists: Boolean(button),
            buttonDisabled: button?.disabled ?? null,
            buttonVisible: Boolean(button?.getClientRects().length)
        };
    }

    function isRestricted() {
        return /\/sorry\//i.test(location.pathname) ||
            Boolean(document.querySelector("#captcha-form, #gs_captcha_ccl, iframe[src*='recaptcha']"));
    }

    function checkAbort(signal) {
        if (signal.aborted)
            throw new DOMException("Profile loading cancelled", "AbortError");
        if (isRestricted())
            throw new Error("Google Scholar access restriction detected");
    }

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                reject(new DOMException("Cancelled", "AbortError"));
                return;
            }
            const abort = () => {
                clearTimeout(timer);
                reject(new DOMException("Cancelled", "AbortError"));
            };
            const timer = setTimeout(() => {
                signal.removeEventListener("abort", abort);
                resolve();
            }, ms);
            signal.addEventListener("abort", abort, {once: true});
        });
    }

    async function waitForStableState(signal) {
        let previous = JSON.stringify(getState());
        let stableSince = Date.now();
        const start = Date.now();
        while (Date.now() - start < CONFIG.BATCH_TIMEOUT) {
            checkAbort(signal);
            const state = getState();
            const current = JSON.stringify(state);
            if (current !== previous) {
                previous = current;
                stableSince = Date.now();
            }
            if (Date.now() - stableSince >= CONFIG.STABLE_DURATION)
                return state;
            await sleep(CONFIG.POLL_INTERVAL, signal);
        }
        throw new Error("Profile state did not stabilize");
    }

    async function waitForBatch(previous, signal) {
        const start = Date.now();
        let changedAt = null;
        let lastKey = null;
        while (Date.now() - start < CONFIG.BATCH_TIMEOUT) {
            checkAbort(signal);
            const state = getState();
            const increased = state.loaded > previous.loaded;
            const paginationChanged = state.pagination !== previous.pagination;
            const consistent = state.paginationEnd === null ||
                state.paginationEnd === state.loaded;
            if (increased && paginationChanged && consistent) {
                const key = JSON.stringify(state);
                if (key !== lastKey) {
                    lastKey = key;
                    changedAt = Date.now();
                }
                if (Date.now() - changedAt >= CONFIG.STABLE_DURATION)
                    return state;
            }
            await sleep(CONFIG.POLL_INTERVAL, signal);
        }
        throw new Error("Profile batch loading timed out");
    }

    function collectPublications() {
        const publications = new Map();
        for (const el of document.querySelectorAll(".gsc_a_tr")) {
            const article = ScholarParser.parseProfileArticle(el);
            if (!article.title) continue;
            const citationText = el.querySelector(".gsc_a_c")?.textContent.trim() || "";
            const citationLink = el.querySelector(".gsc_a_c a")?.href || null;
            const rawCitations = citationText.replace(/[,\s\u00a0]/g, "");
            const citations = /^\d+$/.test(rawCitations)
                ? Number(rawCitations)
                : citationText === "" ? 0 : null;
            const key = article.id || `${article.title}|${article.year}`;
            if (publications.has(key)) continue;
            publications.set(key, {
                id: article.id,
                title: article.title,
                authors: article.authors,
                publication: article.metadata,
                journal: article.journal,
                year: article.year,
                citations,
                citationUrl: citationLink,
                url: article.url,
                doi: article.doi,
                issn: article.issn,
                pageType: "profile"
            });
        }
        return [...publications.values()];
    }

    function buildResult(status, batches, reason = null, evidence = null) {
        return {
            status,
            complete: status === "complete",
            profile: getProfileInfo(),
            publications: collectPublications(),
            batches,
            reason,
            evidence,
            state: getState(),
            collectedAt: new Date().toISOString()
        };
    }

    async function loadAll({onProgress = () => {}} = {}) {
        if (active) throw new Error("Profile loading is already running");
        if (ScholarParser.getPageType() !== "profile")
            throw new Error("Not a researcher profile page");
        active = true;
        controller = new AbortController();
        const signal = controller.signal;
        const initialId = getProfileInfo().id;
        let batches = 0;

        function report(stage) {
            onProgress({
                stage,
                batches,
                ...getState()
            });
        }

        try {
            report("initializing");
            let state = await waitForStableState(signal);
            while (true) {
                checkAbort(signal);
                if (getProfileInfo().id !== initialId)
                    throw new Error("Researcher profile changed during loading");
                if (!state.buttonExists || !state.buttonVisible)
                    return buildResult("incomplete", batches, "Pagination button unavailable");
                if (state.buttonDisabled) {
                    const consistent = state.paginationEnd === state.loaded;
                    if (consistent && state.loaded > 0) {
                        report("complete");
                        return buildResult("complete", batches, null,
                            batches > 0 ? "final_batch_disabled" : "initial_stable_disabled");
                    }
                    return buildResult("incomplete", batches, "Unable to confirm profile completeness");
                }
                if (batches >= CONFIG.MAX_BATCHES || state.loaded >= CONFIG.MAX_ARTICLES)
                    return buildResult("incomplete", batches, "Loading safety limit reached");

                const button = document.querySelector("#gsc_bpf_more");
                if (!button || button.disabled)
                    throw new Error("Show more button is unavailable");
                const previous = state;
                report("loading");
                button.click();
                state = await waitForBatch(previous, signal);
                batches++;
                report("batch_loaded");
                if (!state.buttonDisabled)
                    await sleep(CONFIG.BATCH_INTERVAL, signal);
            }
        } catch (error) {
            const status = error.name === "AbortError" ? "cancelled" : "incomplete";
            return buildResult(status, batches, error.message);
        } finally {
            active = false;
            controller = null;
        }
    }

    function cancel() {
        controller?.abort();
    }

    function isLoading() {
        return active;
    }

    return {
        getProfileInfo, getState, collectPublications,
        loadAll, cancel, isLoading
    };
})();