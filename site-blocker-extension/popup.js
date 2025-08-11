const KEYS = { enabled: "enabled", blockedDomains: "blockedDomains" };

function get(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (it) => resolve(it)));
}
function set(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()));
}
function updateDynamicRules(params) {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(params, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err); else resolve();
    });
  });
}

async function refresh() {
  const { enabled, blockedDomains } = await get([KEYS.enabled, KEYS.blockedDomains]);
  document.getElementById("status").textContent = enabled ? "Enabled" : "Disabled";
  document.getElementById("toggleBtn").textContent = enabled ? "Disable" : "Enable";
  document.getElementById("num").textContent = String((blockedDomains || []).length);
}

document.addEventListener("DOMContentLoaded", async () => {
  await refresh();
  document.getElementById("manageBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("toggleBtn").addEventListener("click", async () => {
    const { enabled } = await get([KEYS.enabled]);
    const next = !enabled;
    await set({ [KEYS.enabled]: next });
    if (!next) {
      const existing = await new Promise((resolve) => {
        chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules));
      });
      const toRemove = existing.map((r) => r.id);
      if (toRemove.length) await updateDynamicRules({ addRules: [], removeRuleIds: toRemove });
    } else {
      // Let options page manage re-apply next time it opens; here we can quickly re-apply by reconstructing
      const { blockedDomains, domainToRuleId, nextRuleId } = await get(["blockedDomains", "domainToRuleId", "nextRuleId"]);
      const rules = [];
      let currentId = nextRuleId || 10000;
      const esc = (d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const toRegex = (d) => `^https?:\\/\\/([a-z0-9-]+\\.)*${esc(d)}(?:\\/|$)`;
      const mapping = { ...(domainToRuleId || {}) };
      (blockedDomains || []).forEach((d) => {
        let id = mapping[d];
        if (typeof id !== "number") id = currentId++;
        mapping[d] = id;
        rules.push({ id, priority: 1, action: { type: "redirect", redirect: { extensionPath: "/block.html" } }, condition: { regexFilter: toRegex(d), resourceTypes: ["main_frame"] } });
      });
      const existing = await new Promise((resolve) => {
        chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules));
      });
      const toRemove = existing.map((r) => r.id);
      await updateDynamicRules({ addRules: rules, removeRuleIds: toRemove });
      await set({ domainToRuleId: mapping, nextRuleId: currentId });
    }
    await refresh();
  });
});