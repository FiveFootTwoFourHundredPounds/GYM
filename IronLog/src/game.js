import db, { today, daysAgo } from './db.js';

export const xpForLevel = (l) => Math.round(100 * Math.pow(l - 1, 2));
export function levelFromXp(xp) { let l = 1; while (xp >= xpForLevel(l + 1)) l++; return l; }

const RANKS = [
  { min: 1,  name: 'Bronze',      color: '#c07b46' },
  { min: 5,  name: 'Silver',      color: '#c3ccd6' },
  { min: 9,  name: 'Gold',        color: '#e8b93b' },
  { min: 14, name: 'Platinum',    color: '#4fd1c5' },
  { min: 20, name: 'Diamond',     color: '#7aa2ff' },
  { min: 27, name: 'Master',      color: '#c084fc' },
  { min: 35, name: 'Grandmaster', color: '#ff6b6b' },
  { min: 45, name: 'Legend',      color: '#ffd76a' },
];

export function levelInfo(xp) {
  const level = levelFromXp(xp);
  const cur = xpForLevel(level), next = xpForLevel(level + 1);
  const rank = [...RANKS].reverse().find(r => level >= r.min);
  return {
    xp, level, rank: rank.name, rankColor: rank.color,
    into: xp - cur, need: next - cur,
    pct: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)),
  };
}

export function awardXp(userId, amount, reason, dailyCap = null) {
  const day = today();
  if (dailyCap !== null) {
    const got = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM xp_events
      WHERE user_id=? AND reason=? AND day=?`).get(userId, reason, day).s;
    amount = Math.max(0, Math.min(amount, dailyCap - got));
  }
  if (amount <= 0) return 0;
  db.prepare(`INSERT INTO xp_events (user_id,amount,reason,day) VALUES (?,?,?,?)`)
    .run(userId, amount, reason, day);
  db.prepare(`UPDATE users SET xp = xp + ? WHERE id=?`).run(amount, userId);
  return amount;
}

export function touchStreak(userId) {
  const u = db.prepare(`SELECT last_active, streak FROM users WHERE id=?`).get(userId);
  const t = today();
  if (u.last_active === t) return u.streak;
  const streak = u.last_active === daysAgo(1) ? u.streak + 1 : 1;
  db.prepare(`UPDATE users SET streak=?, last_active=? WHERE id=?`).run(streak, t, userId);
  if (streak % 7 === 0) awardXp(userId, 100, 'streak_week');
  return streak;
}