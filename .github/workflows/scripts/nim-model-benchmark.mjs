/* eslint-disable no-console */
import { performance } from "node:perf_hooks";

const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODELS = [
  { id: "meta/llama-3.1-8b-instruct", label: "meta-llama-3.1-8b-instruct" },
  { id: "minimaxai/minimax-m2.1", label: "minimax-m2.1" },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const API_KEY = requireEnv("NIM_API_KEY");
const INTENT_CASES = clampInt(process.env.INTENT_CASES, 1, 10, 10);
const TIMEOUT_MS = clampInt(process.env.NIM_TIMEOUT_MS, 5000, 120000, 30000);
const TASKS = new Set(
  String(process.env.BENCH_TASKS || "intent")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const INTENT_PROMPT = `You are a STRICT job intent detector. Be AGGRESSIVE in rejecting non-job posts. Your task is to determine if a post is TRULY offering paid work or hiring someone for a specific task/project.

A post IS a job ONLY if it shows ALL of these:
- Clear hiring intent: "looking for [profession]", "hiring", "seeking", "need [profession]" to DO WORK
- Specific work to be done (build X, design Y, write Z)
- The poster is the employer/client, not selling something

A post is NOT a job (REJECT these aggressively):
- Seeks advice, recommendations, tips, or opinions ("need advice on", "recommendations?", "thoughts on?", "struggling with", "how do I")
- Looking to SELL/TRANSFER something ("handover my", "sell my SaaS", "looking for buyer")
- Commission/sales schemes ("earn ₹", "earn $", "% commission", "for every business you close")
- Navigation spam ("go to r/", "check out r/", "post this in", "wrong sub")
- Empty/low effort (title only "[Hiring]" with no content)
- Vague "looking for" without clear job context ("looking for packaging" - packaging of what?)
- MLM, referral programs, affiliate marketing
- Casual conversation, surveys, or feedback requests

POST TO ANALYZE:
Title: {title}
Content: {content}

Return ONLY valid JSON (no markdown):
{"isJob": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

const SUMMARY_PROMPT = `Summarize this job post in 1-2 sentences (max 100 words). Focus on:
1. What profession is needed
2. Key requirements/skills
3. Any notable details (pay, timeline, etc.)

JOB POST:
{text}

Summary:
- Write in plain English.
- Do not use bullets or markdown.
- Do not include disclaimers or analysis labels.`;

const CATEGORIZE_PROMPT = `You are a job posting classifier. Analyze this job post and determine which professions it matches.

JOB POST:
{text}

PROFESSION OPTIONS:
- developer: Software development, programming, web/mobile app development, frontend/backend engineering
- artist: Visual art, illustration, graphic design, UI/UX design, concept art, game art
- voice-actor: Voice acting, voice-over work, narration, character voices, audiobooks
- video-editor: Video editing, motion graphics, VFX, post-production, color grading
- writer: Writing, copywriting, content writing, technical writing, scriptwriting
- audio: Sound design, music composition, audio engineering, game audio, Foley
- qa: Quality assurance, testing, QA engineering, game testing, beta testing
- virtual-assistant: Virtual assistance, administrative support, project management, data entry

TASK:
1. Identify which profession(s) this job post is hiring for
2. Return ONLY a JSON array with format: {"matches": [{"profession": "profession-id", "confidence": 0.0-1.0}]}
3. Only include professions with confidence >= 0.5

Return ONLY the JSON, no explanation.`;

const intentCases = [
  {
    id: "selfpromo-how-i",
    title: "How I stopped saying I'll post an update when we ...",
    content: "",
    expectIsJob: false,
  },
  {
    id: "opinion-unpopular",
    title: "Unpopular opinion: web agencies are quietly ...",
    content: "",
    expectIsJob: false,
  },
  {
    id: "selfpromo-i-built",
    title: "I built a school management software for one ...",
    content: "Sharing what I learned and how I approached it.",
    expectIsJob: false,
  },
  {
    id: "nonjob-looking-for-app",
    title: "Today I found myself looking for an app and realized this about landing pages",
    content: "Not hiring, just discussing patterns I noticed.",
    expectIsJob: false,
  },
  {
    id: "nonjob-cofounder",
    title: "Seeking a technical cofounder (CTO) for my startup idea",
    content: "Equity only. Looking for a partner, not a contractor.",
    expectIsJob: false,
  },
  {
    id: "job-hiring-illustrator",
    title: "[Hiring] Webtoon Storyboard/Sketch Illustrator",
    content: "Paid gig. Budget $500. Need storyboard + sketch, 2-3 episodes to start.",
    expectIsJob: true,
  },
  {
    id: "job-looking-for-dev",
    title: "Looking for a developer to build a simple SaaS MVP",
    content: "Budget $2k. Timeline 2 weeks. React + Node preferred.",
    expectIsJob: true,
  },
  {
    id: "job-need-designer",
    title: "Need a designer for a landing page",
    content: "Paid project. Quick turnaround, Figma deliverables.",
    expectIsJob: true,
  },
  {
    id: "job-linux-admin",
    title: "[Hiring] Linux / VPS Server Administrator",
    content: "Ongoing monthly retainer $300. Need help with backups, security hardening, monitoring.",
    expectIsJob: true,
  },
  {
    id: "job-video-editor",
    title: "[Hiring] Video Editor (22 USD a week)",
    content: "Weekly editing for short clips. Paid $22/week. 3-5 videos.",
    expectIsJob: true,
  },
];

const summaryCases = [
  {
    id: "sum-dev-mvp",
    title: "Looking for a developer to build a simple SaaS MVP",
    content: "Budget $2k. Timeline 2 weeks. React + Node preferred. Basic auth, Stripe, admin dashboard.",
  },
  {
    id: "sum-linux-admin",
    title: "[Hiring] Linux / VPS Server Administrator",
    content: "Ongoing monthly retainer $300. Need backups, security hardening, monitoring, and occasional incident response.",
  },
  {
    id: "sum-illustrator",
    title: "[Hiring] Webtoon Storyboard/Sketch Illustrator",
    content: "Paid gig. Budget $500. Need storyboard + sketch, 2-3 episodes to start. Provide samples/portfolio.",
  },
];

const categorizeCases = [
  {
    id: "cat-dev",
    text: "Hiring a React/Node developer to build an MVP with Stripe, auth, and an admin dashboard.",
    expect: ["developer"],
  },
  {
    id: "cat-artist",
    text: "Looking for an illustrator to draw character concepts and key art for a webtoon.",
    expect: ["artist"],
  },
  {
    id: "cat-va",
    text: "Need a virtual assistant for inbox management, scheduling, and basic data entry (paid).",
    expect: ["virtual-assistant"],
  },
];

function cleanJsonish(text) {
  if (!text) return "";
  return String(text)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

async function nimChat({ model, prompt, temperature, maxTokens }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(NIM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    const elapsedMs = performance.now() - started;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message || JSON.stringify(json);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const content = json?.choices?.[0]?.message?.content ?? "";
    return { content, elapsedMs };
  } finally {
    clearTimeout(t);
  }
}

function scoreSummary({ title, summary }) {
  const s = String(summary || "").trim();
  if (!s) return { ok: false, reason: "empty" };
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 100) return { ok: false, reason: "too_long" };
  if (/^[-*]\s/.test(s) || /\n\s*[-*]\s/.test(s)) return { ok: false, reason: "bullets" };
  if (s.toLowerCase() === String(title || "").trim().toLowerCase()) return { ok: false, reason: "echo_title" };
  return { ok: true };
}

function scoreCategorization({ parsed, expect }) {
  const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
  const got = new Set(
    matches
      .map((m) => m?.profession)
      .filter((p) => typeof p === "string"),
  );
  const exp = new Set(expect);
  let ok = true;
  for (const e of exp) {
    if (!got.has(e)) ok = false;
  }
  return { ok, got: Array.from(got).sort() };
}

async function runForModel(model) {
  const results = {
    model: model.id,
    label: model.label,
    intent: { total: 0, correct: 0, jsonOk: 0, avgMs: 0, failures: [] },
    summary: { total: 0, ok: 0, avgMs: 0, failures: [] },
    categorize: { total: 0, ok: 0, jsonOk: 0, avgMs: 0, failures: [] },
  };

  // Intent
  if (TASKS.has("intent")) {
    const cases = intentCases.slice(0, INTENT_CASES);
    let totalMs = 0;
    for (const tc of cases) {
      results.intent.total += 1;
      const prompt = INTENT_PROMPT.replace("{title}", tc.title).replace("{content}", tc.content || "(no content)");
      try {
        const { content, elapsedMs } = await nimChat({
          model: model.id,
          prompt,
          temperature: 0.1,
          maxTokens: 300,
        });
        totalMs += elapsedMs;
        const cleaned = cleanJsonish(content);
        let parsed;
        try {
          parsed = JSON.parse(cleaned);
          results.intent.jsonOk += 1;
        } catch {
          results.intent.failures.push({ id: tc.id, type: "json_parse", sample: cleaned.slice(0, 200) });
          continue;
        }

        const isJob = Boolean(parsed?.isJob);
        const conf = parsed?.confidence;
        const confOk = typeof conf === "number" && conf >= 0 && conf <= 1;
        if (!confOk) {
          results.intent.failures.push({ id: tc.id, type: "bad_confidence", sample: cleaned.slice(0, 200) });
        }

        if (isJob === tc.expectIsJob) results.intent.correct += 1;
        else results.intent.failures.push({ id: tc.id, type: "wrong_label", expect: tc.expectIsJob, got: isJob });
      } catch (err) {
        results.intent.failures.push({ id: tc.id, type: "request_failed", error: String(err?.message || err) });
      }
    }
    results.intent.avgMs = results.intent.total ? Math.round(totalMs / results.intent.total) : 0;
  }

  // Summary
  if (TASKS.has("summary")) {
    let totalMs = 0;
    for (const tc of summaryCases) {
      results.summary.total += 1;
      const text = `${tc.title}\n\n${tc.content}`.trim();
      const prompt = SUMMARY_PROMPT.replace("{text}", text);
      try {
        const { content, elapsedMs } = await nimChat({
          model: model.id,
          prompt,
          temperature: 0.3,
          maxTokens: 200,
        });
        totalMs += elapsedMs;
        const s = String(content || "").trim();
        const score = scoreSummary({ title: tc.title, summary: s });
        if (score.ok) results.summary.ok += 1;
        else results.summary.failures.push({ id: tc.id, reason: score.reason, sample: s.slice(0, 200) });
      } catch (err) {
        results.summary.failures.push({ id: tc.id, reason: "request_failed", error: String(err?.message || err) });
      }
    }
    results.summary.avgMs = results.summary.total ? Math.round(totalMs / results.summary.total) : 0;
  }

  // Categorize
  if (TASKS.has("categorize")) {
    let totalMs = 0;
    for (const tc of categorizeCases) {
      results.categorize.total += 1;
      const prompt = CATEGORIZE_PROMPT.replace("{text}", tc.text);
      try {
        const { content, elapsedMs } = await nimChat({
          model: model.id,
          prompt,
          temperature: 0.1,
          maxTokens: 300,
        });
        totalMs += elapsedMs;
        const cleaned = cleanJsonish(content);
        let parsed;
        try {
          parsed = JSON.parse(cleaned);
          results.categorize.jsonOk += 1;
        } catch {
          results.categorize.failures.push({ id: tc.id, type: "json_parse", sample: cleaned.slice(0, 200) });
          continue;
        }
        const score = scoreCategorization({ parsed, expect: tc.expect });
        if (score.ok) results.categorize.ok += 1;
        else results.categorize.failures.push({ id: tc.id, type: "wrong_label", got: score.got, expect: tc.expect });
      } catch (err) {
        results.categorize.failures.push({ id: tc.id, type: "request_failed", error: String(err?.message || err) });
      }
    }
    results.categorize.avgMs = results.categorize.total ? Math.round(totalMs / results.categorize.total) : 0;
  }

  return results;
}

async function main() {
  const all = [];
  for (const m of MODELS) {
    console.log(`\n=== Running model: ${m.id} ===`);
    const r = await runForModel(m);
    all.push(r);
    console.log(
      JSON.stringify(
        {
          model: r.model,
          intent: { correct: r.intent.correct, total: r.intent.total, jsonOk: r.intent.jsonOk, avgMs: r.intent.avgMs },
          summary: { ok: r.summary.ok, total: r.summary.total, avgMs: r.summary.avgMs },
          categorize: {
            ok: r.categorize.ok,
            total: r.categorize.total,
            jsonOk: r.categorize.jsonOk,
            avgMs: r.categorize.avgMs,
          },
        },
        null,
        2,
      ),
    );
  }

  // Recommend based primarily on intent correctness + JSON compliance.
  const scored = all.map((r) => {
    const intentAcc = r.intent.total ? r.intent.correct / r.intent.total : 0;
    const intentJson = r.intent.total ? r.intent.jsonOk / r.intent.total : 0;
    const catJson = r.categorize.total ? r.categorize.jsonOk / r.categorize.total : 0;
    const sumRate = r.summary.total ? r.summary.ok / r.summary.total : 0;
    // Weighted: intent accuracy dominates. JSON compliance matters a lot too.
    const overall = 0.6 * intentAcc + 0.2 * intentJson + 0.1 * catJson + 0.1 * sumRate;
    return { model: r.model, label: r.label, intentAcc, intentJson, catJson, sumRate, overall };
  });
  scored.sort((a, b) => b.overall - a.overall);
  const winner = scored[0];

  const final = {
    nim_url: NIM_URL,
    intent_cases: INTENT_CASES,
    timeout_ms: TIMEOUT_MS,
    scores: scored,
    recommended_model: winner?.model || null,
    recommended_label: winner?.label || null,
  };

  console.log("\nFINAL_RESULT " + JSON.stringify(final));
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
