import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractAiBlocks, normalizeText, stripTags, decodeEntities, escapeHtml } from "./html-content.js";

const MAX_HTML_CHARS = 2_000_000;
const MAX_BLOCKS = 90;

export async function importSite({ sourceUrl, entity, market, outputRoot }) {
  const url = validateUrl(sourceUrl);
  const warnings = [];
  const slug = slugify(entity || url.hostname.replace(/^www\./, ""));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(outputRoot, `${slug}-${timestamp}`);

  const response = await fetchWithTimeout(url.href);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    throw new Error(`Could not import site (${response.status}): ${response.statusText}`);
  }
  if (contentType && !contentType.includes("text/html")) {
    warnings.push(`Expected HTML but received content type: ${contentType}`);
  }

  const rawHtml = (await response.text()).slice(0, MAX_HTML_CHARS);
  if (rawHtml.length >= MAX_HTML_CHARS) warnings.push("Source HTML was truncated before distillation.");

  const distilled = distillHtml({ html: rawHtml, sourceUrl: url.href, entity, market, warnings });
  const importedHtml = renderImportedHtml({ ...distilled, sourceUrl: url.href, entity, market });
  const blocks = extractAiBlocks(importedHtml);

  if (!blocks.length) {
    throw new Error("Imported page did not produce any editable content blocks.");
  }
  if (blocks.filter((block) => block.editable).length < 3) {
    warnings.push("Imported page has very few editable text blocks.");
  }

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), importedHtml, "utf8");
  await writeFile(join(dir, "import-report.json"), `${JSON.stringify({
    sourceUrl: url.href,
    entity,
    market,
    generatedAt: new Date().toISOString(),
    blockCount: blocks.length,
    editableBlockCount: blocks.filter((block) => block.editable).length,
    warnings
  }, null, 2)}\n`, "utf8");

  return {
    dir,
    htmlPath: relativeImportedPath(dir, "index.html"),
    reportPath: relativeImportedPath(dir, "import-report.json"),
    blockCount: blocks.length,
    editableBlockCount: blocks.filter((block) => block.editable).length,
    previewText: blocks.slice(0, 8).map((block) => block.text).join("\n"),
    warnings
  };
}

function distillHtml({ html, sourceUrl, entity, market, warnings }) {
  const title = firstText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = firstText(metaContent(html, "description"));
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<button[\s\S]*?<\/button>/gi, " ");

  const blocks = [];
  if (title) blocks.push({ tag: "h1", key: "imported-title", text: title });
  if (description) blocks.push({ tag: "p", key: "imported-description", text: description });

  const seen = new Set(blocks.map((block) => canonicalText(block.text)));
  const keyCounts = { heading: 0, copy: 0, "list-item": 0, quote: 0 };
  const contentRe = /<(h1|h2|h3|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = contentRe.exec(cleaned)) && blocks.length < MAX_BLOCKS) {
    const sourceTag = match[1].toLowerCase();
    const text = firstText(match[2]);
    if (!usefulText(text, sourceTag)) continue;

    const canonical = canonicalText(text);
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    const tag = sourceTag === "li" ? "p" : sourceTag;
    const prefix = sourceTag === "li" ? "list-item" : sourceTag === "blockquote" ? "quote" : sourceTag === "p" ? "copy" : "heading";
    keyCounts[prefix] += 1;
    blocks.push({
      tag,
      key: `imported-${prefix}-${keyCounts[prefix]}`,
      text
    });
  }

  if (!blocks.length) {
    const fallback = firstText(cleaned);
    if (fallback) blocks.push({ tag: "p", key: "imported-copy-1", text: fallback.slice(0, 800) });
  }
  if (blocks.length >= MAX_BLOCKS) warnings.push(`Imported content was limited to ${MAX_BLOCKS} blocks.`);

  return {
    title: title || entity || "Imported Website",
    description,
    blocks,
    sourceUrl,
    entity,
    market
  };
}

function renderImportedHtml({ title, description, blocks, sourceUrl, entity, market }) {
  const body = blocks.map((block) => {
    const tag = ["h1", "h2", "h3", "p", "blockquote"].includes(block.tag) ? block.tag : "p";
    return `          <${tag} data-ai-key="${block.key}">${escapeHtml(block.text)}</${tag}>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description || `Imported content for ${entity || sourceUrl}`)}">
    <style>
      body { margin: 0; font-family: Arial, sans-serif; color: #20242a; background: #eef1f4; line-height: 1.6; }
      main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 42px 0; }
      section { background: #fff; border: 1px solid #cfd6dd; padding: 28px; }
      h1, h2, h3 { line-height: 1.15; margin: 0 0 16px; }
      p, blockquote { margin: 0 0 14px; }
      .meta { color: #646d78; font-size: 13px; margin-bottom: 24px; }
    </style>
  </head>
  <body>
    <main>
      <p class="meta">Imported from ${escapeHtml(sourceUrl)}${market ? ` for ${escapeHtml(market)}` : ""}</p>
      <section aria-label="${escapeHtml(entity || "Imported website")} distilled content">
${body}
      </section>
    </main>
  </body>
</html>
`;
}

function metaContent(html, name) {
  const re = new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${escapeRegExp(name)}["'])[^>]*content=["']([^"']*)["'][^>]*>`, "i");
  return html.match(re)?.[1] || "";
}

function firstText(value) {
  return normalizeText(stripTags(decodeEntities(String(value || ""))));
}

function usefulText(text, tag) {
  if (!text) return false;
  if (text.length < 18 && !/^h[1-3]$/.test(tag)) return false;
  if (text.length > 1200) return false;
  if (/^(menu|close|open|next|previous|submit|learn more|read more)$/i.test(text)) return false;
  const letters = (text.match(/[a-z]/gi) || []).length;
  return letters >= Math.min(8, text.length);
}

function canonicalText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AI-Recommendation-Optimizer/0.1 (+local import tool)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Import request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid website URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Website URL must start with http:// or https://.");
  }
  return url;
}

function relativeImportedPath(dir, fileName) {
  return join("optimizer", "imported-sites", dir.split("/").at(-1), fileName);
}

function slugify(value) {
  return String(value || "imported-site")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "imported-site";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
