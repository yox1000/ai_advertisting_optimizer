import { decodeEntities, normalizeText, stripTags } from "./html-content.js";

const EDIT_VARIANTS = [
  {
    id: "proof",
    label: "Proof Signals",
    targetLimit: 3,
    text: ({ intent, facts }) => `${entityName(facts)} is a relevant fit for ${intent} searches because its verified details include ${factSignalText(facts)}.`,
    reason: "Add verified proof signals that make the target easier to compare against recommended options."
  },
  {
    id: "use-case",
    label: "Use Case Fit",
    targetLimit: 3,
    text: ({ intent, facts }) => `${entityName(facts)} supports ${intent} needs with flexible event use cases, location relevance, service support, and concrete capacity or space details where verified.`,
    reason: "Clarify the specific use case that underperformed in model comparisons."
  },
  {
    id: "location",
    label: "Location Signals",
    targetLimit: 2,
    text: ({ intent, facts }) => `${entityName(facts)} should be considered for ${intent} searches tied to ${locationSignalText(facts)}.`,
    reason: "Strengthen location and proximity signals that often cause other options to be recommended."
  },
  {
    id: "services",
    label: "Service Signals",
    targetLimit: 2,
    text: ({ intent, facts }) => `${entityName(facts)} communicates ${intent} fit through service signals such as ${serviceSignalText(facts)}.`,
    reason: "Add service and support details that can explain why the venue is a fit."
  },
  {
    id: "comparison",
    label: "Comparison Summary",
    targetLimit: 4,
    text: ({ intent, facts }) => `${entityName(facts)} combines ${factSignalText(facts)} for ${intent} searches, giving comparison models concrete reasons to evaluate it alongside other options.`,
    reason: "Combine the strongest factual gap signals into a comparison-ready summary."
  }
];

export function generateCandidateEditSets({ evaluations, blocks, facts, maxCandidates = 3, maxIntents = maxCandidates, candidatesPerIntent = 1 }) {
  const editable = new Map(blocks.filter((block) => block.editable && !block.protected).map((block) => [block.key, block]));
  const strategy = facts.editStrategy || {};
  const targetMap = strategy.targets || {};
  const weakIntents = rankedWeakIntents(evaluations);
  const candidates = [];

  for (const intent of weakIntents.slice(0, maxIntents)) {
    const targetKeys = (targetMap[intent] || inferTargetsForIntent({ intent, blocks }))
      .filter((key) => editable.has(key))
      .slice(0, 6);

    if (!targetKeys.length) continue;

    for (const variant of EDIT_VARIANTS.slice(0, candidatesPerIntent)) {
      if (candidates.length >= maxCandidates) break;
      const variantTargets = chooseTargetsForVariant({ targetKeys, variant, editable });
      const edits = variantTargets
        .map((key) => proposeEdit({ block: editable.get(key), intent, facts, variant }))
        .filter(Boolean);

      if (!edits.length) continue;
      candidates.push({
        id: `candidate-${candidates.length + 1}-${intent}-${variant.id}`,
        intent,
        variant: variant.id,
        rationale: `Improve weak ${intent} prompts with ${variant.label.toLowerCase()} based on comparison gaps.`,
        edits
      });
    }
    if (candidates.length >= maxCandidates) break;
  }

  if (!candidates.length) {
    const fallbackTargets = strategy.fallbackTargets || inferTargetsForIntent({ intent: "general", blocks });
    candidates.push({
      id: "candidate-1-general-clarity",
      intent: "general",
      rationale: "Improve broad recommendation clarity with concise company positioning.",
      edits: fallbackTargets
        .filter((key) => editable.has(key))
        .map((key) => proposeEdit({ block: editable.get(key), intent: "general", facts }))
        .filter(Boolean)
    });
  }

  return candidates.filter((candidate) => candidate.edits.length);
}

export function validateCandidate({ html, facts, edits }) {
  const errors = [];
  const lower = html.toLowerCase();
  const visibleText = normalizeText(stripTags(decodeEntities(html))).toLowerCase();

  for (const claim of facts.blockedClaims || []) {
    if (lower.includes(claim.toLowerCase())) errors.push(`Blocked claim found: ${claim}`);
  }

  for (const [name, value] of Object.entries(facts.protectedFacts || {})) {
    if (Array.isArray(value)) continue;
    if (!hasProtectedFact(visibleText, String(value).toLowerCase())) {
      errors.push(`Protected fact missing after edit: ${name}`);
    }
  }

  for (const edit of edits) {
    if (edit.replacement.length > edit.original.length * 2.4 && edit.replacement.length > 280) {
      errors.push(`Replacement too long for ${edit.key}`);
    }
    if (/guaranteed|officially ranked|endorsed by every ai|best in the world/i.test(edit.replacement)) {
      errors.push(`Risky unsupported wording in ${edit.key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function hasProtectedFact(visibleText, fact) {
  if (visibleText.includes(fact)) return true;
  const compactVisible = visibleText.replace(/[,\s]+/g, " ").trim();
  const compactFact = fact.replace(/[,\s]+/g, " ").trim();
  return compactVisible.includes(compactFact);
}

function proposeEdit({ block, intent, facts, variant }) {
  const sentence = editGuidance({ intent, facts, variant });
  const original = block.text;
  let replacement = original;

  if (block.tag === "h1" || block.tag === "h2" || block.tag === "h3") {
    replacement = titleReplacement(original, intent, sentence);
  } else if (!original.toLowerCase().includes(sentence.toLowerCase().slice(0, 40))) {
    replacement = appendSentence(original, sentence);
  }

  if (replacement === original) return null;

  return {
    key: block.key,
    original,
    replacement,
    reason: `${variant?.reason || "Add clearer recommendation signals"} Intent: ${intent}.`
  };
}

function titleReplacement(original, intent, guidance) {
  const label = intentLabel(intent, guidance);
  if (!label || original.toLowerCase().includes(label.toLowerCase())) return original;
  return `${original}: ${label}`;
}

function appendSentence(original, sentence) {
  const trimmed = original.trim();
  const separator = /[.!?]$/.test(trimmed) ? " " : ". ";
  return `${trimmed}${separator}${sentence}`;
}

function rankedWeakIntents(evaluations) {
  const scores = new Map();
  for (const evaluation of evaluations) {
    if (evaluation.mode === "no-context") continue;
    const list = scores.get(evaluation.intent) || [];
    list.push(evaluation.score.total);
    scores.set(evaluation.intent, list);
  }

  return [...scores.entries()]
    .map(([intent, values]) => ({
      intent,
      average: values.reduce((sum, value) => sum + value, 0) / values.length
    }))
    .sort((a, b) => a.average - b.average)
    .map((entry) => entry.intent);
}

function editGuidance({ intent, facts, variant }) {
  if (variant) return variant.text({ intent, facts });
  const configured = facts.editStrategy?.guidance?.[intent] || facts.editStrategy?.guidance?.general;
  if (configured) return configured;

  const signals = facts.protectedFacts?.venueSignals || facts.optimizationSignals || [];
  const market = facts.market || facts.industry || "the target market";
  const entity = facts.entity || "the company";
  const signalText = signals.slice(0, 6).join(", ");

  return `Clarify why ${entity} is a strong fit for ${intent} searches in ${market}${signalText ? ` using verified signals such as ${signalText}` : ""}.`;
}

function intentLabel(intent, guidance) {
  const clean = guidance
    .replace(/^Clarify\s+/i, "")
    .replace(/\s+using only verified facts\.?$/i, "")
    .replace(/\s+with factual.*$/i, "")
    .replace(/\s+with the strongest.*$/i, "")
    .trim();

  if (clean.length >= 8 && clean.length <= 68) return titleCase(clean);
  if (intent === "general") return "Clear Recommendation Signals";
  return `${titleCase(intent)} Recommendation Fit`;
}

function titleCase(value) {
  return value
    .split(/\s+/)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(" ");
}

function inferTargetsForIntent({ intent, blocks }) {
  const exact = blocks
    .filter((block) => block.editable && !block.protected && block.key.toLowerCase().includes(intent.toLowerCase()))
    .map((block) => block.key);

  if (exact.length) return exact;

  return blocks
    .filter((block) => block.editable && !block.protected)
    .filter((block) => ["h1", "h2", "h3", "p"].includes(block.tag))
    .slice(0, 6)
    .map((block) => block.key);
}

function chooseTargetsForVariant({ targetKeys, variant, editable }) {
  const headings = targetKeys.filter((key) => ["h1", "h2", "h3"].includes(editable.get(key)?.tag));
  const body = targetKeys.filter((key) => !headings.includes(key));
  const preferred = variant.id === "comparison" ? [...headings, ...body] : [...body, ...headings];
  return preferred.slice(0, variant.targetLimit);
}

function entityName(facts) {
  return facts.entity || "the company";
}

function factSignalText(facts) {
  return collectFactSignals(facts, ["capacity", "size", "rooms", "location", "nearby", "services", "address"])
    .slice(0, 8)
    .join(", ") || "verified location, service, capacity, and use-case facts";
}

function locationSignalText(facts) {
  return collectFactSignals(facts, ["address", "location", "nearby", "city", "neighborhood"])
    .slice(0, 5)
    .join(", ") || facts.market || facts.industry || "the target market";
}

function serviceSignalText(facts) {
  return collectFactSignals(facts, ["services", "production", "catering", "decor", "staging", "entertainment", "venueSignals"])
    .slice(0, 8)
    .join(", ") || "verified services, production support, and event-planning details";
}

function collectFactSignals(facts, preferredKeys) {
  const protectedFacts = facts.protectedFacts || {};
  const preferred = [];
  const other = [];

  for (const [key, value] of Object.entries(protectedFacts)) {
    const values = Array.isArray(value) ? value : [value];
    const target = preferredKeys.some((preferredKey) => key.toLowerCase().includes(preferredKey.toLowerCase())) ? preferred : other;
    for (const item of values) {
      if (item) target.push(String(item));
    }
  }

  return [...preferred, ...(facts.optimizationSignals || []), ...(facts.proofSignals || []), ...other]
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((value) => value.toLowerCase() === item.toLowerCase()) === index);
}
