const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const bcrypt = require('bcrypt');
const pool = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({ pool: pool, tableName: 'session' }),
  secret: 'revizor-hospital-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL COLLATE "default", "sess" json NOT NULL, "expire" timestamp(6) NOT NULL) WITH (OIDS=FALSE); ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE; CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`).catch(() => {});

// Пользователь и настройки
app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  try {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.locals.settings = settings.rows[0];
    if (req.session.userId) {
      const user = await pool.query('SELECT id, nickname, avatar_data, avatar_mime FROM users WHERE id = $1', [req.session.userId]);
      if (user.rows[0]) {
        if (user.rows[0].avatar_data) {
          user.rows[0].avatar_url = 'data:' + (user.rows[0].avatar_mime || 'image/png') + ';base64,' + user.rows[0].avatar_data;
        } else {
          user.rows[0].avatar_url = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ccc"/><text x="60" y="130" font-size="100" fill="white">?</text></svg>').toString('base64');
        }
        res.locals.currentUser = user.rows[0];
      }
    }
  } catch (e) {}
  next();
});

function checkOpen(place) {
  return async (req, res, next) => {
    try {
      const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
      if (!settings.rows[0][place + '_open']) {
        return res.send('<div style="text-align:center;font-family:Courier New;margin-top:100px;"><h1>ЗАКРЫТО</h1><a href="/">← В меню</a></div>');
      }
      next();
    } catch (e) { next(); }
  };
}

const places = {
  hospital: { name: 'Богоугодные заведения', chief: 'Артемий Филиппович Земляника', desc: 'Лучшие больницы, богадельни и сиротские дома! У нас всё по-простому: хотите — лечим, хотите — калечим. Колпаки чистые, больные выздоравливают как мухи. Особенно хорошо лечим от жадности, хамства и ревизоров! Заходите — не пожалеете. А пожалеете — вылечим!' },
  mayor: { name: 'Городская управа', chief: 'Антон Антонович Сквозник-Дмухановский', desc: 'Образцовый порядок и благолепие! Городничий лично следит, чтобы улицы были выметены, взятки розданы, а ревизоры не приезжали.' },
  schools: { name: 'Городские училища', chief: 'Лука Лукич Хлопов', desc: 'Знания — свет! Наши учителя трезвые (почти), ученики напуганные (очень), а экзамены сдаются по знакомству.' },
  court: { name: 'Суд', chief: 'Аммос Фёдорович Ляпкин-Тяпкин', desc: 'Правосудие с душком и гусями! Дела рассматриваются быстро и в вашу пользу (если договоритесь).' },
  post: { name: 'Почта', chief: 'Иван Кузьмич Шпекин', desc: 'Все письма проходят обязательную цензуру! Ваши секреты — наши секреты! Отправка быстрая и неконфиденциальная.' },
  police: { name: 'Полиция', chief: 'Держиморда и Ко', desc: 'Порядок — наше всё! Кулаки крепкие, сапоги тяжёлые, прав не качаем.' }
};

// Главная
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

// Заведения
Object.keys(places).forEach(place => {
  app.get('/' + place, checkOpen(place), async (req, res) => {
    try {
      const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
      const comments = await pool.query('SELECT comments.*, users.nickname, users.avatar_data, users.avatar_mime FROM comments JOIN users ON comments.user_id = users.id WHERE comments.place = $1 ORDER BY comments.created_at DESC', [place]);
      comments.rows.forEach(c => {
        if (c.avatar_data) {
          c.avatar_url = 'data:' + (c.avatar_mime || 'image/png') + ';base64,' + c.avatar_data;
        } else {
          c.avatar_url = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ccc"/><text x="60" y="130" font-size="100" fill="white">?</text></svg>').toString('base64');
        }
      });
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
    let avatar_data = null;
    let avatar_mime = 'image/png';
    if (req.file) {
      avatar_data = req.file.buffer.toString('base64');
      avatar_mime = req.file.mimetype;
    }
    const currentYear = new Date().getFullYear();
    const result = await pool.query('INSERT INTO users (nickname, password_hash, avatar_data, avatar_mime, registered_year) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [nickname, password_hash, avatar_data, avatar_mime, currentYear]);
    req.session.userId = result.rows[0].id;
    res.redirect(req.session.returnTo || '/hospital');
  } catch (e) {
    if (e.code === '23505') return res.render('register', { error: 'Такой ник уже занят!' });
    res.render('register', { error: 'Ошибка ' + e.message });
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
  } catch (e) { res.render('login', { error: 'Ошибка' }); }
});

// Выход
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// Профиль
app.get('/profile/:id', async (req, res) => {
  try {
    const user = await pool.query('SELECT id, nickname, avatar_data, avatar_mime, registered_year FROM users WHERE id = $1', [req.params.id]);
    if (!user.rows[0]) return res.status(404).send('Не найден');
    if (user.rows[0].avatar_data) {
      user.rows[0].avatar_url = 'data:' + (user.rows[0].avatar_mime || 'image/png') + ';base64,' + user.rows[0].avatar_data;
    } else {
      user.rows[0].avatar_url = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ccc"/><text x="60" y="130" font-size="100" fill="white">?</text></svg>').toString('base64');
    }
    const isOwner = req.session.userId && req.session.userId == user.rows[0].id;
    res.render('profile', { user: user.rows[0], isOwner, error: null });
  } catch (e) { res.status(500).send('Ошибка'); }
});

app.post('/profile/:id', upload.single('avatar'), async (req, res) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!req.session.userId || req.session.userId != user.rows[0].id) return res.redirect('/login');
    const { nickname, password } = req.body;
    let password_hash = user.rows[0].password_hash;
    if (password) password_hash = await bcrypt.hash(password, 10);
    
    if (req.file) {
      await pool.query('UPDATE users SET avatar_data = $1, avatar_mime = $2 WHERE id = $3',
        [req.file.buffer.toString('base64'), req.file.mimetype, user.rows[0].id]);
    }
    
    await pool.query('UPDATE users SET nickname = $1, password_hash = $2, registered_year = $3 WHERE id = $4',
      [nickname || user.rows[0].nickname, password_hash, req.body.registered_year || user.rows[0].registered_year, user.rows[0].id]);
    
    res.redirect('/profile/' + user.rows[0].id);
  } catch (e) { res.redirect('/profile/' + req.params.id); }
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

app.listen(PORT, '0.0.0.0', () => console.log('Город N открыт на порту ' + PORT));