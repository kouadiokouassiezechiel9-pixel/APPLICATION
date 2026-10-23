const $ = s => document.querySelector(s);
const el = (t, a = {}, ...k) => { const e = document.createElement(t); Object.assign(e, a); e.append(...k); return e; };
const fmt = n => Number(n).toLocaleString('fr-FR') + ' francs';
const tier = n => (n <= 10 ? 5000 : n <= 20 ? 10000 : 10000 + 3000 * Math.ceil((n - 20) / 10)); // affichage seulement, le serveur décide
const api = async (p, m = 'GET', b) => {
  const r = await fetch('/api/' + p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur');
  return j;
};
let toastTimer;
const say = (t, ok = true) => { const b = $('#toast'); if (!b) return alert(t); clearTimeout(toastTimer); b.textContent = t; b.className = ok ? 'ok' : 'err'; b.hidden = !t;
  if (t && ok) toastTimer = setTimeout(() => { b.hidden = true; }, 8000); };
const run = f => async ev => {
  const btn = ev && ev.currentTarget; if (btn) btn.disabled = true; say('Veuillez patienter…');
  try { await f(); if ($('#toast').textContent === 'Veuillez patienter…') say(''); }
  catch (e) { say(e.message || 'Erreur', false); }
  finally { if (btn) btn.disabled = false; }
};
let cart = [], me = null;
const goPay = async r => { if (r.payUrl) location.href = r.payUrl; else await loadMerchant(); }; // Wave : redirection ; sinon mode test
const back = new URLSearchParams(location.search).get('paiement');
if (back) { history.replaceState(null, '', '/'); setTimeout(() => say(back === 'ok' ? 'Retour de Wave. Votre paiement est en cours de confirmation, il apparaîtra dans quelques instants (actualisez la page).' : 'Le paiement Wave n\'a pas abouti. Vous pouvez réessayer.'), 300); }

async function refresh() {
  try { me = await api('me'); } catch { me = null; }
  $('#auth').hidden = !!me; $('#logout').hidden = !me;
  $('#who').textContent = me ? me.name + ' (' + me.role + ')' : '';
  $('#merchant').hidden = !(me && me.role === 'merchant');
  if (!$('#merchant').hidden) await loadMerchant();
  const talk = !!me && me.role !== 'admin';
  $('#convs').hidden = !talk; $('#myorders').hidden = !(me && me.role === 'client');
  if (talk) await loadThreads();
  if (me && me.role === 'client') await loadMyOrders();
}
const STATUS = { pending: 'en attente', preparing: 'en préparation', delivered: 'livrée' };
const PAY = { wave: 'Wave' };
async function loadMyOrders() {
  const l = await api('orders/mine');
  $('#mo').replaceChildren(...(l.length ? l : [null]).map(o => o ? el('div', { className: 'card' },
    el('b', {}, 'Commande #' + o.id + ' - ' + fmt(o.total) + ' - ' + (o.payment_status === 'paid' ? 'acompte ' + fmt(o.deposit) + ' payé, reste ' + fmt(o.total - o.deposit) + ' à la livraison' : o.payment_status === 'unpaid' ? 'en attente du paiement Wave de l\'acompte' : 'annulée')),
    el('p', { className: 'small' }, o.items.map(i => i.name + ' ×' + i.qty + ' (' + STATUS[i.status] + ')').join(', ') + ' · ' + o.delivery_location)) : el('p', {}, 'Aucune commande.')));
}
async function loadThreads() {
  const l = await api('threads');
  $('#threads').replaceChildren(...(l.length ? l : [null]).map(t => t ? el('div', { className: 'card' },
    t.label + (t.unread ? ' (' + t.unread + ' nouveau' + (t.unread > 1 ? 'x' : '') + ')' : '') + ' ',
    el('button', { onclick: () => openChat(t.other_id, t.label) }, 'Ouvrir')) : el('p', {}, 'Aucune conversation.')));
}
let chatWith = null, chatArticle = null, chatTimer = null;
async function drawChat() {
  const l = await api('messages/' + chatWith);
  $('#chMsgs').replaceChildren(...l.map(m => el('div', { className: m.sender_id === me.id ? 'me' : '' },
    (m.article ? '[' + m.article + '] ' : '') + m.body)));
  $('#chMsgs').scrollTop = 1e9;
}
function openChat(id, label, articleId) {
  chatWith = id; chatArticle = articleId; $('#chTitle').textContent = label;
  $('#chat').showModal(); drawChat().catch(() => {});
  clearInterval(chatTimer); chatTimer = setInterval(() => drawChat().catch(() => {}), 5000);
}
$('#chClose').onclick = () => { clearInterval(chatTimer); $('#chat').close(); if (me) loadThreads().catch(() => {}); };
$('#chat').addEventListener('close', () => clearInterval(chatTimer));
$('#chSend').onclick = run(async () => {
  await api('messages', 'POST', { to: chatWith, body: $('#chText').value, articleId: chatArticle });
  $('#chText').value = ''; await drawChat();
});
async function search() {
  const list = await api('articles?q=' + encodeURIComponent($('#q').value));
  $('#results').replaceChildren(...list.map(a => el('div', { className: 'card' },
    a.has_photo ? el('img', { className: 'ph', src: '/api/articles/' + a.id + '/photo', alt: a.name, loading: 'lazy' }) : '',
    el('b', {}, a.name), el('p', {}, a.description || ''),
    a.premium ? el('p', { className: 'small' }, '★ Premium') : '', el('p', { className: 'small' }, a.details || ''),
    el('p', {}, fmt(a.price) + ' · ' + a.shop_name + ' · stock ' + a.stock),
    el('button', { onclick: run(async () => { if (!me || me.role !== 'client') throw new Error('Connectez-vous avec un compte client pour poser une question'); openChat(a.merchant_id, a.shop_name, a.id); }) }, 'Poser une question'), ' ',
    el('button', { onclick: () => { const c = cart.find(x => x.id === a.id); c ? c.qty++ : cart.push({ id: a.id, name: a.name, price: a.price, qty: 1 }); drawCart(); } }, 'Ajouter au panier'))));
}
function drawCart() {
  $('#cart').replaceChildren(...cart.map(c => el('div', {}, c.name + ' × ' + c.qty + ' ',
    el('button', { onclick: () => { cart = cart.filter(x => x !== c); drawCart(); } }, 'Retirer'))));
}
// ---- Photos : réduction dans le navigateur (max 800 px, JPEG) puis envoi ----
async function compress(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (JPG, PNG...)');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = URL.createObjectURL(file); }); }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, 800 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.72));
  if (!blob) throw new Error('Impossible de préparer la photo');
  return blob;
}
async function sendPhoto(id, file) {
  const blob = await compress(file);
  const r = await fetch('/api/merchant/articles/' + id + '/photo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Envoi de la photo impossible'); }
}
async function loadMerchant() {
  const m = await api('merchant/me');
  $('#quota').textContent = (m.validated ? '' : 'Compte en attente de validation. ') + (m.plan ? 'Abonnement ' + m.plan + ' jusqu\'au ' + new Date(m.plan_expires_at).toLocaleDateString('fr-FR') : 'Aucun abonnement mensuel actif : vos articles sont masqués') + ' · Articles en ligne : ' + m.used + ' / ' + m.quota;
  $('#tier').replaceChildren(...[10, 20, 30, 40, 50, 100].map(n => el('option', { value: n }, n + ' articles - ' + fmt(tier(n)))));
  const list = await api('merchant/articles');
  $('#mine').replaceChildren(...list.map(a => el('div', { className: 'row' },
    a.has_photo ? el('img', { className: 'thumb', src: '/api/articles/' + a.id + '/photo?v=' + Date.now(), alt: '' }) : '',
    a.name + (a.details ? ' (' + a.details + ')' : '') + ' - ' + fmt(a.price) + ' - stock ' + a.stock + ' ',
    el('label', { className: 'btn' }, a.has_photo ? 'Changer la photo' : 'Ajouter une photo',
      el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: run(async ev => { const f = ev.target.files[0]; if (!f) return; await sendPhoto(a.id, f); say('Photo enregistrée.'); await loadMerchant(); }) })),
    el('button', { onclick: run(async () => { await api('merchant/articles/' + a.id, 'DELETE'); await loadMerchant(); }) }, 'Supprimer'))));
  const od = await api('merchant/orders');
  $('#morders').replaceChildren(...(od.length ? od : [null]).map(o => o ? el('div', { className: 'card' },
    el('b', {}, 'Commande #' + o.id + ' - ' + fmt(o.total) + ' - ' + STATUS[o.status]),
    el('p', {}, 'Acompte payé : ' + fmt(o.deposit) + ' · À encaisser à la livraison : ' + fmt(o.balance)),
    el('p', {}, o.items.map(i => i.name + ' ×' + i.qty).join(', ')),
    el('p', { className: 'small' }, o.customer_name + ' · ' + o.customer_phone + ' · ' + o.delivery_location + ' · paiement ' + PAY[o.payment_method]),
    ...['pending', 'preparing', 'delivered'].filter(s => s !== o.status).map(s => el('button', { onclick: run(async () => { await api('merchant/orders/' + o.id + '/status', 'POST', { status: s }); await loadMerchant(); }) }, '→ ' + STATUS[s]))) : el('p', {}, 'Aucune commande reçue.')));
}

$('#go').onclick = run(search);
$('#login').onclick = run(async () => { await api('login', 'POST', { email: $('#email').value, password: $('#password').value }); await refresh(); });
$('#register').onclick = run(async () => {
  await api('register', 'POST', { role: $('#role').value, name: $('#name').value, email: $('#remail').value, phone: $('#phone').value || undefined,
    password: $('#rpassword').value, shopName: $('#shop').value || undefined, location: $('#loc').value || undefined });
  say('Compte créé ! Vous pouvez maintenant vous connecter avec le même e-mail et mot de passe.');
});
$('#logout').onclick = run(async () => { await api('logout', 'POST', {}); await refresh(); });
$('#order').onclick = run(async () => {
  if (!me || me.role !== 'client') throw new Error('Connectez-vous avec un compte client pour commander');
  if (!cart.length) throw new Error('Panier vide');
  $('#ckName').value = me.name; const tot = cart.reduce((n, c) => n + c.price * c.qty, 0), dep = Math.ceil(tot / 2);
  $('#ckTotal').textContent = 'Total : ' + fmt(tot) + ' · À payer maintenant sur Wave (50 %) : ' + fmt(dep) + ' · Reste à payer à la livraison : ' + fmt(tot - dep);
  $('#checkout').showModal();
});
$('#ckCancel').onclick = () => $('#checkout').close();
$('#ckOk').onclick = run(async () => {
  const r = await api('orders', 'POST', { items: cart.map(c => ({ id: c.id, qty: c.qty })), customerName: $('#ckName').value,
    customerPhone: $('#ckPhone').value, deliveryLocation: $('#ckLoc').value, paymentMethod: 'wave' });
  $('#checkout').close(); cart = [];
  if (r.payUrl) { location.href = r.payUrl; return; } // paiement sur Wave
  drawCart(); say('Commande #' + r.id + ' payée (mode test).'); await search(); await loadMyOrders();
});
$('#planStd').onclick = run(async () => { goPay(await api('merchant/plan', 'POST', { tier: 'standard' })); });
$('#planPre').onclick = run(async () => { goPay(await api('merchant/plan', 'POST', { tier: 'premium' })); });
$('#pay').onclick = run(async () => goPay(await api('merchant/subscribe', 'POST', { quota: +$('#tier').value })));
$('#aphoto').onchange = () => { const f = $('#aphoto').files[0], p = $('#apreview'); if (!f) { p.hidden = true; return; } p.src = URL.createObjectURL(f); p.hidden = false; };
$('#add').onclick = run(async () => {
  if (!$('#legal').checked) throw new Error('Vous devez certifier que le produit est légal en Côte d\'Ivoire');
  const created = await api('merchant/articles', 'POST', { name: $('#an').value, price: +$('#ap').value, stock: +$('#as').value, description: $('#ad').value || undefined, details: $('#adet').value || undefined, legalConfirm: $('#legal').checked });
  const file = $('#aphoto').files[0]; let msg = 'Article ajouté.', ok = true;
  if (file) { try { await sendPhoto(created.id, file); msg = 'Article et photo enregistrés.'; } catch (e) { msg = 'Article ajouté, mais la photo n\'a pas été envoyée : ' + e.message + ' (vous pouvez l\'ajouter depuis la liste ci-dessous).'; ok = false; } }
  $('#aphoto').value = ''; $('#apreview').hidden = true;
  await loadMerchant(); say(msg, ok);
});
refresh(); search();
