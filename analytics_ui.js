const ScholarAnalyticsUI = (() => {
    const MATCH_TIMEOUT = 180000;
    const POLL_INTERVAL = 300;
    let modal = null;
    let snapshot = null;
    let controller = null;
    let currentTask = null;
    let generation = 0;
    let activeTab = "overview";
    let analysisFilters = {...ScholarAnalytics.DEFAULT_FILTERS};
    let currentAnalysis = null;
    const QUARTILE_COLORS = {
        Q1: "#137333",
        Q2: "#65b77d",
        Q3: "#b7dfc2",
        Q4: "#e6f4ea",
        Unclassified: "#b8bec7"
    };
    const $ = selector => modal?.querySelector(selector);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function createModal() {
        const el = document.createElement("dialog");
        el.className = "sj-analytics-modal";
        el.setAttribute("aria-label", "Publication Analytics");
        el.innerHTML = `
            <header class="sja-header">
                <div>
                    <div class="sja-title">Publication Analytics</div>
                    <div class="sja-subtitle"></div>
                </div>
                <button type="button" class="sja-close" aria-label="Close">×</button>
            </header>
            <main class="sja-main"></main>
            <footer class="sja-footer">
                <span>ScholarJournal · Researcher Publication Analytics</span>
                <button type="button" class="sja-btn sja-footer-close">Close</button>
            </footer>
        `;
        el.querySelector(".sja-close").onclick = close;
        el.querySelector(".sja-footer-close").onclick = close;
        el.addEventListener("cancel", e => {
            e.preventDefault();
            close();
        });
        el.addEventListener("click", e => {
            if (e.target !== el) return;
            const r = el.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right ||
                e.clientY < r.top || e.clientY > r.bottom) close();
        });
        document.body.appendChild(el);
        return el;
    }

    function renderLoading() {
        $(".sja-main").innerHTML = `
            <div class="sja-loading">
                <div class="sja-spinner"></div>
                <h2>Preparing researcher profile...</h2>
                <p class="sja-loading-message">Initializing publication analysis</p>
                <div class="sja-progress-section">
                    <div class="sja-progress-label">
                        <strong>Loading publications</strong>
                        <span class="sja-loaded-count">0 loaded</span>
                    </div>
                    <div class="sja-progress-track">
                        <div class="sja-load-progress sja-indeterminate"></div>
                    </div>
                </div>
                <div class="sja-progress-section">
                    <div class="sja-progress-label">
                        <strong>Journal identification</strong>
                        <span class="sja-matched-count">0 / 0</span>
                    </div>
                    <div class="sja-progress-track">
                        <div class="sja-match-progress"></div>
                    </div>
                </div>
                <div class="sja-loading-stats">
                    <div><span>Local matched</span><strong id="sja-local">0</strong></div>
                    <div><span>Remote resolved</span><strong id="sja-remote">0</strong></div>
                    <div><span>Pending</span><strong id="sja-pending">0</strong></div>
                    <div><span>Unresolved</span><strong id="sja-unresolved">0</strong></div>
                </div>
                <p class="sja-loading-hint">
                    Loading the complete public Google Scholar profile.
                    The total publication count may not be known in advance.
                </p>
                <button type="button" class="sja-btn sja-cancel">Cancel loading</button>
            </div>
        `;
        $(".sja-cancel").onclick = cancel;
    }

    function getIdentificationProgress() {
        const elements = [...document.querySelectorAll(".gsc_a_tr")];
        const records = elements.map(el => ScholarJournal.articleRecords.get(el));
        const completed = records.filter(r =>
            r?.result && ["done", "deferred"].includes(r.phase)
        );
        const local = completed.filter(r =>
            r.result.method?.startsWith("local_") && r.result.jcr_matched
        ).length;
        const remote = completed.filter(r =>
            r.result.method?.startsWith("crossref_") &&
            r.result.article_verified
        ).length;
        const unresolved = completed.filter(r =>
            !r.result.journal_verified &&
            r.result.status !== "non_journal"
        ).length;
        return {
            total: elements.length,
            completed: completed.length,
            pending: elements.length - completed.length,
            local, remote, unresolved
        };
    }

    function updateProgress(profileComplete = false, message = null) {
        if (!modal?.isConnected || !$(".sja-loaded-count")) return;
        const progress = getIdentificationProgress();
        const percent = progress.total
            ? progress.completed / progress.total * 100 : 0;
        $(".sja-loaded-count").textContent = `${progress.total} loaded`;
        $(".sja-matched-count").textContent =
            `${progress.completed} / ${progress.total}`;
        $(".sja-match-progress").style.width = `${percent}%`;
        $("#sja-local").textContent = progress.local;
        $("#sja-remote").textContent = progress.remote;
        $("#sja-pending").textContent = progress.pending;
        $("#sja-unresolved").textContent = progress.unresolved;
        if (profileComplete) {
            $(".sja-load-progress").classList.remove("sja-indeterminate");
            $(".sja-load-progress").style.width = "100%";
            $(".sja-loaded-count").textContent = `${progress.total} · Complete`;
        }
        if (message) $(".sja-loading-message").textContent = message;
    }

    function checkAbort(signal) {
        if (signal.aborted)
            throw new DOMException("Analysis cancelled", "AbortError");
    }

    async function waitForIdentification(signal, profileComplete) {
        const start = Date.now();
        while (Date.now() - start < MATCH_TIMEOUT) {
            checkAbort(signal);
            ScholarJournal.processPage();
            const progress = getIdentificationProgress();
            updateProgress(profileComplete,
                "Waiting for journal identification to finish...");
            if (progress.pending === 0) return true;
            await sleep(POLL_INTERVAL);
        }
        return false;
    }

    function fmt(value, digits = 2) {
        return value == null || !Number.isFinite(Number(value))
            ? "—" : Number(Number(value).toFixed(digits)).toLocaleString();
    }

    function makeEl(tag, className = "", text = null) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== null) el.textContent = String(text);
        return el;
    }

    function createFilterPanel() {
        const panel = makeEl("div", "sja-filter-panel");
        panel.innerHTML = `
            <div class="sja-filter-heading">
                <strong>Analysis filters</strong>
                <span class="sja-selection-count"></span>
                <button type="button" class="sja-btn sja-reset-filters">Reset filters</button>
            </div>
            <div class="sja-filter-grid">
                <div class="sja-field">
                    <label for="sja-period">Publication period</label>
                    <select id="sja-period">
                        <option value="all">All time</option>
                        <option value="3">Last 3 years</option>
                        <option value="5">Last 5 years</option>
                        <option value="10">Last 10 years</option>
                        <option value="custom">Custom years</option>
                    </select>
                    <div class="sja-range" id="sja-custom-years" hidden>
                        <input type="number" id="sja-start-year" placeholder="From" min="1000" step="1">
                        <span>–</span>
                        <input type="number" id="sja-end-year" placeholder="To" min="1000" step="1">
                    </div>
                </div>
                <div class="sja-field">
                    <label for="sja-ranking-mode">Citation ranking method</label>
                    <select id="sja-ranking-mode">
                        <option value="total">Total citations</option>
                        <option value="annual">Citations per year</option>
                    </select>
                </div>
                <div class="sja-field">
                    <label for="sja-ranking-type">Citation ranking</label>
                    <select id="sja-ranking-type">
                        <option value="all">All publications</option>
                        <option value="10">Top 10</option>
                        <option value="20">Top 20</option>
                        <option value="50">Top 50</option>
                        <option value="1%">Top 1%</option>
                        <option value="5%">Top 5%</option>
                        <option value="10%">Top 10%</option>
                        <option value="20%">Top 20%</option>
                        <option value="number">Custom Top N</option>
                        <option value="percent">Custom Top %</option>
                    </select>
                    <input type="number" id="sja-ranking-value" min="1" step="1" placeholder="Enter value" hidden>
                </div>
                <div class="sja-field">
                    <label>Journal</label>
                    <details class="sja-journal-picker">
                        <summary class="sja-journal-summary">All journals</summary>
                        <div class="sja-journal-dropdown">
                            <input type="search" id="sja-journal-query" placeholder="Find journals...">
                            <button type="button" class="sja-btn sja-clear-journals">Clear selection</button>
                            <div class="sja-journal-options"></div>
                        </div>
                    </details>
                </div>
                <div class="sja-field">
                    <label>Impact Factor</label>
                    <div class="sja-range">
                        <input type="number" id="sja-min-if" min="0" step="any" placeholder="Min IF">
                        <span>–</span>
                        <input type="number" id="sja-max-if" min="0" step="any" placeholder="Max IF">
                    </div>
                </div>
                <div class="sja-field">
                    <label>Citation count</label>
                    <div class="sja-range">
                        <input type="number" id="sja-min-citations" min="0" step="1" placeholder="Min">
                        <span>–</span>
                        <input type="number" id="sja-max-citations" min="0" step="1" placeholder="Max">
                    </div>
                </div>
                <div class="sja-field sja-field-wide">
                    <label>JCR Quartile</label>
                    <div class="sja-choice-group" id="sja-quartile-options">
                        <button type="button" data-q="Q1">Q1</button>
                        <button type="button" data-q="Q2">Q2</button>
                        <button type="button" data-q="Q3">Q3</button>
                        <button type="button" data-q="Q4">Q4</button>
                        <button type="button" data-q="Unclassified">Unclassified</button>
                    </div>
                </div>
                <div class="sja-field sja-field-wide">
                    <label>Publication type</label>
                    <div class="sja-choice-group" id="sja-type-options">
                        <button type="button" data-type="journal">Journal</button>
                        <button type="button" data-type="conference">Conference</button>
                        <button type="button" data-type="preprint">Preprint</button>
                        <button type="button" data-type="book">Book</button>
                        <button type="button" data-type="other">Other</button>
                        <button type="button" data-type="unknown">Unknown</button>
                    </div>
                </div>
            </div>
            <div class="sja-filter-error" role="status"></div>
        `;
        return panel;
    }

    function renderJournalOptions() {
        const container = $(".sja-journal-options");
        const query = ($("#sja-journal-query")?.value || "").trim().toLowerCase();
        container.replaceChildren();
        const journals = ScholarAnalytics.summarizeJournals(snapshot.publications);
        for (const j of journals) {
            if (query && !j.journal.toLowerCase().includes(query)) continue;
            const row = makeEl("label", "sja-journal-option");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = j.key;
            checkbox.checked = analysisFilters.journals.includes(j.key);
            checkbox.onchange = () => {
                analysisFilters.journals = checkbox.checked
                    ? [...new Set([...analysisFilters.journals, j.key])]
                    : analysisFilters.journals.filter(x => x !== j.key);
                updateJournalSummary();
                updateAnalysis();
            };
            row.append(
                checkbox,
                makeEl("span", "", j.journal),
                makeEl("small", "", j.publications)
            );
            container.appendChild(row);
        }
        if (!container.childElementCount)
            container.appendChild(makeEl("div", "sja-empty", "No journals found"));
    }

    function updateJournalSummary() {
        const n = analysisFilters.journals.length;
        $(".sja-journal-summary").textContent =
            n ? `${n} journal(s) selected` : "All journals";
    }

    function syncFilterControls() {
        $("#sja-period").value = analysisFilters.period;
        $("#sja-custom-years").hidden = analysisFilters.period !== "custom";
        $("#sja-start-year").value = analysisFilters.startYear ?? "";
        $("#sja-end-year").value = analysisFilters.endYear ?? "";
        $("#sja-ranking-mode").value = analysisFilters.rankingMode;
        $("#sja-ranking-type").value = "all";
        $("#sja-ranking-value").value = analysisFilters.rankingValue ?? "";
        $("#sja-ranking-value").hidden = true;
        $("#sja-min-if").value = analysisFilters.minIF ?? "";
        $("#sja-max-if").value = analysisFilters.maxIF ?? "";
        $("#sja-min-citations").value = analysisFilters.minCitations ?? "";
        $("#sja-max-citations").value = analysisFilters.maxCitations ?? "";
        $("#sja-journal-query").value = "";
        modal.querySelectorAll("[data-q], [data-type]").forEach(button => {
            const selected = button.dataset.q
                ? analysisFilters.quartiles.includes(button.dataset.q)
                : analysisFilters.publicationTypes.includes(button.dataset.type);
            button.classList.toggle("sja-selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
        $(".sja-filter-error").textContent = "";
        updateJournalSummary();
        renderJournalOptions();
    }

    function bindFilterEvents() {
        const inputIDs = [
            "sja-period", "sja-start-year", "sja-end-year",
            "sja-ranking-mode", "sja-ranking-type", "sja-ranking-value",
            "sja-min-if", "sja-max-if",
            "sja-min-citations", "sja-max-citations"
        ];
        inputIDs.forEach(id => {
            const el = $(`#${id}`);
            el.addEventListener(el.tagName === "SELECT" ? "change" : "input",
                readFilterControls);
        });
        $("#sja-journal-query").oninput = renderJournalOptions;
        $(".sja-clear-journals").onclick = () => {
            analysisFilters.journals = [];
            updateJournalSummary();
            renderJournalOptions();
            updateAnalysis();
        };
        modal.querySelectorAll("[data-q]").forEach(button => {
            button.onclick = () => {
                const q = button.dataset.q;
                analysisFilters.quartiles = analysisFilters.quartiles.includes(q)
                    ? analysisFilters.quartiles.filter(x => x !== q)
                    : [...analysisFilters.quartiles, q];
                const selected = analysisFilters.quartiles.includes(q);
                button.classList.toggle("sja-selected", selected);
                button.setAttribute("aria-pressed", String(selected));
                updateAnalysis();
            };
        });
        modal.querySelectorAll("[data-type]").forEach(button => {
            button.onclick = () => {
                const types = button.dataset.type === "journal"
                    ? ["journal", "journal_inferred"] : [button.dataset.type];
                const selected = types.every(t => analysisFilters.publicationTypes.includes(t));
                analysisFilters.publicationTypes = selected
                    ? analysisFilters.publicationTypes.filter(t => !types.includes(t))
                    : [...new Set([...analysisFilters.publicationTypes, ...types])];
                button.classList.toggle("sja-selected", !selected);
                button.setAttribute("aria-pressed", String(!selected));
                updateAnalysis();
            };
        });
        $(".sja-reset-filters").onclick = () => {
            analysisFilters = {...ScholarAnalytics.DEFAULT_FILTERS};
            syncFilterControls();
            updateAnalysis();
        };
    }

    function readFilterControls() {
        const value = id => $(`#${id}`).value;
        const number = id => {
            const v = value(id);
            return v === "" ? null : Number(v);
        };
        const period = value("sja-period");
        const rank = value("sja-ranking-type");
        $("#sja-custom-years").hidden = period !== "custom";
        $("#sja-ranking-value").hidden = !["number", "percent"].includes(rank);
        $("#sja-ranking-value").max = rank === "percent" ? "100" : "";
        const next = {
            ...analysisFilters,
            period,
            startYear: number("sja-start-year"),
            endYear: number("sja-end-year"),
            rankingMode: value("sja-ranking-mode"),
            minIF: number("sja-min-if"),
            maxIF: number("sja-max-if"),
            minCitations: number("sja-min-citations"),
            maxCitations: number("sja-max-citations"),
            rankingType: "all",
            rankingValue: null
        };
        if (rank === "number" || rank === "percent") {
            next.rankingType = rank;
            next.rankingValue = number("sja-ranking-value");
        } else if (rank.endsWith("%")) {
            next.rankingType = "percent";
            next.rankingValue = Number(rank.slice(0, -1));
        } else if (rank !== "all") {
            next.rankingType = "number";
            next.rankingValue = Number(rank);
        }

        let error = "";
        const ranges = [
            [next.minIF, next.maxIF, "IF"],
            [next.minCitations, next.maxCitations, "citation count"]
        ];
        if (period === "custom")
            ranges.push([next.startYear, next.endYear, "year"]);
        for (const [min, max, label] of ranges) {
            if ([min, max].some(v => v !== null && (!Number.isFinite(v) || v < 0)))
                error = `Invalid ${label} range.`;
            if (min !== null && max !== null && min > max)
                error = `Minimum ${label} cannot exceed maximum.`;
        }
        if (period === "custom" && [next.startYear, next.endYear].some(y =>
            y !== null && (!Number.isInteger(y) || y < 1000 || y > ScholarAnalytics.CURRENT_YEAR)))
            error = "Enter valid publication years.";
        if ([next.minCitations, next.maxCitations].some(v =>
            v !== null && !Number.isInteger(v)))
            error = "Citation counts must be integers.";
        if (next.rankingType !== "all" &&
            (!Number.isInteger(next.rankingValue) || next.rankingValue <= 0 ||
             (next.rankingType === "percent" && next.rankingValue > 100)))
            error = "Enter a valid ranking value.";
        $(".sja-filter-error").textContent = error;
        if (error) return;
        analysisFilters = next;
        updateAnalysis();
    }

    function createTabs() {
        const container = makeEl("nav", "sja-tabs");
        container.setAttribute("aria-label", "Analysis sections");
        const tabs = [
            ["overview", "Overview"],
            ["journals", "Journals"],
            ["citations", "Citations"],
            ["papers", "Papers"]
        ];
        for (const [key, label] of tabs) {
            const button = makeEl("button", "sja-tab", label);
            button.type = "button";
            button.dataset.tab = key;
            button.onclick = () => {
                activeTab = key;
                renderActiveTab();
            };
            container.appendChild(button);
        }
        return container;
    }

    function createMetricGrid(metrics) {
        const grid = makeEl("div", "sja-overview-grid");
        for (const [label, value, note] of metrics) {
            const card = makeEl("div", "sja-metric-card");
            card.append(makeEl("span", "", label), makeEl("strong", "", value));
            if (note) card.appendChild(makeEl("small", "sja-metric-note", note));
            grid.appendChild(card);
        }
        return grid;
    }

    function createChartCard(title, note = "") {
        const card = makeEl("section", "sja-chart-card");
        card.appendChild(makeEl("h3", "", title));
        if (note) card.appendChild(makeEl("p", "sja-chart-note", note));
        return card;
    }

    function createLegend(items) {
        const legend = makeEl("div", "sja-chart-legend");
        for (const [label, color] of items) {
            const item = makeEl("span", "sja-legend-item");
            const swatch = makeEl("i");
            swatch.style.backgroundColor = color;
            item.append(swatch, makeEl("span", "", label));
            legend.appendChild(item);
        }
        return legend;
    }

    function drawBarChart(data, options = {}) {
        const chart = makeEl("div", "sja-bar-chart");
        if (!data.length) {
            chart.appendChild(makeEl("div", "sja-empty", "No data available"));
            return chart;
        }
        const height = options.height || 190;
        const max = Math.max(1, ...data.map(d =>
            d.segments ? d.segments.reduce((n, s) => n + s.value, 0) : d.value || 0));
        const scroll = makeEl("div", "sja-chart-scroll");
        const columns = makeEl("div", "sja-chart-columns");
        columns.style.minWidth = `${Math.max(240, data.length * 42)}px`;
        for (const item of data) {
            const column = makeEl("div", "sja-chart-column");
            const barArea = makeEl("div", "sja-bar-area");
            barArea.style.height = `${height}px`;
            const total = item.segments
                ? item.segments.reduce((n, s) => n + s.value, 0)
                : item.value;
            const stack = makeEl("div", "sja-bar-stack");
            if (total !== null && total !== undefined) {
                stack.style.height = `${total / max * 100}%`;
                stack.appendChild(makeEl("span", "sja-bar-number", fmt(total)));
                for (const seg of item.segments || [{
                    value: total, color: options.color || "#5489c7",
                    label: options.label || "Value"
                }]) {
                    if (seg.value <= 0) continue;
                    const bar = makeEl("div", "sja-bar-segment");
                    bar.style.backgroundColor = seg.color;
                    bar.style.height = `${seg.value / total * 100}%`;
                    bar.title = `${item.label} · ${seg.label}: ${fmt(seg.value)}`;
                    stack.appendChild(bar);
                }
            } else {
                stack.style.height = "0";
                stack.appendChild(makeEl("span", "sja-bar-number", "—"));
            }
            barArea.appendChild(stack);
            column.append(barArea, makeEl("div", "sja-bar-label", item.label));
            columns.appendChild(column);
        }
        scroll.appendChild(columns);
        chart.appendChild(scroll);
        return chart;
    }

    function fillMissingYears(data) {
        if (!data.length) return [];
        const index = new Map(data.map(d => [d.year, d]));
        const current = ScholarAnalytics.CURRENT_YEAR;
        let start = data[0].year;
        let end = data.at(-1).year;
        if (["3", "5", "10"].includes(String(analysisFilters.period))) {
            start = current - Number(analysisFilters.period) + 1;
            end = current;
        } else if (analysisFilters.period === "custom") {
            start = analysisFilters.startYear ?? start;
            end = analysisFilters.endYear ?? end;
        }
        start = Math.max(start, 1000);
        end = Math.min(end, current);
        const years = [];
        for (let year = start; year <= end; year++) {
            years.push(index.get(year) || {
                year, publications: 0, citations: 0,
                meanIF: null, medianIF: null, validIF: 0,
                Q1: 0, Q2: 0, Q3: 0, Q4: 0, Unclassified: 0,
                currentYear: year === current
            });
        }
        return years;
    }

    function drawQuartileChart(data) {
        const container = makeEl("div", "sja-donut-layout");
        const total = data.reduce((n, d) => n + d.count, 0);
        const donut = makeEl("div", "sja-donut");
        let offset = 0;
        const stops = [];
        for (const d of data) {
            if (!total || !d.count) continue;
            const end = offset + d.count / total * 100;
            stops.push(`${QUARTILE_COLORS[d.quartile]} ${offset}% ${end}%`);
            offset = end;
        }
        donut.style.background = stops.length
            ? `conic-gradient(${stops.join(",")})` : "#e8edf3";
        const center = makeEl("div", "sja-donut-center");
        center.append(
            makeEl("strong", "", total),
            makeEl("span", "", "Publications")
        );
        donut.appendChild(center);
        const legend = makeEl("div", "sja-donut-legend");
        for (const d of data) {
            const row = makeEl("div", "sja-donut-row");
            const swatch = makeEl("i");
            swatch.style.backgroundColor = QUARTILE_COLORS[d.quartile];
            row.append(
                swatch,
                makeEl("span", "", d.quartile),
                makeEl("strong", "", d.count),
                makeEl("small", "", total ? `${fmt(d.count / total * 100, 1)}%` : "—")
            );
            legend.appendChild(row);
        }
        container.append(donut, legend);
        return container;
    }

    function renderOverview(analysis) {
        const target = $(".sja-tab-content");
        const s = analysis.statistics;
        const o = s.overview;
        if (!analysis.selectedPublications) {
            target.appendChild(makeEl("div", "sja-empty sja-empty-large",
                "No publications match the current filters."));
            return;
        }
        target.appendChild(createMetricGrid([
            ["Publications", o.total, `of ${analysis.totalPublications} collected`],
            ["Unique journals", o.uniqueJournals, `${o.identifiedJournals} identified journal publications`],
            ["Total citations", fmt(o.totalCitations, 0), `${o.validCitations} valid records`],
            ["JCR matched", o.jcrMatched, `${fmt(o.jcrMatched / o.total * 100, 1)}% of selected`],
            ["Q1 proportion", o.q1Percentage == null ? "—" : `${fmt(o.q1Percentage, 1)}%`,
                `${o.q1} / ${o.classified} classified · ${fmt(o.q1 / o.total * 100, 1)}% of all`],
            ["Median IF", fmt(o.medianIF), `${o.validIF} publications with IF`],
            ["Mean IF", fmt(o.meanIF), `${o.missingIF} missing IF`],
            ["Highest IF", fmt(o.maxIF), "Current local JCR database"]
        ]));

        const charts = makeEl("div", "sja-chart-grid");
        const years = fillMissingYears(s.years.data);
        const annual = createChartCard(
            "Annual publications",
            "Publication count by year and current JCR quartile. * Current year."
        );
        annual.classList.add("sja-chart-wide");
        annual.appendChild(drawBarChart(years.map(y => ({
            label: `${y.year}${y.currentYear ? "*" : ""}`,
            segments: ScholarAnalytics.QUARTILES.map(q => ({
                label: q, value: y[q] || 0, color: QUARTILE_COLORS[q]
            }))
        })), {height: 205}));
        annual.appendChild(createLegend(Object.entries(QUARTILE_COLORS)));
        if (s.years.unknownYear)
            annual.appendChild(makeEl("p", "sja-chart-note",
                `${s.years.unknownYear} publications have an unknown or invalid year.`));
        charts.appendChild(annual);

        const quartiles = createChartCard(
            "JCR quartile distribution",
            "Percentages are based on all selected publications."
        );
        quartiles.appendChild(drawQuartileChart(s.quartiles));
        charts.appendChild(quartiles);

        const impact = createChartCard(
            "Impact Factor distribution",
            `${s.impactFactor.valid} valid IF · ${s.impactFactor.missing} missing`
        );
        impact.appendChild(drawBarChart(s.impactFactor.bins.map(b => ({
            label: b.label, value: b.count
        })), {color: "#bb6c65", height: 190, label: "Publications"}));
        charts.appendChild(impact);

        const annualIF = createChartCard(
            "Annual mean Impact Factor",
            "Paper-weighted mean of current JCR IF; missing values are excluded."
        );
        annualIF.classList.add("sja-chart-wide");
        annualIF.appendChild(drawBarChart(years.map(y => ({
            label: `${y.year}${y.currentYear ? "*" : ""}`,
            value: y.meanIF
        })), {color: "#bb6c65", height: 190, label: "Mean IF"}));
        charts.appendChild(annualIF);

        const types = createChartCard(
            "Publication types",
            "Local journal matches infer publication type; Crossref provides explicit types."
        );
        types.classList.add("sja-chart-wide");
        const labels = {
            journal: "Journal article (Crossref)",
            journal_inferred: "Journal article (inferred)",
            conference: "Conference",
            preprint: "Preprint",
            book: "Book / Chapter",
            other: "Other",
            unknown: "Unknown"
        };
        const typeList = makeEl("div", "sja-type-list");
        for (const d of s.publicationTypes) {
            const row = makeEl("div", "sja-type-row");
            const track = makeEl("div", "sja-type-track");
            const bar = makeEl("div");
            bar.style.width = `${d.percentage || 0}%`;
            track.appendChild(bar);
            row.append(
                makeEl("span", "", labels[d.type] || d.type),
                track,
                makeEl("strong", "", `${d.count} (${fmt(d.percentage, 1)}%)`)
            );
            typeList.appendChild(row);
        }
        types.appendChild(typeList);
        charts.appendChild(types);
        target.appendChild(charts);
    }

    function createTable(headers, rows) {
        const wrapper = makeEl("div", "sja-table-wrapper");
        const table = makeEl("table", "sja-table");
        const thead = document.createElement("thead");
        const tbody = document.createElement("tbody");
        const header = document.createElement("tr");
        headers.forEach(label => header.appendChild(makeEl("th", "", label)));
        thead.appendChild(header);
        for (const row of rows) {
            const tr = document.createElement("tr");
            for (const value of row) {
                const td = document.createElement("td");
                if (value instanceof Node) td.appendChild(value);
                else td.textContent = value == null ? "—" : String(value);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        wrapper.appendChild(table);
        return wrapper;
    }

    function createSelect(options, value, onChange) {
        const select = makeEl("select", "sja-table-select");
        for (const [key, label] of options) {
            const option = makeEl("option", "", label);
            option.value = key;
            select.appendChild(option);
        }
        select.value = value;
        select.onchange = () => onChange(select.value);
        return select;
    }

    function createLink(text, url) {
        if (!url) return makeEl("span", "", text);
        try {
            const parsed = new URL(url);
            if (!["https:", "http:"].includes(parsed.protocol))
                return makeEl("span", "", text);
            const link = makeEl("a", "sja-paper-link", text);
            link.href = parsed.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            return link;
        } catch {
            return makeEl("span", "", text);
        }
    }

    function drawHorizontalBars(data, color = "#5489c7") {
        const container = makeEl("div", "sja-horizontal-chart");
        const max = Math.max(1, ...data.map(d => d.value || 0));
        for (const d of data) {
            const row = makeEl("div", "sja-horizontal-row");
            const heading = makeEl("div", "sja-horizontal-heading");
            const label = makeEl(d.onClick ? "button" : "span", d.onClick ? "sja-text-button" : "", d.label);
            if (d.onClick) {
                label.type = "button";
                label.onclick = d.onClick;
            }
            heading.append(label, makeEl("strong", "", fmt(d.value, 0)));
            const track = makeEl("div", "sja-horizontal-track");
            const bar = makeEl("div");
            bar.style.width = `${(d.value || 0) / max * 100}%`;
            bar.style.backgroundColor = color;
            bar.title = `${d.label}: ${fmt(d.value)}`;
            track.appendChild(bar);
            row.append(heading, track);
            container.appendChild(row);
        }
        return container;
    }

    function filterByJournal(key) {
        analysisFilters.journals = [key];
        updateJournalSummary();
        renderJournalOptions();
        updateAnalysis();
    }

    function renderJournals(analysis) {
        const target = $(".sja-tab-content");
        const journals = analysis.statistics.journals;
        if (!journals.length) {
            target.appendChild(makeEl("div", "sja-empty sja-empty-large", "No identified journals in the selected publications."));
            return;
        }
        let sortKey = "publications";
        let query = "";
        let detailKey = journals[0].key;
        const controls = makeEl("div", "sja-table-controls");
        const search = makeEl("input", "sja-table-search");
        search.type = "search";
        search.placeholder = "Search journals...";
        const sort = createSelect([
            ["publications", "Most publications"],
            ["citations", "Most citations"],
            ["jif", "Highest IF"],
            ["meanCitations", "Mean citations"],
            ["lastYear", "Latest publication"]
        ], sortKey, value => {
            sortKey = value;
            renderTable();
        });
        controls.append(search, sort);
        const rankingCard = createChartCard("Top 15 journals", "Ranked by publication count in the selected dataset.");
        const detailCard = createChartCard("Selected journal");
        const tableCard = createChartCard("Journal statistics", "Click a journal to inspect its publication history.");
        const tableContent = makeEl("div");
        const tableCount = makeEl("div", "sja-chart-note");
        tableCard.append(controls, tableCount, tableContent);
        target.append(rankingCard, detailCard, tableCard);

        function renderDetail() {
            const j = journals.find(x => x.key === detailKey);
            detailCard.replaceChildren();
            if (!j) return;
            const header = makeEl("div", "sja-detail-heading");
            const filterButton = makeEl("button", "sja-btn", "Analyze this journal");
            filterButton.type = "button";
            filterButton.onclick = () => filterByJournal(j.key);
            header.append(makeEl("h3", "", j.journal), filterButton);
            detailCard.append(
                header,
                createMetricGrid([
                    ["Publications", j.publications],
                    ["Impact Factor", fmt(j.jif)],
                    ["Total citations", fmt(j.citations, 0)],
                    ["Mean citations", fmt(j.meanCitations)]
                ])
            );
            const years = fillMissingYears(j.annualPublications);
            detailCard.appendChild(drawBarChart(years.map(y => ({
                label: `${y.year}${y.currentYear ? "*" : ""}`,
                value: y.publications
            })), {height: 160, color: "#5489c7", label: "Publications"}));
            detailCard.appendChild(makeEl("p", "sja-chart-note",
                `JCR: ${j.quartile || "—"} · First publication: ${j.firstYear || "—"} · Last publication: ${j.lastYear || "—"}`));
        }

        function selectJournal(key) {
            detailKey = key;
            renderDetail();
            renderTable();
        }

        function renderTable() {
            const data = journals.filter(j =>
                j.journal.toLowerCase().includes(query.toLowerCase())
            ).sort((a, b) =>
                (b[sortKey] ?? -1) - (a[sortKey] ?? -1) ||
                b.publications - a.publications ||
                a.journal.localeCompare(b.journal)
            );
            tableCount.textContent = `${data.length} / ${journals.length} journals`;
            const rows = data.map(j => {
                const button = makeEl("button", "sja-text-button", j.journal);
                button.type = "button";
                button.classList.toggle("sja-text-selected", j.key === detailKey);
                button.onclick = () => selectJournal(j.key);
                return [
                    button, j.publications,
                    `${fmt(j.percentage, 1)}%`,
                    fmt(j.jif), j.quartile || "—",
                    fmt(j.citations, 0), fmt(j.meanCitations),
                    j.firstYear || "—", j.lastYear || "—"
                ];
            });
            tableContent.replaceChildren(
                createTable([
                    "Journal", "Papers", "Share", "IF", "JCR",
                    "Citations", "Mean cites", "First year", "Last year"
                ], rows)
            );
            if (!rows.length)
                tableContent.appendChild(makeEl("div", "sja-empty", "No matching journals."));
        }

        search.oninput = () => {
            query = search.value.trim();
            renderTable();
        };
        rankingCard.appendChild(drawHorizontalBars(
            journals.slice(0, 15).map(j => ({
                label: j.journal,
                value: j.publications,
                onClick: () => selectJournal(j.key)
            }))
        ));
        renderDetail();
        renderTable();
    }

    function drawConcentrationChart(data) {
        const container = makeEl("div", "sja-concentration-chart");
        const points = data.filter(d =>
            d.publicationShare !== null && d.citationShare !== null
        );
        if (points.length < 2) {
            container.appendChild(makeEl("div", "sja-empty", "No citation concentration data available."));
            return container;
        }
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 720 330");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "Cumulative citation concentration");
        const left = 65, right = 695, top = 20, bottom = 275;
        const x = v => left + v / 100 * (right - left);
        const y = v => bottom - v / 100 * (bottom - top);

        function node(tag, attrs, text = null) {
            const el = document.createElementNS(ns, tag);
            for (const [key, value] of Object.entries(attrs))
                el.setAttribute(key, value);
            if (text !== null) el.textContent = text;
            svg.appendChild(el);
            return el;
        }

        for (const v of [0, 25, 50, 75, 100]) {
            node("line", {x1: left, x2: right, y1: y(v), y2: y(v), stroke: "#e5e9ef"});
            node("text", {x: left - 10, y: y(v) + 4, "text-anchor": "end", fill: "#687585", "font-size": 11}, `${v}%`);
            node("text", {x: x(v), y: bottom + 18, "text-anchor": "middle", fill: "#687585", "font-size": 11}, `${v}%`);
        }
        node("line", {
            x1: left, y1: bottom, x2: right, y2: top,
            stroke: "#9ba7b5", "stroke-dasharray": "5 5"
        });
        const path = points.map((d, i) =>
            `${i ? "L" : "M"}${x(d.publicationShare)},${y(d.citationShare)}`
        ).join(" ");
        node("path", {
            d: `${path} L${x(points.at(-1).publicationShare)},${bottom} L${left},${bottom} Z`,
            fill: "#5489c7", "fill-opacity": .12
        });
        node("path", {
            d: path, fill: "none", stroke: "#315681",
            "stroke-width": 2.5, "stroke-linejoin": "round"
        });
        for (const d of points) {
            const circle = node("circle", {
                cx: x(d.publicationShare), cy: y(d.citationShare),
                r: 4, fill: "#315681"
            });
            const title = document.createElementNS(ns, "title");
            title.textContent = `${d.papers} papers (${fmt(d.publicationShare, 1)}%) · ${fmt(d.citationShare, 1)}% of citations`;
            circle.appendChild(title);
        }
        node("text", {
            x: (left + right) / 2, y: 320,
            "text-anchor": "middle", fill: "#526174", "font-size": 12
        }, "Cumulative share of publications");
        node("text", {
            x: 15, y: (top + bottom) / 2,
            transform: `rotate(-90 15 ${(top + bottom) / 2})`,
            "text-anchor": "middle", fill: "#526174", "font-size": 12
        }, "Cumulative citation share");
        container.appendChild(svg);
        return container;
    }

    function renderCitations(analysis) {
        const target = $(".sja-tab-content");
        const publications = analysis.publications;
        const c = analysis.statistics.citations;
        if (!publications.length) {
            target.appendChild(makeEl("div", "sja-empty sja-empty-large", "No publications match the current filters."));
            return;
        }
        const percent = v => v == null ? "—" : `${fmt(v, 1)}%`;
        target.appendChild(createMetricGrid([
            ["Total citations", fmt(c.total, 0), `${c.valid} valid records`],
            ["Mean citations", fmt(c.mean)],
            ["Median citations", fmt(c.median)],
            ["Highest citations", fmt(c.max, 0)],
            ["Uncited publications", c.uncited],
            ["Top 10 papers' share", percent(c.top10Share), `${Math.min(10, c.valid)} papers`],
            ["Top 1% papers' share", percent(c.top1PercentShare), `${Math.ceil(c.valid * .01)} papers`],
            ["Top 10% papers' share", percent(c.top10PercentShare), `${Math.ceil(c.valid * .1)} papers`]
        ]));

        const charts = makeEl("div", "sja-chart-grid");
        const concentration = createChartCard(
            "Citation concentration",
            "Publications are ranked by total citations. The dashed line represents equal citation distribution."
        );
        concentration.classList.add("sja-chart-wide");
        concentration.appendChild(drawConcentrationChart(c.concentration));
        charts.appendChild(concentration);

        const bins = [
            {label: "0", min: 0, max: 1},
            {label: "1–9", min: 1, max: 10},
            {label: "10–49", min: 10, max: 50},
            {label: "50–99", min: 50, max: 100},
            {label: "100–499", min: 100, max: 500},
            {label: "500–999", min: 500, max: 1000},
            {label: "1000+", min: 1000, max: Infinity}
        ];
        const values = publications.filter(p =>
            p.citations != null && String(p.citations).trim() !== "" &&
            Number.isFinite(Number(p.citations)) && Number(p.citations) >= 0
        ).map(p => Number(p.citations));
        const distribution = createChartCard(
            "Citation count distribution",
            `${c.valid} valid records · ${c.missing} missing`
        );
        distribution.appendChild(drawBarChart(bins.map(b => ({
            label: b.label,
            value: values.filter(v => v >= b.min && v < b.max).length
        })), {height: 190, color: "#5489c7", label: "Publications"}));
        charts.appendChild(distribution);

        const shares = createChartCard("Citation contribution");
        shares.appendChild(createTable(
            ["Ranking", "Papers", "Citation share"],
            [
                ["Top 1%", Math.ceil(c.valid * .01), percent(c.top1PercentShare)],
                ["Top 10%", Math.ceil(c.valid * .1), percent(c.top10PercentShare)],
                ["Top 10 papers", Math.min(10, c.valid), percent(c.top10Share)],
                ["Top 20 papers", Math.min(20, c.valid), percent(c.top20Share)]
            ]
        ));
        charts.appendChild(shares);
        target.appendChild(charts);

        const rankingCard = createChartCard(
            "Most cited publications",
            "Annual citations are approximate and based on publication year."
        );
        const controls = makeEl("div", "sja-table-controls");
        let mode = "total", limit = 20;
        const modeSelect = createSelect([
            ["total", "Total citations"],
            ["annual", "Citations per year"]
        ], mode, value => {
            mode = value;
            renderRanking();
        });
        const limitSelect = createSelect([
            ["10", "Top 10"],
            ["20", "Top 20"],
            ["50", "Top 50"],
            ["100", "Top 100"]
        ], String(limit), value => {
            limit = Number(value);
            renderRanking();
        });
        controls.append(modeSelect, limitSelect);
        const rankingContent = makeEl("div");
        rankingCard.append(controls, rankingContent);
        target.appendChild(rankingCard);

        function renderRanking() {
            const eligible = publications.filter(p => mode === "annual"
                ? ScholarAnalytics.getCitationsPerYear(p) !== null
                : p.citations != null && String(p.citations).trim() !== "" &&
                  Number.isFinite(Number(p.citations)) && Number(p.citations) >= 0);
            const ranked = ScholarAnalytics.sortByCitations(eligible, mode).slice(0, limit);
            const rows = ranked.map((p, i) => [
                i + 1,
                createLink(p.title, p.url),
                ScholarAnalytics.getJournal(p) || p.journalIdentity?.journal || p.journal || "—",
                p.year || "—",
                fmt(ScholarAnalytics.getIF(p)),
                ScholarAnalytics.getQuartile(p),
                fmt(p.citations, 0),
                fmt(ScholarAnalytics.getCitationsPerYear(p))
            ]);
            rankingContent.replaceChildren(createTable(
                ["Rank", "Publication", "Journal", "Year", "IF", "JCR", "Citations", "Cites/year"],
                rows
            ));
            if (!rows.length)
                rankingContent.appendChild(makeEl("div", "sja-empty", "No eligible publications."));
        }
        renderRanking();
    }

    function renderPapers(analysis) {
        const target = $(".sja-tab-content");
        const publications = analysis.publications;
        let query = "", sortKey = "citations", ascending = false;
        let page = 1, pageSize = 25;
        let filtered = [];
        const card = createChartCard(
            "Publication list",
            "Search and sort the publications included in the current analysis."
        );
        const controls = makeEl("div", "sja-table-controls");
        const search = makeEl("input", "sja-table-search");
        search.type = "search";
        search.placeholder = "Search title, authors or journal...";
        const sort = createSelect([
            ["citations", "Total citations"],
            ["annual", "Citations per year"],
            ["year", "Publication year"],
            ["jif", "Impact Factor"],
            ["quartile", "JCR Quartile"],
            ["journal", "Journal name"],
            ["title", "Publication title"]
        ], sortKey, value => {
            sortKey = value;
            page = 1;
            renderTable();
        });
        const direction = makeEl("button", "sja-btn", "↓ Descending");
        direction.type = "button";
        direction.onclick = () => {
            ascending = !ascending;
            direction.textContent = ascending ? "↑ Ascending" : "↓ Descending";
            page = 1;
            renderTable();
        };
        controls.append(search, sort, direction);
        const tableContent = makeEl("div");
        const footer = makeEl("div", "sja-pagination");
        const count = makeEl("span", "sja-pagination-count");
        const navigation = makeEl("div", "sja-pagination-controls");
        const previous = makeEl("button", "sja-btn", "Previous");
        const next = makeEl("button", "sja-btn", "Next");
        const pageInfo = makeEl("span", "sja-page-info");
        previous.type = next.type = "button";
        previous.onclick = () => {
            if (page > 1) {
                page--;
                renderTable();
            }
        };
        next.onclick = () => {
            if (page < Math.ceil(filtered.length / pageSize)) {
                page++;
                renderTable();
            }
        };
        const size = createSelect([
            ["25", "25 / page"],
            ["50", "50 / page"],
            ["100", "100 / page"]
        ], String(pageSize), value => {
            pageSize = Number(value);
            page = 1;
            renderTable();
        });
        navigation.append(previous, pageInfo, next, size);
        footer.append(count, navigation);
        const exportRow = makeEl("div", "sja-table-controls sja-paper-export");
        const exportScope = createSelect([
            ["selected", "All selected publications"],
            ["searched", "Table search results"]
        ], "selected", () => {});
        const exportButton = makeEl("button", "sja-btn sja-primary", "Export CSV");
        exportButton.type = "button";
        const exportStatus = makeEl("span", "sja-chart-note");
        exportStatus.setAttribute("role", "status");
        exportRow.append(exportScope, exportButton, exportStatus);
        card.append(controls, tableContent, footer, exportRow);
        target.appendChild(card);

        function sortValue(p) {
            switch (sortKey) {
                case "annual":
                    return ScholarAnalytics.getCitationsPerYear(p);
                case "jif":
                    return ScholarAnalytics.getIF(p);
                case "quartile": {
                    const q = ScholarAnalytics.getQuartile(p);
                    return /^Q[1-4]$/.test(q) ? 5 - Number(q.slice(1)) : null;
                }
                case "journal":
                    return ScholarAnalytics.getJournal(p)?.toLowerCase() || null;
                case "title":
                    return p.title?.toLowerCase() || null;
                case "year":
                case "citations": {
                    const value = p[sortKey];
                    return value != null && String(value).trim() !== "" &&
                        Number.isFinite(Number(value)) ? Number(value) : null;
                }
                default:
                    return null;
            }
        }

        function compare(a, b) {
            const x = sortValue(a), y = sortValue(b);
            if (x == null && y == null) return 0;
            if (x == null) return 1;
            if (y == null) return -1;
            const cmp = typeof x === "string" || typeof y === "string"
                ? String(x).localeCompare(String(y)) : x - y;
            return (ascending ? 1 : -1) * cmp ||
                String(a.title).localeCompare(String(b.title));
        }

        function renderTable() {
            const q = query.toLowerCase();
            filtered = publications.filter(p => {
                const text = [
                    p.title, p.authors,
                    ScholarAnalytics.getJournal(p),
                    p.journalIdentity?.journal,
                    p.journal
                ].filter(Boolean).join(" ").toLowerCase();
                return !q || text.includes(q);
            }).sort(compare);
            const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
            page = Math.min(page, pages);
            const start = (page - 1) * pageSize;
            const selected = filtered.slice(start, start + pageSize);
            const rows = selected.map((p, i) => {
                const publication = makeEl("div", "sja-paper-cell");
                publication.appendChild(createLink(p.title, p.url));
                if (p.authors)
                    publication.appendChild(makeEl("small", "sja-paper-authors", p.authors));
                const journal = ScholarAnalytics.getJournal(p) ||
                    p.journalIdentity?.journal || p.journal || "—";
                const citations = p.citations == null
                    ? "—" : createLink(fmt(p.citations, 0), p.citationUrl);
                return [
                    start + i + 1, publication, journal,
                    p.year || "—", fmt(ScholarAnalytics.getIF(p)),
                    ScholarAnalytics.getQuartile(p), citations,
                    fmt(ScholarAnalytics.getCitationsPerYear(p))
                ];
            });
            tableContent.replaceChildren(createTable([
                "#", "Publication", "Journal", "Year", "IF",
                "JCR", "Citations", "Cites/year"
            ], rows));
            if (!rows.length)
                tableContent.appendChild(makeEl("div", "sja-empty", "No matching publications."));
            count.textContent = filtered.length
                ? `${start + 1}–${start + selected.length} of ${filtered.length} publications`
                : "0 publications";
            pageInfo.textContent = `${page} / ${pages}`;
            previous.disabled = page <= 1;
            next.disabled = page >= pages;
        }

        search.oninput = () => {
            query = search.value.trim();
            page = 1;
            renderTable();
        };
        exportButton.onclick = () => {
            const data = exportScope.value === "searched" ? filtered : publications;
            try {
                const result = ScholarExport.exportAnalyticsCSV(data, analysis.profile);
                exportStatus.textContent = result.message;
                exportStatus.classList.toggle("sja-export-error", !result.success);
            } catch (error) {
                exportStatus.textContent = `Export failed: ${error.message}`;
                exportStatus.classList.add("sja-export-error");
            }
        };
        renderTable();
    }

    function renderActiveTab() {
        if (!currentAnalysis) return;
        modal.querySelectorAll(".sja-tab").forEach(button => {
            const active = button.dataset.tab === activeTab;
            button.classList.toggle("sja-tab-active", active);
            button.setAttribute("aria-current", active ? "page" : "false");
        });
        const target = $(".sja-tab-content");
        target.replaceChildren();
        switch (activeTab) {
            case "overview":
                renderOverview(currentAnalysis);
                break;
            case "journals":
                renderJournals(currentAnalysis);
                break;
            case "citations":
                renderCitations(currentAnalysis);
                break;
            case "papers":
                renderPapers(currentAnalysis);
                break;
        }
    }

    function updateAnalysis() {
        if (!snapshot || !modal?.isConnected) return;
        currentAnalysis = ScholarAnalytics.analyze(snapshot, analysisFilters);
        const a = currentAnalysis;
        $(".sja-selection-count").textContent =
            `${a.selectedPublications} / ${a.totalPublications} publications`;
        const ranking = $(".sja-ranking-note");
        if (a.filters.rankingType !== "all") {
            ranking.hidden = false;
            ranking.textContent =
                `Citation ranking: ${a.selectedPublications} of ${a.rankableCount} rankable publications` +
                ` (${a.rankableCount ? fmt(a.selectedPublications / a.rankableCount * 100, 1) : "0"}%). ` +
                `Ranking is within the selected researcher publication subset.`;
        } else {
            ranking.hidden = true;
        }
        renderActiveTab();
    }

    function renderDashboard(data, fromCache = false) {
        if (!modal?.isConnected) return;
        snapshot = data;
        activeTab = "overview";
        analysisFilters = {...ScholarAnalytics.DEFAULT_FILTERS};
        currentAnalysis = null;
        $(".sja-main").innerHTML = `
            <div class="sja-dashboard">
                <div class="sja-data-header">
                    <div>
                        <div class="sja-data-status"></div>
                        <div class="sja-data-timestamp"></div>
                    </div>
                    <button type="button" class="sja-btn sja-refresh">Refresh profile</button>
                </div>
                <div class="sja-data-warning" hidden></div>
                <div class="sja-filter-container"></div>
                <div class="sja-ranking-note" hidden></div>
                <div class="sja-tabs-container"></div>
                <div class="sja-tab-content"></div>
                <div class="sja-note sja-dashboard-note">
                    Statistics describe the collected public Google Scholar profile.
                    Journal metrics come from the current local JCR database,
                    not publication-year JCR data. Journal metrics and citations
                    should not be interpreted as direct measures of research quality.
                </div>
            </div>
        `;
        const status = $(".sja-data-status");
        status.textContent =
            `${data.complete ? "Complete profile" : "Incomplete profile"} · ${data.publications.length} publications`;
        status.classList.toggle("sja-incomplete", !data.complete);
        $(".sja-data-timestamp").textContent =
            `${fromCache ? "Cached profile" : "Freshly collected"} · ${new Date(data.collectedAt).toLocaleString()}`;

        const warnings = [];
        if (!data.complete)
            warnings.push("The publication list is incomplete.");
        if (data.stats?.pending)
            warnings.push(`${data.stats.pending} publications are awaiting identification.`);
        if (data.stats?.apiErrors)
            warnings.push(`${data.stats.apiErrors} remote lookups failed.`);
        if (data.stats?.deferred)
            warnings.push(`${data.stats.deferred} remote lookups were deferred.`);
        if (data.stats?.unresolved)
            warnings.push(`${data.stats.unresolved} publications have unresolved journal identities.`);
        if (warnings.length) {
            const warning = $(".sja-data-warning");
            warning.hidden = false;
            warning.textContent = warnings.join(" ");
        }

        $(".sja-filter-container").appendChild(createFilterPanel());
        $(".sja-tabs-container").appendChild(createTabs());
        bindFilterEvents();
        syncFilterControls();
        updateAnalysis();
        $(".sja-refresh").onclick = () => {
            if (!currentTask) startLoading(true);
        };
    }

    function renderInterrupted(reason, partial = null) {
        if (!modal?.isConnected) return;
        $(".sja-main").innerHTML = `
            <div class="sja-interrupted">
                <div class="sja-warning-icon">!</div>
                <h2>Profile preparation interrupted</h2>
                <p class="sja-error-message"></p>
                <p class="sja-partial-count"></p>
                <div class="sja-action-row">
                    <button type="button" class="sja-btn sja-primary sja-retry">Resume loading</button>
                    <button type="button" class="sja-btn sja-partial">Analyze collected data</button>
                </div>
                <p class="sja-note">
                    Partial results may not represent the researcher's complete publication record.
                </p>
            </div>
        `;
        $(".sja-error-message").textContent = reason;
        $(".sja-partial-count").textContent = partial
            ? `${partial.publications.length} publications collected.` : "";
        $(".sja-partial").disabled = !partial?.publications.length;
        $(".sja-retry").onclick = () => {
            if (!currentTask) startLoading(true);
        };
        $(".sja-partial").onclick = () => {
            if (partial) renderDashboard(ScholarProfileCache.hydrate(partial));
        };
    }

    function buildPartial(profileData = null) {
        const data = profileData || {
            profile: ScholarProfileLoader.getProfileInfo(),
            complete: false,
            evidence: null,
            collectedAt: new Date().toISOString(),
            publications: ScholarProfileLoader.collectPublications()
        };
        return ScholarProfileCache.buildSnapshot(data, ScholarJournal.articleRecords);
    }

    async function prepare(forceRefresh, signal, token) {
        let profileData = null;
        let progressTimer = null;
        const isCurrent = () => modal?.isConnected && token === generation;
        try {
            renderLoading();
            updateProgress(false, "Checking local profile cache...");
            if (!forceRefresh) {
                const cached = await ScholarProfileCache.load(
                    ScholarProfileLoader.getProfileInfo().id
                );
                checkAbort(signal);
                if (!isCurrent()) return;
                if (cached?.complete && cached.stats?.pending === 0) {
                    renderDashboard(ScholarProfileCache.hydrate(cached), true);
                    return;
                }
            }

            progressTimer = setInterval(() => {
                if (isCurrent())
                    updateProgress(Boolean(profileData?.complete));
            }, POLL_INTERVAL);

            profileData = await ScholarProfileLoader.loadAll({
                onProgress: state => {
                    if (!isCurrent()) return;
                    updateProgress(state.stage === "complete",
                        state.stage === "complete"
                            ? "Complete profile collected"
                            : "Loading publications from Google Scholar...");
                }
            });
            checkAbort(signal);
            if (!isCurrent()) return;

            if (!profileData.complete) {
                renderInterrupted(profileData.reason || "Profile is incomplete",
                    buildPartial(profileData));
                return;
            }

            const finished = await waitForIdentification(signal, true);
            checkAbort(signal);
            if (!isCurrent()) return;

            const data = buildPartial(profileData);
            if (!finished) {
                renderInterrupted("Journal identification timed out.", data);
                return;
            }

            try {
                const saved = await ScholarProfileCache.save(data);
                console.log("[ScholarJournal Analytics] Cache:", saved);
            } catch (error) {
                console.warn("[ScholarJournal Analytics] Cache save failed:", error);
            }

            checkAbort(signal);
            if (isCurrent())
                renderDashboard(ScholarProfileCache.hydrate(data));
        } catch (error) {
            if (!isCurrent()) return;
            let partial = null;
            try {
                partial = buildPartial(profileData);
            } catch {}
            renderInterrupted(error.name === "AbortError"
                ? "Loading cancelled by user." : error.message, partial);
        } finally {
            if (progressTimer !== null) clearInterval(progressTimer);
        }
    }

    function startLoading(forceRefresh = false) {
        if (currentTask || !modal?.isConnected) return currentTask;
        controller = new AbortController();
        const token = ++generation;
        const task = prepare(forceRefresh, controller.signal, token);
        currentTask = task;
        task.finally(() => {
            if (currentTask === task) {
                currentTask = null;
                controller = null;
            }
        });
        return task;
    }

    function cancel() {
        controller?.abort();
        ScholarProfileLoader.cancel();
    }

    function close() {
        generation++;
        cancel();
        if (modal?.open) modal.close();
        modal?.remove();
        modal = null;
        snapshot = null;
    }

    async function open() {
        if (ScholarParser.getPageType() !== "profile") return;
        if (modal?.isConnected) return;
        if (currentTask) await currentTask.catch(() => {});
        if (modal?.isConnected ||
            ScholarParser.getPageType() !== "profile") return;
        const settings = await ScholarSettings.load();
        if (!settings.enabled || modal?.isConnected) return;
        modal = createModal();
        $(".sja-subtitle").textContent =
            ScholarProfileLoader.getProfileInfo().name || "Researcher Profile";
        modal.showModal();
        startLoading();
    }

    function getSnapshot() {
        return snapshot;
    }

    function mountButton() {
        if (ScholarParser.getPageType() !== "profile") return;
        if (document.querySelector(".sj-analytics-entry")) return;
        const target = document.querySelector("#gsc_a_t");
        if (!target) return;
        const container = document.createElement("div");
        container.className = "sj-analytics-entry";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sja-btn sja-primary";
        button.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
                <path d="M3 3v18h18M7 15v-4M12 15V6M17 15V9"/>
            </svg>
            Publication Analytics
        `;
        button.onclick = () => {
            open().catch(error =>
                console.error("[ScholarJournal Analytics]", error)
            );
        };
        container.appendChild(button);
        target.before(container);
    }

    function unmountButton() {
        document.querySelectorAll(".sj-analytics-entry").forEach(el => el.remove());
        close();
    }

    return {
        open, close, cancel, getSnapshot,
        mountButton, unmountButton
    };
})();