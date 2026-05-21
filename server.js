const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const pool = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Папки
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Загрузка аватарок
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Настройки
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: 'revizor-hospital-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Создаём таблицу сессий
pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL COLLATE "default", "sess" json NOT NULL, "expire" timestamp(6) NOT NULL) WITH (OIDS=FALSE); ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE; CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`).catch(() => {});

// Передаём пользователя и настройки
app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  try {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.locals.settings = settings.rows[0];
    if (req.session.userId) {
      const user = await pool.query('SELECT id, nickname, avatar_url FROM users WHERE id = $1', [req.session.userId]);
      res.locals.currentUser = user.rows[0];
    }
  } catch (e) {}
  next();
});

function checkOpen(place) {
  return async (req, res, next) => {
    try {
      const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
      if (!settings.rows[0][place + '_open']) {
        return res.send(`<div style="text-align:center;font-family:'Courier New';margin-top:100px;"><h1>ЗАКРЫТО</h1><p>Это заведение временно не работает.</p><a href="/">← В меню</a></div>`);
      }
      next();
    } catch (e) {
      next();
    }
  };
}

const places = {
  hospital: { name: 'Богоугодные заведения', icon: '', chief: 'Артемий Филиппович Земляника', desc: 'Лучшие больницы, богадельни и сиротские дома! У нас всё по-простому: хотите — лечим, хотите — калечим. Колпаки чистые, больные выздоравливают как мухи. Особенно хорошо лечим от жадности, хамства и ревизоров! Заходите — не пожалеете. А пожалеете — вылечим!' },
  mayor: { name: 'Городская управа', icon: '', chief: 'Антон Антонович Сквозник-Дмухановский', desc: 'Образцовый порядок и благолепие! Городничий лично следит, чтобы улицы были выметены, взятки розданы, а ревизоры не приезжали.' },
  schools: { name: 'Городские училища', icon: '', chief: 'Лука Лукич Хлопов', desc: 'Знания — свет! Наши учителя трезвые (почти), ученики напуганные (очень), а экзамены сдаются по знакомству.' },
  court: { name: 'Суд', icon: '', chief: 'Аммос Фёдорович Ляпкин-Тяпкин', desc: 'Правосудие с душком и гусями! Дела рассматриваются быстро и в вашу пользу (если договоритесь).' },
  post: { name: 'Почта', icon: '', chief: 'Иван Кузьмич Шпекин', desc: 'Все письма проходят обязательную цензуру! Ваши секреты — наши секреты! Отправка быстрая и неконфиденциальная.' },
  police: { name: 'Полиция', icon: '', chief: 'Держиморда и Ко', desc: 'Порядок — наше всё! Кулаки крепкие, сапоги тяжёлые, прав не качаем. Украли — найдём, потеряли — тоже найдём.' }
};

// Главное меню
app.get('/', async (req, res) => {
  if (req.query.logout === 'admin') req.session.isAdmin = false;
  try {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.render('menu', { places, settings: settings.rows[0] });
  } catch (e) {
    res.render('menu', { places, settings: { show_time: 1, hospital_open: 1, mayor_open: 1, schools_open: 1, court_open: 1, post_open: 1, police_open: 1 } });
  }
});

// Админка
app.get('/admin', async (req, res) => {
  if (req.session.isAdmin) {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const comments = await pool.query('SELECT comments.*, users.nickname FROM comments JOIN users ON comments.user_id = users.id ORDER BY comments.created_at DESC');
    return res.render('admin', { settings: settings.rows[0], places, comments: comments.rows });
  }
  res.render('admin-login', { error: null });
});

app.post('/admin', async (req, res) => {
  if (req.body.admin_password) {
    if (req.body.admin_password === 'revizor123') {
      req.session.isAdmin = true;
      const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
      const comments = await pool.query('SELECT comments.*, users.nickname FROM comments JOIN users ON comments.user_id = users.id ORDER BY comments.created_at DESC');
      return res.render('admin', { settings: settings.rows[0], places, comments: comments.rows });
    }
    return res.render('admin-login', { error: 'Неверный пароль!' });
  }
  
  if (!req.session.isAdmin) return res.redirect('/admin');
  
  const { show_time, hospital_open, mayor_open, schools_open, court_open, post_open, police_open } = req.body;
  await pool.query('UPDATE settings SET show_time=$1, hospital_open=$2, mayor_open=$3, schools_open=$4, court_open=$5, post_open=$6, police_open=$7 WHERE id=1',
    [show_time ? 1 : 0, hospital_open ? 1 : 0, mayor_open ? 1 : 0, schools_open ? 1 : 0, court_open ? 1 : 0, post_open ? 1 : 0, police_open ? 1 : 0]);
  res.redirect('/admin');
});

app.post('/admin/delete-comment', async (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin');
  await pool.query('DELETE FROM comments WHERE id = $1', [req.body.comment_id]);
  res.redirect('/admin');
});

// Страницы заведений
Object.keys(places).forEach(place => {
  app.get('/' + place, checkOpen(place), async (req, res) => {
    try {
      const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
      const comments = await pool.query('SELECT comments.*, users.nickname, users.avatar_url FROM comments JOIN users ON comments.user_id = users.id WHERE comments.place = $1 ORDER BY comments.created_at DESC', [place]);
      res.render('place', { place, placeData: places[place], comments: comments.rows, settings: settings.rows[0] });
    } catch (e) {
      res.render('place', { place, placeData: places[place], comments: [], settings: { show_time: 1 } });
    }
  });
});

// Регистрация
app.get('/register', (req, res) => {
  req.session.returnTo = req.get('Referer') || '/hospital';
  res.render('register', { error: null });
});

app.post('/register', upload.single('avatar'), async (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.render('register', { error: 'Ник и пароль обязательны!' });
  
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const avatar_url = req.file ? '/uploads/' + req.file.filename : '/uploads/default.png';
    const currentYear = new Date().getFullYear();
    
    const result = await pool.query('INSERT INTO users (nickname, password_hash, avatar_url, registered_year) VALUES ($1, $2, $3, $4) RETURNING id',
      [nickname, password_hash, avatar_url, currentYear]);
    
    req.session.userId = result.rows[0].id;
    res.redirect(req.session.returnTo || '/hospital');
  } catch (e) {
    if (e.code === '23505') return res.render('register', { error: 'Такой ник уже занят!' });
    res.render('register', { error: 'Ошибка при регистрации' });
  }
});

// Вход
app.get('/login', (req, res) => {
  req.session.returnTo = req.get('Referer') || '/hospital';
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { nickname, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE nickname = $1', [nickname]);
    if (!user.rows[0]) return res.render('login', { error: 'Неверный ник или пароль' });
    
    const match = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!match) return res.render('login', { error: 'Неверный ник или пароль' });
    
    req.session.userId = user.rows[0].id;
    res.redirect(req.session.returnTo || '/hospital');
  } catch (e) {
    res.render('login', { error: 'Ошибка при входе' });
  }
});

// Выход
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Профиль
app.get('/profile/:id', async (req, res) => {
  try {
    const user = await pool.query('SELECT id, nickname, avatar_url, registered_year FROM users WHERE id = $1', [req.params.id]);
    if (!user.rows[0]) return res.status(404).send('Не найден');
    const isOwner = req.session.userId && req.session.userId == user.rows[0].id;
    res.render('profile', { user: user.rows[0], isOwner, error: null });
  } catch (e) {
    res.status(500).send('Ошибка');
  }
});

app.post('/profile/:id', upload.single('avatar'), async (req, res) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!req.session.userId || req.session.userId != user.rows[0].id) return res.redirect('/login');
    
    const { nickname, password } = req.body;
    let avatar_url = user.rows[0].avatar_url;
    let password_hash = user.rows[0].password_hash;
    
    if (req.file) avatar_url = '/uploads/' + req.file.filename;
    if (password) password_hash = await bcrypt.hash(password, 10);
    
    await pool.query('UPDATE users SET nickname = $1, password_hash = $2, avatar_url = $3, registered_year = $4 WHERE id = $5',
      [nickname || user.rows[0].nickname, password_hash, avatar_url, req.body.registered_year || user.rows[0].registered_year, user.rows[0].id]);
    
    res.redirect('/profile/' + user.rows[0].id);
  } catch (e) {
    res.redirect('/profile/' + req.params.id);
  }
});

// Комментарий
app.post('/comment/:place', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { text, rating } = req.body;
  try {
    await pool.query('INSERT INTO comments (user_id, place, text, rating) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.params.place, text, rating || 0]);
  } catch (e) {}
  res.redirect('/' + req.params.place);
});

// Запуск
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Город N открыт на порту ${PORT}`);
});