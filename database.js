const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nickname TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        registered_year INTEGER DEFAULT 2026
      );

      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        place TEXT DEFAULT 'hospital',
        text TEXT NOT NULL,
        rating INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
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
    
    // Добавляем колонки, если их нет (для старых баз)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT DEFAULT 'image/png'`);
    
    await client.query(`INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING`);
  } finally {
    client.release();
  }
}

initDB();

module.exports = pool;