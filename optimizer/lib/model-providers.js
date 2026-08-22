import { pageTextFromBlocks } from "./html-content.js";
import { requireEnv } from "./env.js";
import { resultFromModelResponse, scoreResult, summarizeEvaluations } from "./evaluator.js";

const PROVIDERS = {
  openai: {
    env: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-5.6",
    kind: "responses",
    url: "https://api.openai.com/v1/responses"
  },
  deepseek: {
    env: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    kind: "chat-completions",
    url: "https://api.deepseek.com/chat/completions"
  }
};

export function parseProviderNames(value) {
  if (!value || value === "local") return [];
  return value.split(",").map((name) => name.trim()).filter(Boolean);
}

export async function evaluateWithProviders({ providerNames, blocks, prompts, competitors, facts, modes = prompts.modes, onProgress }) {
  const siteText = pageTextFromBlocks(blocks);
  const evaluations = [];
  const total = providerNames.length * modes.length * prompts.prompts.length;
  let completed = 0;

  for (const providerName of providerNames) {
    const provider = resolveProvider(providerName);

    for (const mode of modes) {
      for (const prompt of prompts.prompts) {
        onProgress?.({
          type: "start",
          completed,
          total,
          provider: providerName,
          model: provider.model,
          mode,
          promptId: prompt.id
        });
        const input = buildModePrompt({ mode, prompt, siteText, competitors, facts });
        const response = await callProvider({ provider, input });
        const result = resultFromModelResponse({ response, prompt, mode, siteText, facts });
        const score = scoreResult({ result, prompt, mode, facts, weights: prompts.weights });
        completed += 1;

        evaluations.push({
          model: `${providerName}:${provider.model}`,
          mode,
          promptId: prompt.id,
          intent: prompt.intent,
          question: prompt.question,
          result,
          score
        });
        onProgress?.({
          type: "finish",
          completed,
          total,
          provider: providerName,
          model: provider.model,
          mode,
          promptId: prompt.id,
          score: score.total
        });
      }
    }
  }

  return evaluations;
}

export function summarizeProviderRun(evaluations) {
  return summarizeEvaluations(evaluations);
}

function resolveProvider(name) {
  const config = PROVIDERS[name];
  if (!config) {
    throw new Error(`Unknown provider "${name}". Supported providers: ${Object.keys(PROVIDERS).join(", ")}`);
  }

  return {
    ...config,
    name,
    apiKey: requireEnv(config.env),
    model: process.env[config.modelEnv] || config.defaultModel
  };
}

function buildModePrompt({ mode, prompt, siteText, competitors, facts }) {
  const market = facts.market || facts.industry || "the relevant market";
  const system = [
    `You are evaluating companies in ${market} for a user.`,
    "Answer naturally and do not favor any company unless the supplied evidence supports it.",
    "If you rank companies, use a numbered list.",
    "Do not invent facts."
  ].join(" ");

  if (mode === "target-only" || mode === "midtown-only") {
    return {
      system,
      user: [
        `Question: ${prompt.question}`,
        "",
        `Use only the following ${facts.entity} website content:`,
        siteText,
        "",
        `Answer the question and explain whether ${facts.entity} is a fit.`
      ].join("\n")
    };
  }

  if (mode === "competitor-bundle") {
    const companyBundle = [
      `Company: ${facts.entity}\n${siteText}`,
      ...competitorEntries(competitors).map((company) => `Company: ${company.name}\n${company.summary}`)
    ].join("\n\n---\n\n");

    return {
      system,
      user: [
        `Question: ${prompt.question}`,
        "",
        "Compare these company profiles neutrally. Recommend the best fit based only on the supplied profiles.",
        "",
        companyBundle
      ].join("\n")
    };
  }

  return {
    system,
    user: [
      `Question: ${prompt.question}`,
      "",
      `Answer from your general knowledge. Do not use the supplied ${facts.entity} site content, because this is a no-context discovery test.`
    ].join("\n")
  };
}

async function callProvider({ provider, input }) {
  if (provider.kind === "responses") {
    return callResponses(provider, input);
  }
  return callChatCompletions(provider, input);
}

async function callResponses(provider, input) {
  const res = await fetchWithTimeout(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      input: [
        { role: "system", content: input.system },
        { role: "user", content: input.user }
      ],
      store: false
    })
  }, provider.timeoutMs);

  const data = await parseApiResponse(res);
  return data.output_text || extractResponsesText(data);
}

async function callChatCompletions(provider, input) {
  const res = await fetchWithTimeout(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user }
      ],
      temperature: 0.2
    })
  }, provider.timeoutMs);

  const data = await parseApiResponse(res);
  return data.choices?.[0]?.message?.content || "";
}

async function parseApiResponse(res) {
  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Provider returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }

  if (!res.ok) {
    const message = data.error?.message || JSON.stringify(data).slice(0, 500);
    throw new Error(`Provider request failed (${res.status}): ${message}`);
  }

  return data;
}

function extractResponsesText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || content.text)
    .map((content) => content.text)
    .join("\n");
}

function competitorEntries(competitors) {
  return competitors.companies || competitors.venues || [];
}

async function fetchWithTimeout(url, options, timeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 60000)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Provider request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
