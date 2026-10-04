import fs from 'node:fs';

const P = process.env.AI_PROVIDER || 'ollama';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const TXT = process.env.AI_TEXT_MODEL || 'qwen2.5:7b-instruct';
const VIS = process.env.AI_VISION_MODEL || 'qwen2.5vl:7b';

export const b64 = (p) => fs.readFileSync(p).toString('base64');

async function chat({ system, user, images = [], vision = false }) {
  const model = vision ? VIS : TXT;
  if (P === 'ollama') {
    const msg = { role: 'user', content: user };
    if (images.length) msg.images = images;
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, format: 'json', options: { temperature: 0.3, num_ctx: 8192 },
        messages: [{ role: 'system', content: system }, msg],
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
    return (await r.json()).message?.content ?? '';
  }
  const content = [{ type: 'text', text: user },
    ...images.map(i => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${i}` } }))];
  const r = await fetch(`${process.env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model, temperature: 0.3, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return (await r.json()).choices[0].message.content;
}

function parse(raw, fallback = {}) {
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { ...fallback, _raw: raw.slice(0, 800) };
}

const JSON_RULE = 'Reply with ONE valid JSON object only. No markdown, no prose outside JSON.';

export async function analyzeMeal(imgB64, note, profile) {
  const raw = await chat({
    vision: true, images: [imgB64],
    system: `You are a precise nutrition analyst. ${JSON_RULE}`,
    user: `Analyse this meal photo. User: ${profile.sex}, ${profile.age ?? '?'}y, ${profile.height_cm ?? '?'}cm, goal=${profile.goal}.
User note: "${note || 'none'}".
Estimate realistic portion sizes from visual cues (plate size, utensils).
JSON schema:
{"title":"short meal name","items":[{"name":"","qty":"","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0}],
"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"low|medium|high",
"verdict":"one sentence judgement for their goal","good":["..."],"improve":["..."],"swap":"one concrete swap idea"}`,
  });
  return parse(raw, { title: 'Unknown meal', calories: 0 });
}

export async function analyzeWorkoutPhoto(imgB64, note) {
  const raw = await chat({
    vision: true, images: [imgB64],
    system: `You are a gym coach reading a training photo. ${JSON_RULE}`,
    user: `Describe what is happening. Note: "${note || 'none'}".
{"scene":"","equipment":[],"exercise_guess":"","form_notes":["..."],"estimated_effort":"light|moderate|hard"}`,
  });
  return parse(raw);
}

export async function analyzePlan(plan, profile) {
  const raw = await chat({
    system: `You are an evidence-based strength coach. ${JSON_RULE}`,
    user: `Review this training plan.
User: ${profile.sex}, ${profile.age ?? '?'}y, ${profile.height_cm ?? '?'}cm, goal=${profile.goal}, activity=${profile.activity}.
Plan "${plan.title}" | goal=${plan.goal} | ${plan.days_per_week} days/week:
---
${plan.content}
---
{"score":0,"summary":"","split_type":"","strengths":["..."],"gaps":["..."],
"muscle_balance":{"push":"low|ok|high","pull":"low|ok|high","legs":"low|ok|high","core":"low|ok|high"},
"weekly_sets_estimate":0,"fixes":[{"change":"","why":""}],"progression_advice":""}`,
  });
  return parse(raw);
}

export async function dailyReview(ctx) {
  const raw = await chat({
    system: `You are a supportive but honest daily fitness coach. ${JSON_RULE}`,
    user: `Review today's data and give feedback.
${JSON.stringify(ctx, null, 1)}
{"score":0,"headline":"","summary":"","wins":["..."],"fixes":["..."],
"macro_check":{"calories":"under|on|over","protein":"under|on|over"},
"tomorrow":["..."],"motivation":""}`,
  });
  return parse(raw);
}

export async function coachVerdict(ctx) {
  const raw = await chat({
    system: `You are a body-recomposition coach. Be decisive and quantitative. ${JSON_RULE}`,
    user: `Decide whether this person should bulk, cut, or maintain.
${JSON.stringify(ctx, null, 1)}
Use the weight trend (kg/week), training consistency and intake.
{"recommendation":"bulk|cut|maintain","confidence":"low|medium|high","reasoning":"",
"weight_trend_kg_per_week":0,"calorie_target":0,"protein_target_g":0,"carb_target_g":0,"fat_target_g":0,
"training_focus":"","cardio":"","checkin_in_weeks":0,"watch_out_for":["..."],"next_steps":["..."]}`,
  });
  return parse(raw);
}

export async function health() {
  try {
    if (P !== 'ollama') return { ok: true, provider: P };
    const r = await fetch(`${OLLAMA}/api/tags`);
    const d = await r.json();
    return { ok: true, provider: 'ollama', models: d.models?.map(m => m.name) ?? [] };
  } catch (e) { return { ok: false, error: e.message }; }
}