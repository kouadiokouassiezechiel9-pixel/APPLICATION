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

// ---- Rayons (sections du marché) ----
const ss = { get: k => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
let CATS = [], rayon = ss.get('rayon');
const catLabel = id => (CATS.find(c => c.id === id) || {}).label || '';
async function loadCats() { if (!CATS.length) CATS = await api('categories'); }
function updateRayonBar() { $('#rayonName').textContent = rayon ? catLabel(rayon) : 'Tous les rayons'; }
async function chooseRayon(id) {
  rayon = id; ss.set('rayon', id); if ($('#rayons').open) $('#rayons').close();
  updateRayonBar(); await search(); $('#results').scrollIntoView({ behavior: 'smooth' });
}
async function openRayons() {
  await loadCats();
  $('#rayonGrid').replaceChildren(...CATS.map(c => el('button', { onclick: run(async () => chooseRayon(c.id)) },
    el('b', {}, c.label), el('br'), el('span', { className: 'small' }, c.hint + ' · ' + c.count + ' article' + (c.count > 1 ? 's' : '')))));
  ss.set('rayonVu', '1'); $('#rayons').showModal();
}
async function fillCats() {
  await loadCats(); const sel = $('#acat');
  if (sel.options.length < 2) CATS.forEach(c => sel.append(el('option', { value: c.id }, c.label)));
}
let mode = 'merchant';   // un commerçant choisit : son espace, ou l'achat comme un client
const ROLE_FR = { client: 'client', merchant: 'commerçant', admin: 'administrateur' };
const authMode = reg => { $('#loginBox').hidden = reg; $('#registerBox').hidden = !reg; };
async function refresh() {
  try { me = await api('me'); } catch { me = null; }
  $('#auth').hidden = !!me; $('#logout').hidden = !me; $('#bell').hidden = !me || me.role === 'admin';
  if (me && me.role !== 'admin') { pollNotifs(); if (!notifTimer) notifTimer = setInterval(pollNotifs, 30000); } else { clearInterval(notifTimer); notifTimer = null; setUnread(0); }
  if (!me) { mode = 'merchant'; authMode(false); }
  $('#who').textContent = me ? me.name + ' (' + (ROLE_FR[me.role] || me.role) + ')' : '';
  const isM = !!me && me.role === 'merchant';
  const buying = !!me && (me.role === 'client' || (isM && mode === 'client'));
  $('#modeBar').hidden = !isM;
  $('#modeMerchant').className = mode === 'merchant' ? 'on' : ''; $('#modeClient').className = mode === 'client' ? 'on' : '';
  $('#searchBox').hidden = !buying; $('#cartBox').hidden = !buying;   // recherche et panier : clients, et commerçants en mode achat
  if (buying) {
    await loadCats().catch(() => {}); updateRayonBar(); await search();
    if (!ss.get('rayonVu')) openRayons().catch(() => {});   // message d'accueil : choisir un rayon
  }
  $('#merchant').hidden = !(isM && mode === 'merchant');
  if (!$('#merchant').hidden) await loadMerchant();
  const talk = !!me && me.role !== 'admin';
  $('#convs').hidden = !talk; $('#myorders').hidden = !buying;
  if (talk) await loadThreads();
  if (buying) await loadMyOrders();
}
const STATUS = { pending: 'en attente', preparing: 'en préparation', delivered: 'livrée' };
const PAY = { wave: 'Wave' };
async function loadMyOrders() {
  const l = await api('orders/mine');
  $('#mo').replaceChildren(...(l.length ? l : [null]).map(o => {
    if (!o) return el('p', {}, 'Aucune commande.');
    // boutiques dont les articles sont livrés : le client peut les noter (une fois par commande)
    const livrees = [...new Map(o.items.filter(i => i.status === 'delivered').map(i => [i.merchant_id, i.shop])).entries()];
    const notes = livrees.map(([mid, shop]) => {
      const recu = o.items.some(i => i.merchant_id === mid && i.status === 'delivered' && i.received);
      if (!recu) return el('p', {}, shop + ' a livré votre commande. ', el('button', { onclick: run(async () => { await api('orders/' + o.id + '/received', 'POST', { merchantId: mid }); say('Réception confirmée. Vous pouvez maintenant noter la boutique.'); await loadMyOrders(); }) }, 'J\'ai bien reçu ma commande'));
      if ((o.reviewed || []).includes(mid)) return el('p', { className: 'small' }, '✔ Vous avez noté ' + shop);
      const sel = el('select', {}, ...[5, 4, 3, 2, 1].map(n => el('option', { value: n }, n + ' / 5 ' + '★'.repeat(n))));
      return el('p', {}, 'Noter ' + shop + ' : ', sel,
        el('button', { onclick: run(async () => { await api('orders/' + o.id + '/review', 'POST', { merchantId: mid, score: +sel.value }); say('Merci pour votre note !'); await loadMyOrders(); }) }, 'Envoyer la note'));
    });
    return el('div', { className: 'card' },
      el('b', {}, 'Commande #' + o.id + ' - ' + fmt(o.total) + ' - ' + (o.payment_status === 'paid' ? 'acompte ' + fmt(o.deposit) + ' payé, reste ' + fmt(o.total - o.deposit) + ' à la livraison' : o.payment_status === 'unpaid' ? 'en attente du paiement Wave de l\'acompte' : 'annulée')),
      el('p', { className: 'small' }, o.items.map(i => i.name + ' ×' + i.qty + ' (' + STATUS[i.status] + ')').join(', ') + ' · ' + o.delivery_location),
      ...notes);
  }));
}
async function loadThreads() {
  const l = await api('threads');
  $('#threads').replaceChildren(...(l.length ? l : [null]).map(t => t ? el('div', { className: 'card' },
    t.label + (me && me.role === 'merchant' ? (t.side === 'buyer' ? ' · vos achats' : ' · vos ventes') : '') + (t.unread ? ' (' + t.unread + ' nouveau' + (t.unread > 1 ? 'x' : '') + ')' : '') + ' ',
    el('button', { onclick: () => openChat(t.other_id, t.label, undefined, t.side) }, 'Ouvrir')) : el('p', {}, 'Aucune conversation.')));
}
let chatWith = null, chatArticle = null, chatTimer = null, chatSide = 'buyer';
async function drawChat() {
  const l = await api('messages/' + chatWith + '?side=' + chatSide);
  $('#chMsgs').replaceChildren(...l.map(m => el('div', { className: m.sender_id === me.id ? 'me' : '' },
    (m.article ? '[' + m.article + '] ' : '') + m.body)));
  $('#chMsgs').scrollTop = 1e9;
}
function openChat(id, label, articleId, side) {
  chatWith = id; chatArticle = articleId; chatSide = side || 'buyer'; $('#chTitle').textContent = label;
  $('#chat').showModal(); drawChat().catch(() => {});
  clearInterval(chatTimer); chatTimer = setInterval(() => drawChat().catch(() => {}), 5000);
}
$('#chClose').onclick = () => { clearInterval(chatTimer); $('#chat').close(); if (me) loadThreads().catch(() => {}); };
$('#chat').addEventListener('close', () => clearInterval(chatTimer));
$('#chSend').onclick = run(async () => {
  await api('messages', 'POST', { to: chatWith, body: $('#chText').value, articleId: chatArticle, side: chatSide });
  $('#chText').value = ''; await drawChat();
});
const stars = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
let shopFilter = 0;
function showBanner(name) {
  const b = $('#shopBanner'); b.hidden = !shopFilter;
  b.replaceChildren(el('span', {}, 'Articles de la boutique : ' + name + ' '),
    el('button', { onclick: run(async () => { shopFilter = 0; b.hidden = true; await search(); }) }, 'Voir tous les articles'));
}
async function viewShopArticles(s) {
  shopFilter = s.id; $('#q').value = ''; $('#shops').hidden = true; showBanner(s.shop_name);
  await search(); $('#results').scrollIntoView({ behavior: 'smooth' });
}
const yearsText = s => s.years == null ? '' : s.years > 0 ? 'Depuis ' + s.years + ' an' + (s.years > 1 ? 's' : '') : 'Nouvelle boutique';
function showShopInfo(s) {
  const d = $('#shopInfo');
  d.replaceChildren(
    s.has_logo ? el('img', { className: 'logo', src: '/api/shops/' + s.id + '/logo', alt: 'Logo de ' + s.shop_name }) : '',
    el('h2', {}, s.shop_name),
    el('p', {}, el('span', { className: 'stars' }, stars(s.stars)), s.rating ? ' ' + s.rating + '/5 (' + s.reviews + ' avis)' : ' pas encore d\'avis'),
    el('p', { className: 'small' }, [s.location, yearsText(s)].filter(Boolean).join(' · ')),
    s.description ? el('p', { className: 'desc' }, s.description) : el('p', { className: 'small' }, 'Cette boutique n\'a pas encore rédigé sa présentation.'),
    el('p', {}, el('button', { onclick: run(async () => { d.close(); await viewShopArticles(s); }) }, 'Voir ses articles'), ' ',
      s.whatsapp ? el('button', { onclick: () => openWa(s.whatsapp, 'Bonjour ' + s.shop_name + ', je vous contacte depuis Marketplace.') }, 'WhatsApp') : '', ' ',
      el('button', { id: 'shopInfoClose', onclick: () => d.close() }, 'Fermer')));
  d.showModal();
}
async function showShops() {
  const box = $('#shops');
  if (!box.hidden) { box.hidden = true; return; }
  const l = await api('shops');
  box.replaceChildren(...(l.length ? l : [null]).map(s => s ? el('div', { className: 'card' },
    s.has_logo ? el('img', { className: 'logo', src: '/api/shops/' + s.id + '/logo', alt: 'Logo de ' + s.shop_name, loading: 'lazy' }) : '',
    el('b', {}, s.shop_name), s.premium ? el('p', { className: 'small' }, 'Premium') : '',
    el('p', { className: 'small' }, [s.location, yearsText(s)].filter(Boolean).join(' · ')),
    s.description ? el('p', { className: 'clamp' }, s.description) : '',
    el('p', {}, el('span', { className: 'stars' }, stars(s.stars)), s.rating ? ' ' + s.rating + '/5 (' + s.reviews + ' avis)' : ' pas encore d\'avis'),
    el('p', { className: 'small' }, s.articles + ' article' + (s.articles > 1 ? 's' : '') + ' en ligne'),
    el('button', { onclick: () => showShopInfo(s) }, 'Présentation'), ' ',
    el('button', { onclick: run(async () => viewShopArticles(s)) }, 'Voir ses articles'))
    : el('p', {}, 'Aucune boutique disponible pour le moment.')));
  box.hidden = false;
}
function drawStars(m) {
  const r = m.rules || {};
  const kids = [el('p', {}, 'Étoiles de la boutique : ', el('span', { className: 'stars' }, stars(m.stars)),
    m.reviews ? ' · moyenne ' + m.rating + '/5 (' + m.reviews + ' avis)' : ' · aucun avis pour l\'instant')];
  if (m.stars === 1) kids.push(el('p', { className: 'small' }, 'Pour passer à 3 étoiles : au moins ' + r.minReviews + ' avis avec une moyenne de ' + r.minAvg + '/5 ou plus. Les clients vous notent après la livraison.'));
  else if (m.stars === 3 && m.star_request === 'none') kids.push(el('p', {}, 'Vous pouvez demander les 5 étoiles. Après confirmation de l\'administrateur, vous paierez ' + fmt(r.fee) + '. '),
    el('button', { onclick: run(async () => { await api('merchant/stars/request', 'POST', {}); say('Demande envoyée à l\'administrateur.'); await loadMerchant(); }) }, 'Demander les 5 étoiles'));
  else if (m.stars === 3 && m.star_request === 'requested') kids.push(el('p', { className: 'small' }, 'Demande envoyée : en attente de confirmation de l\'administrateur.'));
  else if (m.stars === 3 && m.star_request === 'approved') kids.push(el('p', {}, 'L\'administrateur a confirmé. Payez ' + fmt(r.fee) + ' pour passer à 5 étoiles. '),
    el('button', { onclick: run(async () => goPay(await api('merchant/stars/pay', 'POST', {}))) }, 'Payer avec Wave'));
  else if (m.stars >= 5) kids.push(el('p', { className: 'small' }, 'Boutique 5 étoiles ✔'));
  $('#starsBox').replaceChildren(...kids);
}
async function search() {
  const list = await api('articles?q=' + encodeURIComponent($('#q').value) + (shopFilter ? '&shop=' + shopFilter : '') + (rayon ? '&category=' + rayon : ''));
  $('#results').replaceChildren(...list.map(a => el('div', { className: 'card' },
    gallery(a),
    el('b', {}, a.name), el('p', { className: 'small' }, el('span', { className: 'stars' }, stars(a.stars)), a.rating ? ' ' + a.rating + '/5' : ''), a.category ? el('p', { className: 'small' }, catLabel(a.category)) : '', el('p', {}, a.description || ''),
    a.premium ? el('p', { className: 'small' }, '★ Premium') : '', el('p', { className: 'small' }, a.details || ''),
    priceLine(a),
    ...(me && a.merchant_id === me.id ? [el('p', { className: 'small' }, 'C\'est votre article')] : [
    el('button', { onclick: run(async () => { if (!me || me.role === 'admin') throw new Error('Connectez-vous pour poser une question'); openChat(a.merchant_id, a.shop_name, a.id, 'buyer'); }) }, 'Poser une question'), ' ', el('button', { onclick: run(async () => showShopInfo(await api('shops/' + a.merchant_id))) }, 'La boutique'), ' ', a.whatsapp ? el('button', { onclick: () => openWa(a.whatsapp, 'Bonjour, je suis intéressé(e) par « ' + a.name + ' » sur Marketplace.') }, 'WhatsApp') : '', ' ',
    el('button', { onclick: () => { const c = cart.find(x => x.id === a.id); c ? c.qty++ : cart.push({ id: a.id, name: a.name, price: a.promo_price || a.price, qty: 1 }); drawCart(); } }, 'Ajouter au panier')]))));
}
function drawCart() {
  $('#cart').replaceChildren(...cart.map(c => el('div', {}, c.name + ' × ' + c.qty + ' ',
    el('button', { onclick: () => { cart = cart.filter(x => x !== c); drawCart(); } }, 'Retirer'))));
}
// ---- Photos multiples, promotions, WhatsApp, statistiques, notifications ----
const waLink = (num, text) => {
  let d = String(num || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2);
  if (d && !d.startsWith('225') && d.length <= 10) d = '225' + d;   // numéros ivoiriens
  return d ? 'https://wa.me/' + d + '?text=' + encodeURIComponent(text || '') : '';
};
const openWa = (num, text) => { const u = waLink(num, text); if (u) window.open(u, '_blank', 'noopener'); };
function gallery(a) {
  const ids = a.photos || []; if (!ids.length) return '';
  let i = 0; const img = el('img', { className: 'ph', src: '/api/articles/photos/' + ids[0], alt: a.name, loading: 'lazy' });
  if (ids.length === 1) return img;
  const cnt = el('span', { className: 'cnt' }, '1/' + ids.length);
  const go = d => { i = (i + d + ids.length) % ids.length; img.src = '/api/articles/photos/' + ids[i]; cnt.textContent = (i + 1) + '/' + ids.length; };
  return el('div', { className: 'gal' }, img, el('button', { className: 'nav l', title: 'Photo précédente', onclick: () => go(-1) }, '‹'),
    el('button', { className: 'nav r', title: 'Photo suivante', onclick: () => go(1) }, '›'), cnt);
}
const priceLine = a => a.promo_price
  ? el('p', {}, el('s', { className: 'old' }, fmt(a.price)), ' ', el('b', { className: 'promo' }, fmt(a.promo_price)), ' ',
      el('span', { className: 'badge' }, '−' + Math.round((1 - a.promo_price / a.price) * 100) + '%'), ' · ' + a.shop_name + ' · stock ' + a.stock)
  : el('p', {}, fmt(a.price) + ' · ' + a.shop_name + ' · stock ' + a.stock);
async function loadStats() {
  const s = await api('merchant/stats'), max = Math.max(1, ...s.days.map(d => d.revenue));
  const kpi = (l, v) => el('div', { className: 'kpi' }, el('b', {}, String(v)), el('span', { className: 'small' }, l));
  $('#statsBox').replaceChildren(
    el('div', { className: 'kpis' }, kpi('Ventes (commandes payées)', fmt(s.revenue)), kpi('7 derniers jours', fmt(s.d7)), kpi('30 derniers jours', fmt(s.d30)), kpi('Commandes', s.orders),
      kpi('Articles vendus', s.items), kpi('À livrer', s.pending), kpi('Livrées', s.delivered), kpi('Note moyenne', s.reviews ? s.rating + '/5 (' + s.reviews + ')' : '—')),
    s.top.length ? el('div', {}, el('p', { className: 'small' }, 'Articles les plus vendus'), ...s.top.map(t => el('p', {}, t.name + ' — ' + t.qty + ' vendu' + (t.qty > 1 ? 's' : '') + ' · ' + fmt(t.revenue)))) : el('p', { className: 'small' }, 'Pas encore de vente.'),
    s.days.length ? el('div', {}, el('p', { className: 'small' }, 'Ventes des 14 derniers jours'),
      el('div', { className: 'bars' }, ...s.days.map(d => el('div', { className: 'bar', title: d.day + ' : ' + fmt(d.revenue) }, el('i', { style: 'height:' + Math.max(6, Math.round(d.revenue / max * 100)) + 'px' }), el('span', {}, d.day))))) : '');
}
let notifTimer = null;
function setUnread(n) { const b = $('#bell'); b.textContent = 'Notifications' + (n ? ' (' + n + ')' : ''); b.className = n ? 'on' : ''; document.title = (n ? '(' + n + ') ' : '') + 'Marketplace'; }
async function pollNotifs() { if (!me) return; try { setUnread((await api('notifications')).unread); } catch {} }
async function openNotifs() {
  const r = await api('notifications');
  $('#notifList').replaceChildren(...(r.items.length ? r.items : [null]).map(n => n
    ? el('div', { className: 'card' }, el('b', {}, (n.read ? '' : '● ') + n.title), el('p', { className: 'small' }, n.body || ''), el('p', { className: 'small' }, new Date(n.created_at).toLocaleString('fr-FR')))
    : el('p', {}, 'Aucune notification.')));
  $('#notifs').showModal();
  if (r.unread) { await api('notifications/read', 'POST', {}); setUnread(0); }
}
// ---- Photos : réduction dans le navigateur (max 800 px, JPEG) puis envoi ----
async function compress(file, max = 800) {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (JPG, PNG...)');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = URL.createObjectURL(file); }); }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.72));
  if (!blob) throw new Error('Impossible de préparer la photo');
  return blob;
}
async function sendPhoto(id, file) {
  const blob = await compress(file);
  const r = await fetch('/api/merchant/articles/' + id + '/photos', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Envoi de la photo impossible'); }
}
async function loadMerchant() {
  const m = await api('merchant/me');
  // Le formulaire d'ajout n'apparaît qu'après paiement de l'abonnement mensuel ET de la capacité d'articles
  const prixTier = fmt(tier(10)), abo = 'Standard ' + fmt(3000) + ' ou Premium ' + fmt(5000);
  let need = '';
  if (!m.plan && !m.quota) need = 'Pour ajouter vos articles, payez d\'abord : 1) l\'abonnement mensuel (' + abo + ') et 2) la capacité d\'articles (par exemple 10 articles = ' + prixTier + ').';
  else if (!m.plan) need = 'Il reste à payer l\'abonnement mensuel (' + abo + ') pour pouvoir ajouter des articles.';
  else if (!m.quota) need = 'Il reste à payer la capacité d\'articles (par exemple 10 articles = ' + prixTier + ') pour pouvoir ajouter des articles.';
  else if (m.quota <= m.used) need = 'Vous avez atteint votre capacité de ' + m.quota + ' articles. Payez un palier supérieur pour en ajouter.';
  $('#addBox').hidden = need !== ''; $('#payFirst').hidden = need === ''; $('#payFirst').textContent = need;
  drawStars(m);
  loadStats().catch(() => {});
  fillShop(m);
  await fillCats();
  $('#quota').textContent = (m.validated ? '' : 'Compte en attente de validation. ') + (m.plan ? 'Abonnement ' + m.plan + ' jusqu\'au ' + new Date(m.plan_expires_at).toLocaleDateString('fr-FR') : 'Aucun abonnement mensuel actif : vos articles sont masqués') + ' · Articles en ligne : ' + m.used + ' / ' + m.quota;
  $('#tier').replaceChildren(...[10, 20, 30, 40, 50, 100].map(n => el('option', { value: n }, n + ' articles - ' + fmt(tier(n)))));
  const list = await api('merchant/articles');
  $('#mine').replaceChildren(...list.map(a => {
    const pp = el('input', { type: 'number', min: 1, placeholder: 'Prix promo', value: a.promo_price || '' }), pu = el('input', { type: 'date', value: a.promo_until || '' });
    return el('div', { className: 'row' },
      el('div', { className: 'thumbs' }, ...(a.photos || []).map(pid => el('span', { className: 'ph1' },
        el('img', { className: 'thumb', src: '/api/articles/photos/' + pid + '?v=' + Date.now(), alt: '' }),
        el('button', { className: 'x', title: 'Retirer cette photo', onclick: run(async () => { await api('merchant/articles/' + a.id + '/photos/' + pid, 'DELETE'); await loadMerchant(); }) }, '×')))),
      el('b', {}, a.name), (a.details ? ' (' + a.details + ')' : '') + ' · ',
      ...(a.promo_price ? [el('s', { className: 'old' }, fmt(a.price)), ' ', el('b', { className: 'promo' }, fmt(a.promo_price)), a.promo_until ? ' (jusqu\'au ' + a.promo_until + ')' : ''] : [fmt(a.price)]),
      ' · stock ' + a.stock + ' ',
      el('div', {},
        el('label', { className: 'btn' }, (a.photos || []).length ? 'Ajouter des photos' : 'Ajouter des photos',
          el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: run(async ev => {
            const fs = [...ev.target.files]; if (!fs.length) return; let n = 0; for (const f of fs) { await sendPhoto(a.id, f); n++; }
            say(n + ' photo' + (n > 1 ? 's' : '') + ' enregistrée' + (n > 1 ? 's' : '') + '.'); await loadMerchant(); }) }))),
      el('div', {}, el('span', { className: 'small' }, 'Promotion : '), pp, el('span', { className: 'small' }, ' jusqu\'au (facultatif) '), pu,
        el('button', { onclick: run(async () => { await api('merchant/articles/' + a.id + '/promo', 'POST', { price: pp.value ? +pp.value : null, until: pu.value || null }); say(pp.value ? 'Promotion enregistrée.' : 'Promotion retirée.'); await loadMerchant(); }) }, a.promo_price ? 'Modifier la promo' : 'Appliquer la promo'),
        a.promo_price ? el('button', { onclick: run(async () => { await api('merchant/articles/' + a.id + '/promo', 'POST', { price: null }); say('Promotion retirée.'); await loadMerchant(); }) }, 'Retirer la promo') : ''),
      el('button', { onclick: run(async () => { await api('merchant/articles/' + a.id, 'DELETE'); await loadMerchant(); }) }, 'Supprimer'));
  }));
  const od = await api('merchant/orders');
  $('#morders').replaceChildren(...(od.length ? od : [null]).map(o => o ? el('div', { className: 'card' },
    el('b', {}, 'Commande #' + o.id + ' - ' + fmt(o.total) + ' - ' + STATUS[o.status]),
    el('p', {}, 'Acompte payé : ' + fmt(o.deposit) + ' · À encaisser à la livraison : ' + fmt(o.balance)),
    el('p', {}, o.items.map(i => i.name + ' ×' + i.qty).join(', ')),
    el('p', { className: 'small' }, o.customer_name + ' · ' + o.customer_phone + ' · ' + o.delivery_location + ' · paiement ' + PAY[o.payment_method]),
    ...['pending', 'preparing', 'delivered'].filter(s => s !== o.status).map(s => el('button', { onclick: run(async () => { await api('merchant/orders/' + o.id + '/status', 'POST', { status: s }); await loadMerchant(); }) }, '→ ' + STATUS[s]))) : el('p', {}, 'Aucune commande reçue.')));
}

$('#go').onclick = run(search);
// ---- Ma boutique (espace commerçant) ----
let shopDirty = false;
function fillShop(m) {
  if (shopDirty) return;   // ne pas écraser ce que le commerçant est en train de taper
  $('#shName').value = m.shop_name || ''; $('#shLoc').value = m.location || ''; $('#shWa').value = m.whatsapp || '';
  $('#shYears').value = m.years == null ? '' : m.years; $('#shDesc').value = m.description || '';
  const p = $('#logoPrev'); p.hidden = !m.has_logo; if (m.has_logo) p.src = '/api/merchant/logo?v=' + Date.now();
}
$('#shopForm').oninput = () => { shopDirty = true; };
$('#shSave').onclick = run(async () => {
  await api('merchant/profile', 'POST', { shopName: $('#shName').value, location: $('#shLoc').value || undefined, whatsapp: $('#shWa').value || undefined,
    description: $('#shDesc').value || undefined, years: $('#shYears').value === '' ? undefined : +$('#shYears').value });
  shopDirty = false; say('Votre boutique a été enregistrée.'); await loadMerchant();
});
$('#logoFile').onchange = run(async ev => {
  const f = ev.target.files[0]; if (!f) return;
  const blob = await compress(f, 400);
  const r = await fetch('/api/merchant/logo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Envoi du logo impossible'); }
  ev.target.value = ''; const p = $('#logoPrev'); p.src = '/api/merchant/logo?v=' + Date.now(); p.hidden = false; say('Logo enregistré.');
});
$('#bell').onclick = run(openNotifs);
$('#notifClose').onclick = () => $('#notifs').close();
$('#rayonBtn').onclick = run(openRayons);
$('#rayonAll').onclick = run(async () => chooseRayon(''));
$('#toRegister').onclick = () => authMode(true);
$('#toLogin').onclick = () => authMode(false);
$('#role').onchange = () => { $('#merchantFields').hidden = $('#role').value !== 'merchant'; };
$('#modeMerchant').onclick = run(async () => { mode = 'merchant'; await refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#modeClient').onclick = run(async () => { mode = 'client'; await refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#shopsBtn').onclick = run(showShops);
const welcome = (extra) => {
  if (!me) return;
  say('Bienvenue ' + me.name + ' ! Vous êtes connecté.' + (extra ? ' ' + extra : ''));
  const e = $(me.role === 'merchant' ? '#merchant' : '#searchBox');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (e && !e.hidden) setTimeout(() => e.scrollIntoView({ behavior: 'smooth' }), 300);
};
$('#login').onclick = run(async () => { await api('login', 'POST', { email: $('#email').value.trim().toLowerCase(), password: $('#password').value }); await refresh(); welcome(); });
$('#register').onclick = run(async () => {
  await api('register', 'POST', { role: $('#role').value, name: $('#name').value, email: $('#remail').value.trim().toLowerCase(), phone: $('#phone').value || undefined,
    password: $('#rpassword').value.trim(), shopName: $('#shop').value || undefined, location: $('#loc').value || undefined });
  const estCommercant = $('#role').value === 'merchant';
  try {
    await api('login', 'POST', { email: $('#remail').value.trim().toLowerCase(), password: $('#rpassword').value.trim() });
    await refresh();
    welcome(estCommercant ? 'Votre boutique sera visible après validation par l\'administrateur et paiement du forfait mensuel.' : '');
  } catch { say('Compte créé ! Connectez-vous avec le même e-mail et mot de passe.'); }
});
$('#logout').onclick = run(async () => { await api('logout', 'POST', {}); await refresh(); });
$('#order').onclick = run(async () => {
  if (!me || me.role === 'admin') throw new Error('Connectez-vous pour commander');
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
$('#aphoto').onchange = () => { const p = $('#apreview'), fs = [...$('#aphoto').files]; p.replaceChildren(...fs.map(f => el('img', { className: 'prev', src: URL.createObjectURL(f), alt: '' }))); p.hidden = !fs.length; };
$('#add').onclick = run(async () => {
  if (!$('#legal').checked) throw new Error('Vous devez certifier que le produit est légal en Côte d\'Ivoire');
  if (!$('#acat').value) throw new Error('Choisissez le rayon de l\'article');
  const created = await api('merchant/articles', 'POST', { name: $('#an').value, price: +$('#ap').value, stock: +$('#as').value, description: $('#ad').value || undefined, details: $('#adet').value || undefined, category: $('#acat').value, legalConfirm: $('#legal').checked });
  const files = [...$('#aphoto').files]; let msg = 'Article ajouté.', ok = true, n = 0;
  if (files.length) { try { for (const f of files) { await sendPhoto(created.id, f); n++; } msg = 'Article et ' + n + ' photo' + (n > 1 ? 's' : '') + ' enregistrés.'; }
    catch (e) { msg = 'Article ajouté avec ' + n + ' photo(s), mais : ' + e.message + ' (vous pouvez ajouter les autres depuis la liste ci-dessous).'; ok = false; } }
  $('#aphoto').value = ''; $('#apreview').replaceChildren(); $('#apreview').hidden = true;
  await loadMerchant(); say(msg, ok);
});
refresh();

// ---- Design : titres mot par mot, fond de courbes de niveau ----
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' }) : null;
  document.querySelectorAll('header h1, section h2').forEach(h => {
    const txt = h.textContent.trim(); h.setAttribute('aria-label', txt);
    h.replaceChildren(...txt.split(/\s+/).map((w, i) => { const s = document.createElement('span'); s.className = 'w'; s.setAttribute('aria-hidden', 'true'); s.style.setProperty('--i', i); s.textContent = w; return s; }));
    if (reduce || !io) h.classList.add('in'); else io.observe(h);
  });
})();
(() => {
  const cv = document.getElementById('contours'); if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d'), CELLS = 72, COUNT = 2.5, SCALE = 3.8, AMP = 0.37;
  const field = (x, y, t) => {
    let f = Math.sin(x + t * 0.6) * 0.5; f += Math.sin(y * 0.85 - t * 0.45) * 0.45;
    f += Math.sin((x + y) * 0.65 + t * 0.35) * 0.35; f += Math.sin((x - y) * 0.95 - t * 0.55) * 0.25;
    return f * 0.5 + 0.5;
  };
  const size = () => { const r = Math.min(devicePixelRatio || 1, 2); cv.width = Math.round(innerWidth * r); cv.height = Math.round(innerHeight * r); };
  const draw = (now) => {
    const w = cv.width, h = cv.height, t = now / 1000 * 1.66;
    const cols = w >= h ? CELLS : Math.max(8, Math.round(CELLS * w / h)), rows = Math.max(8, Math.round(cols * h / w));
    const sx = w / cols, sy = h / rows, asp = w / h, v = new Float32Array((cols + 1) * (rows + 1));
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const nx = ((i / cols) * 2 - 1) * asp * SCALE, ny = ((j / rows) * 2 - 1) * SCALE;
      v[j * (cols + 1) + i] = field(nx + Math.sin(ny * 0.8 + t * 0.7) * AMP, ny + Math.cos(nx * 0.7 - t * 0.6) * AMP, t) * COUNT;
    }
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(14,34,51,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
    for (let L = 0.5; L < COUNT; L += 1) for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = v[j * (cols + 1) + i], b = v[j * (cols + 1) + i + 1], c = v[(j + 1) * (cols + 1) + i + 1], d = v[(j + 1) * (cols + 1) + i];
      const k = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0); if (k === 0 || k === 15) continue;
      const x0 = i * sx, y0 = j * sy, T = [x0 + sx * ((L - a) / (b - a)), y0], R = [x0 + sx, y0 + sy * ((L - b) / (c - b))], B = [x0 + sx * ((L - d) / (c - d)), y0 + sy], Lf = [x0, y0 + sy * ((L - a) / (d - a))];
      switch (k) { case 1: case 14: seg(Lf, B); break; case 2: case 13: seg(B, R); break; case 3: case 12: seg(Lf, R); break; case 4: case 11: seg(T, R); break;
        case 6: case 9: seg(T, B); break; case 7: case 8: seg(Lf, T); break; case 5: seg(Lf, T); seg(B, R); break; case 10: seg(Lf, B); seg(T, R); break; }
    }
    ctx.stroke();
  };
  size(); draw(0);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { addEventListener('resize', () => { size(); draw(0); }); return; }
  let last = 0; const loop = (now) => { if (!document.hidden && now - last > 50) { last = now; draw(now); } requestAnimationFrame(loop); };
  addEventListener('resize', size); requestAnimationFrame(loop);
})();
