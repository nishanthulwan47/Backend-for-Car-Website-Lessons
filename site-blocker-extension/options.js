const STORAGE_KEYS = {
  blockedDomains: "blockedDomains",
  enabled: "enabled",
  nextRuleId: "nextRuleId",
  domainToRuleId: "domainToRuleId",
};

const DEFAULTS = {
  blockedDomains: [],
  enabled: true,
  nextRuleId: 10000,
  domainToRuleId: {},
};

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => {
      resolve(items);
    });
  });
}

function setStorage(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function promisifyUpdateDynamicRules(params) {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(params, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

function escapeForRegex(domain) {
  return domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function domainToRegexFilter(domain) {
  const escaped = escapeForRegex(domain);
  return `^https?:\\/\\/([a-z0-9-]+\\.)*${escaped}(?:\\/|$)`;
}

function sanitizeDomain(input) {
  let d = input.trim().toLowerCase();
  if (!d) return "";
  d = d.replace(/^https?:\\/\\//, "");
  d = d.replace(/^www\\./, "");
  // Remove path/query
  d = d.split("/")[0];
  // Basic validation: must contain at least one dot and have valid chars
  if (!/^[a-z0-9.-]+$/.test(d) || !d.includes(".")) return "";
  return d;
}

async function addRuleForDomain(domain, ruleId) {
  const rule = {
    id: ruleId,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/block.html" } },
    condition: { regexFilter: domainToRegexFilter(domain), resourceTypes: ["main_frame"] },
  };
  await promisifyUpdateDynamicRules({ addRules: [rule], removeRuleIds: [] });
}

async function removeRule(ruleId) {
  await promisifyUpdateDynamicRules({ addRules: [], removeRuleIds: [ruleId] });
}

async function applyAllRules(blockedDomains, domainToRuleId, nextRuleId) {
  // Build rules for all domains that have assigned IDs
  const rules = [];
  let currentId = nextRuleId;
  for (const domain of blockedDomains) {
    let id = domainToRuleId[domain];
    if (typeof id !== "number") {
      id = currentId++;
      domainToRuleId[domain] = id;
    }
    rules.push({
      id,
      priority: 1,
      action: { type: "redirect", redirect: { extensionPath: "/block.html" } },
      condition: { regexFilter: domainToRegexFilter(domain), resourceTypes: ["main_frame"] },
    });
  }
  // Reset dynamic rules to these
  // First, fetch existing dynamic rules and remove them
  const existing = await new Promise((resolve) => {
    chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules));
  });
  const toRemove = existing.map((r) => r.id);
  await promisifyUpdateDynamicRules({ addRules: rules, removeRuleIds: toRemove });
  await setStorage({ domainToRuleId, nextRuleId: currentId });
}

function renderList(blockedDomains) {
  const list = document.getElementById("domainList");
  const count = document.getElementById("count");
  list.innerHTML = "";
  blockedDomains.forEach((domain) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "domain";
    span.textContent = domain;
    const actions = document.createElement("div");
    actions.className = "actions";
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      const { domainToRuleId } = await getStorage([STORAGE_KEYS.domainToRuleId]);
      const id = (domainToRuleId || {})[domain];
      const { enabled, blockedDomains } = await getStorage([STORAGE_KEYS.enabled, STORAGE_KEYS.blockedDomains]);
      const newList = (blockedDomains || []).filter((d) => d !== domain);
      const newMapping = { ...(domainToRuleId || {}) };
      if (typeof id === "number") {
        try {
          if (enabled) await removeRule(id);
        } catch (e) {
          console.warn("Remove rule error", e);
        }
        delete newMapping[domain];
      }
      await setStorage({ [STORAGE_KEYS.blockedDomains]: newList, [STORAGE_KEYS.domainToRuleId]: newMapping });
      renderList(newList);
      updateStatusText();
    });
    actions.appendChild(removeBtn);
    li.appendChild(span);
    li.appendChild(actions);
    list.appendChild(li);
  });
  count.textContent = String(blockedDomains.length);
}

async function updateStatusText() {
  const { enabled, blockedDomains } = await getStorage([STORAGE_KEYS.enabled, STORAGE_KEYS.blockedDomains]);
  const statusText = document.getElementById("statusText");
  statusText.textContent = enabled ? "Enabled" : "Disabled";
  const toggle = document.getElementById("enabledToggle");
  toggle.checked = !!enabled;
  renderList(blockedDomains || []);
}

async function init() {
  const items = await getStorage(Object.values(STORAGE_KEYS));
  const enabled = items[STORAGE_KEYS.enabled] ?? DEFAULTS.enabled;
  const blockedDomains = items[STORAGE_KEYS.blockedDomains] ?? DEFAULTS.blockedDomains;
  const nextRuleId = items[STORAGE_KEYS.nextRuleId] ?? DEFAULTS.nextRuleId;
  const domainToRuleId = items[STORAGE_KEYS.domainToRuleId] ?? DEFAULTS.domainToRuleId;

  document.getElementById("enabledToggle").addEventListener("change", async (e) => {
    const checked = e.target.checked;
    await setStorage({ [STORAGE_KEYS.enabled]: checked });
    if (checked) {
      // Re-apply all rules
      await applyAllRules(
        (await getStorage([STORAGE_KEYS.blockedDomains]))[STORAGE_KEYS.blockedDomains] || [],
        (await getStorage([STORAGE_KEYS.domainToRuleId]))[STORAGE_KEYS.domainToRuleId] || {},
        (await getStorage([STORAGE_KEYS.nextRuleId]))[STORAGE_KEYS.nextRuleId] ?? DEFAULTS.nextRuleId
      );
    } else {
      // Remove all rules but keep data
      const existing = await new Promise((resolve) => {
        chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules));
      });
      const toRemove = existing.map((r) => r.id);
      if (toRemove.length) await promisifyUpdateDynamicRules({ addRules: [], removeRuleIds: toRemove });
    }
    updateStatusText();
  });

  document.getElementById("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("domainInput");
    const sanitized = sanitizeDomain(input.value);
    if (!sanitized) {
      input.focus();
      return;
    }
    const items = await getStorage(Object.values(STORAGE_KEYS));
    const blocked = items[STORAGE_KEYS.blockedDomains] || [];
    const mapping = items[STORAGE_KEYS.domainToRuleId] || {};
    let nextId = items[STORAGE_KEYS.nextRuleId] ?? DEFAULTS.nextRuleId;

    if (blocked.includes(sanitized)) {
      input.value = "";
      return;
    }

    blocked.push(sanitized);

    if (items[STORAGE_KEYS.enabled]) {
      const id = mapping[sanitized] ?? nextId++;
      mapping[sanitized] = id;
      try {
        await addRuleForDomain(sanitized, id);
      } catch (e) {
        console.error("Failed to add rule", e);
      }
      await setStorage({ [STORAGE_KEYS.blockedDomains]: blocked, [STORAGE_KEYS.domainToRuleId]: mapping, [STORAGE_KEYS.nextRuleId]: nextId });
    } else {
      await setStorage({ [STORAGE_KEYS.blockedDomains]: blocked });
    }

    input.value = "";
    renderList(blocked);
    updateStatusText();
  });

  document.getElementById("exportBtn").addEventListener("click", async () => {
    const { blockedDomains } = await getStorage([STORAGE_KEYS.blockedDomains]);
    const blob = new Blob([JSON.stringify(blockedDomains || [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "site-blocker-domains.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    let domains;
    try {
      domains = JSON.parse(text);
      if (!Array.isArray(domains)) throw new Error("Invalid format");
    } catch (err) {
      alert("Import failed: not a JSON array");
      return;
    }
    const sanitized = Array.from(new Set(domains.map((d) => sanitizeDomain(String(d))).filter(Boolean)));
    const { enabled } = await getStorage([STORAGE_KEYS.enabled]);
    let mapping = (await getStorage([STORAGE_KEYS.domainToRuleId]))[STORAGE_KEYS.domainToRuleId] || {};
    let nextId = (await getStorage([STORAGE_KEYS.nextRuleId]))[STORAGE_KEYS.nextRuleId] ?? DEFAULTS.nextRuleId;
    if (enabled) {
      // Replace rules wholesale
      await applyAllRules(sanitized, mapping, nextId);
      // applyAllRules updated mapping and nextId in storage
      mapping = (await getStorage([STORAGE_KEYS.domainToRuleId]))[STORAGE_KEYS.domainToRuleId] || {};
      nextId = (await getStorage([STORAGE_KEYS.nextRuleId]))[STORAGE_KEYS.nextRuleId] ?? DEFAULTS.nextRuleId;
    }
    await setStorage({ [STORAGE_KEYS.blockedDomains]: sanitized, [STORAGE_KEYS.domainToRuleId]: mapping, [STORAGE_KEYS.nextRuleId]: nextId });
    e.target.value = "";
    renderList(sanitized);
    updateStatusText();
  });

  document.getElementById("clearAllBtn").addEventListener("click", async () => {
    const { enabled } = await getStorage([STORAGE_KEYS.enabled]);
    if (enabled) {
      const existing = await new Promise((resolve) => {
        chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules));
      });
      const toRemove = existing.map((r) => r.id);
      if (toRemove.length) await promisifyUpdateDynamicRules({ addRules: [], removeRuleIds: toRemove });
    }
    await setStorage({ [STORAGE_KEYS.blockedDomains]: [], [STORAGE_KEYS.domainToRuleId]: {}, [STORAGE_KEYS.nextRuleId]: DEFAULTS.nextRuleId });
    renderList([]);
    updateStatusText();
  });

  document.getElementById("enabledToggle").checked = !!enabled;
  renderList(blockedDomains);
  await setStorage({ [STORAGE_KEYS.enabled]: enabled, [STORAGE_KEYS.blockedDomains]: blockedDomains, [STORAGE_KEYS.nextRuleId]: nextRuleId, [STORAGE_KEYS.domainToRuleId]: domainToRuleId });
  updateStatusText();
}

document.addEventListener("DOMContentLoaded", init);