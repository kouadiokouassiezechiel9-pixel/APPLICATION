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
  const client = !!me && me.role === 'client';
  $('#searchBox').hidden = !client; $('#cartBox').hidden = !client;   // recherche et panier : clients connectés seulement
  if (client) await search();
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
  // Le formulaire d'ajout n'apparaît qu'après paiement de l'abonnement mensuel ET de la capacité d'articles
  const prixTier = fmt(tier(10)), abo = 'Standard ' + fmt(3000) + ' ou Premium ' + fmt(5000);
  let need = '';
  if (!m.plan && !m.quota) need = 'Pour ajouter vos articles, payez d\'abord : 1) l\'abonnement mensuel (' + abo + ') et 2) la capacité d\'articles (par exemple 10 articles = ' + prixTier + ').';
  else if (!m.plan) need = 'Il reste à payer l\'abonnement mensuel (' + abo + ') pour pouvoir ajouter des articles.';
  else if (!m.quota) need = 'Il reste à payer la capacité d\'articles (par exemple 10 articles = ' + prixTier + ') pour pouvoir ajouter des articles.';
  else if (m.quota <= m.used) need = 'Vous avez atteint votre capacité de ' + m.quota + ' articles. Payez un palier supérieur pour en ajouter.';
  $('#addBox').hidden = need !== ''; $('#payFirst').hidden = need === ''; $('#payFirst').textContent = need;
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
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
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
