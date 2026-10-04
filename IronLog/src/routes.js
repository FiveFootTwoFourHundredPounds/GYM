import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db, { today, daysAgo } from './db.js';
import * as ai from './ai.js';
import { awardXp, touchStreak, levelInfo } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = express.Router();
const SECRET = process.env.JWT_SECRET || 'dev-secret';

const upload = multer({
  limits: { fileSize: 12 * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../data/uploads'),
    filename: (q, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase()),
  }),
  fileFilter: (q, f, cb) => cb(null, /image\/(jpeg|png|webp|gif)/.test(f.mimetype)),
});
const up = (field) => (req, res, next) => upload.single(field)(req, res, e => e ? res.status(400).json({ error: e.message }) : next());

function auth(req, res, next) {
  try {
    req.uid = jwt.verify(req.cookies.token, SECRET).uid;
    req.user = db.prepare('SELECT * FROM users WHERE id=?').get(req.uid);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ error: 'Not logged in' }); }
}
const pub = (u) => ({
  id: u.id, username: u.username, display_name: u.display_name || u.username,
  bio: u.bio, title: u.title, avatar: u.avatar, accent: u.accent, banner: u.banner,
  streak: u.streak, goal: u.goal, ...levelInfo(u.xp),
});

/* ---------- auth ---------- */
r.post('/register', (req, res) => {
  const { username, password, display_name } = req.body;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: 'Username: 3-20 letters/numbers/_' });
  if ((password || '').length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Username taken' });
  const info = db.prepare(`INSERT INTO users (username,password_hash,display_name) VALUES (?,?,?)`)
    .run(username, bcrypt.hashSync(password, 10), display_name || username);
  res.cookie('token', jwt.sign({ uid: info.lastInsertRowid }, SECRET, { expiresIn: '90d' }),
    { httpOnly: true, sameSite: 'lax', maxAge: 7776000000 });
  res.json({ ok: true });
});

r.post('/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username);
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash))
    return res.status(401).json({ error: 'Wrong username or password' });
  res.cookie('token', jwt.sign({ uid: u.id }, SECRET, { expiresIn: '90d' }),
    { httpOnly: true, sameSite: 'lax', maxAge: 7776000000 });
  res.json({ ok: true });
});

r.post('/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
r.get('/me', auth, (req, res) => res.json(pub(req.user)));

r.patch('/me', auth, (req, res) => {
  const f = ['display_name', 'bio', 'title', 'accent', 'banner', 'sex', 'age', 'height_cm', 'goal', 'activity', 'is_public'];
  const set = f.filter(k => k in req.body);
  if (set.length) db.prepare(`UPDATE users SET ${set.map(k => `${k}=?`).join(',')} WHERE id=?`)
    .run(...set.map(k => req.body[k]), req.uid);
  res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.uid)));
});

r.post('/me/avatar', auth, up('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run('/uploads/' + req.file.filename, req.uid);
  res.json({ avatar: '/uploads/' + req.file.filename });
});

/* ---------- weight ---------- */
r.post('/weights', auth, (req, res) => {
  const w = parseFloat(req.body.weight_kg);
  if (!(w > 20 && w < 400)) return res.status(400).json({ error: 'Invalid weight' });
  db.prepare(`INSERT INTO weights (user_id,day,weight_kg) VALUES (?,?,?)
    ON CONFLICT(user_id,day) DO UPDATE SET weight_kg=excluded.weight_kg`).run(req.uid, today(), w);
  awardXp(req.uid, 10, 'weigh_in', 10); touchStreak(req.uid);
  res.json({ ok: true });
});
r.get('/weights', auth, (req, res) =>
  res.json(db.prepare('SELECT day,weight_kg FROM weights WHERE user_id=? ORDER BY day').all(req.uid)));

/* ---------- meals ---------- */
r.post('/meals', auth, up('image'), (req, res) => {
  const { meal_type = 'meal', note = '' } = req.body;
  const img = req.file ? '/uploads/' + req.file.filename : null;
  const info = db.prepare(`INSERT INTO meals (user_id,day,meal_type,image,note,status)
    VALUES (?,?,?,?,?,?)`).run(req.uid, today(), meal_type, img, note, img ? 'pending' : 'skipped');
  const id = info.lastInsertRowid;
  awardXp(req.uid, 12, 'meal', 48); touchStreak(req.uid);

  if (req.file) setImmediate(async () => {
    try {
      const a = await ai.analyzeMeal(ai.b64(req.file.path), note, req.user);
      db.prepare(`UPDATE meals SET status='done',title=?,calories=?,protein=?,carbs=?,fat=?,ai_json=? WHERE id=?`)
        .run(a.title ?? 'Meal', +a.calories || 0, +a.protein_g || 0, +a.carbs_g || 0, +a.fat_g || 0, JSON.stringify(a), id);
      awardXp(req.uid, 5, 'meal_ai', 20);
    } catch (e) {
      db.prepare(`UPDATE meals SET status='error',ai_json=? WHERE id=?`).run(JSON.stringify({ error: e.message }), id);
    }
  });
  res.json({ id });
});

r.get('/meals', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM meals WHERE user_id=? AND day=? ORDER BY id DESC')
    .all(req.uid, req.query.day || today())));

r.delete('/meals/:id', auth, (req, res) => {
  db.prepare('DELETE FROM meals WHERE id=? AND user_id=?').run(req.params.id, req.uid);
  res.json({ ok: true });
});

/* ---------- workouts ---------- */
r.post('/workouts', auth, up('image'), (req, res) => {
  const { title = 'Training', duration_min = 60, intensity = 'moderate', note = '' } = req.body;
  const img = req.file ? '/uploads/' + req.file.filename : null;
  db.prepare(`INSERT INTO workouts (user_id,day,title,duration_min,intensity,note,image)
    VALUES (?,?,?,?,?,?,?)`).run(req.uid, today(), title, +duration_min, intensity, note, img);
  const bonus = Math.min(40, Math.round(+duration_min / 2)) + (intensity === 'hard' ? 20 : 0);
  awardXp(req.uid, 60 + bonus, 'workout', 200); touchStreak(req.uid);
  res.json({ ok: true });
});

r.get('/workouts', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 60').all(req.uid)));

/* ---------- plans ---------- */
r.post('/plans', auth, up('image'), (req, res) => {
  const { title, goal = 'hypertrophy', days_per_week = 4, content = '' } = req.body;
  const img = req.file ? '/uploads/' + req.file.filename : null;
  const info = db.prepare(`INSERT INTO plans (user_id,title,goal,days_per_week,content,image)
    VALUES (?,?,?,?,?,?)`).run(req.uid, title || 'My Plan', goal, +days_per_week, content, img);
  awardXp(req.uid, 40, 'plan', 80);
  res.json({ id: info.lastInsertRowid });
});

r.get('/plans', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM plans WHERE user_id=? ORDER BY id DESC').all(req.uid)));

r.post('/plans/:id/analyze', auth, async (req, res, next) => {
  try {
    const p = db.prepare('SELECT * FROM plans WHERE id=? AND user_id=?').get(req.params.id, req.uid);
    if (!p) return res.status(404).json({ error: 'Plan not found' });
    const a = await ai.analyzePlan(p, req.user);
    db.prepare('UPDATE plans SET ai_json=? WHERE id=?').run(JSON.stringify(a), p.id);
    res.json(a);
  } catch (e) { next(e); }
});

r.delete('/plans/:id', auth, (req, res) => {
  db.prepare('DELETE FROM plans WHERE id=? AND user_id=?').run(req.params.id, req.uid);
  res.json({ ok: true });
});

/* ---------- stats helper ---------- */
function snapshot(uid, day = today()) {
  const m = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(calories),0) kcal, COALESCE(SUM(protein),0) p,
    COALESCE(SUM(carbs),0) c, COALESCE(SUM(fat),0) f FROM meals WHERE user_id=? AND day=?`).get(uid, day);
  const w = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(duration_min),0) mins FROM workouts WHERE user_id=? AND day=?`).get(uid, day);
  const wt = db.prepare('SELECT weight_kg FROM weights WHERE user_id=? AND day=?').get(uid, day);
  return { day, meals: m.n, calories: Math.round(m.kcal), protein_g: Math.round(m.p),
    carbs_g: Math.round(m.c), fat_g: Math.round(m.f), workouts: w.n, training_minutes: w.mins,
    weight_kg: wt?.weight_kg ?? null };
}

r.get('/stats/today', auth, (req, res) => res.json(snapshot(req.uid)));

/* ---------- AI reviews ---------- */
r.post('/review/day', auth, async (req, res, next) => {
  try {
    const u = req.user;
    const meals = db.prepare('SELECT title,calories,protein,carbs,fat,meal_type FROM meals WHERE user_id=? AND day=?').all(u.id, today());
    const wk = db.prepare('SELECT title,duration_min,intensity,note FROM workouts WHERE user_id=? AND day=?').all(u.id, today());
    const plan = db.prepare('SELECT title,goal,days_per_week,content FROM plans WHERE user_id=? AND active=1 ORDER BY id DESC').get(u.id);
    const a = await ai.dailyReview({
      profile: { sex: u.sex, age: u.age, height_cm: u.height_cm, goal: u.goal, activity: u.activity, streak: u.streak },
      today: snapshot(u.id), meals, workouts: wk, active_plan: plan ?? null,
      last_7_days: [...Array(7)].map((_, i) => snapshot(u.id, daysAgo(i))),
    });
    db.prepare(`INSERT INTO reviews (user_id,day,kind,content) VALUES (?,?,?,?)`)
      .run(u.id, today(), 'day', JSON.stringify(a));
    awardXp(u.id, 15, 'review', 15);
    res.json(a);
  } catch (e) { next(e); }
});

r.post('/review/coach', auth, async (req, res, next) => {
  try {
    const u = req.user;
    const weights = db.prepare('SELECT day,weight_kg FROM weights WHERE user_id=? ORDER BY day DESC LIMIT 45').all(u.id);
    const a = await ai.coachVerdict({
      profile: { sex: u.sex, age: u.age, height_cm: u.height_cm, stated_goal: u.goal, activity: u.activity },
      weight_history: weights.reverse(),
      last_14_days: [...Array(14)].map((_, i) => snapshot(u.id, daysAgo(i))),
    });
    db.prepare(`INSERT INTO reviews (user_id,day,kind,content) VALUES (?,?,?,?)`)
      .run(u.id, today(), 'coach', JSON.stringify(a));
    res.json(a);
  } catch (e) { next(e); }
});

r.get('/review/latest', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM reviews WHERE user_id=? AND kind=? ORDER BY id DESC')
    .get(req.uid, req.query.kind || 'day');
  res.json(row ? { ...row, content: JSON.parse(row.content) } : null);
});

/* ---------- leaderboard & social ---------- */
r.get('/leaderboard', auth, (req, res) => {
  const range = req.query.range || 'week';
  const since = range === 'week' ? daysAgo(7) : range === 'month' ? daysAgo(30) : '0000-00-00';
  const rows = db.prepare(`
    SELECT u.id,u.username,u.display_name,u.avatar,u.accent,u.title,u.xp,u.streak,
      COALESCE(SUM(e.amount),0) period_xp,
      (SELECT COUNT(*) FROM workouts w WHERE w.user_id=u.id AND w.day>=?) sessions
    FROM users u LEFT JOIN xp_events e ON e.user_id=u.id AND e.day>=?
    WHERE u.is_public=1 GROUP BY u.id
    ORDER BY ${range === 'all' ? 'u.xp' : 'period_xp'} DESC, u.xp DESC LIMIT 100`).all(since, since);
  res.json(rows.map((x, i) => ({ rankPos: i + 1, ...x, ...levelInfo(x.xp), display_name: x.display_name || x.username })));
});

r.get('/users/:username', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!u.is_public && u.id !== req.uid) return res.status(403).json({ error: 'This profile is private' });
  const recent = db.prepare('SELECT title,day,duration_min,intensity,image FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 9').all(u.id);
  const gallery = db.prepare(`SELECT image,title,day FROM meals WHERE user_id=? AND image IS NOT NULL ORDER BY id DESC LIMIT 9`).all(u.id);
  const totals = db.prepare(`SELECT COUNT(*) sessions, COALESCE(SUM(duration_min),0) mins FROM workouts WHERE user_id=?`).get(u.id);
  const week = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM xp_events WHERE user_id=? AND day>=?').get(u.id, daysAgo(7)).s;
  const cheers = db.prepare('SELECT COUNT(*) c FROM cheers WHERE to_id=?').get(u.id).c;
  res.json({ ...pub(u), totals, week_xp: week, cheers, recent, gallery, isSelf: u.id === req.uid });
});

r.post('/users/:username/cheer', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(req.params.username);
  if (!u || u.id === req.uid) return res.status(400).json({ error: 'Cannot cheer' });
  try {
    db.prepare('INSERT INTO cheers (from_id,to_id,day) VALUES (?,?,?)').run(req.uid, u.id, today());
    awardXp(u.id, 3, 'cheer', 30);
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'Already cheered today' }); }
});

r.get('/ai/health', auth, async (req, res) => res.json(await ai.health()));

export default r;