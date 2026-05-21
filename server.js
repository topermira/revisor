const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

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
  limits: { fileSize: 2 * 1024 * 1024 }
});

// Настройки
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './' }),
  secret: 'revizor-hospital-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Передаём пользователя и настройки в шаблоны
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (req.session.userId) {
    const user = db.prepare('SELECT id, nickname, avatar_url FROM users WHERE id = ?').get(req.session.userId);
    res.locals.currentUser = user;
  }
  next();
});

// Проверка, открыто ли заведение
function checkOpen(place, req, res, next) {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!settings[place + '_open']) {
    return res.send(`<div style="text-align:center;font-family:'Courier New';margin-top:100px;"><h1>🚫 ЗАКРЫТО</h1><p>Это заведение временно не работает. Заходите позже.</p><a href="/">← В меню</a></div>`);
  }
  next();
}

// Данные заведений
const places = {
  hospital: { name: 'Богоугодные заведения', chief: 'Артемий Филиппович Земляника', desc: 'Лучшие больницы, богадельни и сиротские дома! У нас всё по-простому: хотите — лечим, хотите — калечим. Колпаки чистые, больные выздоравливают как мухи. Особенно хорошо лечим от жадности, хамства и ревизоров! Заходите — не пожалеете. А пожалеете — вылечим!' },
  mayor: { name: 'Городская управа', chief: 'Антон Антонович Сквозник-Дмухановский', desc: 'Образцовый порядок и благолепие! Городничий лично следит, чтобы улицы были выметены, взятки розданы, а ревизоры не приезжали. Жалуйтесь смело — мы ваши жалобы очень внимательно... теряем. Но зато красиво!' },
  schools: { name: 'Городские училища', chief: 'Лука Лукич Хлопов', desc: 'Знания — свет, а незнание — тьма! Наши учителя трезвые (почти), ученики напуганные (очень), а экзамены сдаются исключительно по знакомству. Готовим будущих взяточников и ревизоров. Записывайтесь — пока места не разобрали!' },
  court: { name: 'Суд', chief: 'Аммос Фёдорович Ляпкин-Тяпкин', desc: 'Правосудие с душком и гусями! Судья Ляпкин-Тяпкин рассматривает дела быстро, справедливо и в вашу пользу (если вы правильно договоритесь). Гуси в коридоре — как символ нашей неподкупности. А приговор? Какой приговор — вы же не виноваты!' },
  post: { name: 'Почта', chief: 'Иван Кузьмич Шпекин', desc: 'Все письма проходят обязательную цензуру! То есть, мы их просто читаем из любопытства. Ваши секреты — наши секреты! Отправка быстрая, надёжная и совершенно не конфиденциальная. Анекдоты и сплетни приветствуются!' },
  police: { name: 'Полиция', chief: 'Держиморда, Свистунов и Ко', desc: 'Порядок — наше всё! Кулаки крепкие, сапоги тяжёлые, прав не качаем. Украли — найдём, потеряли — тоже найдём (и себе возьмём). Самые честные полицейские в губернии. Не верите? Приходите — убедитесь... или убежите!' }
};

app.get('/', (req, res) => {
  if (req.query.logout === 'admin') {
    req.session.isAdmin = false;
  }
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.render('menu', { places, settings });
});

// ============ АДМИН-ПАНЕЛЬ ============
app.get('/admin', (req, res) => {
  if (req.session.isAdmin) {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const comments = db.prepare(`
      SELECT comments.*, users.nickname 
      FROM comments 
      JOIN users ON comments.user_id = users.id 
      ORDER BY comments.created_at DESC
    `).all();
    return res.render('admin', { settings, places, comments });
  }
  res.render('admin-login', { error: null });
});

// Удаление комментария
app.post('/admin/delete-comment', (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin');
  
  const commentId = req.body.comment_id;
  if (commentId) {
    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
  }
  
  res.redirect('/admin');
});

app.post('/admin', (req, res) => {
  // Если это вход в админку
  if (req.body.admin_password) {
    console.log('Попытка входа в админку');
    if (req.body.admin_password === 'revizor123') {
      console.log('Пароль верный');
      req.session.isAdmin = true;
      const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      const comments = db.prepare(`
        SELECT comments.*, users.nickname 
        FROM comments 
        JOIN users ON comments.user_id = users.id 
        ORDER BY comments.created_at DESC
      `).all();
      return res.render('admin', { settings, places, comments });
    }
    console.log('Пароль неверный');
    return res.render('admin-login', { error: 'Неверный пароль!' });
  }
  
  // Если это сохранение настроек
  if (!req.session.isAdmin) return res.redirect('/admin');
  
  const { show_time, hospital_open, mayor_open, schools_open, court_open, post_open, police_open } = req.body;
  
  db.prepare(`UPDATE settings SET 
    show_time = ?,
    hospital_open = ?,
    mayor_open = ?,
    schools_open = ?,
    court_open = ?,
    post_open = ?,
    police_open = ?
    WHERE id = 1`).run(
    show_time ? 1 : 0,
    hospital_open ? 1 : 0,
    mayor_open ? 1 : 0,
    schools_open ? 1 : 0,
    court_open ? 1 : 0,
    post_open ? 1 : 0,
    police_open ? 1 : 0
  );
  
  res.redirect('/admin');
});

// Выход из админки
app.get('/admin-logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/');
});

// ============ СТРАНИЦЫ ЗАВЕДЕНИЙ ============
Object.keys(places).forEach(place => {
  app.get('/' + place, checkOpen.bind(null, place), (req, res) => {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const comments = db.prepare(`
      SELECT comments.*, users.nickname, users.avatar_url 
      FROM comments 
      JOIN users ON comments.user_id = users.id 
      WHERE comments.place = ?
      ORDER BY comments.created_at DESC
    `).all(place);
    
    res.render('place', { 
      place, 
      placeData: places[place], 
      comments, 
      settings 
    });
  });
});

// ============ РЕГИСТРАЦИЯ ============
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', upload.single('avatar'), async (req, res) => {
  const { nickname, password } = req.body;
  
  if (!nickname || !password) {
    return res.render('register', { error: 'Ник и пароль обязательны!' });
  }
  
  const existing = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (existing) {
    return res.render('register', { error: 'Такой ник уже занят!' });
  }
  
  const password_hash = await bcrypt.hash(password, 10);
  const avatar_url = req.file ? '/uploads/' + req.file.filename : '/uploads/default.png';
  const currentYear = new Date().getFullYear();
  
  const result = db.prepare('INSERT INTO users (nickname, password_hash, avatar_url, registered_year) VALUES (?, ?, ?, ?)').run(nickname, password_hash, avatar_url, currentYear);
  
  req.session.userId = result.lastInsertRowid;
  res.redirect('/hospital');
});

// ============ ВХОД ============
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { nickname, password } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
  if (!user) {
    return res.render('login', { error: 'Неверный ник или пароль' });
  }
  
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.render('login', { error: 'Неверный ник или пароль' });
  }
  
  req.session.userId = user.id;
  res.redirect('/hospital');
});

// ============ ВЫХОД ============
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ============ ПРОФИЛЬ ============
app.get('/profile/:id', (req, res) => {
  const user = db.prepare('SELECT id, nickname, avatar_url, registered_year FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).send('Пользователь не найден');
  
  const isOwner = req.session.userId && req.session.userId == user.id;
  res.render('profile', { user, isOwner, error: null });
});

app.post('/profile/:id', upload.single('avatar'), async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!req.session.userId || req.session.userId != user.id) {
    return res.redirect('/login');
  }
  
  const { nickname, password } = req.body;
  let avatar_url = user.avatar_url;
  let password_hash = user.password_hash;
  
  if (req.file) {
    avatar_url = '/uploads/' + req.file.filename;
  }
  
  if (password) {
    password_hash = await bcrypt.hash(password, 10);
  }
  
  if (nickname && nickname !== user.nickname) {
    const existing = db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(nickname, user.id);
    if (existing) {
      return res.render('profile', { user, isOwner: true, error: 'Ник занят!' });
    }
  }
  
  db.prepare('UPDATE users SET nickname = ?, password_hash = ?, avatar_url = ?, registered_year = ? WHERE id = ?').run(
    nickname || user.nickname,
    password_hash,
    avatar_url,
    req.body.registered_year || user.registered_year,
    user.id
  );
  
  res.redirect('/profile/' + user.id);
});

// ============ КОММЕНТАРИЙ ============
app.post('/comment/:place', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  const { text } = req.body;
  const place = req.params.place;
  
  if (text.trim()) {
    db.prepare('INSERT INTO comments (user_id, place, text) VALUES (?, ?, ?)').run(req.session.userId, place, text);
  }
  
  res.redirect('/' + place);
});

// ============ ЗАПУСК ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Уездный город N открыт на http://localhost:${PORT}`);
});