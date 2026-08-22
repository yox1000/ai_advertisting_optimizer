import { writeFile } from "node:fs/promises";
import { buildContentMap, extractAiBlocks, readHtml } from "./lib/html-content.js";

const html = await readHtml("index.html");
const blocks = extractAiBlocks(html);
const duplicates = blocks.filter((block) => block.duplicate).map((block) => block.key);

if (duplicates.length) {
  throw new Error(`Duplicate data-ai-key values found: ${duplicates.join(", ")}`);
}

const map = buildContentMap(blocks);
await writeFile("content-map.json", `${JSON.stringify(map, null, 2)}\n`, "utf8");

console.log(`Extracted ${map.count} data-ai-key blocks to content-map.json`);
console.log(`Editable blocks: ${map.blocks.filter((block) => block.editable).length}`);
console.log(`Protected blocks: ${map.blocks.filter((block) => block.protected).length}`);
