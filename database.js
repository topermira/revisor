const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'hospital.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url TEXT DEFAULT '/uploads/default.png',
    registered_year INTEGER DEFAULT 2026
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    place TEXT DEFAULT 'hospital',
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    show_time INTEGER DEFAULT 1,
    hospital_open INTEGER DEFAULT 1,
    mayor_open INTEGER DEFAULT 1,
    schools_open INTEGER DEFAULT 1,
    court_open INTEGER DEFAULT 1,
    post_open INTEGER DEFAULT 1,
    police_open INTEGER DEFAULT 1
  );
`);

// Вставляем настройки по умолчанию, если нет
db.exec(`INSERT OR IGNORE INTO settings (id) VALUES (1)`);

module.exports = db;