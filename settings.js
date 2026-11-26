const ScholarSettings = (() => {
    const KEY = "scholarjournal_settings";
    const DEFAULTS = Object.freeze({
        enabled: true,
        showJournal: true,
        showJIF: true,
        showQuartile: true,
        showPercentile: true,
        showJIF5: false,
        showJCI: false,
        showRank: false,
        showDetails: true,
        showFilters: true,
        hideUnmatched: false,
        enableCrossref: true,
        crossrefEmail: ""
    });

    function normalizeEmail(value = "") {
        return typeof value === "string" ? value.trim() : "";
    }

    function isValidEmail(value) {
        const email = normalizeEmail(value);
        return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function normalize(settings = {}) {
        const config = Object.fromEntries(
            Object.entries(DEFAULTS).map(([key, value]) => {
                const input = settings?.[key];
                return [key, typeof input === typeof value ? input : value];
            })
        );
        config.crossrefEmail = normalizeEmail(config.crossrefEmail);
        if (!isValidEmail(config.crossrefEmail))
            config.crossrefEmail = "";
        return config;
    }

    async function load() {
        const data = await chrome.storage.local.get(KEY);
        return normalize(data[KEY]);
    }

    async function save(settings) {
        const config = normalize(settings);
        await chrome.storage.local.set({[KEY]: config});
        return config;
    }

    async function update(changes) {
        const settings = await load();
        return save({...settings, ...changes});
    }

    async function reset() {
        return save(DEFAULTS);
    }

    function subscribe(callback) {
        const listener = (changes, areaName) => {
            if (areaName !== "local" || !changes[KEY]) return;
            callback(normalize(changes[KEY].newValue));
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }

    return {
        KEY, DEFAULTS, load, save, update, reset,
        subscribe, normalizeEmail, isValidEmail
    };
})();