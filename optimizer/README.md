# AI Recommendation Optimizer

This harness evaluates whether a company's website content is easy for AI systems to understand and recommend. Midtown Loft & Terrace is the current example configuration, not a hardcoded requirement.

It separates three test modes:

- `no-context`: asks prompts without supplying the local website content. This is a baseline tracking signal; local edits should not be expected to change it immediately.
- `competitor-bundle`: compares the target company content against neutral competitor profiles. This is the main local optimization signal because it avoids directly telling the model to favor the target company.
- `target-only`: supplies only the target company's content. This is useful for content clarity, but it is biased and should not be treated as public recommendation lift.

## Configure A Client

To adapt the harness to another company:

- Put the company's static page in `index.html`.
- Add `data-ai-key` attributes to editable text blocks.
- Update `facts.json` with `entity`, `aliases`, `industry`, `market`, protected facts, blocked claims, and `editStrategy`.
- Update `prompt-suite.json` with the prompts the company wants to win.
- Update `competitors.json` with neutral competitor profiles. New configs can use a `companies` array; the Midtown example still uses the older `venues` key for compatibility.

See `optimizer/example-facts.generic.json` for a generic facts template.

## Commands

```bash
npm run extract:content
npm run optimize
npm run optimize -- --iterations=5
npm run setup
npm run baseline:openai
npm run baseline:real
npm run optimize:openai
npm run optimize:real
```

`npm run setup` starts a local setup page at `http://localhost:8090/setup.html`. Use it to enter a website URL, target company, prompts, factual guardrails, and run settings. Click Import Site to fetch the URL and distill it into local editable HTML under `optimizer/imported-sites/`. The page starts with five prompt rows; remove extras for a focused test or add more for broader coverage. The Discovered Options section is for the other companies, venues, or products that models mention when answering those same prompts. Use the Discover button with OpenAI or DeepSeek selected, then manually remove bad options or add missing ones if needed. Saving from that page creates a timestamped folder under `optimizer/generated-setups/` with:

- `facts.json`
- `prompt-suite.json`
- `competitors.json`
- `setup.json`
- `run-command.txt`

If a site was imported, `run-command.txt` uses that imported HTML path. If no import was run, it falls back to `index.html`.

The Test preset dropdown can fill the prompt rows and run settings for the staged tests: single-prompt debug, five-prompt set, multi-iteration, cross-model baseline, and cross-model edit. Presets do not replace the imported site or discovered options; those remain editable before saving.

`npm run optimize` creates:

- `content-map.json`: extracted `data-ai-key` blocks from `index.html`.
- `optimizer/runs/<timestamp>/report.md`: human-readable run summary.
- `optimizer/runs/<timestamp>/report.json`: full machine-readable results.
- `optimizer/runs/<timestamp>/candidate-*.html`: candidate site copies with proposed edits.
- `optimizer/runs/<timestamp>/best-candidate.html`: only written when at least one candidate is accepted.

The harness does not overwrite `index.html`. A human should inspect the accepted candidate before applying it to the live/static page.

Generated setup and imported-site folders are ignored by git.

## Current Model Behavior

By default, the harness uses deterministic local model simulators:

- `local-balanced`
- `local-event-planner`
- `local-skeptic`

These are not real public AI products. They are repeatable scoring stand-ins for local iteration.

For real model calls, create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Then fill in:

```bash
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
```

Do not commit `.env`. It is ignored by git.

Run OpenAI only:

```bash
npm run baseline:openai
```

Run OpenAI and DeepSeek:

```bash
npm run baseline:real
```

Those baseline commands only produce a report. They do not score candidate edits.

Run one recursive candidate-edit pass with OpenAI only:

```bash
npm run optimize:openai
```

Run one recursive candidate-edit pass with OpenAI and DeepSeek:

```bash
npm run optimize:real
```

Real provider runs print progress for each model call. The number of calls is providers multiplied by modes multiplied by prompts. With two providers, three modes, and five prompts, `baseline:real` performs 30 calls. A normal `optimize:real` run performs the same baseline calls again for each candidate edit path. To test more candidate paths:

```bash
npm run optimize -- --providers=openai,deepseek --iterations=1 --max-candidates=3
```

Provider calls time out after 60 seconds by default. To shorten that while testing:

```bash
MODEL_TIMEOUT_MS=30000 npm run baseline:real
```

OpenAI uses the Responses API. DeepSeek uses its OpenAI-compatible chat completions endpoint.

## Guardrails

- Edits only target non-protected `data-ai-key` blocks.
- Protected facts are configured in `facts.json`; for the Midtown example they include address, contact info, venue sizes, and capacities.
- Candidate validation rejects unsupported claims, blocked superlatives, and missing protected facts.
- No-context scores are reported separately from competitor-bundle and target-only clarity scores.
