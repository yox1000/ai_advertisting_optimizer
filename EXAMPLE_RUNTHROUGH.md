# Example Runthrough

This shows what a typical optimizer run looks like conceptually and practically. Midtown Loft & Terrace is the current demo company, but the same flow applies to any company.

## 1. Configure The Target Company

The optimizer needs four main inputs.

### Website Content

`index.html` contains the page we want to evaluate and improve.

Editable text blocks need `data-ai-key` attributes:

```html
<h1 data-ai-key="home-hero-title">Example Company: Primary Offer</h1>
<p data-ai-key="home-intro-copy">Example company description...</p>
```

The optimizer uses these keys to extract, score, and propose edits to specific content blocks.

### Protected Facts

`facts.json` describes the target company and facts that should not be casually changed.

Example:

```json
{
  "entity": "Example Company",
  "aliases": ["Example Co"],
  "industry": "event venues",
  "market": "NYC event venues",
  "protectedFacts": {
    "address": "123 Example Street",
    "phone": "(555) 555-5555"
  },
  "blockedClaims": ["guaranteed number one"]
}
```

### Prompts

`prompt-suite.json` contains the questions we want the company to perform well on.

Example:

```json
{
  "id": "rooftop-wedding-100",
  "question": "What are the best rooftop wedding venues in NYC for about 100 guests?",
  "intent": "wedding",
  "requiredSignals": ["rooftop", "wedding", "100 guests", "nyc"]
}
```

### Competitors

`competitors.json` contains neutral competitor profiles for fair comparison.

Example:

```json
{
  "companies": [
    {
      "name": "Competitor A",
      "summary": "A competitor profile with relevant services and proof points.",
      "signals": ["rooftop", "wedding", "nyc"]
    }
  ]
}
```

The current Midtown demo still uses the older `venues` key, which is supported for compatibility.

## 2. Extract The Website Content

Run:

```bash
npm run extract:content
```

Output:

```text
Extracted 116 data-ai-key blocks to content-map.json
Editable blocks: 76
Protected blocks: 19
```

This creates `content-map.json`, which is the optimizer's view of the website.

## 3. Run A Local Baseline

Run:

```bash
npm run optimize -- --iterations=1
```

Example output:

```text
Run: 2026-08-22T21-19-44-339Z
Initial overall: 93
Initial by mode: no-context 88, competitor-bundle 95, target-only 95
Providers: local
Iterations completed: 1
Accepted candidates: 0
Final overall: 93
Report: optimizer/runs/<timestamp>/report.md
```

This uses local deterministic model stand-ins, not real AI APIs.

## 4. Understand The Three Modes

### No-context

The model answers without being given the local website content.

Conceptual prompt:

```text
What are the best rooftop wedding venues in NYC for about 100 guests?
```

This is closest to public discovery behavior, but local edits usually will not affect it immediately.

### Competitor-bundle

The model receives the target company plus competitor profiles neutrally.

Conceptual prompt:

```text
Compare these company profiles and recommend the best fit.
Company A: ...
Company B: ...
Target Company: ...
```

This is the main local optimization signal because it checks whether the target company wins when fairly compared.

### Target-only

The model receives only the target company's website content.

Conceptual prompt:

```text
Based only on this website content, is this company a fit for the user request?
```

This is biased, but useful for checking whether the site clearly communicates the right facts.

## 5. Candidate Edits

After scoring the baseline, the optimizer looks for weak intents.

Example:

```text
Weak intent: wedding
Weak prompt: rooftop wedding venue for 100 guests
```

Then it uses `facts.json -> editStrategy` to find relevant content blocks.

Example targets:

```json
{
  "wedding": ["wedding-title", "wedding-copy-1", "wedding-copy-2"]
}
```

It proposes candidate edits only to non-protected blocks.

Example candidate:

```text
wedding-copy-1:
Add clearer wedding recommendation signals while preserving factual company positioning.
```

The candidate is tested again. If the score improves safely, it can be accepted into the working candidate. If not, it is rejected.

The real site file is not overwritten automatically.

## 6. Report Output

Each run writes:

```text
optimizer/runs/<timestamp>/report.md
optimizer/runs/<timestamp>/report.json
optimizer/runs/<timestamp>/iteration-*-candidate-*.html
```

If an edit is accepted, it also writes:

```text
optimizer/runs/<timestamp>/best-candidate.html
```

`report.md` is for humans.

`report.json` is for future automation.

## 7. Real Model Run

Create a local `.env` file:

```bash
cp .env.example .env
```

Add keys:

```bash
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
```

Run OpenAI:

```bash
npm run optimize:openai
```

Run OpenAI + DeepSeek:

```bash
npm run optimize:real
```

Do not commit `.env`.

## 8. What A Good Result Looks Like

Good result:

```text
competitor-bundle score improves
target-only score stays high
no-context score does not regress
protected facts remain intact
risky claims are not introduced
```

Bad result:

```text
candidate repeats keywords unnaturally
candidate invents unsupported claims
candidate removes protected facts
competitor-bundle score does not improve
target-only clarity gets worse
```

## 9. Practical Interpretation

The optimizer does not magically force public AI models to recommend the company.

It helps answer:

```text
If an AI model sees this website content, does it understand why this company should be recommended?
Does the company compare well against competitors?
Which prompts are weak?
Which copy edits help?
```

For public model behavior, the improved site still needs to be deployed, crawled, indexed, and tested over time.
