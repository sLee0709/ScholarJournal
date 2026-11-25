const Popup = (() => {
    const $ = id => document.getElementById(id);
    const keys = Object.keys(ScholarSettings.DEFAULTS);
    let settings = {...ScholarSettings.DEFAULTS};
    let saveQueue = Promise.resolve();
    let statusTimer = null;

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
        const jifColor = metricColor(
            "#fce8e6", "#801710", Math.log1p(28.3) / Math.log1p(50)
        );
        const quartileColor = metricColor(
            "#e6f4ea", "#137333", 1
        );
        const percentileColor = metricColor(
            "#f3e8fd", "#50158a", 1 - Math.log1p(0.6) / Math.log1p(100)
        );
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

    function applySettings() {
        for (const key of keys) {
            const el = $(key);
            if (!el) continue;
            el.checked = settings[key];
            el.disabled = key !== "enabled" && !settings.enabled;
        }
        $("settingsPanel").classList.toggle("settings-disabled", !settings.enabled);
        renderPreview();
    }

    function saveSettings() {
        const snapshot = {...settings};
        saveQueue = saveQueue.catch(() => {}).then(async () => {
            await ScholarSettings.save(snapshot);
        }).catch(error => {
            showStatus(`Failed to save settings: ${error.message}`, true);
        });
        return saveQueue;
    }

    function bindSettings() {
        for (const key of keys) {
            const el = $(key);
            if (!el) continue;
            el.addEventListener("change", () => {
                settings[key] = el.checked;
                applySettings();
                saveSettings();
            });
        }
    }

    async function refreshCacheStats() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "CROSSREF_STATS"
            });
            if (!response?.success)
                throw new Error(response?.error || "Unable to read cache");
            $("cacheEntries").textContent = Number(response.cacheEntries || 0).toLocaleString();
            $("cacheSize").textContent = `${Number(response.cacheMB || 0).toFixed(3)} MB`;
        } catch (error) {
            $("cacheEntries").textContent = "—";
            $("cacheSize").textContent = "—";
            showStatus(`Cache unavailable: ${error.message}`, true);
        }
    }

    async function clearCache() {
        const button = $("clearCache");
        button.disabled = true;
        button.textContent = "Clearing...";
        try {
            const response = await chrome.runtime.sendMessage({
                type: "CROSSREF_CLEAR_CACHE"
            });
            if (!response?.success)
                throw new Error(response?.error || "Unable to clear cache");
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
        settings = {...ScholarSettings.DEFAULTS};
        applySettings();
        await saveSettings();
        showStatus("Default settings restored");
    }

    async function init() {
        $("version").textContent = `ScholarJournal v${chrome.runtime.getManifest().version}`;
        try {
            settings = await ScholarSettings.load();
        } catch (error) {
            showStatus(`Failed to load settings: ${error.message}`, true);
        }
        applySettings();
        bindSettings();
        $("clearCache").addEventListener("click", clearCache);
        $("resetSettings").addEventListener("click", resetSettings);
        await refreshCacheStats();
    }

    return {init};
})();

document.addEventListener("DOMContentLoaded", Popup.init);