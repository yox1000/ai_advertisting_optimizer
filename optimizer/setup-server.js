import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { discoverOptionsFromPrompts } from "./lib/discovery.js";
import { loadDotEnv } from "./lib/env.js";

const port = Number(process.env.PORT || 8090);
const root = resolve(".");
const outputRoot = join(root, "optimizer", "generated-setups");

loadDotEnv();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/setups") {
      await handleSaveSetup(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/discover-options") {
      await handleDiscoverOptions(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    console.error(`If the setup page is already running, open http://localhost:${port}/setup.html`);
    console.error(`Otherwise run it on another port: PORT=${port + 1} npm run setup`);
    process.exit(1);
  }

  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Setup page: http://localhost:${port}/setup.html`);
});

async function handleSaveSetup(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  validatePayload(payload);

  const slug = slugify(payload.slug || payload.facts.entity || "setup");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(outputRoot, `${slug}-${timestamp}`);

  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, "facts.json"), payload.facts);
  await writeJson(join(dir, "prompt-suite.json"), payload.prompts);
  await writeJson(join(dir, "competitors.json"), payload.competitors);
  await writeJson(join(dir, "setup.json"), {
    sourceUrl: payload.sourceUrl,
    runOptions: payload.runOptions,
    createdAt: new Date().toISOString()
  });

  const runCommand = buildRunCommand({ dir, payload });
  await writeFile(join(dir, "run-command.txt"), `${runCommand}\n`, "utf8");

  sendJson(res, 200, {
    ok: true,
    dir,
    files: ["facts.json", "prompt-suite.json", "competitors.json", "setup.json", "run-command.txt"],
    runCommand
  });
}

async function handleDiscoverOptions(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  const providerNames = (payload.runOptions?.providers || []).filter((provider) => provider !== "local");

  if (!providerNames.length) {
    sendJson(res, 400, { error: "Select OpenAI or DeepSeek to discover options from real model answers." });
    return;
  }

  validatePayload(payload);

  const progress = [];
  const options = await discoverOptionsFromPrompts({
    providerNames,
    prompts: payload.prompts,
    facts: payload.facts,
    maxOptions: Number(payload.maxOptions || 12),
    onProgress: (event) => {
      progress.push(event);
      if (event.type === "start") {
        console.log(`[discover] [${event.completed + 1}/${event.total}] ${event.provider} ${event.promptId}`);
        return;
      }
      console.log(`[discover] [${event.completed}/${event.total}] done ${event.provider} ${event.promptId}: ${event.options.join(", ")}`);
    }
  });

  sendJson(res, 200, { ok: true, options, progress });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const requested = url.pathname === "/" ? "/setup.html" : url.pathname;
  const filePath = resolve(root, `.${requested}`);

  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const data = await readFile(filePath);
  res.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
  res.end(data);
}

function buildRunCommand({ dir, payload }) {
  const providers = payload.runOptions.providers.length ? payload.runOptions.providers.join(",") : "local";
  const args = [
    "node optimizer/run.js",
    "--html=index.html",
    `--facts=${relativePath(dir, "facts.json")}`,
    `--prompts=${relativePath(dir, "prompt-suite.json")}`,
    `--competitors=${relativePath(dir, "competitors.json")}`,
    `--providers=${providers}`,
    `--iterations=${payload.runOptions.iterations}`,
    `--max-candidates=${payload.runOptions.maxCandidates}`,
    payload.runOptions.evaluateCandidates ? "" : "--evaluate-candidates=false",
    payload.sourceUrl ? `--source-url=${shellArg(payload.sourceUrl)}` : ""
  ].filter(Boolean);

  return args.join(" ");
}

function relativePath(dir, fileName) {
  return join("optimizer", "generated-setups", dir.split("/").at(-1), fileName);
}

function validatePayload(payload) {
  if (!payload.sourceUrl) throw new Error("Website URL is required.");
  if (!payload.facts?.entity) throw new Error("Target company name is required.");
  if (!Array.isArray(payload.prompts?.prompts) || payload.prompts.prompts.length < 1) {
    throw new Error("At least one prompt is required.");
  }
  const incomplete = payload.prompts.prompts.find((prompt) => !prompt.intent || !prompt.question);
  if (incomplete) {
    throw new Error("Each prompt needs an intent and a question.");
  }
  if (!Array.isArray(payload.runOptions?.providers)) throw new Error("Providers are required.");
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "setup";
}

function shellArg(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
