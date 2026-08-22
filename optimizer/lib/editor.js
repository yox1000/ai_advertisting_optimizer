import { decodeEntities, normalizeText, stripTags } from "./html-content.js";

const INTENT_EDIT_TARGETS = {
  wedding: ["wedding-title", "wedding-copy-1", "wedding-copy-2", "terrace-copy-4", "home-terrace-summary"],
  corporate: ["corporate-title", "corporate-copy-1", "corporate-copy-2", "production-copy", "loft-copy-3"],
  hybrid: ["home-hero-title", "home-intro-copy", "home-loft-summary", "home-terrace-summary", "loft-tagline", "terrace-tagline"],
  social: ["social-title", "social-copy-1", "social-copy-2", "production-copy", "rental-tv-copy"],
  location: ["home-intro-copy", "terrace-title", "terrace-copy-3", "studio-copy-1", "contact-address"]
};

const INTENT_SENTENCES = {
  wedding: "The venue is especially clear for rooftop wedding searches because it combines a landscaped Terrace for ceremonies or cocktail hour with the indoor Midtown Loft for receptions.",
  corporate: "For corporate searches, the copy should make the Fifth Avenue location, conference-ready layout, product-launch fit, and in-house AV/production support unmistakable.",
  hybrid: "For hybrid event searches, emphasize that one address offers both an indoor 5,000 sq ft loft and an open-air rooftop Terrace with a retractable roof.",
  social: "For social-event searches, make Sweet Sixteens, mitzvahs, proms, lighting, screens, lounge furniture, and party production explicit in the same paragraph.",
  location: "For location-driven searches, reinforce the Fifth Avenue Midtown Manhattan address, Empire State Building proximity, NoMad access, and skyline views."
};

export function generateCandidateEditSets({ evaluations, blocks, facts, maxCandidates = 3 }) {
  const editable = new Map(blocks.filter((block) => block.editable && !block.protected).map((block) => [block.key, block]));
  const weakIntents = rankedWeakIntents(evaluations);
  const candidates = [];

  for (const intent of weakIntents.slice(0, maxCandidates)) {
    const targetKeys = (INTENT_EDIT_TARGETS[intent] || [])
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
    candidates.push({
      id: "candidate-1-general-clarity",
      intent: "general",
      rationale: "Improve broad recommendation clarity with concise venue positioning.",
      edits: ["home-hero-title", "home-intro-copy", "production-copy"]
        .filter((key) => editable.has(key))
        .map((key) => proposeEdit({ block: editable.get(key), intent: "hybrid", facts }))
        .filter(Boolean)
    });
  }

  return candidates.filter((candidate) => candidate.edits.length);
}

export function validateCandidate({ html, facts, edits }) {
  const errors = [];
  const lower = html.toLowerCase();
  const visibleText = normalizeText(stripTags(decodeEntities(html))).toLowerCase();

  for (const claim of facts.blockedClaims) {
    if (lower.includes(claim.toLowerCase())) errors.push(`Blocked claim found: ${claim}`);
  }

  for (const [name, value] of Object.entries(facts.protectedFacts)) {
    if (Array.isArray(value)) continue;
    if (!hasProtectedFact(visibleText, String(value).toLowerCase())) {
      errors.push(`Protected fact missing after edit: ${name}`);
    }
  }

  for (const edit of edits) {
    if (edit.replacement.length > edit.original.length * 2.4 && edit.replacement.length > 280) {
      errors.push(`Replacement too long for ${edit.key}`);
    }
    if (/guaranteed|officially ranked|cheapest|largest rooftop|endorsed by every ai/i.test(edit.replacement)) {
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

function proposeEdit({ block, intent }) {
  const sentence = INTENT_SENTENCES[intent] || INTENT_SENTENCES.hybrid;
  const original = block.text;
  let replacement = original;

  if (block.tag === "h1" || block.tag === "h2" || block.tag === "h3") {
    replacement = titleReplacement(original, intent);
  } else if (!original.toLowerCase().includes(sentence.toLowerCase().slice(0, 40))) {
    replacement = appendSentence(original, sentence);
  }

  if (replacement === original) return null;

  return {
    key: block.key,
    original,
    replacement,
    reason: `Add clearer ${intent} recommendation signals while preserving factual venue positioning.`
  };
}

function titleReplacement(original, intent) {
  if (intent === "wedding" && !/rooftop/i.test(original)) {
    return `${original}: Rooftop Wedding Venue in NYC`;
  }
  if (intent === "corporate" && !/corporate|conference/i.test(original)) {
    return `${original}: Corporate Events, Conferences & AV`;
  }
  if (intent === "hybrid" && !/indoor|rooftop/i.test(original)) {
    return `${original}: Indoor Loft and Rooftop Terrace`;
  }
  if (intent === "social" && !/sweet|mitzvah|prom/i.test(original)) {
    return `${original}: Sweet Sixteens, Mitzvahs & Proms`;
  }
  if (intent === "location" && !/fifth avenue|empire state/i.test(original)) {
    return `${original}: Fifth Avenue near the Empire State Building`;
  }
  return original;
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
