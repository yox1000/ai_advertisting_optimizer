# Optimizer Code Rundown

This is the plain-English rundown of the AI optimization code.

The site now has a small "AI optimization lab" around it. It can run a repeatable local simulation by default, and it can call real OpenAI/DeepSeek models when API keys are provided through local environment variables.

## Main Pieces

### `index.html`

This is the target company's site content. The checked-in demo currently uses Midtown Loft & Terrace, but the optimizer is meant to work for any company. The important part is that many text blocks have `data-ai-key`, like:

```html
<p data-ai-key="wedding-copy-1">...</p>
```

Those keys let the optimizer know which exact pieces of copy it is allowed to inspect or potentially edit later.

### `content-map.json`

This is generated from `index.html`. It lists every `data-ai-key`, its text, category, and whether it is editable or protected.

Protected means facts like address, phone number, pricing, capacities, product specs, service areas, or other claims the optimizer should not casually rewrite.

### `prompt-suite.json`

This stores the test questions we care about, such as:

```text
What are the best companies for [target use case] in [target market]?
```

Each prompt also has intent labels like `wedding`, `corporate`, `social`, or `location`.

### `competitors.json`

This contains neutral sample competitor profiles. The optimizer uses these for the fair comparison mode, where the target company is compared against other options.

### `facts.json`

This stores protected facts for the target company:

- address
- phone/email
- product/service specs
- capacity or pricing facts, if relevant
- location signals
- blocked risky claims

This is the safety file.

## Optimizer Scripts

### `optimizer/extract-content.js`

Reads `index.html`, finds every `data-ai-key`, and writes `content-map.json`.

Run it with:

```bash
npm run extract:content
```

### `optimizer/run.js`

This is the main loop.

It does this:

1. Reads the current website.
2. Extracts all editable content blocks.
3. Runs the three test modes.
4. Scores the results.
5. Generates possible copy edits.
6. Tests those edited versions.
7. Accepts only edits that improve the right score without breaking protected facts.
8. Writes a report.

Run it with:

```bash
npm run optimize -- --iterations=3
```

## The Three Test Modes

### No-context

Pretends the model is answering normally without seeing our local site content. This is closest to public AI behavior, but local edits usually will not affect it.

### Competitor-bundle

Compares the target company against neutral competitor profiles. This is the most useful local test because it checks whether the target company's content wins fairly.

### Target-only

Feeds only the target company's content. This is biased, but useful for checking whether the site clearly explains what the company offers.

## Helper Libraries

### `optimizer/lib/html-content.js`

Handles reading the HTML and extracting editable text from `data-ai-key` elements.

### `optimizer/lib/evaluator.js`

Scores how well the target company performs in the three modes. By default it uses deterministic local "model stand-ins" so we can test the loop without API cost.

### `optimizer/lib/model-providers.js`

Calls real model APIs when requested. It currently supports:

- OpenAI through `OPENAI_API_KEY`
- DeepSeek through `DEEPSEEK_API_KEY`

Run real providers with:

```bash
npm run optimize -- --providers=openai --iterations=1
npm run optimize -- --providers=openai,deepseek --iterations=1
```

The keys belong in a local `.env` file, not in git.

### `optimizer/lib/editor.js`

Suggests copy edits when a prompt category is weak. It also validates that edits do not remove protected facts or add risky unsupported claims.

## Run Outputs

Every optimizer run creates a timestamped folder under:

```text
optimizer/runs/
```

Each run can include:

- `report.md`
- `report.json`
- candidate edited HTML files
- `best-candidate.html`, only if an edit is accepted

Reports show whether the current content already scores well, which weak prompts remain, and whether any candidate edit was accepted.

## Summary

We built the skeleton of the recursive optimization system. It can extract content, test prompts in three modes, score results, propose edits, reject unsafe edits, and produce reports.

The next major step is adding more real providers and replacing sample competitor profiles with sourced competitor content.
