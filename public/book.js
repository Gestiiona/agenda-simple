// AgendaSimple — página pública de reservas
'use strict';
const $app = document.getElementById('app');
let info, state = {};

function header() {
  const s = info.settings;
  return `<header><img src="/icon.svg" width="44" alt=""><h1>${esc(s.businessName)}</h1>
    ${s.welcome ? `<p class="muted" style="margin:0">${esc(s.welcome)}</p>` : ''}
    ${s.address ? `<p class="muted" style="margin:.25rem 0 0;font-size:.9rem">${esc(s.address)}</p>` : ''}</header>`;
}
const steps = n => `<div class="steps" aria-label="Paso ${n} de 3">${[1, 2, 3].map(i => `<span class="${i <= n ? 'on' : ''}"></span>`).join('')}</div>`;

function stepService() {
  const list = info.services;
  $app.innerHTML = header() + steps(1) + `<div class="card"><h2>Elige un servicio</h2>
    ${list.length ? list.map(s => `<button class="choice" data-id="${s.id}"><div class="row between"><span class="t">${esc(s.name)}</span><span>${esc(money(s.price, info.settings))}</span></div>
      <div class="s">${durationLabel(s.duration)}${s.description ? ' · ' + esc(s.description) : ''}</div></button>`).join('')
      : '<p class="muted">Todavía no hay servicios disponibles para reservar.</p>'}</div>`;
  $app.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { state = { service: list.find(s => s.id === b.dataset.id) }; stepDate(); });
}

async function stepDate() {
  $app.innerHTML = header() + steps(2) + `<div class="card"><p><a href="#" id="back">← Cambiar servicio</a></p>
    <div class="summary"><strong>${esc(state.service.name)}</strong> · ${durationLabel(state.service.duration)}</div>
    <h2>Elige el día</h2><div id="days" class="muted">Buscando días disponibles…</div>
    <div id="slotsBox"></div></div>`;
  document.getElementById('back').onclick = e => { e.preventDefault(); stepService(); };
  const days = await api('/api/public/days?service=' + state.service.id).catch(() => []);
  const box = document.getElementById('days');
  if (!days.length) { box.innerHTML = 'No hay horarios disponibles en los próximos días. Escríbenos para coordinar.' + contactButton(); return; }
  box.className = 'days';
  box.innerHTML = days.map(d => `<button data-d="${d}"><small>${esc(fmtDay(d, { weekday: 'short' }))}</small>${esc(fmtDay(d, { day: 'numeric', month: 'short' }))}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => {
    box.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    state.date = b.dataset.d; loadSlots();
  });
  box.querySelector('button').click();
}
async function loadSlots() {
  const sb = document.getElementById('slotsBox');
  sb.innerHTML = '<p class="muted">Cargando horarios…</p>';
  const slots = await api(`/api/public/slots?service=${state.service.id}&date=${state.date}`).catch(() => []);
  sb.innerHTML = `<h2 class="cap" style="margin-top:1.25rem">${esc(fmtDay(state.date))}</h2>` +
    (slots.length ? `<div class="slots">${slots.map(t => `<button data-t="${t}">${fmtTime(t)}</button>`).join('')}</div>` : '<p class="muted">Ya no quedan horarios este día.</p>');
  sb.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { state.start = b.dataset.t; stepForm(); });
}
function contactButton() {
  const w = info.settings.whatsapp;
  return w ? `<p style="margin-top:1rem"><a class="btn wa" target="_blank" rel="noopener" href="${waLink(w, 'Hola, quiero agendar una cita.')}">Escribir por WhatsApp</a></p>` : '';
}

function stepForm() {
  const sv = state.service;
  $app.innerHTML = header() + steps(3) + `<div class="card"><p><a href="#" id="back">← Cambiar horario</a></p>
    <div class="summary"><strong>${esc(sv.name)}</strong><br><span class="cap">${esc(fmtDay(state.date))}</span> · ${fmtTime(state.start)}${sv.price ? ' · ' + esc(money(sv.price, info.settings)) : ''}</div>
    <form id="f">
      <div class="field"><label for="n">Tu nombre *</label><input id="n" name="name" required autocomplete="name"></div>
      <div class="field"><label for="p">WhatsApp / teléfono *</label><input id="p" name="phone" required inputmode="tel" autocomplete="tel" placeholder="+57 300 000 0000"></div>
      <div class="field"><label for="e">Email (opcional)</label><input id="e" name="email" type="email" autocomplete="email"></div>
      <div class="field"><label for="no">Comentario (opcional)</label><textarea id="no" name="note" rows="2"></textarea></div>
      <div class="hp" aria-hidden="true"><label>No llenar<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn primary" style="width:100%;justify-content:center">Confirmar reserva</button>
      ${info.settings.cancelPolicy ? `<p class="muted" style="font-size:.85rem;margin-bottom:0">${esc(info.settings.cancelPolicy)}</p>` : ''}
    </form></div>`;
  document.getElementById('back').onclick = e => { e.preventDefault(); stepDate(); };
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const body = { ...Object.fromEntries(new FormData(e.target)), serviceId: sv.id, date: state.date, start: state.start };
    try {
      const r = await api('/api/public/book', { method: 'POST', body });
      history.replaceState(null, '', '/c/' + r.token);
      showBooking(r.booking, r.token, true);
    } catch (err) {
      toast(err.message); btn.disabled = false;
      if (err.status === 409) setTimeout(stepDate, 1200);
    }
  };
}

function showBooking(b, token, fresh) {
  const s = info.settings;
  const link = `${location.origin}/c/${token}`;
  const msg = `Hola, acabo de reservar: ${b.serviceName} el ${fmtDay(b.date)} a las ${fmtTime(b.start)} a nombre de ${b.name}. Mi reserva: ${link}`;
  const cancelled = b.status === 'cancelada';
  $app.innerHTML = header() + `<div class="card done">
    <div class="big">${cancelled ? '✕' : '✓'}</div>
    <h2 style="margin-top:.5rem">${cancelled ? 'Reserva cancelada' : fresh ? '¡Reserva recibida!' : 'Tu reserva'}</h2>
    <div class="summary" style="text-align:left"><strong>${esc(b.serviceName)}</strong> · ${durationLabel(b.duration)}<br>
      <span class="cap">${esc(fmtDay(b.date))}</span> · ${fmtTime(b.start)}<br>${esc(b.name)}<div style="margin-top:.4rem">${badge(b.status)}</div></div>
    ${!cancelled && s.whatsapp ? `<p>${fresh ? 'Avísanos por WhatsApp para confirmar tu cita más rápido:' : ''}</p><a class="btn wa" target="_blank" rel="noopener" href="${waLink(s.whatsapp, msg)}">Enviar por WhatsApp</a>` : ''}
    ${!cancelled ? `<p class="muted" style="font-size:.9rem;margin-top:1.25rem">Guarda este enlace para ver o cancelar tu reserva:</p>
      <div class="share"><input readonly value="${esc(link)}" aria-label="Enlace de tu reserva"><button class="btn" id="copy">Copiar</button></div>` : ''}
    ${b.canCancel ? '<p style="margin-top:1.25rem"><button class="btn danger" id="cancel">Cancelar reserva</button></p>' : ''}
    <p style="margin-top:1.25rem"><a href="/">Hacer otra reserva</a></p></div>`;
  const copy = document.getElementById('copy');
  if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Enlace copiado'); } catch { toast('Copia el enlace manualmente'); } };
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.onclick = async () => {
    if (!confirm('¿Seguro que quieres cancelar esta reserva?')) return;
    try { const r = await api(`/api/public/booking/${token}/cancel`, { method: 'POST', body: {} }); showBooking(r.booking, token, false); toast('Reserva cancelada'); }
    catch (err) { toast(err.message); }
  };
}

(async function init() {
  try {
    info = await api('/api/public/info');
    document.title = 'Reservar cita — ' + info.settings.businessName;
    const m = location.pathname.match(/^\/c\/([a-f0-9]{32})$/);
    if (m) {
      try { const r = await api('/api/public/booking/' + m[1]); return showBooking(r.booking, m[1], false); }
      catch { $app.innerHTML = header() + '<div class="card"><h2>Reserva no encontrada</h2><p class="muted">El enlace no es válido.</p><a href="/">Hacer una reserva</a></div>'; return; }
    }
    stepService();
  } catch { $app.innerHTML = '<div class="card"><h2>No se pudo cargar la página</h2><p class="muted">Intenta de nuevo en unos minutos.</p></div>'; }
})();
