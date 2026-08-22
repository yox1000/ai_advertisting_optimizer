import { decodeEntities, normalizeText, stripTags } from "./html-content.js";

export function generateCandidateEditSets({ evaluations, blocks, facts, maxCandidates = 3 }) {
  const editable = new Map(blocks.filter((block) => block.editable && !block.protected).map((block) => [block.key, block]));
  const strategy = facts.editStrategy || {};
  const targetMap = strategy.targets || {};
  const weakIntents = rankedWeakIntents(evaluations);
  const candidates = [];

  for (const intent of weakIntents.slice(0, maxCandidates)) {
    const targetKeys = (targetMap[intent] || inferTargetsForIntent({ intent, blocks }))
      .filter((key) => editable.has(key))
      .slice(0, 4);

    if (!targetKeys.length) continue;

    const edits = targetKeys
      .map((key) => proposeEdit({ block: editable.get(key), intent, facts }))
      .filter(Boolean);

    if (edits.length) {
      candidates.push({
        id: `candidate-${candidates.length + 1}-${intent}`,
        intent,
        rationale: `Improve weak ${intent} prompts with clearer factual signals.`,
        edits
      });
    }
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

function proposeEdit({ block, intent, facts }) {
  const sentence = editGuidance({ intent, facts });
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
    reason: `Add clearer ${intent} recommendation signals while preserving factual company positioning.`
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

function editGuidance({ intent, facts }) {
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
