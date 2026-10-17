// AgendaSimple — panel de administración
'use strict';
const $app = document.getElementById('app');
let settings = null, services = [];
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const formData = f => Object.fromEntries(new FormData(f).entries());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
async function adminApi(path, opts) {
  try { return await api(path, opts); }
  catch (e) { if (e.status === 401) { location.hash = '#/login'; route(); } throw e; }
}

function shell(active, content) {
  const link = (h, label, key) => `<a href="${h}" class="${active === key ? 'active' : ''}">${label}</a>`;
  $app.innerHTML = `<div class="layout"><nav class="side">
      <div class="brand"><img src="/icon.svg" alt="">AgendaSimple</div>
      ${link('#/', 'Hoy', 'home')}${link('#/agenda', 'Agenda', 'agenda')}${link('#/nueva', '+ Nueva cita', 'nueva')}
      ${link('#/servicios', 'Servicios', 'servicios')}${link('#/horario', 'Horario', 'horario')}${link('#/ajustes', 'Ajustes', 'ajustes')}
      <div class="spacer"></div><a href="/" target="_blank" rel="noopener">Ver página de reservas ↗</a><a href="#" id="logout">Cerrar sesión</a>
    </nav><main>${content}</main></div>`;
  document.getElementById('logout').onclick = async e => { e.preventDefault(); await api('/api/logout', { method: 'POST', body: {} }); location.hash = '#/login'; route(); };
}

// ---------- Acceso ----------
function viewSetup() {
  $app.innerHTML = `<div class="auth card"><h1>Bienvenido a AgendaSimple</h1>
    <p class="muted">Configura tu negocio y crea la contraseña del panel.</p>
    <form id="f">
      <div class="field"><label>Código de configuración</label><input name="setupCode" required autocomplete="off" placeholder="Aparece en los registros (logs) del servidor"></div>
      <div class="field"><label>Nombre del negocio</label><input name="businessName" required></div>
      <div class="field"><label>Contraseña (mínimo 8 caracteres)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn primary" style="width:100%">Empezar</button></form></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/setup', { method: 'POST', body: formData(e.target) }); location.hash = '#/ajustes'; route(); toast('¡Listo! Completa tus datos y tu WhatsApp.'); }
    catch (err) { toast(err.message); }
  };
}
function viewLogin() {
  $app.innerHTML = `<div class="auth card"><div class="row" style="margin-bottom:1rem"><img src="/icon.svg" width="36" alt=""><h1 style="margin:0">AgendaSimple</h1></div>
    <form id="f"><div class="field"><label>Contraseña</label><input name="password" type="password" required autofocus autocomplete="current-password"></div>
    <button class="btn primary" style="width:100%">Entrar</button></form></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: formData(e.target) }); location.hash = '#/'; route(); } catch (err) { toast(err.message); }
  };
}

// ---------- Hoy ----------
function apptRow(b) {
  return `<div class="appt" data-id="${b.id}"><span class="time">${fmtTime(b.start)}</span>
    <div><strong>${esc(b.name)}</strong><div class="muted" style="font-size:.9rem">${esc(b.serviceName)} · ${durationLabel(b.duration)}</div></div>${badge(b.status)}</div>`;
}
function bindAppts() { document.querySelectorAll('.appt[data-id]').forEach(r => r.onclick = () => { location.hash = '#/cita/' + r.dataset.id; }); }

async function viewHome() {
  const d = await adminApi('/api/dashboard');
  const link = location.origin + '/';
  shell('home', `<div class="row between"><h1 class="cap">${esc(fmtDay(d.today))}</h1><a class="btn primary" href="#/nueva">+ Nueva cita</a></div>
    ${!settings.whatsapp ? '<div class="card" style="border-color:var(--warn)">Agrega tu número de WhatsApp en <a href="#/ajustes">Ajustes</a> para que tus clientes puedan escribirte al reservar.</div>' : ''}
    <div class="grid stats">
      <div class="card stat"><div class="label">Citas hoy</div><div class="value">${d.todayList.filter(b => b.status !== 'cancelada').length}</div></div>
      <div class="card stat"><div class="label">Por confirmar</div><div class="value" style="${d.pending ? 'color:var(--warn)' : ''}">${d.pending}</div></div>
      <div class="card stat"><div class="label">Próximos 7 días</div><div class="value">${d.week}</div></div>
      <div class="card stat"><div class="label">Atendido este mes</div><div class="value">${money(d.monthDone, settings) || '$0'}</div></div>
    </div>
    <div class="card"><h2>Agenda de hoy</h2>${d.todayList.length ? d.todayList.map(apptRow).join('') : '<div class="empty">No hay citas para hoy.</div>'}</div>
    <div class="card"><h2>Tu enlace de reservas</h2><p class="muted">Compártelo en tu Instagram, WhatsApp Business o Google Maps.</p>
      <div class="share"><input readonly value="${esc(link)}"><button class="btn" id="copy">Copiar</button></div></div>`);
  bindAppts();
  document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Enlace copiado'); } catch { toast(link); } };
}

// ---------- Agenda ----------
async function viewAgenda(from) {
  const today = (await adminApi('/api/dashboard')).today;
  from = from || today;
  const to = addDays(from, 13);
  const list = await adminApi(`/api/bookings?from=${from}&to=${to}`);
  let showCancelled = false; try { showCancelled = sessionStorage.getItem('showCancelled') === '1'; } catch {}
  const byDay = {};
  list.filter(b => showCancelled || b.status !== 'cancelada').forEach(b => (byDay[b.date] ||= []).push(b));
  shell('agenda', `<div class="row between"><h1>Agenda</h1>
      <div class="row"><a class="btn sm" href="#/agenda/${addDays(from, -14)}">← Anterior</a><a class="btn sm" href="#/agenda/${today}">Hoy</a><a class="btn sm" href="#/agenda/${addDays(from, 14)}">Siguiente →</a></div></div>
    <p class="muted">Del ${esc(fmtDay(from, { day: 'numeric', month: 'long' }))} al ${esc(fmtDay(to, { day: 'numeric', month: 'long' }))} ·
      <label style="display:inline;color:inherit"><input type="checkbox" id="sc" ${showCancelled ? 'checked' : ''} style="width:auto"> Mostrar canceladas</label></p>
    <div class="card">${Object.keys(byDay).length ? Object.entries(byDay).map(([d, items]) => `<div class="agenda-day"><h3>${esc(fmtDay(d))}</h3>${items.map(apptRow).join('')}</div>`).join('') : '<div class="empty">No hay citas en estas dos semanas.</div>'}</div>`);
  bindAppts();
  document.getElementById('sc').onchange = e => { try { sessionStorage.setItem('showCancelled', e.target.checked ? '1' : '0'); } catch {} viewAgenda(from); };
}

// ---------- Detalle de cita ----------
async function viewBooking(bid) {
  const list = await adminApi('/api/bookings');
  const b = list.find(x => x.id === bid);
  if (!b) { toast('Cita no encontrada'); location.hash = '#/agenda'; return; }
  const link = `${location.origin}/c/${b.token}`;
  const when = `${fmtDay(b.date)} a las ${fmtTime(b.start)}`;
  const msgs = {
    confirm: `Hola ${b.name}, te confirmamos tu cita de ${b.serviceName} el ${when} en ${settings.businessName}. Si necesitas cancelar: ${link}`,
    remind: `Hola ${b.name}, te recordamos tu cita de ${b.serviceName} el ${when} en ${settings.businessName}. ¡Te esperamos!`,
    cancel: `Hola ${b.name}, lamentamos informarte que tu cita de ${b.serviceName} del ${when} fue cancelada. Escríbenos para reprogramarla.`
  };
  shell('agenda', `<p><a href="#/agenda/${b.date}">← Agenda</a></p>
    <div class="card"><div class="row between"><h1 style="margin:0">${esc(b.name)}</h1>${badge(b.status)}</div>
      <p class="cap" style="margin:.5rem 0 0"><strong>${esc(when)}</strong></p>
      <p class="muted" style="margin:.25rem 0">${esc(b.serviceName)} · ${durationLabel(b.duration)} ${b.price ? '· ' + esc(money(b.price, settings)) : ''} · ${b.source === 'web' ? 'Reservó en línea' : 'Creada en el panel'}${b.cancelledBy === 'cliente' ? ' · Cancelada por el cliente' : ''}</p>
      <p style="margin:.25rem 0">📞 ${esc(b.phone || '—')} ${b.email ? '· ✉️ ' + esc(b.email) : ''}</p>
      ${b.note ? `<p class="muted" style="white-space:pre-line">${esc(b.note)}</p>` : ''}
      <h2 style="margin-top:1.25rem">Estado</h2>
      <div class="row">${['confirmada', 'completada', 'no_asistio', 'cancelada', 'pendiente'].filter(s => s !== b.status).map(s => `<button class="btn sm" data-status="${s}">${esc(STATUS[s])}</button>`).join('')}</div>
      ${b.phone ? `<h2 style="margin-top:1.25rem">Escribir por WhatsApp</h2><div class="row">
        <a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, msgs.confirm)}">Confirmar cita</a>
        <a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, msgs.remind)}">Recordatorio</a>
        <a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, msgs.cancel)}">Avisar cancelación</a></div>` : ''}
    </div>
    <form class="card" id="resch"><h2>Reprogramar</h2><div class="grid cols-2">
      <div class="field"><label>Fecha</label><input type="date" name="date" value="${b.date}" required></div>
      <div class="field"><label>Hora</label><select name="start" id="slot"></select></div></div>
      <button class="btn">Guardar nueva hora</button></form>
    <form class="card" id="edit"><h2>Datos del cliente</h2><div class="grid cols-2">
      <div class="field"><label>Nombre</label><input name="name" value="${esc(b.name)}" required></div>
      <div class="field"><label>Teléfono</label><input name="phone" value="${esc(b.phone)}"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(b.email)}"></div></div>
      <div class="field"><label>Notas</label><textarea name="note">${esc(b.note)}</textarea></div>
      <div class="row between"><button class="btn">Guardar</button><button type="button" class="btn danger" id="del">Eliminar cita</button></div></form>`);
  const save = async (body, msg) => {
    try { await adminApi('/api/bookings/' + b.id, { method: 'PUT', body }); toast(msg); viewBooking(b.id); }
    catch (err) {
      if (err.data?.canForce && confirm(err.message + '. ¿Guardar de todos modos (sobrecupo)?')) return save({ ...body, force: true }, msg);
      toast(err.message);
    }
  };
  document.querySelectorAll('[data-status]').forEach(btn => btn.onclick = () => save({ status: btn.dataset.status }, 'Estado actualizado'));
  const dateInput = document.querySelector('#resch [name=date]');
  const loadSlots = async () => {
    const slots = await adminApi(`/api/slots?service=${b.serviceId}&date=${dateInput.value}&ignore=${b.id}`).catch(() => []);
    const opts = new Set(slots); if (dateInput.value === b.date) opts.add(b.start);
    document.getElementById('slot').innerHTML = [...opts].sort().map(t => `<option value="${t}" ${t === b.start && dateInput.value === b.date ? 'selected' : ''}>${fmtTime(t)}</option>`).join('') || '<option value="">Sin horarios libres</option>';
  };
  dateInput.onchange = loadSlots; loadSlots();
  document.getElementById('resch').onsubmit = e => { e.preventDefault(); const f = formData(e.target); if (!f.start) return toast('Elige una hora'); save(f, 'Cita reprogramada'); };
  document.getElementById('edit').onsubmit = e => { e.preventDefault(); save(formData(e.target), 'Datos guardados'); };
  document.getElementById('del').onclick = async () => {
    if (!confirm('¿Eliminar esta cita definitivamente?')) return;
    await adminApi('/api/bookings/' + b.id, { method: 'DELETE' }); toast('Cita eliminada'); location.hash = '#/agenda/' + b.date;
  };
}

// ---------- Nueva cita ----------
async function viewNew() {
  services = await adminApi('/api/services');
  const today = (await adminApi('/api/dashboard')).today;
  shell('nueva', `<h1>Nueva cita</h1>${!services.length ? '<div class="card">Primero crea un servicio en <a href="#/servicios">Servicios</a>.</div>' : `
    <form class="card" id="f"><div class="grid cols-2">
      <div class="field"><label>Servicio</label><select name="serviceId" id="sv">${services.map(s => `<option value="${s.id}">${esc(s.name)} (${durationLabel(s.duration)})</option>`).join('')}</select></div>
      <div class="field"><label>Fecha</label><input type="date" name="date" id="dt" value="${today}" required></div>
      <div class="field"><label>Hora</label><select name="start" id="slot"></select></div>
      <div class="field"><label>Nombre del cliente *</label><input name="name" required></div>
      <div class="field"><label>Teléfono / WhatsApp</label><input name="phone" inputmode="tel"></div>
      <div class="field"><label>Email</label><input name="email" type="email"></div></div>
      <div class="field"><label>Notas</label><textarea name="note"></textarea></div>
      <button class="btn primary">Crear cita</button></form>`}`);
  if (!services.length) return;
  const sv = document.getElementById('sv'), dt = document.getElementById('dt');
  const load = async () => {
    const slots = await adminApi(`/api/slots?service=${sv.value}&date=${dt.value}`).catch(() => []);
    document.getElementById('slot').innerHTML = slots.length ? slots.map(t => `<option value="${t}">${fmtTime(t)}</option>`).join('') : '<option value="">Sin horarios libres este día</option>';
  };
  sv.onchange = load; dt.onchange = load; load();
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const body = formData(e.target);
    if (!body.start) return toast('No hay horarios libres ese día');
    const create = async b => {
      try { const r = await adminApi('/api/bookings', { method: 'POST', body: b }); toast('Cita creada'); location.hash = '#/cita/' + r.id; }
      catch (err) { if (err.data?.canForce && confirm(err.message + '. ¿Crearla de todos modos?')) return create({ ...b, force: true }); toast(err.message); }
    };
    create(body);
  };
}

// ---------- Servicios ----------
async function viewServices() {
  services = await adminApi('/api/services');
  shell('servicios', `<div class="row between"><h1>Servicios</h1><button class="btn primary" id="add">+ Nuevo servicio</button></div>
    <div id="formBox"></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Servicio</th><th>Duración</th><th class="num">Precio</th><th>Estado</th><th></th></tr></thead>
    <tbody>${services.length ? services.map(s => `<tr><td><strong>${esc(s.name)}</strong>${s.description ? `<div class="muted" style="font-size:.85rem">${esc(s.description)}</div>` : ''}</td>
      <td>${durationLabel(s.duration)}</td><td class="num">${esc(money(s.price, settings) || '—')}</td><td>${s.active ? '<span class="badge confirmada">Visible</span>' : '<span class="badge">Oculto</span>'}</td>
      <td class="num"><button class="btn sm" data-edit="${s.id}">Editar</button> <button class="btn sm danger" data-del="${s.id}">Eliminar</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Crea tu primer servicio: corte de cabello, consulta, manicure…</td></tr>'}</tbody></table></div></div>`);
  const form = s => {
    s ||= { name: '', duration: 30, price: 0, description: '', active: true };
    const box = document.getElementById('formBox');
    box.innerHTML = `<form class="card" id="sf"><h2>${s.id ? 'Editar servicio' : 'Nuevo servicio'}</h2><div class="grid cols-2">
      <div class="field"><label>Nombre *</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="field"><label>Duración (minutos)</label><input name="duration" type="number" min="5" step="5" value="${s.duration}" required></div>
      <div class="field"><label>Precio (opcional)</label><input name="price" type="number" min="0" step="any" value="${s.price}"></div>
      <div class="field"><label>Descripción corta</label><input name="description" value="${esc(s.description)}"></div></div>
      <label style="display:flex;gap:.5rem;align-items:center;color:var(--text)"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} style="width:auto"> Visible en la página de reservas</label>
      <div class="row" style="margin-top:.75rem"><button class="btn primary">Guardar</button><button type="button" class="btn" id="cx">Cancelar</button></div></form>`;
    document.getElementById('cx').onclick = () => { box.innerHTML = ''; };
    document.getElementById('sf').onsubmit = async e => {
      e.preventDefault();
      const body = { ...formData(e.target), active: e.target.active.checked };
      try { await adminApi(s.id ? '/api/services/' + s.id : '/api/services', { method: s.id ? 'PUT' : 'POST', body }); toast('Servicio guardado'); viewServices(); } catch (err) { toast(err.message); }
    };
    box.querySelector('input').focus();
  };
  document.getElementById('add').onclick = () => form(null);
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(services.find(s => s.id === b.dataset.edit)));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar este servicio? Las citas ya creadas se conservan.')) return;
    await adminApi('/api/services/' + b.dataset.del, { method: 'DELETE' }); toast('Servicio eliminado'); viewServices();
  });
}

// ---------- Horario ----------
async function viewHours() {
  settings = await adminApi('/api/settings');
  const blocked = await adminApi('/api/blocked');
  const hours = structuredClone(settings.hours);
  shell('horario', `<h1>Horario de atención</h1>
    <form class="card" id="hf"><p class="muted">Agrega varios tramos si cierras al mediodía (por ejemplo 8:00–12:00 y 14:00–18:00).</p><div id="rows"></div>
      <button class="btn primary" style="margin-top:1rem">Guardar horario</button></form>
    <div class="card"><h2>Días bloqueados</h2><p class="muted">Festivos, vacaciones o días en que no atiendes.</p>
      <form id="bf" class="row" style="margin-bottom:.75rem"><input type="date" name="date" required style="width:auto"><input name="reason" placeholder="Motivo (opcional)" style="flex:1;min-width:160px"><button class="btn">Bloquear día</button></form>
      ${blocked.length ? `<table>${blocked.map(b => `<tr><td class="cap">${esc(fmtDay(b.date))}</td><td class="muted">${esc(b.reason)}</td><td class="num"><button class="btn sm" data-unblock="${b.date}">Quitar</button></td></tr>`).join('')}</table>` : '<p class="muted">Ningún día bloqueado.</p>'}</div>`);
  const render = () => {
    document.getElementById('rows').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<div class="hours-row"><strong>${DAYS[d]}</strong><div class="ranges">
      ${(hours[d] || []).map((r, i) => `<span><input type="time" data-d="${d}" data-i="${i}" data-k="open" value="${r.open}"> – <input type="time" data-d="${d}" data-i="${i}" data-k="close" value="${r.close}">
        <button type="button" class="btn sm danger" data-rm="${d}:${i}" aria-label="Quitar tramo">✕</button></span>`).join('') || '<span class="muted">Cerrado</span>'}
      <button type="button" class="btn sm" data-add="${d}">+ Tramo</button></div></div>`).join('');
    document.querySelectorAll('#rows input[type=time]').forEach(inp => inp.onchange = () => { hours[inp.dataset.d][inp.dataset.i][inp.dataset.k] = inp.value; });
    document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const d = b.dataset.add; (hours[d] ||= []).push(hours[d].length ? { open: '14:00', close: '18:00' } : { open: '09:00', close: '18:00' }); render(); });
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const [d, i] = b.dataset.rm.split(':'); hours[d].splice(+i, 1); render(); });
  };
  render();
  document.getElementById('hf').onsubmit = async e => {
    e.preventDefault();
    for (const d in hours) for (const r of hours[d]) if (!r.open || !r.close || r.open >= r.close) return toast(`Revisa el horario del ${DAYS[d].toLowerCase()}: la hora de cierre debe ser después de la de apertura`);
    try { settings = await adminApi('/api/settings', { method: 'PUT', body: { hours } }); toast('Horario guardado'); } catch (err) { toast(err.message); }
  };
  document.getElementById('bf').onsubmit = async e => { e.preventDefault(); await adminApi('/api/blocked', { method: 'POST', body: formData(e.target) }); toast('Día bloqueado'); viewHours(); };
  document.querySelectorAll('[data-unblock]').forEach(b => b.onclick = async () => { await adminApi('/api/blocked/' + b.dataset.unblock, { method: 'DELETE' }); viewHours(); });
}

// ---------- Ajustes ----------
async function viewSettings() {
  const s = settings = await adminApi('/api/settings');
  const f = (name, label, attrs = '') => `<div class="field"><label>${label}</label><input name="${name}" value="${esc(s[name])}" ${attrs}></div>`;
  shell('ajustes', `<h1>Ajustes</h1>
    <form id="f" class="card"><h2>Tu negocio</h2><div class="grid cols-2">
      ${f('businessName', 'Nombre del negocio', 'required')}${f('whatsapp', 'WhatsApp del negocio (con indicativo)', 'placeholder="+57 300 000 0000" inputmode="tel"')}
      ${f('address', 'Dirección')}${f('welcome', 'Mensaje de bienvenida')}</div>
      <h2 style="margin-top:1rem">Reglas de reserva</h2><div class="grid cols-2">
      <div class="field"><label>Intervalo entre horarios</label><select name="slotStep">${[10, 15, 20, 30, 45, 60].map(v => `<option value="${v}" ${v === s.slotStep ? 'selected' : ''}>Cada ${v} min</option>`).join('')}</select></div>
      ${f('minNotice', 'Anticipación mínima (minutos)', 'type="number" min="0"')}
      ${f('maxDaysAhead', 'Reservar hasta cuántos días adelante', 'type="number" min="1" max="365"')}
      ${f('capacity', 'Citas simultáneas (personas que atienden)', 'type="number" min="1" max="50"')}
      <div class="field"><label>Zona horaria</label><select name="timezone">${['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/Guayaquil', 'America/Panama', 'America/Santo_Domingo', 'America/Guatemala', 'America/Costa_Rica', 'America/Montevideo', 'America/Asuncion', 'America/La_Paz', 'America/New_York', 'Europe/Madrid'].map(v => `<option ${v === s.timezone ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Moneda</label><select name="currency">${['COP', 'MXN', 'USD', 'EUR', 'PEN', 'CLP', 'ARS', 'GTQ', 'DOP', 'CRC', 'BOB', 'UYU', 'PYG'].map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
      <div class="field"><label>Política de cancelación (se muestra al reservar)</label><input name="cancelPolicy" value="${esc(s.cancelPolicy)}"></div>
      <button class="btn primary">Guardar ajustes</button></form>
    <form id="pw" class="card"><h2>Cambiar contraseña</h2><div class="grid cols-2">
      <div class="field"><label>Contraseña actual</label><input name="current" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div></div>
      <button class="btn">Actualizar contraseña</button></form>
    <div class="card"><h2>Copia de seguridad</h2><p class="muted">Descarga servicios, horario y citas en un archivo. Hazlo antes de actualizar o mover la app.</p>
      <div class="row"><a class="btn" href="/api/backup">Descargar copia</a>
      <label class="btn" style="margin:0;color:var(--text)">Restaurar desde archivo…<input type="file" id="restore" accept="application/json,.json" hidden></label></div></div>`);
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { settings = await adminApi('/api/settings', { method: 'PUT', body: formData(e.target) }); toast('Ajustes guardados'); } catch (err) { toast(err.message); }
  };
  document.getElementById('pw').onsubmit = async e => {
    e.preventDefault();
    try { await adminApi('/api/password', { method: 'PUT', body: formData(e.target) }); e.target.reset(); toast('Contraseña actualizada'); } catch (err) { toast(err.message); }
  };
  document.getElementById('restore').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('Esto reemplazará servicios, horario y citas por los del archivo. Se guardará una copia del estado actual en el servidor. ¿Continuar?')) { e.target.value = ''; return; }
    try { const r = await adminApi('/api/restore', { method: 'POST', body: JSON.parse(await file.text()) }); toast(`Restaurado: ${r.services} servicios, ${r.bookings} citas`); settings = null; setTimeout(route, 800); }
    catch (err) { toast(err.message.includes('JSON') ? 'El archivo no es válido' : err.message); e.target.value = ''; }
  };
}

// ---------- Router ----------
async function route() {
  const st = await fetch('/api/status').then(r => r.json());
  if (st.setup) return viewSetup();
  if (!st.authed) return viewLogin();
  const h = location.hash.slice(1) || '/';
  if (h === '/login') { location.hash = '#/'; return; }
  if (!settings) settings = await adminApi('/api/settings');
  try {
    let m;
    if (h === '/') return await viewHome();
    if (h === '/agenda') return await viewAgenda();
    if ((m = h.match(/^\/agenda\/(\d{4}-\d{2}-\d{2})$/))) return await viewAgenda(m[1]);
    if ((m = h.match(/^\/cita\/([a-f0-9]+)$/))) return await viewBooking(m[1]);
    if (h === '/nueva') return await viewNew();
    if (h === '/servicios') return await viewServices();
    if (h === '/horario') return await viewHours();
    if (h === '/ajustes') return await viewSettings();
    location.hash = '#/';
  } catch (err) { if (err.status !== 401) toast(err.message); }
}
window.addEventListener('hashchange', route);
route();
