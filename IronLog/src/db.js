import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '../data/ironlog.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  bio TEXT DEFAULT '',
  title TEXT DEFAULT 'Newcomer',
  avatar TEXT,
  accent TEXT DEFAULT '#7aa2ff',
  banner TEXT DEFAULT 'sunset',
  sex TEXT DEFAULT 'unspecified',
  age INTEGER,
  height_cm REAL,
  goal TEXT DEFAULT 'maintain',
  activity TEXT DEFAULT 'moderate',
  xp INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  last_active TEXT,
  is_public INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
  reason TEXT, day TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, day TEXT NOT NULL, weight_kg REAL NOT NULL,
  UNIQUE(user_id, day)
);
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, day TEXT NOT NULL, meal_type TEXT,
  image TEXT, note TEXT, status TEXT DEFAULT 'pending',
  title TEXT, calories REAL, protein REAL, carbs REAL, fat REAL,
  ai_json TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, day TEXT NOT NULL, title TEXT,
  duration_min INTEGER, intensity TEXT, note TEXT, image TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, title TEXT, goal TEXT,
  days_per_week INTEGER, content TEXT, image TEXT,
  ai_json TEXT, active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
  content TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cheers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, day TEXT NOT NULL,
  UNIQUE(from_id, to_id, day)
);
CREATE INDEX IF NOT EXISTS ix_meals ON meals(user_id, day);
CREATE INDEX IF NOT EXISTS ix_wk ON workouts(user_id, day);
CREATE INDEX IF NOT EXISTS ix_xp ON xp_events(user_id, created_at);
`);

export default db;
export const today = () => new Date().toLocaleDateString('en-CA');
export const daysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};