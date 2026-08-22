import { generateProviderText } from "./model-providers.js";

export async function discoverOptionsFromPrompts({ providerNames, prompts, facts, maxOptions = 12, onProgress }) {
  const discovered = new Map();
  const promptList = prompts.prompts || [];
  const total = providerNames.length * promptList.length;
  let completed = 0;

  for (const providerName of providerNames) {
    for (const prompt of promptList) {
      onProgress?.({
        type: "start",
        completed,
        total,
        provider: providerName,
        promptId: prompt.id
      });

      const response = await generateProviderText({
        providerName,
        input: buildDiscoveryPrompt({ prompt, facts })
      });
      const options = parseOptions(response)
        .filter((option) => !isTargetOption(option.name, facts))
        .slice(0, 8);

      for (const option of options) {
        const key = canonicalName(option.name);
        const existing = discovered.get(key) || {
          name: option.name,
          count: 0,
          prompts: new Set(),
          providers: new Set(),
          reasons: []
        };

        existing.count += 1;
        existing.prompts.add(prompt.id);
        existing.providers.add(providerName);
        if (option.reason) existing.reasons.push(option.reason);
        discovered.set(key, existing);
      }

      completed += 1;
      onProgress?.({
        type: "finish",
        completed,
        total,
        provider: providerName,
        promptId: prompt.id,
        options: options.map((option) => option.name)
      });
    }
  }

  return [...discovered.values()]
    .sort((a, b) => b.count - a.count || b.providers.size - a.providers.size || a.name.localeCompare(b.name))
    .slice(0, maxOptions)
    .map((option) => ({
      name: option.name,
      summary: buildSummary(option),
      discovery: {
        count: option.count,
        prompts: [...option.prompts],
        providers: [...option.providers]
      }
    }));
}

function buildDiscoveryPrompt({ prompt, facts }) {
  const market = facts.market || facts.industry || "the relevant market";
  return {
    system: [
      `You answer consumer/business recommendation questions in ${market}.`,
      "Do not use any target-company website content.",
      "Do not favor a company unless your general knowledge supports it.",
      "Return concise JSON only."
    ].join(" "),
    user: [
      `Question: ${prompt.question}`,
      "",
      "List up to 7 real options a user might reasonably be recommended for this question.",
      "Return JSON in this exact shape:",
      "{\"options\":[{\"name\":\"Company name\",\"reason\":\"Short factual reason\"}]}"
    ].join("\n")
  };
}

function parseOptions(response) {
  const fromJson = parseJsonOptions(response);
  if (fromJson.length) return fromJson;

  return response
    .split(/\n+/)
    .map((line) => line.match(/^\s*(?:\d+[\).\s-]+|[-*]\s+)(.+)$/)?.[1] || "")
    .map((line) => line.replace(/\*\*/g, "").trim())
    .map((line) => {
      const [name, ...rest] = line.split(/\s[-:]\s/);
      return { name: cleanName(name), reason: rest.join(" - ").trim() };
    })
    .filter((option) => validName(option.name));
}

function parseJsonOptions(response) {
  const candidates = [
    response,
    response.match(/\{[\s\S]*\}/)?.[0],
    response.match(/\[[\s\S]*\]/)?.[0]
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate);
      const options = Array.isArray(data) ? data : data.options;
      if (!Array.isArray(options)) continue;
      return options
        .map((option) => ({
          name: cleanName(typeof option === "string" ? option : option.name),
          reason: typeof option === "string" ? "" : String(option.reason || "").trim()
        }))
        .filter((option) => validName(option.name));
    } catch {
      continue;
    }
  }

  return [];
}

function buildSummary(option) {
  const reason = option.reasons.find(Boolean);
  const promptCount = option.prompts.size;
  const providerCount = option.providers.size;
  const base = reason || `Discovered as a relevant option across ${promptCount} prompt${promptCount === 1 ? "" : "s"}.`;
  return `${base} Mentioned ${option.count} time${option.count === 1 ? "" : "s"} across ${providerCount} provider${providerCount === 1 ? "" : "s"}.`;
}

function isTargetOption(name, facts) {
  const targetNames = [facts.entity, ...(facts.aliases || [])].map(canonicalName).filter(Boolean);
  return targetNames.includes(canonicalName(name));
}

function canonicalName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanName(value) {
  return String(value || "")
    .replace(/^["']|["']$/g, "")
    .replace(/\.$/, "")
    .trim();
}

function validName(name) {
  if (!name || name.length < 2 || name.length > 90) return false;
  if (/^(company name|option|none|n\/a)$/i.test(name)) return false;
  return /[a-z0-9]/i.test(name);
}
