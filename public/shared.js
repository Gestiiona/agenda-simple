// Utilidades compartidas por la página de reservas y el panel
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function money(n, s) {
  if (!n) return '';
  try { return new Intl.NumberFormat(s?.locale || 'es-CO', { style: 'currency', currency: s?.currency || 'COP', maximumFractionDigits: (s?.currency || 'COP') === 'COP' ? 0 : 2 }).format(n); }
  catch { return String(n); }
}
// Las fechas AAAA-MM-DD se formatean en UTC al mediodía para que nunca cambien de día
function fmtDay(d, opts = { weekday: 'long', day: 'numeric', month: 'long' }, locale = 'es') {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'a. m.' : 'p. m.';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}
const durationLabel = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Error'); e.status = res.status; e.data = data; throw e; }
  return data;
}
const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const STATUS = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Completada', no_asistio: 'No asistió' };
const badge = s => `<span class="badge ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
