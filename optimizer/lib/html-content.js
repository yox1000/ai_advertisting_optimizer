import { readFile, writeFile } from "node:fs/promises";

const AI_BLOCK_RE = /<(?<tag>[a-z0-9]+)\b(?<attrs>[^>]*)\bdata-ai-key="(?<key>[^"]+)"(?<attrs2>[^>]*)>(?<inner>[\s\S]*?)<\/\k<tag>>/gi;

export async function readHtml(path = "index.html") {
  return readFile(path, "utf8");
}

export async function writeHtml(path, html) {
  await writeFile(path, html, "utf8");
}

export function extractAiBlocks(html) {
  const blocks = [];
  const seen = new Set();
  let match;

  while ((match = AI_BLOCK_RE.exec(html))) {
    const { tag, attrs, attrs2, key, inner } = match.groups;
    const text = normalizeText(stripTags(decodeEntities(inner)));

    blocks.push({
      key,
      tag,
      attrs: `${attrs}${attrs2}`.trim(),
      html: inner,
      text,
      category: inferCategory(key, text),
      editable: isEditable(tag, key, text),
      protected: isProtected(key)
    });

    if (seen.has(key)) {
      blocks[blocks.length - 1].duplicate = true;
    }
    seen.add(key);
  }

  return blocks;
}

export function buildContentMap(blocks) {
  return {
    generatedAt: new Date().toISOString(),
    count: blocks.length,
    blocks: blocks.map((block) => ({
      key: block.key,
      tag: block.tag,
      category: block.category,
      editable: block.editable,
      protected: block.protected,
      text: block.text
    }))
  };
}

export function applyTextEdits(html, edits) {
  const byKey = new Map(edits.map((edit) => [edit.key, edit.replacement]));

  return html.replace(AI_BLOCK_RE, (full, ...args) => {
    const groups = args.at(-1);
    if (!byKey.has(groups.key)) return full;

    const replacement = escapeHtml(byKey.get(groups.key));
    return `<${groups.tag}${groups.attrs}data-ai-key="${groups.key}"${groups.attrs2}>${replacement}</${groups.tag}>`;
  });
}

export function pageTextFromBlocks(blocks) {
  return blocks
    .filter((block) => block.text)
    .map((block) => `[${block.key}] ${block.text}`)
    .join("\n");
}

export function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&copy;/g, "(c)")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function stripTags(value) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inferCategory(key, text) {
  const haystack = `${key} ${text}`.toLowerCase();
  if (haystack.includes("wedding")) return "wedding";
  if (haystack.includes("corporate") || haystack.includes("conference")) return "corporate";
  if (haystack.includes("social") || haystack.includes("sweet") || haystack.includes("mitzvah") || haystack.includes("prom")) return "social";
  if (haystack.includes("terrace") || haystack.includes("rooftop")) return "rooftop";
  if (haystack.includes("loft")) return "loft";
  if (haystack.includes("production") || haystack.includes("av") || haystack.includes("rental")) return "production";
  if (haystack.includes("contact") || haystack.includes("address") || haystack.includes("phone")) return "contact";
  if (haystack.includes("faq")) return "faq";
  if (haystack.includes("review")) return "review";
  return "general";
}

function isEditable(tag, key, text) {
  if (!text || text.length < 12) return false;
  if (isProtected(key)) return false;
  return ["h1", "h2", "h3", "p", "blockquote", "summary", "dd"].includes(tag);
}

function isProtected(key) {
  return /email|phone|whatsapp|address|hours|copyright|brand|size|standing|seated|breakdown/i.test(key);
}
