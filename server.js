const fs = require('fs'), crypto = require('crypto');
const express = require('express'), helmet = require('helmet'), cookie = require('cookie-parser');
const rateLimit = require('express-rate-limit'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const { Pool } = require('pg'), { z } = require('zod');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const prod = process.env.NODE_ENV === 'production';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Grille tarifaire : 1-10 => 5000 ; 11-20 => 10000 ; au-delà +3000 par tranche de 10
const price = n => (n <= 0 ? 0 : n <= 10 ? 5000 : n <= 20 ? 10000 : 10000 + 3000 * Math.ceil((n - 20) / 10));

// Produits interdits à la vente (liste de départ, à faire valider par un juriste ivoirien et à compléter)
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const BANNED = ['drogue','cocaine','heroine','cannabis','marijuana','haschich','chanvre indien','crack','ecstasy','lsd','methamphetamine',
  'arme','armes','pistolet','fusil','revolver','munition','munitions','grenade','explosif','explosifs','kalachnikov',
  'faux billet','faux billets','faux papiers','faux diplome','faux diplomes','contrefacon','contrefait','contrefaits',
  'ivoire','pangolin','peau de leopard','medicament','medicaments','tramadol','codeine','antibiotique','antibiotiques','ordonnance',
  'organe','organes','pornographie'];
const bannedRe = new RegExp('(^|[^a-z0-9])(' + BANNED.map(w => w.replace(/ /g, '\\s+')).join('|') + ')($|[^a-z0-9])');
const isBanned = (...t) => bannedRe.test(norm(t.join(' ')));

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
// Webhook Wave : corps brut obligatoire (la signature se calcule sur le texte exact reçu)
app.post('/webhooks/wave', express.raw({ type: () => true, limit: '50kb' }),
  (req, res) => handleWaveWebhook(req, res).catch(e => { console.error(e); res.status(500).end(); }));
app.use(express.json({ limit: '50kb' }));
app.use(cookie());
// Fichiers publics servis un par un (racine du dépôt OU dossier public/)
const path = require('path');
const pagesPubliques = ['index.html', 'app.js', 'admin.html', 'admin.js', 'style.css', 'admin.css'];
const trouver = n => [path.join(__dirname, n), path.join(__dirname, 'public', n)].find(f => fs.existsSync(f)); // racine d'abord (versions les plus récentes)
app.get('/version', (req, res) => res.type('text').send('version-connexion-2026-10-23'));
app.get('/', (req, res) => { const f = trouver('index.html'); f ? res.sendFile(f) : res.status(404).send('index.html introuvable'); });
for (const n of pagesPubliques) app.get('/' + n, (req, res) => { const f = trouver(n); f ? res.sendFile(f) : res.status(404).end(); });
app.use(express.static(path.join(__dirname, 'public')));

const wrap = f => (req, res, next) => f(req, res, next).catch(e => {
  console.error(e);
  res.status(500).json({ error: 'Erreur serveur' });
});
const parse = (schema, req, res) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const noms = { name: 'Nom', email: 'E-mail', password: 'Mot de passe (10 caractères minimum)', shopName: 'Nom de la boutique', phone: 'Téléphone', location: 'Localisation', code: 'Code (6 chiffres)' };
    const champ = r.error.issues[0] && r.error.issues[0].path[0];
    res.status(400).json({ error: 'Champ à corriger : ' + (noms[champ] || champ || 'formulaire') }); return null;
  }
  return r.data;
};
const tx = async fn => {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
};
const auth = (...roles) => async (req, res, next) => {
  try {
    const u = jwt.verify(req.cookies.t || '', SECRET);
    const r = await pool.query('SELECT status FROM users WHERE id=$1', [u.id]);
    if (!r.rows[0] || r.rows[0].status !== 'active') return res.status(401).json({ error: 'Compte inactif' });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Interdit' });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Non connecté' }); }
};

// ---------- Comptes ----------
const trop = { error: 'Trop de tentatives. Patientez 15 minutes puis réessayez.' };
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: trop });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: trop });
const setCookie = (res, u) => res.cookie('t',
  jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '8h' }),
  { httpOnly: true, sameSite: 'strict', secure: prod, maxAge: 8 * 3600e3 });

app.post('/api/register', limiter, wrap(async (req, res) => {
  const d = parse(z.object({
    role: z.enum(['client', 'merchant']),
    name: z.string().min(2).max(80), email: z.string().email().max(120),
    phone: z.string().max(30).optional(), password: z.string().min(10).max(200),
    shopName: z.string().min(2).max(80).optional(), location: z.string().max(120).optional(),
  }), req, res);
  if (!d) return;
  if (d.role === 'merchant' && !d.shopName) return res.status(400).json({ error: 'Nom de boutique requis' });
  try {
    const hash = await bcrypt.hash(d.password, 12);
    await tx(async c => {
      const u = await c.query('INSERT INTO users(role,name,email,phone,password_hash) VALUES($1,$2,lower($3),$4,$5) RETURNING id',
        [d.role, d.name, d.email, d.phone || null, hash]);
      if (d.role === 'merchant')
        await c.query('INSERT INTO merchants(user_id,shop_name,location) VALUES($1,$2,$3)', [u.rows[0].id, d.shopName, d.location || null]);
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'E-mail déjà utilisé' });
    throw e;
  }
}));

const login = admin => wrap(async (req, res) => {
  const d = parse(z.object({ email: z.string().email().max(120), password: z.string().max(200) }), req, res);
  if (!d) return;
  const u = (await pool.query('SELECT * FROM users WHERE email=lower($1)', [d.email])).rows[0];
  const ok = u && (u.role === 'admin') === admin && await bcrypt.compare(d.password, u.password_hash);
  if (!ok || u.status !== 'active') return res.status(401).json({ error: 'Identifiants incorrects' });
  setCookie(res, u); res.json({ ok: true });
});
app.post('/api/login', limiter, login(false));

// ---- Double authentification admin (TOTP, RFC 6238) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = buf => { let bits = '', o = ''; for (const x of buf) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) o += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return o; };
const b32dec = s => { let bits = ''; for (const ch of s) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
const hotp = (key, ctr) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ctr));
  const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); };
const totpOk = (secret, code) => { const t = Math.floor(Date.now() / 30000), key = b32dec(secret);
  return [-1, 0, 1].some(d => { const a = Buffer.from(hotp(key, t + d)), b = Buffer.from(String(code));
    return a.length === b.length && crypto.timingSafeEqual(a, b); }); };
// Le secret TOTP est chiffré en base (AES-256-GCM, clé dérivée de JWT_SECRET)
const K = crypto.createHash('sha256').update(SECRET).digest();
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', K, iv);
  const e = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64'); };
const dec = s => { const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', K, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const ck = { httpOnly: true, sameSite: 'strict', secure: prod };

// Étape 1 : e-mail + mot de passe
app.post('/api/admin/login', adminLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ email: z.string().email().max(120), password: z.string().max(200) }), req, res);
  if (!d) return;
  const u = (await pool.query("SELECT * FROM users WHERE email=lower($1) AND role='admin'", [d.email])).rows[0];
  if (!u || u.status !== 'active' || !(await bcrypt.compare(d.password, u.password_hash)))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  res.cookie('p', jwt.sign({ id: u.id, stage: 'pw' }, SECRET, { expiresIn: '5m' }), { ...ck, maxAge: 300e3 });
  if (u.totp_enabled) return res.json({ step: 'code' });
  // première connexion : enrôlement. On réaffiche la même clé tant que la 2FA n'est pas activée
  let secret = null; try { secret = u.totp_secret ? dec(u.totp_secret) : null; } catch { secret = null; }
  if (!secret) { secret = b32enc(crypto.randomBytes(20)); await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2', [enc(secret), u.id]); }
  res.json({ step: 'setup', secret });
}));
// Étape 2 : code à 6 chiffres de l'application d'authentification
app.post('/api/admin/2fa', adminLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req, res);
  if (!d) return;
  let p; try { p = jwt.verify(req.cookies.p || '', SECRET); } catch { return res.status(401).json({ error: 'Session expirée, reconnectez-vous' }); }
  if (p.stage !== 'pw') return res.status(401).json({ error: 'Non autorisé' });
  const u = (await pool.query("SELECT * FROM users WHERE id=$1 AND role='admin' AND status='active'", [p.id])).rows[0];
  if (!u || !u.totp_secret || !totpOk(dec(u.totp_secret), d.code)) return res.status(401).json({ error: 'Code incorrect' });
  if (!u.totp_enabled) await pool.query('UPDATE users SET totp_enabled=true WHERE id=$1', [u.id]);
  res.clearCookie('p'); setCookie(res, u); res.json({ ok: true });
}));
app.get('/api/admin/users', auth('admin'), wrap(async (req, res) => {
  res.json((await pool.query('SELECT id,name,email,role,status FROM users ORDER BY id DESC LIMIT 200')).rows);
}));
app.post('/api/logout', (req, res) => { res.clearCookie('t'); res.json({ ok: true }); });
app.get('/api/me', auth(), (req, res) => res.json({ id: req.user.id, name: req.user.name, role: req.user.role }));

// ---------- Paiements Wave (seul moyen de paiement de la plateforme) ----------
const WAVE_KEY = process.env.WAVE_API_KEY, WAVE_SIGN = process.env.WAVE_SIGNING_SECRET, WAVE_WHS = process.env.WAVE_WEBHOOK_SECRET;
const BASE_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const mock = !WAVE_KEY && process.env.DEV_PAYMENT_MOCK === 'true'; // test local uniquement
const waveReady = !!WAVE_KEY && BASE_URL.startsWith('https://');

async function waveCreateSession(amount, reference) {
  const body = JSON.stringify({ amount: String(amount), currency: 'XOF', client_reference: reference,
    success_url: BASE_URL + '/?paiement=ok', error_url: BASE_URL + '/?paiement=echec' });
  const headers = { Authorization: 'Bearer ' + WAVE_KEY, 'Content-Type': 'application/json' };
  if (WAVE_SIGN) {
    const t = Math.floor(Date.now() / 1000);
    headers['Wave-Signature'] = `t=${t},v1=${crypto.createHmac('sha256', WAVE_SIGN).update(t + body).digest('hex')}`;
  }
  const r = await fetch('https://api.wave.com/v1/checkout/sessions', { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id || !j.wave_launch_url) { console.error('Wave refus', r.status, JSON.stringify(j)); throw new Error('WAVE'); }
  return { id: j.id, url: j.wave_launch_url };
}
const payFail = (res, e) => {
  if (e.message === 'NOWAVE') { res.status(501).json({ error: 'Paiement Wave non configuré sur le serveur' }); return true; }
  if (e.message === 'WAVE' || e.name === 'TimeoutError') { res.status(502).json({ error: 'Wave est indisponible, réessayez dans un instant' }); return true; }
  return false;
};
// Crée le paiement en attente puis la session Wave ; renvoie l'adresse Wave où envoyer le client
async function startPayment(userId, kind, amount, ref) {
  const p = (await pool.query("INSERT INTO payments(user_id,amount,kind,status,ref) VALUES($1,$2,$3,'pending',$4) RETURNING id",
    [userId, amount, kind, JSON.stringify(ref)])).rows[0];
  if (mock) { await applyPayment(p.id); return { mock: true }; }
  try {
    if (!waveReady) throw new Error('NOWAVE');
    const s = await waveCreateSession(amount, 'pay-' + p.id);
    await pool.query('UPDATE payments SET wave_session_id=$1 WHERE id=$2', [s.id, p.id]);
    return { payUrl: s.url };
  } catch (e) {
    await pool.query("UPDATE payments SET status='failed' WHERE id=$1", [p.id]);
    throw e;
  }
}
// Appelé uniquement quand Wave confirme le paiement (idempotent : ne s'applique qu'une fois)
async function applyPayment(id) {
  return tx(async c => {
    const p = (await c.query("UPDATE payments SET status='paid' WHERE id=$1 AND status='pending' RETURNING *", [id])).rows[0];
    if (!p) return false;
    if (p.kind === 'plan') {
      await c.query("UPDATE plans SET status='replaced' WHERE merchant_id=$1 AND status='active'", [p.user_id]);
      await c.query("INSERT INTO plans(merchant_id,tier,amount,expires_at) VALUES($1,$2,$3,now() + interval '30 days')", [p.user_id, p.ref.tier, p.amount]);
    } else if (p.kind === 'articles') {
      await c.query("UPDATE subscriptions SET status='replaced' WHERE merchant_id=$1 AND status='active'", [p.user_id]);
      await c.query('INSERT INTO subscriptions(merchant_id,quota,amount) VALUES($1,$2,$3)', [p.user_id, p.ref.quota, p.amount]);
    } else if (p.kind === 'order') {
      await c.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [p.ref.orderId]);
    }
    return true;
  });
}
// Commande non payée : on annule et on remet le stock
async function releaseOrder(orderId) {
  await tx(async c => {
    const o = await c.query("UPDATE orders SET payment_status='expired', status='cancelled' WHERE id=$1 AND payment_status='unpaid' RETURNING id", [orderId]);
    if (!o.rowCount) return;
    await c.query('UPDATE articles a SET stock=a.stock+oi.qty FROM order_items oi WHERE oi.order_id=$1 AND a.id=oi.article_id', [orderId]);
    await c.query("UPDATE payments SET status='expired' WHERE kind='order' AND status='pending' AND (ref->>'orderId')::int=$1", [orderId]);
  });
}
async function handleWaveWebhook(req, res) {
  if (!WAVE_WHS) return res.status(503).end();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const parts = String(req.headers['wave-signature'] || '').split(',').map(x => x.split('='));
  const t = (parts.find(x => x[0] === 't') || [])[1];
  const sigs = parts.filter(x => x[0] === 'v1').map(x => x[1] || '');
  const exp = t ? crypto.createHmac('sha256', WAVE_WHS).update(t + raw.toString('utf8')).digest('hex') : '';
  const ok = t && Math.abs(Date.now() / 1000 - Number(t)) < 300 &&
    sigs.some(s => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
  if (!ok) return res.status(401).end();
  let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
  if (ev.type === 'checkout.session.completed' && ev.data && ev.data.payment_status === 'succeeded') {
    const p = (await pool.query('SELECT id,amount,status FROM payments WHERE wave_session_id=$1', [ev.data.id])).rows[0];
    if (p && String(ev.data.amount) === String(p.amount) && ev.data.currency === 'XOF') {
      const done = await applyPayment(p.id);
      if (!done && p.status === 'expired') console.error('Paiement Wave reçu après expiration, remboursement manuel à faire :', ev.data.id);
    } else console.error('Webhook Wave non rapproché :', ev.data.id);
  }
  res.status(200).end();
}

// ---------- Client ----------
const STOP = new Set(['pointure', 'taille', 'de', 'du', 'des', 'la', 'le', 'les', 'en', 'pour', 'a', 'au', 'un', 'une']);
const HAY = "translate(lower(coalesce(a.name,'')||' '||coalesce(a.description,'')||' '||coalesce(a.category,'')||' '||coalesce(a.details,'')),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc')";
app.get('/api/articles', wrap(async (req, res) => {
  const terms = [...new Set(norm(String(req.query.q || '').slice(0, 80)).split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)))].slice(0, 6);
  const params = terms.map(t => /^[0-9]+$/.test(t) ? '\\y' + t + '\\y' : '\\y' + (t.length > 3 ? t.replace(/s$/, '') : t));
  // Score = nombre de mots de la recherche trouvés (nom, description, catégorie, détails comme la pointure)
  const score = params.length ? params.map((_, k) => `(CASE WHEN ${HAY} ~* $${k + 1} THEN 1 ELSE 0 END)`).join('+') : '0';
  const r = await pool.query(
    `SELECT * FROM (
       SELECT a.id,a.name,a.description,a.details,a.price,a.stock,(a.photo IS NOT NULL) AS has_photo,m.shop_name,m.user_id AS merchant_id,
         EXISTS (SELECT 1 FROM plans p WHERE p.merchant_id=m.user_id AND p.tier='premium' AND p.status='active' AND p.expires_at>now()) AS premium,
         (${score}) AS score
       FROM articles a JOIN merchants m ON m.user_id=a.merchant_id
       WHERE a.online AND a.moderation='ok' AND a.stock>0 AND m.validated
         AND ${PLAN_OK}) x
     WHERE ${params.length ? 'score>0' : 'true'}
     ORDER BY premium DESC, score DESC, id DESC LIMIT 50`, params);
  res.json(r.rows);
}));

app.post('/api/orders', auth('client'), wrap(async (req, res) => {
  const d = parse(z.object({
    customerName: z.string().trim().min(2).max(100),
    customerPhone: z.string().trim().min(8).max(20),
    deliveryLocation: z.string().trim().min(3).max(300),
    paymentMethod: z.literal('wave'),
    items: z.array(z.object({
      id: z.number().int(), qty: z.number().int().min(1).max(100) })).min(1).max(50) }), req, res);
  if (!d) return;
  try {
    const out = await tx(async c => {
      const o = (await c.query('INSERT INTO orders(client_id,customer_name,customer_phone,delivery_location,payment_method) VALUES($1,$2,$3,$4,$5) RETURNING id', [req.user.id, d.customerName, d.customerPhone, d.deliveryLocation, d.paymentMethod])).rows[0];
      let total = 0;
      for (const it of [...d.items].sort((a, b) => a.id - b.id)) {
        // Déduction du stock atomique : échoue si stock insuffisant
        const r = await c.query(
          `UPDATE articles a SET stock=a.stock-$1 FROM merchants m
           WHERE a.id=$2 AND a.online AND a.moderation='ok' AND a.stock>=$1 AND m.user_id=a.merchant_id AND m.validated
             AND EXISTS (SELECT 1 FROM plans p WHERE p.merchant_id=m.user_id AND p.status='active' AND p.expires_at>now())
           RETURNING a.price`, [it.qty, it.id]);
        if (!r.rowCount) throw new Error('STOCK');
        total += r.rows[0].price * it.qty;
        await c.query('INSERT INTO order_items(order_id,article_id,qty,unit_price) VALUES($1,$2,$3,$4)',
          [o.id, it.id, it.qty, r.rows[0].price]);
      }
      const deposit = Math.ceil(total / 2); // acompte de 50 % payé sur Wave, le reste à la livraison
      await c.query('UPDATE orders SET total=$1, deposit=$2 WHERE id=$3', [total, deposit, o.id]);
      return { id: o.id, total, deposit, balance: total - deposit };
    });
    try {
      const pay = await startPayment(req.user.id, 'order', out.deposit, { orderId: out.id });
      return res.status(201).json({ ...out, ...pay });
    } catch (e) {
      await releaseOrder(out.id);
      if (payFail(res, e)) return;
      throw e;
    }
  } catch (e) {
    if (e.message === 'STOCK') return res.status(409).json({ error: 'Stock insuffisant ou article indisponible' });
    throw e;
  }
}));

// ---------- Commerçant ----------
app.get('/api/merchant/me', auth('merchant'), wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT m.validated, m.shop_name,
       COALESCE((SELECT quota FROM subscriptions WHERE merchant_id=m.user_id AND status='active' ORDER BY id DESC LIMIT 1),0) AS quota,
       (SELECT tier FROM plans WHERE merchant_id=m.user_id AND status='active' AND expires_at>now() ORDER BY id DESC LIMIT 1) AS plan,
       (SELECT expires_at FROM plans WHERE merchant_id=m.user_id AND status='active' AND expires_at>now() ORDER BY id DESC LIMIT 1) AS plan_expires_at,
       (SELECT count(*)::int FROM articles WHERE merchant_id=m.user_id AND online) AS used
     FROM merchants m WHERE m.user_id=$1`, [req.user.id]);
  res.json(r.rows[0]);
}));

// Abonnement mensuel : standard 3000 francs, premium 5000 francs (30 jours, renouvellement = nouveau paiement)
const PLANS = { standard: 3000, premium: 5000 };
app.post('/api/merchant/plan', auth('merchant'), wrap(async (req, res) => {
  const d = parse(z.object({ tier: z.enum(['standard', 'premium']) }), req, res);
  if (!d) return;
  const m = (await pool.query('SELECT validated FROM merchants WHERE user_id=$1', [req.user.id])).rows[0];
  if (!m.validated) return res.status(403).json({ error: 'Compte en attente de validation' });
  try { res.json(await startPayment(req.user.id, 'plan', PLANS[d.tier], { tier: d.tier })); }
  catch (e) { if (!payFail(res, e)) throw e; }
}));

// Capacité d'articles : paiement séparé, grille tarifaire par palier
app.post('/api/merchant/subscribe', auth('merchant'), wrap(async (req, res) => {
  const d = parse(z.object({ quota: z.number().int().min(10).max(500).refine(n => n % 10 === 0) }), req, res);
  if (!d) return;
  const m = (await pool.query('SELECT validated FROM merchants WHERE user_id=$1', [req.user.id])).rows[0];
  if (!m.validated) return res.status(403).json({ error: 'Compte en attente de validation' });
  try { res.json(await startPayment(req.user.id, 'articles', price(d.quota), { quota: d.quota })); }
  catch (e) { if (!payFail(res, e)) throw e; }
}));

app.get('/api/merchant/articles', auth('merchant'), wrap(async (req, res) => {
  res.json((await pool.query('SELECT id,name,details,price,stock,online,(photo IS NOT NULL) AS has_photo FROM articles WHERE merchant_id=$1 ORDER BY id DESC', [req.user.id])).rows);
}));

app.post('/api/merchant/articles', auth('merchant'), wrap(async (req, res) => {
  const d = parse(z.object({
    name: z.string().min(2).max(120), description: z.string().max(1000).optional(),
    category: z.string().max(60).optional(), details: z.string().max(200).optional(), price: z.number().int().min(1).max(100000000),
    stock: z.number().int().min(0).max(1000000),
    legalConfirm: z.literal(true) }), req, res);
  if (!d) return;
  if (isBanned(d.name, d.description, d.category, d.details))
    return res.status(422).json({ error: 'Ce produit semble interdit à la vente en Côte d\'Ivoire. Il ne peut pas être publié.' });
  const out = await tx(async c => {
    await c.query('SELECT 1 FROM merchants WHERE user_id=$1 FOR UPDATE', [req.user.id]); // évite les ajouts simultanés
    const q = (await c.query("SELECT quota FROM subscriptions WHERE merchant_id=$1 AND status='active' ORDER BY id DESC LIMIT 1", [req.user.id])).rows[0];
    if (!(await c.query("SELECT 1 FROM plans WHERE merchant_id=$1 AND status='active' AND expires_at>now()", [req.user.id])).rowCount) return { noPlan: true };
    const used = (await c.query('SELECT count(*)::int n FROM articles WHERE merchant_id=$1 AND online', [req.user.id])).rows[0].n;
    if (!q || used >= q.quota) return { blocked: true, next: price((q ? q.quota : 0) + 10) };
    const a = await c.query('INSERT INTO articles(merchant_id,name,description,category,details,price,stock) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [req.user.id, d.name, d.description || null, d.category || null, d.details || null, d.price, d.stock]);
    return { id: a.rows[0].id };
  });
  if (out.noPlan) return res.status(402).json({ error: 'Abonnement mensuel requis (Standard 3000 ou Premium 5000 francs)' });
  if (out.blocked) return res.status(402).json({ error: 'Quota atteint : passez au palier supérieur', nextTierPrice: out.next });
  res.status(201).json(out);
}));

// ---- Photos des articles (stockées en base : le disque de Render gratuit est effacé à chaque redémarrage) ----
app.post('/api/merchant/articles/:id/photo', auth('merchant'), express.raw({ type: 'image/jpeg', limit: '400kb' }), wrap(async (req, res) => {
  const b = req.body;
  if (!Buffer.isBuffer(b) || b.length < 100 || !(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff))
    return res.status(400).json({ error: 'Photo invalide (format JPEG, 400 Ko maximum)' });
  const r = await pool.query('UPDATE articles SET photo=$1 WHERE id=$2 AND merchant_id=$3', [b, +req.params.id || 0, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Article introuvable' });
  res.json({ ok: true });
}));
app.get('/api/articles/:id/photo', wrap(async (req, res) => {
  const r = (await pool.query("SELECT photo FROM articles WHERE id=$1 AND moderation='ok' AND photo IS NOT NULL", [+req.params.id || 0])).rows[0];
  if (!r) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' }).send(r.photo);
}));
app.delete('/api/merchant/articles/:id', auth('merchant'), wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM articles WHERE id=$1 AND merchant_id=$2 AND NOT EXISTS (SELECT 1 FROM order_items WHERE article_id=$1)', [+req.params.id || 0, req.user.id]);
  if (!r.rowCount) return res.status(409).json({ error: 'Introuvable ou déjà commandé (mettez-le hors ligne)' });
  res.json({ ok: true });
}));

// ---------- Administrateur ----------
app.get('/api/admin/merchants/pending', auth('admin'), wrap(async (req, res) => {
  res.json((await pool.query('SELECT u.id,u.name,u.email,m.shop_name,m.location FROM merchants m JOIN users u ON u.id=m.user_id WHERE NOT m.validated ORDER BY u.id')).rows);
}));
app.post('/api/admin/merchants/:id/validate', auth('admin'), wrap(async (req, res) => {
  await pool.query('UPDATE merchants SET validated=true WHERE user_id=$1', [+req.params.id || 0]);
  res.json({ ok: true });
}));
app.post('/api/admin/users/:id/suspend', auth('admin'), wrap(async (req, res) => {
  await pool.query("UPDATE users SET status='suspended' WHERE id=$1 AND role<>'admin'", [+req.params.id || 0]);
  res.json({ ok: true });
}));
app.get('/api/admin/stats', auth('admin'), wrap(async (req, res) => {
  const r = await pool.query(`SELECT (SELECT count(*)::int FROM users) users,
    (SELECT count(*)::int FROM orders) orders,
    (SELECT COALESCE(sum(amount),0)::int FROM payments WHERE status IN ('paid','test') AND kind IN ('plan','articles')) revenue`);
  res.json(r.rows[0]);
}));

// ---------- Commandes reçues (commerçant) ----------
app.get('/api/merchant/orders', auth('merchant'), wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT o.id, o.created_at, o.customer_name, o.customer_phone, o.delivery_location, o.payment_method,
            oi.status, sum(oi.qty*oi.unit_price)::int AS total,
            json_agg(json_build_object('name', a.name, 'qty', oi.qty, 'unit_price', oi.unit_price)) AS items
     FROM order_items oi JOIN articles a ON a.id=oi.article_id JOIN orders o ON o.id=oi.order_id
     WHERE a.merchant_id=$1 AND o.payment_status='paid' GROUP BY o.id, oi.status ORDER BY o.id DESC LIMIT 100`, [req.user.id]);
  res.json(r.rows.map(o => ({ ...o, deposit: Math.ceil(o.total / 2), balance: o.total - Math.ceil(o.total / 2) })));
}));
app.post('/api/merchant/orders/:id/status', auth('merchant'), wrap(async (req, res) => {
  const d = parse(z.object({ status: z.enum(['pending', 'preparing', 'delivered']) }), req, res);
  if (!d) return;
  const r = await pool.query(
    'UPDATE order_items oi SET status=$1 FROM articles a WHERE a.id=oi.article_id AND a.merchant_id=$2 AND oi.order_id=$3',
    [d.status, req.user.id, +req.params.id || 0]);
  if (!r.rowCount) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ ok: true });
}));
app.get('/api/orders/mine', auth('client'), wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT o.id, o.created_at, o.total, o.deposit, o.delivery_location, o.payment_method, o.payment_status,
            json_agg(json_build_object('name', a.name, 'qty', oi.qty, 'status', oi.status)) AS items
     FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN articles a ON a.id=oi.article_id
     WHERE o.client_id=$1 GROUP BY o.id ORDER BY o.id DESC LIMIT 50`, [req.user.id]);
  res.json(r.rows);
}));

// ---------- Messagerie client <-> commerçant ----------
const msgLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.get('/api/threads', auth('client', 'merchant'), wrap(async (req, res) => {
  const me = req.user.id, isC = req.user.role === 'client';
  const r = await pool.query(
    `SELECT t.other_id, u.name AS other_name, COALESCE(m.shop_name, u.name) AS label, t.last_at, t.unread
     FROM (SELECT ${isC ? 'merchant_id' : 'client_id'} AS other_id, max(created_at) AS last_at,
                  count(*) FILTER (WHERE NOT read AND sender_id<>$1)::int AS unread
           FROM messages WHERE ${isC ? 'client_id' : 'merchant_id'}=$1 GROUP BY 1) t
     JOIN users u ON u.id=t.other_id LEFT JOIN merchants m ON m.user_id=t.other_id
     ORDER BY t.last_at DESC`, [me]);
  res.json(r.rows);
}));
app.get('/api/messages/:otherId', auth('client', 'merchant'), wrap(async (req, res) => {
  const other = +req.params.otherId || 0, isC = req.user.role === 'client';
  const [cid, mid] = isC ? [req.user.id, other] : [other, req.user.id];
  await pool.query('UPDATE messages SET read=true WHERE client_id=$1 AND merchant_id=$2 AND sender_id<>$3 AND NOT read', [cid, mid, req.user.id]);
  const r = await pool.query(
    `SELECT ms.id, ms.sender_id, ms.body, ms.created_at, a.name AS article
     FROM messages ms LEFT JOIN articles a ON a.id=ms.article_id
     WHERE ms.client_id=$1 AND ms.merchant_id=$2 ORDER BY ms.id DESC LIMIT 200`, [cid, mid]);
  res.json(r.rows.reverse());
}));
app.post('/api/messages', msgLimiter, auth('client', 'merchant'), wrap(async (req, res) => {
  const d = parse(z.object({ to: z.number().int(), body: z.string().trim().min(1).max(1000),
    articleId: z.number().int().optional() }), req, res);
  if (!d) return;
  const isC = req.user.role === 'client';
  const [cid, mid] = isC ? [req.user.id, d.to] : [d.to, req.user.id];
  const ok = (await pool.query(
    `SELECT 1 FROM merchants m JOIN users u ON u.id=$2 WHERE m.user_id=$1 AND m.validated AND u.status='active' AND u.role='client'`, [mid, cid])).rowCount;
  if (!ok) return res.status(404).json({ error: 'Destinataire introuvable' });
  if (!isC && !(await pool.query('SELECT 1 FROM messages WHERE client_id=$1 AND merchant_id=$2 LIMIT 1', [cid, mid])).rowCount)
    return res.status(403).json({ error: 'Le client doit écrire en premier' });
  let art = null;
  if (d.articleId) art = (await pool.query('SELECT id FROM articles WHERE id=$1 AND merchant_id=$2', [d.articleId, mid])).rows[0]?.id || null;
  await pool.query('INSERT INTO messages(client_id,merchant_id,sender_id,article_id,body) VALUES($1,$2,$3,$4,$5)', [cid, mid, req.user.id, art, d.body]);
  res.status(201).json({ ok: true });
}));

// ---------- Modération des produits (admin) ----------
app.get('/api/admin/articles', auth('admin'), wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT a.id,a.name,a.description,a.price,a.moderation,m.shop_name FROM articles a JOIN merchants m ON m.user_id=a.merchant_id
     ORDER BY a.id DESC LIMIT 100`)).rows);
}));
app.post('/api/admin/articles/:id/remove', auth('admin'), wrap(async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req, res);
  if (!d) return;
  await pool.query("UPDATE articles SET moderation='removed', online=false, removed_reason=$1 WHERE id=$2", [d.reason, +req.params.id || 0]);
  res.json({ ok: true });
}));

// ---------- Démarrage ----------
(async () => {
  await pool.query(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));
  await pool.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS photo BYTEA');
  const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env;
  if (e && p && p.length >= 12) {
    const has = await pool.query("SELECT 1 FROM users WHERE role='admin'");
    if (!has.rowCount) await pool.query("INSERT INTO users(role,name,email,password_hash) VALUES('admin','Administrateur',lower($1),$2)", [e, await bcrypt.hash(p, 12)]);
  }
  setInterval(() => pool.query("SELECT (ref->>'orderId')::int AS oid FROM payments WHERE kind='order' AND status='pending' AND created_at < now() - interval '35 minutes'")
    .then(r => Promise.all(r.rows.map(x => releaseOrder(x.oid)))).catch(console.error), 5 * 60 * 1000).unref();
  app.listen(process.env.PORT || 3000, () => console.log('En ligne'));
})().catch(e => { console.error(e); process.exit(1); });
