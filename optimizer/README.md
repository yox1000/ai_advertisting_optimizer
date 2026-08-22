# Midtown AI Recommendation Optimizer

This harness evaluates whether Midtown Loft & Terrace content is easy for AI systems to understand and recommend.

It separates three test modes:

- `no-context`: asks prompts without supplying the local website content. This is a baseline tracking signal; local edits should not be expected to change it immediately.
- `competitor-bundle`: compares Midtown content against neutral competitor profiles. This is the main local optimization signal because it avoids directly telling the model to favor Midtown.
- `midtown-only`: supplies only Midtown content. This is useful for content clarity, but it is biased and should not be treated as public recommendation lift.

## Commands

```bash
npm run extract:content
npm run optimize
npm run optimize -- --iterations=5
npm run optimize -- --providers=openai --iterations=1
npm run optimize -- --providers=openai,deepseek --iterations=1
```

`npm run optimize` creates:

- `content-map.json`: extracted `data-ai-key` blocks from `index.html`.
- `optimizer/runs/<timestamp>/report.md`: human-readable run summary.
- `optimizer/runs/<timestamp>/report.json`: full machine-readable results.
- `optimizer/runs/<timestamp>/candidate-*.html`: candidate site copies with proposed edits.
- `optimizer/runs/<timestamp>/best-candidate.html`: only written when at least one candidate is accepted.

The harness does not overwrite `index.html`. A human should inspect the accepted candidate before applying it to the live/static page.

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
npm run optimize -- --providers=openai --iterations=1
```

Run OpenAI and DeepSeek:

```bash
npm run optimize -- --providers=openai,deepseek --iterations=1
```

OpenAI uses the Responses API. DeepSeek uses its OpenAI-compatible chat completions endpoint.

## Guardrails

- Edits only target non-protected `data-ai-key` blocks.
- Protected facts include address, contact info, venue sizes, and capacities.
- Candidate validation rejects unsupported claims, blocked superlatives, and missing protected facts.
- No-context scores are reported separately from competitor-bundle and Midtown-only scores.
