import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDotEnv } from "./lib/env.js";
import { applyTextEdits, buildContentMap, extractAiBlocks, readHtml } from "./lib/html-content.js";
import { evaluateAll, summarizeEvaluations } from "./lib/evaluator.js";
import { generateCandidateEditSets, validateCandidate } from "./lib/editor.js";
import { evaluateWithProviders, parseProviderNames } from "./lib/model-providers.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join("optimizer", "runs", runId);
const htmlPath = getArgValue("--html") || "index.html";
const factsPath = getArgValue("--facts") || "facts.json";
const promptsPath = getArgValue("--prompts") || "prompt-suite.json";
const competitorsPath = getArgValue("--competitors") || "competitors.json";
const maxIterations = Number(getArgValue("--iterations") || 3);
const providerNames = parseProviderNames(getArgValue("--providers") || "local");
const usingRealProviders = providerNames.length > 0;
const evaluateCandidates = getArgValue("--evaluate-candidates") !== "false";
const maxCandidates = Number(getArgValue("--max-candidates") || 3);

loadDotEnv();

const facts = await readJson(factsPath);
const prompts = await readJson(promptsPath);
const competitors = await readJson(competitorsPath);
const sourceUrl = getArgValue("--source-url") || facts.sourceUrl || null;

await mkdir(runDir, { recursive: true });

const initialHtml = await readHtml(htmlPath);
const initialBlocks = extractAiBlocks(initialHtml);
assertUniqueKeys(initialBlocks);

const contentMap = buildContentMap(initialBlocks);
await writeFile("content-map.json", `${JSON.stringify(contentMap, null, 2)}\n`, "utf8");

let workingHtml = initialHtml;
let finalSummary = null;
const iterations = [];

for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
  const workingBlocks = extractAiBlocks(workingHtml);
  const baselineEvaluations = await evaluateCurrent({ blocks: workingBlocks, phase: `iteration ${iteration} baseline` });
  const baselineSummary = summarizeEvaluations(baselineEvaluations);
  if (!evaluateCandidates) {
    iterations.push({
      iteration,
      baseline: baselineSummary,
      accepted: null,
      candidates: []
    });
    finalSummary = baselineSummary;
    break;
  }
  const candidateSets = generateCandidateEditSets({ evaluations: baselineEvaluations, blocks: workingBlocks, facts, maxCandidates });
  const candidateReports = [];

  for (const candidate of candidateSets) {
    console.log(`Scoring ${candidate.id}: ${candidate.intent}`);
    const candidateHtml = applyTextEdits(workingHtml, candidate.edits);
    const validation = validateCandidate({ html: candidateHtml, facts, edits: candidate.edits });
    const candidateBlocks = extractAiBlocks(candidateHtml);
    const evaluations = validation.valid
      ? await evaluateCurrent({ blocks: candidateBlocks, phase: `iteration ${iteration} ${candidate.id}` })
      : [];
    const summary = validation.valid ? summarizeEvaluations(evaluations) : null;
    const decision = decideCandidate({ baselineSummary, summary, validation });

    const fileName = `iteration-${iteration}-${candidate.id}.html`;
    await writeFile(join(runDir, fileName), candidateHtml, "utf8");

    candidateReports.push({
      ...candidate,
      fileName,
      validation,
      summary,
      decision,
      html: candidateHtml
    });
  }

  const accepted = candidateReports
    .filter((candidate) => candidate.decision.accept)
    .sort((a, b) => b.decision.delta - a.decision.delta)[0] || null;

  iterations.push({
    iteration,
    baseline: baselineSummary,
    accepted: accepted ? {
      id: accepted.id,
      fileName: accepted.fileName,
      intent: accepted.intent,
      delta: accepted.decision.delta,
      reason: accepted.decision.reason,
      edits: accepted.edits
    } : null,
    candidates: candidateReports.map(({ html, ...candidate }) => candidate)
  });

  finalSummary = accepted?.summary || baselineSummary;

  if (!accepted) break;
  workingHtml = accepted.html;
}

if (workingHtml !== initialHtml) {
  await writeFile(join(runDir, "best-candidate.html"), workingHtml, "utf8");
}

const report = {
  runId,
  generatedAt: new Date().toISOString(),
  target: facts.entity,
  sourceUrl,
  htmlPath,
  factsPath,
  promptsPath,
  competitorsPath,
  modes: prompts.modes,
  providers: usingRealProviders ? providerNames : ["local"],
  models: usingRealProviders ? providerNames : ["local-balanced", "local-event-planner", "local-skeptic"],
  maxIterations,
  evaluateCandidates,
  maxCandidates,
  initialBaseline: iterations[0]?.baseline || null,
  finalSummary,
  iterations
};

await writeFile(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(runDir, "report.md"), renderMarkdown(report), "utf8");

console.log(`Run: ${runId}`);
console.log(`Target: ${facts.entity}`);
if (sourceUrl) console.log(`Source URL: ${sourceUrl}`);
console.log(`Initial overall: ${report.initialBaseline?.overall ?? "n/a"}`);
console.log(`Initial by mode: ${formatModeScores(report.initialBaseline?.byMode || {})}`);
console.log(`Providers: ${report.providers.join(", ")}`);
console.log(`Evaluate candidates: ${evaluateCandidates ? "yes" : "no"}`);
console.log(`Max candidates: ${maxCandidates}`);
console.log(`Iterations completed: ${iterations.length}`);
console.log(`Accepted candidates: ${iterations.filter((iteration) => iteration.accepted).length}`);
console.log(`Final overall: ${finalSummary?.overall ?? "n/a"}`);
console.log(`Report: ${join(runDir, "report.md")}`);

function decideCandidate({ baselineSummary, summary, validation }) {
  if (!validation.valid || !summary) {
    return {
      accept: false,
      delta: -Infinity,
      reason: validation.errors.join("; ") || "Candidate did not produce a score."
    };
  }

  const competitorDelta = (summary.byMode["competitor-bundle"] || 0) - (baselineSummary.byMode["competitor-bundle"] || 0);
  const clarityDelta = modeScore(summary, "target-only", "midtown-only") - modeScore(baselineSummary, "target-only", "midtown-only");
  const noContextDelta = (summary.byMode["no-context"] || 0) - (baselineSummary.byMode["no-context"] || 0);
  const totalDelta = summary.overall - baselineSummary.overall;
  const accept = competitorDelta > 0 && clarityDelta >= -2 && noContextDelta >= -2 && totalDelta >= 0;

  return {
    accept,
    delta: totalDelta,
    competitorDelta,
    clarityDelta,
    noContextDelta,
    reason: accept
      ? "Improved neutral competitor-bundle score without clarity or no-context regression."
      : "Did not improve the required neutral competitor-bundle score safely."
  };
}

async function evaluateCurrent({ blocks, phase }) {
  if (usingRealProviders) {
    return evaluateWithProviders({ providerNames, blocks, prompts, competitors, facts, onProgress: (event) => logProviderProgress(event, phase) });
  }
  return evaluateAll({ blocks, prompts, competitors, facts });
}

function assertUniqueKeys(blocks) {
  const seen = new Set();
  const duplicates = [];
  for (const block of blocks) {
    if (seen.has(block.key)) duplicates.push(block.key);
    seen.add(block.key);
  }
  if (duplicates.length) {
    throw new Error(`Duplicate data-ai-key values found: ${duplicates.join(", ")}`);
  }
}

function modeScore(summary, primary, fallback) {
  return summary.byMode[primary] ?? summary.byMode[fallback] ?? 0;
}

function renderMarkdown(report) {
  const weak = report.initialBaseline.weak
    .map((item) => `- ${item.mode} / ${item.model} / ${item.promptId}: ${item.score.total}`)
    .join("\n");
  const iterationSections = report.iterations.map((iteration) => renderIteration(iteration)).join("\n\n");

  return `# AI Recommendation Optimization Run ${report.runId}

Target: ${report.target}

${report.sourceUrl ? `Source URL: ${report.sourceUrl}\n` : ""}

Modes: ${report.modes.join(", ")}

Providers: ${report.providers.join(", ")}

Max iterations: ${report.maxIterations}

Evaluate candidates: ${report.evaluateCandidates ? "yes" : "no"}

Max candidates: ${report.maxCandidates}

## Initial Baseline

Overall: ${report.initialBaseline.overall}

By mode: ${formatModeScores(report.initialBaseline.byMode)}

By model: ${formatModeScores(report.initialBaseline.byModel)}

Weakest checks:
${weak}

## Final

Overall: ${report.finalSummary.overall}

By mode: ${formatModeScores(report.finalSummary.byMode)}

Best candidate file: ${report.iterations.some((iteration) => iteration.accepted) ? "`best-candidate.html`" : "none"}

## Iterations

${iterationSections}
`;
}

function formatModeScores(scores) {
  return Object.entries(scores)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
}

function renderIteration(iteration) {
  const accepted = iteration.accepted
    ? `Accepted: ${iteration.accepted.id} (${iteration.accepted.delta >= 0 ? "+" : ""}${iteration.accepted.delta})\n\nCandidate file: \`${iteration.accepted.fileName}\`\n\nReason: ${iteration.accepted.reason}`
    : "Accepted: none";
  const candidates = iteration.candidates.map((candidate) => {
    const scoreLine = candidate.summary
      ? `overall ${candidate.summary.overall}; modes ${formatModeScores(candidate.summary.byMode)}`
      : "not scored";
    const edits = candidate.edits.map((edit) => `- \`${edit.key}\`: ${edit.reason}`).join("\n");
    return `#### ${candidate.id}\nDecision: ${candidate.decision.accept ? "accepted" : "rejected"}\n\nScore: ${scoreLine}\n\nReason: ${candidate.decision.reason}\n\nEdits:\n${edits}`;
  }).join("\n\n");

  return `### Iteration ${iteration.iteration}

Baseline: overall ${iteration.baseline.overall}; modes ${formatModeScores(iteration.baseline.byMode)}

${accepted}

${candidates}`;
}

function getArgValue(name) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!exact) return null;
  return exact.slice(name.length + 1);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function logProviderProgress(event, phase) {
  const prefix = phase ? `[${phase}] ` : "";
  if (event.type === "start") {
    console.log(`${prefix}[${event.completed + 1}/${event.total}] ${event.provider}:${event.model} ${event.mode} ${event.promptId}`);
    return;
  }
  console.log(`${prefix}[${event.completed}/${event.total}] done ${event.provider}:${event.model} ${event.mode} ${event.promptId} score=${event.score}`);
}
