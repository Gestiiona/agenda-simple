// AgendaSimple — reservas en línea con confirmación por WhatsApp. Sin dependencias (Node.js >= 18)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Base de datos en archivo JSON ----------
const DEFAULT_HOURS = {
  0: [],
  1: [{ open: '09:00', close: '18:00' }],
  2: [{ open: '09:00', close: '18:00' }],
  3: [{ open: '09:00', close: '18:00' }],
  4: [{ open: '09:00', close: '18:00' }],
  5: [{ open: '09:00', close: '18:00' }],
  6: [{ open: '09:00', close: '13:00' }]
};
const EMPTY_DB = {
  settings: {
    businessName: 'Mi Negocio',
    whatsapp: '',
    address: '',
    welcome: 'Reserva tu cita en menos de un minuto.',
    timezone: 'America/Bogota',
    currency: 'COP',
    locale: 'es-CO',
    slotStep: 30,
    minNotice: 60,
    maxDaysAhead: 30,
    capacity: 1,
    cancelPolicy: 'Puedes cancelar hasta 1 hora antes de tu cita.',
    hours: DEFAULT_HOURS
  },
  auth: null,
  services: [],
  blocked: [],
  bookings: []
};

let db;
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...EMPTY_DB.settings, ...db.settings };
    db.services ||= []; db.blocked ||= []; db.bookings ||= [];
  } catch {
    db = structuredClone(EMPTY_DB);
    db.services.push({ id: id(), name: 'Consulta', duration: 30, price: 0, description: '', active: true });
    saveDb();
  }
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function id() { return crypto.randomBytes(8).toString('hex'); }
loadDb();

// ---------- Autenticación ----------
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.auth = { salt, hash: hashPassword(pw, salt), secret: crypto.randomBytes(32).toString('hex') };
  saveDb();
}
if (!db.auth && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 8) console.warn('ADMIN_PASSWORD debe tener al menos 8 caracteres; se ignora.');
  else setPassword(process.env.ADMIN_PASSWORD);
}
const SETUP_CODE = db.auth ? null : (process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex'));
if (SETUP_CODE) {
  console.log('==============================================');
  console.log(' Código de configuración inicial: ' + SETUP_CODE);
  console.log(' (o define la variable ADMIN_PASSWORD)');
  console.log('==============================================');
}
const sign = v => crypto.createHmac('sha256', db.auth.secret).update(v).digest('hex');
function makeSession() { const p = String(Date.now() + 30 * 864e5); return p + '.' + sign(p); }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isAuthed(req) {
  if (!db.auth) return false;
  const [payload, sig] = String(parseCookies(req).as_session || '').split('.');
  if (!payload || !sig) return false;
  const exp = sign(payload);
  return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)) && Number(payload) > Date.now();
}
function cookieHeader(req, value, maxAge = 30 * 86400) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `as_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
const safeEqual = (a, b) => { a = String(a); b = String(b); return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };

// Límite de intentos por IP real (última IP de X-Forwarded-For la añade el proxy)
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress;
}
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  buckets.set(key, list);
  return list.length >= max;
}
const hit = key => buckets.get(key)?.push(Date.now());

// ---------- Utilidades ----------
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON inválido')); } });
  });
}
const str = (v, max = 500) => String(v ?? '').slice(0, max).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// "Ahora" en la zona horaria del negocio: { date: 'AAAA-MM-DD', min: minutos desde medianoche }
function nowLocal() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: db.settings.timezone || 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const weekday = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay();
const ACTIVE = ['pendiente', 'confirmada'];

// ---------- Disponibilidad ----------
function slotsFor(service, date, ignoreBookingId = null) {
  const s = db.settings;
  if (!service || !DATE_RE.test(date)) return [];
  const now = nowLocal();
  if (date < now.date || date > addDays(now.date, s.maxDaysAhead)) return [];
  if (db.blocked.some(b => b.date === date)) return [];
  const ranges = (s.hours[weekday(date)] || []).filter(r => TIME_RE.test(r.open) && TIME_RE.test(r.close));
  const dayBookings = db.bookings.filter(b => b.date === date && ACTIVE.includes(b.status) && b.id !== ignoreBookingId);
  const step = Math.max(5, num(s.slotStep) || 30);
  const out = [];
  for (const r of ranges) {
    for (let start = toMin(r.open); start + service.duration <= toMin(r.close); start += step) {
      if (date === now.date && start < now.min + num(s.minNotice)) continue;
      const end = start + service.duration;
      const overlapping = dayBookings.filter(b => toMin(b.start) < end && toMin(b.start) + b.duration > start).length;
      if (overlapping < Math.max(1, num(s.capacity))) out.push(toTime(start));
    }
  }
  return out;
}
function publicSettings() {
  const s = db.settings;
  return { businessName: s.businessName, whatsapp: s.whatsapp, address: s.address, welcome: s.welcome, currency: s.currency, locale: s.locale, cancelPolicy: s.cancelPolicy, maxDaysAhead: s.maxDaysAhead, hours: s.hours };
}
const publicBooking = b => ({ serviceName: b.serviceName, duration: b.duration, price: b.price, date: b.date, start: b.start, name: b.name, status: b.status, canCancel: canCancel(b) });
function canCancel(b) {
  if (!ACTIVE.includes(b.status)) return false;
  const now = nowLocal();
  if (b.date > now.date) return true;
  return b.date === now.date && toMin(b.start) - now.min >= num(db.settings.minNotice);
}
function cleanPhone(p) { return str(p, 30).replace(/[^\d+]/g, ''); }

// ---------- API pública (página de reservas) ----------
async function publicApi(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/public/info' && m === 'GET') {
    return send(res, 200, { settings: publicSettings(), services: db.services.filter(s => s.active).map(({ id, name, duration, price, description }) => ({ id, name, duration, price, description })) });
  }
  if (p === '/api/public/days' && m === 'GET') {
    const service = db.services.find(s => s.id === url.searchParams.get('service') && s.active);
    if (!service) return send(res, 404, { error: 'Servicio no encontrado' });
    const today = nowLocal().date, days = [];
    for (let i = 0; i <= Math.min(90, db.settings.maxDaysAhead); i++) { const d = addDays(today, i); if (slotsFor(service, d).length) days.push(d); }
    return send(res, 200, days);
  }
  if (p === '/api/public/slots' && m === 'GET') {
    const service = db.services.find(s => s.id === url.searchParams.get('service') && s.active);
    if (!service) return send(res, 404, { error: 'Servicio no encontrado' });
    return send(res, 200, slotsFor(service, String(url.searchParams.get('date'))));
  }
  if (p === '/api/public/book' && m === 'POST') {
    const ip = clientIp(req);
    if (limited('book:' + ip, 30, 60 * 60 * 1000)) return send(res, 429, { error: 'Demasiadas reservas desde esta conexión. Intenta más tarde.' });
    const b = await readBody(req);
    if (b.website) return send(res, 200, { token: crypto.randomBytes(16).toString('hex') }); // campo trampa para bots
    const service = db.services.find(s => s.id === b.serviceId && s.active);
    if (!service) return send(res, 400, { error: 'Elige un servicio' });
    const name = str(b.name, 120), phone = cleanPhone(b.phone);
    if (!name) return send(res, 400, { error: 'Escribe tu nombre' });
    if (phone.replace(/\D/g, '').length < 7) return send(res, 400, { error: 'Escribe un teléfono válido' });
    const digits = phone.replace(/\D/g, '').slice(-10);
    const today = nowLocal().date;
    if (db.bookings.filter(x => ACTIVE.includes(x.status) && x.date >= today && x.phone.replace(/\D/g, '').slice(-10) === digits).length >= 3) {
      return send(res, 429, { error: 'Ya tienes 3 citas próximas con este número. Escríbenos por WhatsApp si necesitas otra.' });
    }
    if (!slotsFor(service, String(b.date)).includes(String(b.start))) return send(res, 409, { error: 'Ese horario ya no está disponible. Elige otro.' });
    const booking = {
      id: id(), token: crypto.randomBytes(16).toString('hex'), serviceId: service.id, serviceName: service.name, duration: service.duration, price: service.price,
      date: b.date, start: b.start, name, phone, email: str(b.email, 200), note: str(b.note, 1000), status: 'pendiente', source: 'web', createdAt: new Date().toISOString()
    };
    db.bookings.push(booking); saveDb(); hit('book:' + ip);
    return send(res, 201, { token: booking.token, booking: publicBooking(booking) });
  }
  let mt = p.match(/^\/api\/public\/booking\/([a-f0-9]{32})(\/cancel)?$/);
  if (mt) {
    const bk = db.bookings.find(x => x.token === mt[1]);
    if (!bk) return send(res, 404, { error: 'Reserva no encontrada' });
    if (!mt[2] && m === 'GET') return send(res, 200, { booking: publicBooking(bk), settings: publicSettings() });
    if (mt[2] && m === 'POST') {
      if (!canCancel(bk)) return send(res, 400, { error: 'Esta reserva ya no se puede cancelar en línea. Escríbenos por WhatsApp.' });
      bk.status = 'cancelada'; bk.cancelledBy = 'cliente'; saveDb();
      return send(res, 200, { booking: publicBooking(bk) });
    }
  }
  return send(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- API de administración ----------
async function adminApi(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/status' && m === 'GET') return send(res, 200, { setup: !db.auth, authed: isAuthed(req) });
  if (p === '/api/setup' && m === 'POST') {
    if (db.auth) return send(res, 400, { error: 'Ya está configurado' });
    const ip = clientIp(req);
    if (limited('login:' + ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    const b = await readBody(req);
    if (!safeEqual(String(b.setupCode || '').trim(), SETUP_CODE)) { hit('login:' + ip); return send(res, 401, { error: 'Código de configuración incorrecto. Búscalo en los registros (logs) del servidor.' }); }
    if (!b.password || String(b.password).length < 8) return send(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres' });
    setPassword(String(b.password));
    if (b.businessName) { db.settings.businessName = str(b.businessName, 200); saveDb(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (limited('login:' + ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    const b = await readBody(req);
    if (!db.auth) return send(res, 400, { error: 'Primero configura la app' });
    if (!safeEqual(hashPassword(String(b.password || ''), db.auth.salt), db.auth.hash)) { hit('login:' + ip); return send(res, 401, { error: 'Contraseña incorrecta' }); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }
  if (p === '/api/logout' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });

  if (!isAuthed(req)) return send(res, 401, { error: 'No autorizado' });

  if (p === '/api/settings' && m === 'GET') return send(res, 200, db.settings);
  if (p === '/api/settings' && m === 'PUT') {
    const b = await readBody(req), s = db.settings;
    for (const k of ['businessName', 'address', 'welcome', 'currency', 'locale', 'cancelPolicy']) if (k in b) s[k] = str(b[k], 2000);
    if ('whatsapp' in b) s.whatsapp = cleanPhone(b.whatsapp);
    if ('timezone' in b) {
      try { new Intl.DateTimeFormat('en', { timeZone: String(b.timezone) }); s.timezone = String(b.timezone); } catch { return send(res, 400, { error: 'Zona horaria no válida' }); }
    }
    if ('slotStep' in b) s.slotStep = Math.min(240, Math.max(5, Math.round(num(b.slotStep))));
    if ('minNotice' in b) s.minNotice = Math.max(0, Math.round(num(b.minNotice)));
    if ('maxDaysAhead' in b) s.maxDaysAhead = Math.min(365, Math.max(1, Math.round(num(b.maxDaysAhead))));
    if ('capacity' in b) s.capacity = Math.min(50, Math.max(1, Math.round(num(b.capacity))));
    if (b.hours && typeof b.hours === 'object') {
      const hours = {};
      for (let d = 0; d < 7; d++) {
        const list = Array.isArray(b.hours[d]) ? b.hours[d] : [];
        hours[d] = list.filter(r => TIME_RE.test(r.open) && TIME_RE.test(r.close) && toMin(r.open) < toMin(r.close)).slice(0, 4).map(r => ({ open: r.open, close: r.close }));
      }
      s.hours = hours;
    }
    saveDb(); return send(res, 200, s);
  }
  if (p === '/api/password' && m === 'PUT') {
    const b = await readBody(req);
    if (!safeEqual(hashPassword(String(b.current || ''), db.auth.salt), db.auth.hash)) return send(res, 400, { error: 'La contraseña actual no es correcta' });
    if (!b.password || String(b.password).length < 8) return send(res, 400, { error: 'Mínimo 8 caracteres' });
    setPassword(String(b.password));
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }

  // Servicios
  if (p === '/api/services' && m === 'GET') return send(res, 200, db.services);
  if (p === '/api/services' && m === 'POST') {
    const b = await readBody(req);
    if (!str(b.name)) return send(res, 400, { error: 'El nombre es obligatorio' });
    const s = { id: id(), name: str(b.name, 120), duration: Math.min(720, Math.max(5, Math.round(num(b.duration) || 30))), price: Math.max(0, num(b.price)), description: str(b.description, 500), active: b.active !== false };
    db.services.push(s); saveDb(); return send(res, 201, s);
  }
  let mt = p.match(/^\/api\/services\/([a-f0-9]+)$/);
  if (mt) {
    const s = db.services.find(x => x.id === mt[1]);
    if (!s) return send(res, 404, { error: 'Servicio no encontrado' });
    if (m === 'PUT') {
      const b = await readBody(req);
      if ('name' in b) { if (!str(b.name)) return send(res, 400, { error: 'El nombre es obligatorio' }); s.name = str(b.name, 120); }
      if ('duration' in b) s.duration = Math.min(720, Math.max(5, Math.round(num(b.duration))));
      if ('price' in b) s.price = Math.max(0, num(b.price));
      if ('description' in b) s.description = str(b.description, 500);
      if ('active' in b) s.active = !!b.active;
      saveDb(); return send(res, 200, s);
    }
    if (m === 'DELETE') { db.services = db.services.filter(x => x.id !== s.id); saveDb(); return send(res, 200, { ok: true }); }
  }

  // Días bloqueados (festivos, vacaciones)
  if (p === '/api/blocked' && m === 'GET') return send(res, 200, db.blocked.sort((a, b) => a.date.localeCompare(b.date)));
  if (p === '/api/blocked' && m === 'POST') {
    const b = await readBody(req);
    if (!DATE_RE.test(String(b.date))) return send(res, 400, { error: 'Fecha inválida' });
    if (!db.blocked.some(x => x.date === b.date)) db.blocked.push({ date: b.date, reason: str(b.reason, 200) });
    saveDb(); return send(res, 201, { ok: true });
  }
  mt = p.match(/^\/api\/blocked\/(\d{4}-\d{2}-\d{2})$/);
  if (mt && m === 'DELETE') { db.blocked = db.blocked.filter(x => x.date !== mt[1]); saveDb(); return send(res, 200, { ok: true }); }

  // Reservas
  if (p === '/api/bookings' && m === 'GET') {
    const from = url.searchParams.get('from') || '0000-00-00', to = url.searchParams.get('to') || '9999-99-99';
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = db.bookings.filter(b => b.date >= from && b.date <= to && (!q || (b.name + ' ' + b.phone).toLowerCase().includes(q)))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return send(res, 200, list);
  }
  if (p === '/api/slots' && m === 'GET') {
    const service = db.services.find(s => s.id === url.searchParams.get('service'));
    return send(res, 200, slotsFor(service, String(url.searchParams.get('date')), url.searchParams.get('ignore')));
  }
  if (p === '/api/bookings' && m === 'POST') {
    const b = await readBody(req);
    const service = db.services.find(s => s.id === b.serviceId);
    if (!service) return send(res, 400, { error: 'Elige un servicio' });
    if (!str(b.name)) return send(res, 400, { error: 'Escribe el nombre del cliente' });
    if (!DATE_RE.test(String(b.date)) || !TIME_RE.test(String(b.start))) return send(res, 400, { error: 'Fecha u hora inválida' });
    if (!b.force && !slotsFor(service, b.date).includes(b.start)) return send(res, 409, { error: 'Ese horario no está disponible', canForce: true });
    const booking = {
      id: id(), token: crypto.randomBytes(16).toString('hex'), serviceId: service.id, serviceName: service.name, duration: service.duration, price: service.price,
      date: b.date, start: b.start, name: str(b.name, 120), phone: cleanPhone(b.phone), email: str(b.email, 200), note: str(b.note, 1000),
      status: 'confirmada', source: 'admin', createdAt: new Date().toISOString()
    };
    db.bookings.push(booking); saveDb(); return send(res, 201, booking);
  }
  mt = p.match(/^\/api\/bookings\/([a-f0-9]+)$/);
  if (mt) {
    const bk = db.bookings.find(x => x.id === mt[1]);
    if (!bk) return send(res, 404, { error: 'Reserva no encontrada' });
    if (m === 'PUT') {
      const b = await readBody(req);
      if ('status' in b) {
        if (!['pendiente', 'confirmada', 'cancelada', 'completada', 'no_asistio'].includes(b.status)) return send(res, 400, { error: 'Estado inválido' });
        if (ACTIVE.includes(b.status) && !ACTIVE.includes(bk.status)) {
          const service = db.services.find(s => s.id === bk.serviceId) || { duration: bk.duration };
          if (!b.force && !slotsFor({ ...service, duration: bk.duration }, bk.date, bk.id).includes(bk.start)) return send(res, 409, { error: 'Ese horario ya está ocupado', canForce: true });
        }
        bk.status = b.status;
      }
      if ('date' in b || 'start' in b) {
        const date = String(b.date ?? bk.date), start = String(b.start ?? bk.start);
        if (!DATE_RE.test(date) || !TIME_RE.test(start)) return send(res, 400, { error: 'Fecha u hora inválida' });
        if (!b.force && !slotsFor({ duration: bk.duration }, date, bk.id).includes(start)) return send(res, 409, { error: 'Ese horario no está disponible', canForce: true });
        bk.date = date; bk.start = start;
      }
      for (const k of ['name', 'email', 'note']) if (k in b) bk[k] = str(b[k], 1000);
      if ('phone' in b) bk.phone = cleanPhone(b.phone);
      saveDb(); return send(res, 200, bk);
    }
    if (m === 'DELETE') { db.bookings = db.bookings.filter(x => x.id !== bk.id); saveDb(); return send(res, 200, { ok: true }); }
  }

  if (p === '/api/dashboard' && m === 'GET') {
    const now = nowLocal();
    const week = addDays(now.date, 6);
    const active = db.bookings.filter(b => ACTIVE.includes(b.status));
    const monthPrefix = now.date.slice(0, 7);
    return send(res, 200, {
      today: now.date,
      todayList: db.bookings.filter(b => b.date === now.date && b.status !== 'cancelada').sort((a, b) => a.start.localeCompare(b.start)),
      pending: active.filter(b => b.status === 'pendiente' && b.date >= now.date).length,
      week: active.filter(b => b.date >= now.date && b.date <= week).length,
      monthDone: db.bookings.filter(b => b.date.startsWith(monthPrefix) && b.status === 'completada').reduce((s, b) => s + num(b.price), 0),
      noShows: db.bookings.filter(b => b.date.startsWith(monthPrefix) && b.status === 'no_asistio').length,
      services: db.services.length
    });
  }

  if (p === '/api/backup' && m === 'GET') {
    const { auth, ...data } = db;
    return send(res, 200, data, { 'Content-Disposition': `attachment; filename="agendasimple-${nowLocal().date}.json"` });
  }
  if (p === '/api/restore' && m === 'POST') {
    const b = await readBody(req, 20e6);
    if (!b || typeof b.settings !== 'object' || !Array.isArray(b.services) || !Array.isArray(b.bookings)) return send(res, 400, { error: 'El archivo no es una copia de seguridad válida' });
    fs.writeFileSync(path.join(DATA_DIR, `antes-de-restaurar-${Date.now()}.json`), JSON.stringify(db));
    db.settings = { ...EMPTY_DB.settings, ...b.settings };
    db.services = b.services; db.bookings = b.bookings; db.blocked = Array.isArray(b.blocked) ? b.blocked : [];
    saveDb();
    return send(res, 200, { ok: true, services: db.services.length, bookings: db.bookings.length });
  }
  return send(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- Archivos estáticos ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || /^\/c\/[a-f0-9]{32}$/.test(rel)) rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Prohibido'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) {
      // Toda escritura debe ser JSON: bloquea formularios de otros sitios (CSRF)
      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Se esperaba JSON' });
      if (url.pathname.startsWith('/api/public/')) return await publicApi(req, res, url);
      return await adminApi(req, res, url);
    }
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: e.message || 'Error' });
  }
});
server.listen(PORT, () => console.log(`AgendaSimple escuchando en http://localhost:${PORT}  (panel: /admin)`));
