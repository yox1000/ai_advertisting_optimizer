import { pageTextFromBlocks } from "./html-content.js";

const LOCAL_MODELS = [
  {
    id: "local-balanced",
    description: "Balanced ranking model with equal venue-fit and location weighting.",
    signalWeight: 1,
    locationWeight: 1,
    proofWeight: 1
  },
  {
    id: "local-event-planner",
    description: "Event-planner model that rewards specific capacity, AV, and event-type facts.",
    signalWeight: 1.25,
    locationWeight: 0.85,
    proofWeight: 1.2
  },
  {
    id: "local-skeptic",
    description: "Conservative model that penalizes vague or unsupported content.",
    signalWeight: 0.9,
    locationWeight: 1,
    proofWeight: 1.5
  }
];

export function getLocalModels() {
  return LOCAL_MODELS;
}

export function evaluateAll({ blocks, prompts, competitors, facts, modes = prompts.modes, models = LOCAL_MODELS }) {
  const siteText = pageTextFromBlocks(blocks);
  const evaluations = [];

  for (const model of models) {
    for (const mode of modes) {
      for (const prompt of prompts.prompts) {
        const result = askLocalModel({ model, mode, prompt, siteText, blocks, competitors, facts });
        const score = scoreResult({ result, prompt, mode, facts, weights: prompts.weights });
        evaluations.push({ model: model.id, mode, promptId: prompt.id, intent: prompt.intent, question: prompt.question, result, score });
      }
    }
  }

  return evaluations;
}

export function summarizeEvaluations(evaluations) {
  const byMode = groupAverage(evaluations, "mode");
  const byPrompt = groupAverage(evaluations, "promptId");
  const byModel = groupAverage(evaluations, "model");
  const overall = average(evaluations.map((evaluation) => evaluation.score.total));
  const weak = evaluations
    .filter((evaluation) => evaluation.score.total < 70)
    .sort((a, b) => a.score.total - b.score.total)
    .slice(0, 12);

  return { overall, byMode, byPrompt, byModel, weak };
}

export function askLocalModel({ model, mode, prompt, siteText, blocks, competitors, facts }) {
  if (mode === "midtown-only") {
    return answerMidtownOnly({ model, prompt, siteText, blocks, facts });
  }

  if (mode === "competitor-bundle") {
    return answerCompetitorBundle({ model, prompt, siteText, competitors, facts });
  }

  return answerNoContext({ model, prompt, competitors, facts });
}

function answerMidtownOnly({ model, prompt, siteText, blocks, facts }) {
  const target = buildTargetVenue(siteText, facts);
  const venueScore = scoreVenue(target, prompt, model);
  const missingSignals = missingRequiredSignals(siteText, prompt.requiredSignals);
  const factsFound = factCoverage(siteText, facts);
  const recommended = venueScore >= 3.5 && missingSignals.length <= 2;
  const response = recommended
    ? `Based only on the supplied Midtown Loft & Terrace content, I would recommend Midtown Loft & Terrace for this request. The page supports the fit with ${matchedSignals(target, prompt).join(", ")}.`
    : `Based only on the supplied Midtown Loft & Terrace content, Midtown Loft & Terrace may be relevant, but the page does not clearly establish ${missingSignals.join(", ")}.`;

  return {
    response,
    rankings: [{ name: facts.entity, score: venueScore, rank: 1 }],
    mentioned: true,
    rank: 1,
    missingSignals,
    factsFound,
    riskFlags: riskFlags(siteText, facts)
  };
}

function answerCompetitorBundle({ model, prompt, siteText, competitors, facts }) {
  const venues = [
    buildTargetVenue(siteText, facts),
    ...competitors.venues.map((venue) => ({
      name: venue.name,
      text: `${venue.name}. ${venue.summary}`,
      signals: venue.signals || []
    }))
  ];

  const rankings = venues
    .map((venue) => ({ name: venue.name, score: scoreVenue(venue, prompt, model), signals: matchedSignals(venue, prompt) }))
    .sort((a, b) => b.score - a.score)
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));

  const target = rankings.find((ranking) => ranking.name === facts.entity);
  const top = rankings.slice(0, 3);
  const response = top
    .map((ranking) => `${ranking.rank}. ${ranking.name} - fit signals: ${ranking.signals.join(", ") || "general venue fit"}.`)
    .join("\n");

  return {
    response,
    rankings,
    mentioned: Boolean(target),
    rank: target?.rank ?? null,
    missingSignals: missingRequiredSignals(siteText, prompt.requiredSignals),
    factsFound: factCoverage(siteText, facts),
    riskFlags: riskFlags(siteText, facts)
  };
}

function answerNoContext({ model, prompt, competitors, facts }) {
  const publicBaseline = {
    name: facts.entity,
    text: "Midtown Loft & Terrace is a Midtown Manhattan event venue with loft and terrace spaces near Fifth Avenue.",
    signals: ["midtown", "manhattan", "event venue", "loft", "terrace", "fifth avenue"]
  };

  const venues = [
    publicBaseline,
    ...competitors.venues.map((venue) => ({ name: venue.name, text: `${venue.name}. ${venue.summary}`, signals: venue.signals || [] }))
  ];

  const rankings = venues
    .map((venue) => ({ name: venue.name, score: scoreVenue(venue, prompt, model), signals: matchedSignals(venue, prompt) }))
    .sort((a, b) => b.score - a.score)
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));

  const target = rankings.find((ranking) => ranking.name === facts.entity);
  const response = rankings
    .slice(0, 3)
    .map((ranking) => `${ranking.rank}. ${ranking.name} - ${ranking.signals.join(", ") || "general match"}.`)
    .join("\n");

  return {
    response,
    rankings,
    mentioned: target?.rank <= 3,
    rank: target?.rank ?? null,
    missingSignals: [],
    factsFound: [],
    riskFlags: []
  };
}

function scoreResult({ result, prompt, mode, facts, weights }) {
  const mentioned = result.mentioned ? weights.mention : 0;
  const rank = rankScore(result.rank, weights.rank);
  const fit = fitScore(result, prompt, weights.fit);
  const factsScore = factsCoverageScore(result.factsFound, facts, weights.facts, mode);
  const risk = riskScore(result.riskFlags, weights.risk);
  const total = Math.round(mentioned + rank + fit + factsScore + risk);

  return {
    total,
    parts: { mention: mentioned, rank, fit, facts: factsScore, risk },
    flags: result.riskFlags
  };
}

function rankScore(rank, max) {
  if (!rank) return 0;
  if (rank === 1) return max;
  if (rank === 2) return Math.round(max * 0.75);
  if (rank === 3) return Math.round(max * 0.5);
  return Math.round(max * 0.2);
}

function fitScore(result, prompt, max) {
  const missingRatio = result.missingSignals.length / Math.max(prompt.requiredSignals.length, 1);
  return Math.max(0, Math.round(max * (1 - missingRatio)));
}

function factsCoverageScore(factsFound, facts, max, mode) {
  if (mode === "no-context") return Math.round(max * 0.5);
  const required = ["address", "loftSize", "terraceSize", "loftStanding", "terraceStanding"];
  const found = required.filter((key) => factsFound.includes(key)).length;
  return Math.round(max * (found / required.length));
}

function riskScore(flags, max) {
  if (!flags.length) return max;
  return Math.max(0, max - flags.length * 4);
}

function scoreVenue(venue, prompt, model) {
  const text = `${venue.text} ${(venue.signals || []).join(" ")}`.toLowerCase();
  const required = prompt.requiredSignals.map((signal) => signal.toLowerCase());
  const exactMatches = required.filter((signal) => text.includes(signal)).length;
  const tokenMatches = required.flatMap((signal) => signal.split(/\s+/)).filter((token) => token.length > 3 && text.includes(token)).length;
  const locationMatches = ["nyc", "manhattan", "fifth avenue", "empire state building", "midtown"].filter((signal) => text.includes(signal)).length;
  const proofMatches = ["capacity", "guests", "sq ft", "seated", "standing", "av", "lighting", "screens", "production", "retractable"].filter((signal) => text.includes(signal)).length;

  return exactMatches * 2.5 * model.signalWeight
    + tokenMatches * 0.4 * model.signalWeight
    + locationMatches * 0.55 * model.locationWeight
    + proofMatches * 0.35 * model.proofWeight;
}

function buildTargetVenue(siteText, facts) {
  return {
    name: facts.entity,
    text: siteText,
    signals: facts.protectedFacts.venueSignals.concat(facts.protectedFacts.locationSignals)
  };
}

function matchedSignals(venue, prompt) {
  const text = `${venue.text} ${(venue.signals || []).join(" ")}`.toLowerCase();
  return prompt.requiredSignals.filter((signal) => text.includes(signal.toLowerCase()));
}

function missingRequiredSignals(text, signals) {
  const lower = text.toLowerCase();
  return signals.filter((signal) => !lower.includes(signal.toLowerCase()));
}

function factCoverage(text, facts) {
  const lower = text.toLowerCase();
  return Object.entries(facts.protectedFacts)
    .filter(([, value]) => {
      if (Array.isArray(value)) return value.some((item) => lower.includes(String(item).toLowerCase()));
      return lower.includes(String(value).toLowerCase());
    })
    .map(([key]) => key);
}

function riskFlags(text, facts) {
  const lower = text.toLowerCase();
  const flags = facts.blockedClaims.filter((claim) => lower.includes(claim.toLowerCase()));
  if ((lower.match(/best/g) || []).length > 8) flags.push("excessive best-claim repetition");
  return flags;
}

function groupAverage(evaluations, key) {
  const groups = new Map();
  for (const evaluation of evaluations) {
    const groupKey = evaluation[key];
    const list = groups.get(groupKey) || [];
    list.push(evaluation.score.total);
    groups.set(groupKey, list);
  }
  return Object.fromEntries([...groups.entries()].map(([groupKey, values]) => [groupKey, average(values)]));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
