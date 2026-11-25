const ScholarFilters = (() => {
    const DEFAULTS = {
        minIF: "",
        maxIF: "",
        quartiles: [],
        journal: "",
        includeUnknown: false
    };
    let filters = {...DEFAULTS, quartiles: []};
    let records = null;
    let toolbar = null;

    function normalize(value) {
        return String(value ?? "").normalize("NFKC").toLowerCase()
            .replace(/\s+/g, " ").trim();
    }

    function numeric(value) {
        if (value == null || String(value).trim() === "") return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }

    function isActive() {
        return filters.minIF !== "" || filters.maxIF !== "" ||
            filters.quartiles.length > 0 || filters.journal.trim() !== "";
    }

    function matches(record) {
        if (!isActive()) return true;
        const {article, result, phase} = record;
        if (phase === "queued" || phase === "running" || !result) return true;

        const j = result.journal;
        const journal = j?.journal || result.metadata?.journal || article.journal || "";
        const abbreviation = j?.abbreviation || result.metadata?.abbreviation || "";
        const query = normalize(filters.journal);

        if (query && !normalize(journal).includes(query) &&
            !normalize(abbreviation).includes(query)) return false;

        const jif = numeric(j?.jif);
        const min = numeric(filters.minIF);
        const max = numeric(filters.maxIF);
        const quartile = String(j?.quartile || "").toUpperCase();

        if (filters.minIF !== "" || filters.maxIF !== "") {
            if (jif === null) {
                if (!filters.includeUnknown) return false;
            } else {
                if (min !== null && jif < min) return false;
                if (max !== null && jif > max) return false;
            }
        }
        if (filters.quartiles.length) {
            if (!/^Q[1-4]$/.test(quartile)) {
                if (!filters.includeUnknown) return false;
            } else if (!filters.quartiles.includes(quartile)) {
                return false;
            }
        }
        return true;
    }

    function applyRecord(record) {
        const element = record.article.element;
        if (!element.isConnected) return;
        element.classList.toggle("sj-filter-hidden", !matches(record));
    }

    function updateCount() {
        if (!toolbar || !records) return;
        const current = [...records.values()].filter(r => r.article.element.isConnected);
        const visible = current.filter(r => !r.article.element.classList.contains("sj-filter-hidden")).length;
        const pending = current.filter(r => ["queued", "running", "local"].includes(r.phase)).length;
        toolbar.querySelector(".sj-filter-count").textContent =
            `${visible} / ${current.length} publications${pending ? ` · ${pending} pending` : ""}`;
    }

    function apply() {
        if (!records) return;
        for (const record of records.values()) applyRecord(record);
        updateCount();
    }

    function getVisibleRecords() {
        if (!records) return [];
        return [...records.values()].filter(r =>
            r.article.element.isConnected &&
            !r.article.element.classList.contains("sj-filter-hidden")
        );
    }

    function syncControls() {
        if (!toolbar) return;
        toolbar.querySelector("#sj-min-if").value = filters.minIF;
        toolbar.querySelector("#sj-max-if").value = filters.maxIF;
        toolbar.querySelector("#sj-journal-search").value = filters.journal;
        toolbar.querySelector("#sj-include-unknown").checked = filters.includeUnknown;
        toolbar.querySelectorAll("[data-quartile]").forEach(button => {
            const selected = filters.quartiles.includes(button.dataset.quartile);
            button.classList.toggle("sj-filter-selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
        toolbar.querySelector(".sj-filter-error").textContent = "";
    }

    function reset() {
        filters = {...DEFAULTS, quartiles: []};
        syncControls();
        apply();
    }

    function bindEvents() {
        const minEl = toolbar.querySelector("#sj-min-if");
        const maxEl = toolbar.querySelector("#sj-max-if");
        const journalEl = toolbar.querySelector("#sj-journal-search");
        const unknownEl = toolbar.querySelector("#sj-include-unknown");
        const errorEl = toolbar.querySelector(".sj-filter-error");

        function updateIF() {
            const min = numeric(minEl.value), max = numeric(maxEl.value);
            if (minEl.validity.badInput || maxEl.validity.badInput ||
                (minEl.value !== "" && min === null) ||
                (maxEl.value !== "" && max === null)) {
                errorEl.textContent = "Enter a valid non-negative IF.";
                return;
            }
            if (min !== null && max !== null && min > max) {
                errorEl.textContent = "Minimum IF cannot exceed maximum IF.";
                return;
            }
            errorEl.textContent = "";
            filters.minIF = minEl.value;
            filters.maxIF = maxEl.value;
            apply();
        }

        minEl.addEventListener("input", updateIF);
        maxEl.addEventListener("input", updateIF);
        journalEl.addEventListener("input", () => {
            filters.journal = journalEl.value;
            apply();
        });
        unknownEl.addEventListener("change", () => {
            filters.includeUnknown = unknownEl.checked;
            apply();
        });
        toolbar.querySelectorAll("[data-quartile]").forEach(button => {
            button.addEventListener("click", () => {
                const q = button.dataset.quartile;
                filters.quartiles = filters.quartiles.includes(q)
                    ? filters.quartiles.filter(x => x !== q)
                    : [...filters.quartiles, q];
                const selected = filters.quartiles.includes(q);
                button.classList.toggle("sj-filter-selected", selected);
                button.setAttribute("aria-pressed", String(selected));
                apply();
            });
        });
        toolbar.querySelector(".sj-filter-reset").onclick = reset;
        toolbar.querySelector(".sj-filter-toggle").onclick = () => {
            const body = toolbar.querySelector(".sj-filter-body");
            body.hidden = !body.hidden;
            const button = toolbar.querySelector(".sj-filter-toggle");
            button.textContent = body.hidden ? "Expand" : "Collapse";
            button.setAttribute("aria-expanded", String(!body.hidden));
        };
        toolbar.querySelector(".sj-export-button").addEventListener("click", () => {
            const scope = toolbar.querySelector("#sj-export-scope").value;
            const status = toolbar.querySelector(".sj-export-status");
            try {
                const result = ScholarExport.exportCSV(records, scope);
                status.textContent = result.message;
                status.classList.toggle("sj-export-error", !result.success);
            } catch (error) {
                status.textContent = `Export failed: ${error.message}`;
                status.classList.add("sj-export-error");
                console.error("[ScholarJournal] Export failed:", error);
            }
        });
    }

    function createToolbar() {
        const el = document.createElement("div");
        el.className = "sj-filter-bar";
        el.innerHTML = `
            <div class="sj-filter-header">
                <strong>ScholarJournal Filters</strong>
                <span class="sj-filter-count"></span>
                <button type="button" class="sj-filter-toggle" aria-expanded="true">Collapse</button>
            </div>
            <div class="sj-filter-body">
                <div class="sj-filter-row">
                    <label class="sj-filter-label" for="sj-min-if">IF range</label>
                    <input type="number" id="sj-min-if" min="0" step="any" placeholder="Min IF" aria-label="Minimum impact factor">
                    <span>–</span>
                    <input type="number" id="sj-max-if" min="0" step="any" placeholder="Max IF" aria-label="Maximum impact factor">
                </div>
                <div class="sj-filter-row">
                    <span class="sj-filter-label">JCR</span>
                    <div class="sj-filter-quartiles">
                        <button type="button" data-quartile="Q1" aria-pressed="false">Q1</button>
                        <button type="button" data-quartile="Q2" aria-pressed="false">Q2</button>
                        <button type="button" data-quartile="Q3" aria-pressed="false">Q3</button>
                        <button type="button" data-quartile="Q4" aria-pressed="false">Q4</button>
                    </div>
                </div>
                <div class="sj-filter-row">
                    <label class="sj-filter-label" for="sj-journal-search">Journal</label>
                    <input type="search" id="sj-journal-search" placeholder="Search journal name...">
                </div>
                <div class="sj-filter-error" role="status"></div>
                <div class="sj-filter-footer">
                    <label class="sj-filter-checkbox">
                        <input type="checkbox" id="sj-include-unknown">
                        Include missing metrics
                    </label>
                    <button type="button" class="sj-filter-reset">Reset filters</button>
                </div>
                <div class="sj-export-row">
                    <select id="sj-export-scope" aria-label="Export scope">
                        <option value="all">All loaded publications</option>
                        <option value="filtered">Filtered publications</option>
                    </select>
                    <button type="button" class="sj-export-button">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round"
                             stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 3v12m-5-5 5 5 5-5"/>
                            <path d="M5 16v5h14v-5"/>
                        </svg>
                        Export CSV
                    </button>
                </div>
                <div class="sj-export-status" role="status" aria-live="polite"></div>                
            </div>
        `;
        return el;
    }

    function mount(articleRecords) {
        records = articleRecords;
        if (toolbar?.isConnected) {
            toolbar.hidden = false;
            apply();
            return;
        }
        const profileTable = document.querySelector("#gsc_a_t");
        const searchResults = document.querySelector("#gs_res_ccl_mid");
        const target = profileTable || searchResults;
        if (!target) return;
        toolbar = createToolbar();
        target.before(toolbar);
        bindEvents();
        syncControls();
        apply();
    }

    function unmount() {
        if (toolbar) toolbar.hidden = true;
        document.querySelectorAll(".sj-filter-hidden").forEach(el =>
            el.classList.remove("sj-filter-hidden")
        );
    }

    function onRecordUpdated(record) {
        if (!toolbar?.isConnected || toolbar.hidden) return;
        applyRecord(record);
        updateCount();
    }

    return {
        mount, unmount, apply, reset, matches,
        onRecordUpdated, getVisibleRecords
    };
})();