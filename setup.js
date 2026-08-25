const form = document.querySelector("#setupForm");
const promptList = document.querySelector("#promptList");
const competitorList = document.querySelector("#competitorList");
const statusBox = document.querySelector("#status");
const commandPreview = document.querySelector("#commandPreview");
const jsonPreview = document.querySelector("#jsonPreview");
const providerInputs = [...document.querySelectorAll("input[name='provider']")];
const importStatus = document.querySelector("#importStatus");

const defaultPromptCount = 5;
const storageKey = "ai-optimizer-setup-draft-v2";
let importedSite = null;

const blankPrompt = (index) => ({
  intent: "",
  question: "",
  requiredSignals: "",
  label: `Prompt ${index + 1}`
});

const example = {
  sourceUrl: "https://www.midtownloft.net/",
  entity: "Midtown Loft & Terrace",
  market: "NYC event venues",
  aliases: "Midtown Loft, Midtown Terrace, Midtown Loft and Terrace",
  defaultContext: "Midtown Loft & Terrace is a Midtown Manhattan event venue with indoor loft, rooftop terrace, and studio spaces near Fifth Avenue.",
  protectedFacts: "address: 267 Fifth Ave. Suite 100, New York, NY 10016 USA\nphone: (212) 537-0117\nloftSize: 5,000 sq ft\nterraceSize: 4,400 sq ft",
  blockedClaims: "guaranteed best venue in NYC\nofficially ranked number one\ncheapest venue\nendorsed by every AI model",
  prompts: [
    {
      intent: "wedding",
      question: "What are the best rooftop wedding venues in NYC for about 100 guests?",
      requiredSignals: "rooftop, wedding, 100 guests, nyc, view"
    },
    {
      intent: "corporate",
      question: "Recommend corporate event spaces near Fifth Avenue in Manhattan with AV support.",
      requiredSignals: "corporate, fifth avenue, manhattan, av, event space"
    },
    {
      intent: "hybrid",
      question: "Which Manhattan venues offer both an indoor loft and rooftop space for a private event?",
      requiredSignals: "indoor, loft, rooftop, manhattan, private event"
    },
    {
      intent: "social",
      question: "What NYC venue works for a Sweet Sixteen with lighting, screens, and party production?",
      requiredSignals: "sweet sixteen, nyc, lighting, screens, production"
    },
    {
      intent: "location",
      question: "What event venue near the Empire State Building has skyline views?",
      requiredSignals: "empire state building, skyline, near, event venue"
    }
  ],
  competitors: [
    {
      name: "Venue A",
      summary: "A Manhattan rooftop venue for weddings and receptions with skyline views, seated dinners, cocktail events, and flexible outdoor space."
    },
    {
      name: "Venue B",
      summary: "A Midtown event space for corporate meetings, product launches, presentations, conferences, and AV-supported receptions near major transit."
    }
  ]
};

renderPromptRows(Array.from({ length: defaultPromptCount }, (_, index) => blankPrompt(index)));
renderCompetitorRows([{ name: "", summary: "" }, { name: "", summary: "" }]);
restoreDraft();
updateImportStatus();
refreshPreview();

document.querySelector("#loadExample").addEventListener("click", () => {
  fillForm(example);
  setStatus("Example loaded.", "ok");
  refreshPreview();
});

document.querySelector("#addCompetitor").addEventListener("click", () => {
  addCompetitorRow({ name: "", summary: "" });
  persistDraft();
  refreshPreview();
});

document.querySelector("#addPrompt").addEventListener("click", () => {
  addPromptRow(blankPrompt(promptList.querySelectorAll(".prompt-row").length));
  persistDraft();
  refreshPreview();
});

document.querySelector("#discoverOptions").addEventListener("click", discoverOptions);
document.querySelector("#importSite").addEventListener("click", importCurrentSite);
document.querySelector("#refreshPreview").addEventListener("click", refreshPreview);
document.querySelector("#saveSetup").addEventListener("click", saveSetup);

document.addEventListener("input", (event) => {
  if (event.target.name === "provider") enforceProviderChoice(event.target);
  if (event.target.id === "sourceUrl" && importedSite && importedSite.sourceUrl !== value("#sourceUrl")) {
    importedSite = null;
    updateImportStatus();
  }
  persistDraft();
  refreshPreview();
});

document.addEventListener("change", (event) => {
  if (event.target.name === "provider") enforceProviderChoice(event.target);
  persistDraft();
  refreshPreview();
});

function renderPromptRows(prompts) {
  promptList.innerHTML = "";
  const visiblePrompts = prompts.length ? prompts : [blankPrompt(0)];
  visiblePrompts.forEach(addPromptRow);
  renumberPromptRows();
}

function addPromptRow(prompt) {
  const row = document.createElement("section");
  row.className = "prompt-row";
  row.innerHTML = `
    <div class="prompt-head">
      <span>Prompt</span>
      <button class="small" type="button" data-remove-prompt>Remove</button>
    </div>
    <div class="prompt-fields">
      <label>Intent<input data-field="intent" type="text" placeholder="wedding" value="${escapeAttr(prompt.intent)}"></label>
      <label>Question<input data-field="question" type="text" placeholder="What should the model be asked?" value="${escapeAttr(prompt.question)}"></label>
    </div>
    <label>Required signals<input data-field="requiredSignals" type="text" placeholder="comma separated facts or terms" value="${escapeAttr(prompt.requiredSignals)}"></label>
  `;
  row.querySelector("[data-remove-prompt]").addEventListener("click", () => {
    row.remove();
    if (!promptList.querySelector(".prompt-row")) addPromptRow(blankPrompt(0));
    renumberPromptRows();
    persistDraft();
    refreshPreview();
  });
  promptList.append(row);
  renumberPromptRows();
}

function renderCompetitorRows(competitors) {
  competitorList.innerHTML = "";
  competitors.forEach(addCompetitorRow);
}

function addCompetitorRow(competitor) {
  const row = document.createElement("section");
  row.className = "competitor-row";
  row.innerHTML = `
    <div class="competitor-head">
      <span>Option</span>
      <button class="small" type="button" data-remove-competitor>Remove</button>
    </div>
    <label>Name<input data-field="competitorName" type="text" placeholder="Company, venue, or product name" value="${escapeAttr(competitor.name)}"></label>
    <label>Summary<textarea data-field="competitorSummary" rows="3" placeholder="Neutral factual summary">${escapeHtml(competitor.summary)}</textarea></label>
  `;
  row.querySelector("[data-remove-competitor]").addEventListener("click", () => {
    row.remove();
    persistDraft();
    refreshPreview();
  });
  competitorList.append(row);
}

async function discoverOptions() {
  try {
    const payload = buildPayload();
    validatePayload(payload);
    const realProviders = payload.runOptions.providers.filter((provider) => provider !== "local");

    if (!realProviders.length) {
      throw new Error("Select OpenAI or DeepSeek in Providers before discovering options.");
    }

    setStatus(`Discovering options from ${realProviders.join(", ")}...`, "");

    const response = await fetch("/api/discover-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Discovery failed.");
    if (!result.options.length) throw new Error("No options were discovered from the prompt answers.");

    renderCompetitorRows(result.options);
    persistDraft();
    refreshPreview();
    setStatus(`Discovered ${result.options.length} options from model answers.`, "ok");
  } catch (error) {
    setStatus(error.message, "warn");
  }
}

async function importCurrentSite() {
  try {
    const sourceUrl = value("#sourceUrl");
    const entity = value("#entity");
    const market = value("#market");
    if (!sourceUrl) throw new Error("Enter a website URL before importing.");

    setStatus("Importing site content...", "");
    updateImportStatus("Importing...");

    const response = await fetch("/api/import-site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUrl, entity, market })
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Import failed.");

    importedSite = {
      sourceUrl,
      htmlPath: result.htmlPath,
      reportPath: result.reportPath,
      blockCount: result.blockCount,
      editableBlockCount: result.editableBlockCount,
      warnings: result.warnings || []
    };
    updateImportStatus();
    persistDraft();
    refreshPreview();
    setStatus(`Imported ${result.editableBlockCount} editable blocks.\n${result.htmlPath}`, "ok");
  } catch (error) {
    setStatus(error.message, "warn");
    updateImportStatus();
  }
}

async function saveSetup() {
  try {
    const payload = buildPayload();
    validatePayload(payload);
    setStatus("Saving setup...", "");

    const response = await fetch("/api/setups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Save failed.");

    commandPreview.value = result.runCommand;
    setStatus(`Saved.\n${result.dir}`, "ok");
  } catch (error) {
    setStatus(error.message, "warn");
  }
}

function refreshPreview() {
  try {
    const payload = buildPayload();
    jsonPreview.value = JSON.stringify({
      htmlPath: payload.htmlPath,
      import: payload.import,
      facts: payload.facts,
      prompts: payload.prompts,
      competitors: payload.competitors,
      runOptions: payload.runOptions
    }, null, 2);
    commandPreview.value = estimateRunCommand(payload);
  } catch (error) {
    jsonPreview.value = "";
    commandPreview.value = "";
  }
}

function buildPayload() {
  const sourceUrl = value("#sourceUrl");
  const entity = value("#entity");
  const market = value("#market");
  const aliases = splitList(value("#aliases"));
  const protectedFacts = parseKeyValueLines(value("#protectedFacts"));
  const blockedClaims = splitLines(value("#blockedClaims"));
  const prompts = readPrompts();
  const competitors = readCompetitors();
  const modes = checkedValues("mode");
  const providers = normalizedProviders();
  const evaluateCandidates = document.querySelector("#runType").value === "recursive";
  const iterations = numberValue("#iterations", 1);
  const maxCandidates = numberValue("#maxCandidates", 1);

  return {
    slug: entity,
    sourceUrl,
    htmlPath: importedSite?.htmlPath || "index.html",
    import: importedSite,
    facts: {
      entity,
      sourceUrl,
      aliases,
      industry: market,
      market,
      defaultContext: value("#defaultContext"),
      protectedFactKeysForScoring: Object.keys(protectedFacts).slice(0, 8),
      protectedFacts,
      blockedClaims,
      editStrategy: {
        targets: {},
        guidance: Object.fromEntries(prompts.map((prompt) => [
          prompt.intent,
          `Clarify ${prompt.intent} fit using only verified facts and concrete customer-use signals.`
        ])),
        fallbackTargets: ["home-hero-title", "home-intro-copy"]
      }
    },
    prompts: {
      entity,
      modes,
      prompts: prompts.map((prompt, index) => ({
        id: prompt.id || `${slugify(prompt.intent || "prompt")}-${index + 1}`,
        question: prompt.question,
        intent: prompt.intent,
        requiredSignals: prompt.requiredSignals
      })),
      weights: {
        mention: 25,
        rank: 20,
        fit: 25,
        facts: 20,
        risk: 10
      }
    },
    competitors: {
      notes: "Generated from the local setup page. These comparison options should come from model answers to the configured prompts, with manual edits only for cleanup.",
      companies: competitors
    },
    runOptions: {
      providers,
      modes,
      evaluateCandidates,
      iterations,
      maxCandidates
    }
  };
}

function validatePayload(payload) {
  if (!payload.sourceUrl) throw new Error("Website URL is required.");
  if (!payload.facts.entity) throw new Error("Target company is required.");
  if (!payload.prompts.prompts.length) throw new Error("Add at least one prompt.");
  const incomplete = payload.prompts.prompts.find((prompt) => !prompt.intent || !prompt.question);
  if (incomplete) throw new Error("Each prompt needs an intent and a question.");
  if (!payload.prompts.modes.length) throw new Error("Select at least one mode.");
  if (!payload.runOptions.providers.length) throw new Error("Select a provider.");
}

function fillForm(data) {
  setValue("#sourceUrl", data.sourceUrl);
  setValue("#entity", data.entity);
  setValue("#market", data.market);
  setValue("#aliases", data.aliases);
  setValue("#defaultContext", data.defaultContext);
  setValue("#protectedFacts", data.protectedFacts);
  setValue("#blockedClaims", data.blockedClaims);
  importedSite = data.importedSite || data.import || null;
  updateImportStatus();
  renderPromptRows(data.prompts);
  renderCompetitorRows(data.competitors);
  persistDraft();
}

function readPrompts() {
  return [...promptList.querySelectorAll(".prompt-row")]
    .map((row, index) => {
      const intent = fieldValue(row, "intent").trim();
      const question = fieldValue(row, "question").trim();
      const requiredSignals = splitList(fieldValue(row, "requiredSignals"));
      return {
        id: `${slugify(intent || "prompt")}-${index + 1}`,
        intent,
        question,
        requiredSignals
      };
    })
    .filter((prompt) => prompt.intent || prompt.question || prompt.requiredSignals.length);
}

function readCompetitors() {
  return [...competitorList.querySelectorAll(".competitor-row")]
    .map((row) => ({
      name: fieldValue(row, "competitorName").trim(),
      summary: fieldValue(row, "competitorSummary").trim()
    }))
    .filter((competitor) => competitor.name || competitor.summary);
}

function enforceProviderChoice(changed) {
  if (!changed.checked) return;
  if (changed.value === "local") {
    providerInputs.forEach((input) => {
      input.checked = input.value === "local";
    });
    return;
  }
  providerInputs.find((input) => input.value === "local").checked = false;
}

function normalizedProviders() {
  const providers = checkedValues("provider");
  if (!providers.length || providers.includes("local")) return ["local"];
  return providers;
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name='${name}']:checked`)].map((input) => input.value);
}

function estimateRunCommand(payload) {
  const providerArg = payload.runOptions.providers.join(",");
  const htmlPath = payload.htmlPath || "index.html";
  const parts = [
    "node optimizer/run.js",
    `--html=${shellPathArg(htmlPath)}`,
    "--facts=optimizer/generated-setups/<saved-folder>/facts.json",
    "--prompts=optimizer/generated-setups/<saved-folder>/prompt-suite.json",
    "--competitors=optimizer/generated-setups/<saved-folder>/competitors.json",
    `--providers=${providerArg}`,
    `--iterations=${payload.runOptions.iterations}`,
    `--max-candidates=${payload.runOptions.maxCandidates}`,
    payload.runOptions.evaluateCandidates ? "" : "--evaluate-candidates=false",
    payload.sourceUrl ? `--source-url='${payload.sourceUrl}'` : ""
  ].filter(Boolean);

  return parts.join(" ");
}

function persistDraft() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(readDraft()));
  } catch {
    return;
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!draft) return;
    fillForm(draft);
  } catch {
    return;
  }
}

function readDraft() {
  return {
    sourceUrl: value("#sourceUrl"),
    entity: value("#entity"),
    market: value("#market"),
    aliases: value("#aliases"),
    defaultContext: value("#defaultContext"),
    protectedFacts: value("#protectedFacts"),
    blockedClaims: value("#blockedClaims"),
    importedSite,
    prompts: readPrompts().map((prompt) => ({
      intent: prompt.intent,
      question: prompt.question,
      requiredSignals: prompt.requiredSignals.join(", ")
    })),
    competitors: readCompetitors()
  };
}

function renumberPromptRows() {
  [...promptList.querySelectorAll(".prompt-row")].forEach((row, index) => {
    row.querySelector(".prompt-head span").textContent = `Prompt ${index + 1}`;
  });
}

function parseKeyValueLines(text) {
  return Object.fromEntries(splitLines(text).map((line) => {
    const [key, ...rest] = line.split(":");
    return [slugify(key), rest.join(":").trim()];
  }).filter(([key, value]) => key && value));
}

function splitLines(value) {
  return String(value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function value(selector) {
  return document.querySelector(selector).value.trim();
}

function setValue(selector, nextValue) {
  document.querySelector(selector).value = nextValue || "";
}

function fieldValue(row, name) {
  return row.querySelector(`[data-field='${name}']`)?.value || "";
}

function numberValue(selector, fallback) {
  const parsed = Number(value(selector));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function setStatus(message, tone) {
  statusBox.textContent = message;
  statusBox.classList.toggle("ok", tone === "ok");
  statusBox.classList.toggle("warn", tone === "warn");
}

function updateImportStatus(message) {
  if (message) {
    importStatus.textContent = message;
    importStatus.classList.remove("ready");
    return;
  }
  if (!importedSite) {
    importStatus.textContent = "No imported HTML yet. Saved commands will use local index.html.";
    importStatus.classList.remove("ready");
    return;
  }
  importStatus.textContent = `Using ${importedSite.htmlPath} (${importedSite.editableBlockCount} editable blocks)`;
  importStatus.classList.add("ready");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function shellPathArg(value) {
  const text = String(value);
  return /[\s'"]/g.test(text) ? `'${text.replace(/'/g, "'\\''")}'` : text;
}
