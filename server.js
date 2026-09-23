require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- one-time seed of the head-office admin account ----------
(function seed() {
  const db = store.load();
  if (db.users.length === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    db.users.push({
      id: store.nextId(db.users),
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'office',
      pointLocation: null,
      createdAt: Date.now()
    });
    store.save(db);
    console.log('----------------------------------------------------');
    console.log('Created default head-office login:');
    console.log('  username:', username);
    console.log('  password:', password);
    console.log('Log in and change this password / create real accounts.');
    console.log('----------------------------------------------------');
  }
})();

// ---------- file upload (live photos) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB per photo
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  }
});

// ---------- app ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, pointLocation: user.pointLocation },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function requireAuth(...roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null;
    if (!token) return res.status(401).json({ error: 'Not logged in.' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Your account cannot do this.' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Session expired — log in again.' });
    }
  };
}

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  const db = store.load();
  const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  res.json({
    token: signToken(user),
    user: { username: user.username, role: user.role, pointLocation: user.pointLocation }
  });
});

app.get('/api/me', requireAuth(), (req, res) => res.json({ user: req.user }));

app.post('/api/change-password', requireAuth(), (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const db = store.load();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  store.save(db);
  res.json({ ok: true });
});

// ---------- user management (head office only) ----------
app.get('/api/users', requireAuth('office'), (req, res) => {
  const db = store.load();
  res.json(db.users.map(u => ({ id: u.id, username: u.username, role: u.role, pointLocation: u.pointLocation, createdAt: u.createdAt })));
});

app.post('/api/users', requireAuth('office'), (req, res) => {
  const { username, password, role, pointLocation } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Username, password and role are required.' });
  if (!['office', 'point'].includes(role)) return res.status(400).json({ error: 'Role must be office or point.' });
  if (role === 'point' && !pointLocation) return res.status(400).json({ error: 'A point/location is required for point accounts.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const db = store.load();
  if (db.users.some(u => u.username.toLowerCase() === String(username).toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const user = {
    id: store.nextId(db.users),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    pointLocation: role === 'point' ? pointLocation : null,
    createdAt: Date.now()
  };
  db.users.push(user);
  store.save(db);
  res.status(201).json({ id: user.id, username: user.username, role: user.role, pointLocation: user.pointLocation });
});

app.delete('/api/users/:id', requireAuth('office'), (req, res) => {
  const db = store.load();
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete your own account while logged in." });
  db.users = db.users.filter(u => u.id !== id);
  store.save(db);
  res.json({ ok: true });
});

// ---------- attendance ----------
app.post('/api/attendance', requireAuth('point', 'office'), upload.single('photo'), (req, res) => {
  const { pointLocation, oicName, date, time, guardName, shift, onTime, offTime } = req.body || {};
  if (!pointLocation || !oicName || !date || !guardName || !shift) {
    return res.status(400).json({ error: 'Point, OIC name, date, guard name and shift are required.' });
  }
  // A point-role account may only submit for its own assigned point.
  if (req.user.role === 'point' && req.user.pointLocation !== pointLocation) {
    return res.status(403).json({ error: 'This account can only log attendance for its assigned point.' });
  }

  const db = store.load();
  const record = {
    id: store.nextId(db.attendance),
    pointLocation,
    oicName,
    date,
    time: time || '',
    guardName,
    shift,
    onTime: onTime || '',
    offTime: offTime || '',
    photoPath: req.file ? `/uploads/${req.file.filename}` : null,
    submittedBy: req.user.username,
    submittedAt: Date.now()
  };
  db.attendance.push(record);
  store.save(db);
  res.status(201).json(record);
});

app.get('/api/attendance', requireAuth('office'), (req, res) => {
  const { date, pointLocation, shift } = req.query;
  const db = store.load();
  let rows = db.attendance;
  if (date) rows = rows.filter(r => r.date === date);
  if (pointLocation) rows = rows.filter(r => r.pointLocation === pointLocation);
  if (shift) rows = rows.filter(r => r.shift === shift);
  rows = rows.slice().sort((a, b) => b.submittedAt - a.submittedAt);
  res.json(rows);
});

app.get('/api/attendance/export.xlsx', requireAuth('office'), (req, res) => {
  const { date, pointLocation, shift } = req.query;
  const db = store.load();
  let rows = db.attendance;
  if (date) rows = rows.filter(r => r.date === date);
  if (pointLocation) rows = rows.filter(r => r.pointLocation === pointLocation);
  if (shift) rows = rows.filter(r => r.shift === shift);

  const data = rows.map(r => ({
    'Point / Location': r.pointLocation,
    'OIC Name': r.oicName,
    'Date': r.date,
    'Time': r.time,
    'Security Person': r.guardName,
    'Shift': r.shift,
    'On-Duty Time': r.onTime,
    'Off-Duty Time': r.offTime,
    'Photo Attached': r.photoPath ? 'Yes' : 'No',
    'Logged By': r.submittedBy
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader('Content-Disposition', `attachment; filename="point-watch-attendance-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Distinct list of points, for the dropdowns — office sees all seen so far, a point account sees only its own.
app.get('/api/points', requireAuth('point', 'office'), (req, res) => {
  const db = store.load();
  if (req.user.role === 'point') return res.json([req.user.pointLocation]);
  const fromUsers = db.users.filter(u => u.pointLocation).map(u => u.pointLocation);
  const fromRecords = db.attendance.map(r => r.pointLocation);
  res.json([...new Set([...fromUsers, ...fromRecords])].sort());
});

app.listen(PORT, () => {
  console.log(`Point Watch running at http://localhost:${PORT}`);
});
