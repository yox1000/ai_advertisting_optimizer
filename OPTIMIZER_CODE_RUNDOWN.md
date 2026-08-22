# Optimizer Code Rundown

This is the plain-English rundown of the AI optimization code.

The site now has a small "AI optimization lab" around it. It does not call real AI models yet. It runs a repeatable local simulation that lets us test the idea safely before plugging in paid APIs.

## Main Pieces

### `index.html`

This is the Midtown site content. The important part is that many text blocks have `data-ai-key`, like:

```html
<p data-ai-key="wedding-copy-1">...</p>
```

Those keys let the optimizer know which exact pieces of copy it is allowed to inspect or potentially edit later.

### `content-map.json`

This is generated from `index.html`. It lists every `data-ai-key`, its text, category, and whether it is editable or protected.

Protected means things like address, phone number, capacities, venue size, etc. The optimizer should not casually rewrite those.

### `prompt-suite.json`

This stores the test questions we care about, such as:

```text
What are the best rooftop wedding venues in NYC for about 100 guests?
```

Each prompt also has intent labels like `wedding`, `corporate`, `social`, or `location`.

### `competitors.json`

This contains neutral sample competitor venue profiles. The optimizer uses these for the fair comparison mode, where Midtown is compared against other venue-like options.

### `facts.json`

This stores protected Midtown facts:

- address
- phone/email
- Loft size and capacity
- Terrace size and capacity
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

Compares Midtown against neutral competitor profiles. This is the most useful local test because it checks whether Midtown content wins fairly.

### Midtown-only

Feeds only Midtown content. This is biased, but useful for checking whether the site clearly explains what Midtown offers.

## Helper Libraries

### `optimizer/lib/html-content.js`

Handles reading the HTML and extracting editable text from `data-ai-key` elements.

### `optimizer/lib/evaluator.js`

Scores how well Midtown performs in the three modes. Right now it uses deterministic local "model stand-ins," not actual GPT/Claude/Gemini calls.

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

The latest report showed that Midtown already scored well in the local competitor test, so no candidate edit was accepted.

## Summary

We built the skeleton of the recursive optimization system. It can extract content, test prompts in three modes, score results, propose edits, reject unsafe edits, and produce reports.

The next major step is plugging in real model APIs.
