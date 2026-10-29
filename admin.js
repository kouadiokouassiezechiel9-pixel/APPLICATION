const $ = s => document.querySelector(s);
const el = (t, a = {}, ...k) => { const e = document.createElement(t); Object.assign(e, a); e.append(...k); return e; };
const api = async (p, m = 'GET', b) => {
  const r = await fetch('/api/' + p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur');
  return j;
};
const run = f => async () => { try { await f(); } catch (e) { alert(e.message); } };

async function dash() {
  $('#login').hidden = $('#step2').hidden = true; $('#dash').hidden = false;
  const s = await api('admin/stats');
  $('#stats').textContent = s.users + ' utilisateurs · ' + s.orders + ' commandes · ' + Number(s.revenue).toLocaleString('fr-FR') + ' francs encaissés (abonnements)';
  const pend = await api('admin/merchants/pending');
  $('#pending').replaceChildren(...(pend.length ? pend : [null]).map(m => m
    ? el('div', { className: 'row' }, m.shop_name + ' - ' + m.name + ' (' + m.email + ') ',
        el('button', { onclick: run(async () => { await api('admin/merchants/' + m.id + '/validate', 'POST', {}); await dash(); }) }, 'Valider'))
    : el('p', {}, 'Aucun commerçant en attente.')));
  const nt = await api('notifications');
  $('#adminNotifs').replaceChildren(...(nt.items.length ? nt.items.slice(0, 10) : [null]).map(n => n ? el('div', { className: 'row' }, (n.read ? '' : '● ') + n.title + (n.body ? ' — ' + n.body : '')) : el('p', {}, 'Aucune notification.')));
  if (nt.unread) await api('notifications/read', 'POST', {});
  const sr = await api('admin/star-requests');
  $('#starReq').replaceChildren(...(sr.length ? sr : [null]).map(m => m
    ? el('div', { className: 'row' }, m.shop_name + ' (' + m.email + ') · ' + (m.rating ? m.rating + '/5, ' + m.reviews + ' avis' : 'aucun avis') + ' ',
        el('button', { onclick: run(async () => { await api('admin/merchants/' + m.id + '/stars', 'POST', { decision: 'approve' }); await dash(); }) }, 'Confirmer'), ' ',
        el('button', { onclick: run(async () => { await api('admin/merchants/' + m.id + '/stars', 'POST', { decision: 'reject' }); await dash(); }) }, 'Refuser'))
    : el('p', {}, 'Aucune demande en attente.')));
  const arts = await api('admin/articles');
  $('#arts').replaceChildren(...arts.map(a => el('div', { className: 'row' },
    a.name + ' - ' + a.shop_name + ' - ' + a.price + ' francs' + (a.moderation === 'removed' ? ' [RETIRÉ]' : '') + ' ',
    ...(a.moderation === 'ok' ? [el('button', { onclick: run(async () => { const reason = prompt('Motif du retrait (produit illégal, etc.) :'); if (reason) { await api('admin/articles/' + a.id + '/remove', 'POST', { reason }); await dash(); } }) }, 'Retirer')] : []))));
  const users = await api('admin/users');
  $('#users').replaceChildren(...users.map(u => el('div', { className: 'row' },
    u.name + ' - ' + u.role + ' - ' + u.status + ' ',
    ...(u.role !== 'admin' && u.status === 'active'
      ? [el('button', { onclick: run(async () => { if (confirm('Suspendre ' + u.name + ' ?')) { await api('admin/users/' + u.id + '/suspend', 'POST', {}); await dash(); } }) }, 'Suspendre')] : []))));
}
$('#go').onclick = run(async () => {
  const r = await api('admin/login', 'POST', { email: $('#email').value, password: $('#password').value });
  $('#login').hidden = true; $('#step2').hidden = false;
  $('#setup').hidden = r.step !== 'setup';
  if (r.step === 'setup') $('#secret').textContent = r.secret;
});
$('#verify').onclick = run(async () => { await api('admin/2fa', 'POST', { code: $('#code').value }); $('#code').value = ''; await dash(); });
$('#logout').onclick = run(async () => { await api('logout', 'POST', {}); location.reload(); });
api('me').then(m => { if (m.role === 'admin') dash(); }).catch(() => {});
