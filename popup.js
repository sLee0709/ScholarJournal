const Popup = (() => {
    const $ = id => document.getElementById(id);
    const keys = Object.keys(ScholarSettings.DEFAULTS)
        .filter(key => typeof ScholarSettings.DEFAULTS[key] === "boolean");
    let settings = {...ScholarSettings.DEFAULTS};
    let saveQueue = Promise.resolve();
    let statusTimer = null;
    let crossrefBusy = false;
    let crossrefAccess = {
        pool: "public",
        confirmed: false,
        email: "",
        doiInterval: 250,
        titleInterval: 1100,
        maxConcurrent: 1
    };

    function showStatus(message, error = false) {
        clearTimeout(statusTimer);
        const el = $("statusMessage");
        el.textContent = message;
        el.classList.toggle("error", error);
        statusTimer = setTimeout(() => {
            el.textContent = "";
            el.classList.remove("error");
        }, 3000);
    }

    function showCrossrefStatus(message = "", type = "") {
        const el = $("crossrefStatus");
        el.textContent = message;
        el.className = `crossref-status${type ? ` ${type}` : ""}`;
    }

    function interpolateColor(start, end, t) {
        t = Math.max(0, Math.min(1, t));
        const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x, 16));
        const a = rgb(start), b = rgb(end);
        return a.map((v, i) => Math.round(v + (b[i] - v) * t));
    }

    function metricColor(start, end, t) {
        const rgb = interpolateColor(start, end, t);
        const linear = rgb.map(v => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        return {
            background: `rgb(${rgb.join(",")})`,
            color: luminance > 0.179 ? "#202124" : "#ffffff"
        };
    }

    function createBadge(text, background = "#edf1f6", color = "#49576a") {
        const badge = document.createElement("span");
        badge.className = "preview-badge";
        badge.textContent = text;
        badge.style.backgroundColor = background;
        badge.style.color = color;
        return badge;
    }

    function renderPreview() {
        const preview = $("metricPreview");
        preview.replaceChildren();
        if (!settings.enabled) {
            const empty = document.createElement("span");
            empty.className = "preview-empty";
            empty.textContent = "ScholarJournal is disabled";
            preview.appendChild(empty);
            return;
        }
        const jifColor = metricColor("#fce8e6", "#801710", Math.log1p(28.3) / Math.log1p(50));
        const quartileColor = metricColor("#e6f4ea", "#137333", 1);
        const percentileColor = metricColor("#f3e8fd", "#50158a", 1 - Math.log1p(0.6) / Math.log1p(100));
        const metrics = [
            ["showJournal", "NATURE METHODS", "#e8f0fe", "#1967d2"],
            ["showJIF", "IF 28.3", jifColor.background, jifColor.color],
            ["showQuartile", "JCR Q1", quartileColor.background, quartileColor.color],
            ["showPercentile", "Top 0.6%", percentileColor.background, percentileColor.color],
            ["showJIF5", "5-year IF 52.5"],
            ["showJCI", "JCI 7.21"],
            ["showRank", "Rank 1/85"]
        ];
        for (const [key, text, background, color] of metrics) {
            if (settings[key])
                preview.appendChild(createBadge(text, background, color));
        }
        if (settings.showDetails) {
            const info = document.createElement("span");
            info.className = "preview-info";
            info.textContent = "ⓘ";
            preview.appendChild(info);
        }
        if (!preview.childElementCount) {
            const empty = document.createElement("span");
            empty.className = "preview-empty";
            empty.textContent = "No metrics selected";
            preview.appendChild(empty);
        }
    }

    function renderCrossrefAccess() {
        const configured = Boolean(settings.crossrefEmail);
        const polite = configured &&
            crossrefAccess.pool === "polite" &&
            crossrefAccess.confirmed === true &&
            crossrefAccess.email === settings.crossrefEmail;
        const badge = $("crossrefPoolBadge");
        badge.className = `crossref-pool-badge ${crossrefBusy ? "connecting" : polite ? "polite" : "public"}`;
        badge.textContent = crossrefBusy ? "Updating..." : polite ? "Polite Pool" : "Public Pool";
        $("crossrefDisconnected").hidden = polite;
        $("crossrefConnected").hidden = !polite;
        $("crossrefConnectedEmail").textContent = settings.crossrefEmail;
        $("crossrefTitleRate").textContent =
            `${(1000 / (crossrefAccess.titleInterval || 1100)).toFixed(2)} /s`;
        $("crossrefConcurrency").textContent =
            crossrefAccess.maxConcurrent || 1;
        const available = settings.enabled && settings.enableCrossref;
        $("crossrefEmailInput").disabled = crossrefBusy || !available;
        $("crossrefConnect").disabled = crossrefBusy || !available ||
            !ScholarSettings.isValidEmail($("crossrefEmailInput").value);
        $("crossrefConnect").textContent =
            crossrefBusy ? "Connecting..." : "Connect to Polite Pool";
        $("crossrefDisconnect").disabled = crossrefBusy;
        $("crossrefDisconnect").textContent =
            crossrefBusy ? "Disconnecting..." : "Disconnect";
        $("resetSettings").disabled = crossrefBusy;
    }

    function applySettings() {
        for (const key of keys) {
            const el = $(key);
            if (!el) continue;
            el.checked = settings[key];
            el.disabled = key !== "enabled" && !settings.enabled;
        }
        $("settingsPanel").classList.toggle("settings-disabled", !settings.enabled);
        renderPreview();
        renderCrossrefAccess();
    }

    function saveSettings(changes = {}) {
        const patch = {...changes};
        const task = saveQueue.catch(() => {}).then(() =>
            ScholarSettings.update(patch)
        );
        saveQueue = task.catch(error => {
            showStatus(`Failed to save settings: ${error.message}`, true);
        });
        return task;
    }

    function bindSettings() {
        for (const key of keys) {
            const el = $(key);
            if (!el) continue;
            el.addEventListener("change", () => {
                settings[key] = el.checked;
                applySettings();
                saveSettings({[key]: settings[key]}).catch(() => {});
            });
        }
    }

    async function requestBackground(message) {
        const response = await chrome.runtime.sendMessage(message);
        if (!response?.success)
            throw new Error(response?.error || "Unable to communicate with Crossref manager");
        return response;
    }

    async function refreshCrossrefAccess() {
        try {
            const response = await requestBackground({
                type: "CROSSREF_ACCESS_STATUS"
            });
            crossrefAccess = {
                ...crossrefAccess,
                ...response.access
            };
            renderCrossrefAccess();
            return response;
        } catch (error) {
            crossrefAccess = {
                pool: "public",
                confirmed: false,
                email: "",
                doiInterval: 250,
                titleInterval: 1100,
                maxConcurrent: 1
            };
            renderCrossrefAccess();
            showCrossrefStatus(`API status unavailable: ${error.message}`, "error");
            return null;
        }
    }

    async function connectCrossref() {
        if (crossrefBusy || !settings.enabled || !settings.enableCrossref) return;
        const email = ScholarSettings.normalizeEmail($("crossrefEmailInput").value);
        if (!ScholarSettings.isValidEmail(email)) {
            showCrossrefStatus("Please enter a valid contact email address.", "error");
            return;
        }
        crossrefBusy = true;
        renderCrossrefAccess();
        showCrossrefStatus("Verifying Crossref API access...", "loading");
        try {
            await saveQueue;
            const response = await requestBackground({
                type: "CROSSREF_CONNECT",
                email
            });
            if (response.access?.pool !== "polite" ||
                response.access?.confirmed !== true)
                throw new Error("Crossref Polite Pool could not be confirmed.");
            settings.crossrefEmail = email;
            crossrefAccess = response.access;
            showCrossrefStatus("Polite Pool connection confirmed.");
        } catch (error) {
            settings.crossrefEmail = (await ScholarSettings.load()).crossrefEmail;
            await refreshCrossrefAccess();
            showCrossrefStatus(`Connection failed: ${error.message}`, "error");
        } finally {
            crossrefBusy = false;
            applySettings();
        }
    }

    async function disconnectCrossref() {
        if (crossrefBusy) return;
        crossrefBusy = true;
        renderCrossrefAccess();
        showCrossrefStatus("Disconnecting...", "loading");
        try {
            await saveQueue;
            const response = await requestBackground({
                type: "CROSSREF_DISCONNECT"
            });
            settings.crossrefEmail = "";
            crossrefAccess = response.access;
            $("crossrefEmailInput").value = "";
            showCrossrefStatus("Disconnected. Public Pool is now active.");
        } catch (error) {
            await refreshCrossrefAccess();
            showCrossrefStatus(`Disconnect failed: ${error.message}`, "error");
        } finally {
            crossrefBusy = false;
            applySettings();
        }
    }

    function bindCrossrefEvents() {
        $("crossrefEmailInput").addEventListener("input", () => {
            showCrossrefStatus();
            renderCrossrefAccess();
        });
        $("crossrefEmailInput").addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                connectCrossref();
            }
        });
        $("crossrefConnect").addEventListener("click", connectCrossref);
        $("crossrefDisconnect").addEventListener("click", disconnectCrossref);
    }

    async function refreshCacheStats() {
        try {
            const response = await requestBackground({
                type: "CROSSREF_STATS"
            });
            $("cacheEntries").textContent = Number(response.cacheEntries || 0).toLocaleString();
            $("cacheSize").textContent = `${Number(response.cacheMB || 0).toFixed(3)} MB`;
            return true;
        } catch (error) {
            $("cacheEntries").textContent = "—";
            $("cacheSize").textContent = "—";
            showStatus(`Cache unavailable: ${error.message}`, true);
            return false;
        }
    }

    async function clearCache() {
        const button = $("clearCache");
        button.disabled = true;
        button.textContent = "Clearing...";
        try {
            const response = await requestBackground({
                type: "CROSSREF_CLEAR_CACHE"
            });
            await refreshCacheStats();
            showStatus(`${response.removed || 0} cache entries removed`);
        } catch (error) {
            showStatus(`Failed to clear cache: ${error.message}`, true);
        } finally {
            button.disabled = false;
            button.textContent = "Clear cache";
        }
    }

    async function resetSettings() {
        if (crossrefBusy) return;
        crossrefBusy = true;
        renderCrossrefAccess();
        try {
            await saveQueue;
            await requestBackground({type: "CROSSREF_DISCONNECT"});
            settings = await ScholarSettings.reset();
            $("crossrefEmailInput").value = "";
            await refreshCrossrefAccess();
            showCrossrefStatus();
            showStatus("Default settings restored");
        } catch (error) {
            settings = await ScholarSettings.load();
            showStatus(`Failed to reset settings: ${error.message}`, true);
        } finally {
            crossrefBusy = false;
            applySettings();
        }
    }

    async function init() {
        $("version").textContent = `ScholarJournal v${chrome.runtime.getManifest().version}`;
        try {
            settings = await ScholarSettings.load();
        } catch (error) {
            showStatus(`Failed to load settings: ${error.message}`, true);
        }
        $("crossrefEmailInput").value = settings.crossrefEmail || "";
        applySettings();
        bindSettings();
        bindCrossrefEvents();
        $("clearCache").addEventListener("click", clearCache);
        $("resetSettings").addEventListener("click", resetSettings);
        await Promise.allSettled([
            refreshCacheStats(),
            refreshCrossrefAccess()
        ]);
    }

    return {init};
})();

document.addEventListener("DOMContentLoaded", Popup.init);