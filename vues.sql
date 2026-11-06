-- Vues de lecture : executees apres toutes les migrations. Aucune donnee secrete (mot de passe, 2FA) n'y figure.

CREATE OR REPLACE VIEW v_commercants AS
SELECT m.user_id AS id, m.shop_name AS entreprise, u.name AS proprietaire, u.email, u.phone AS telephone,
       m.whatsapp, m.location AS localite, m.since_year AS depuis_annee, m.stars AS etoiles,
       CASE WHEN m.validated THEN 'valide' ELSE 'en attente' END AS validation, u.status AS compte,
       count(a.id)::int AS nb_articles,
       count(a.id) FILTER (WHERE a.online AND a.moderation='ok')::int AS nb_articles_en_ligne,
       COALESCE(sum(a.stock),0)::int AS stock_total,
       u.created_at AS inscrit_le
FROM merchants m JOIN users u ON u.id=m.user_id LEFT JOIN articles a ON a.merchant_id=m.user_id
GROUP BY m.user_id, u.id;

CREATE OR REPLACE VIEW v_articles AS
SELECT a.id, m.shop_name AS entreprise, a.name AS article, a.category AS categorie,
       a.price AS prix, a.promo_price AS prix_promo, a.promo_until AS promo_jusqu_au,
       a.stock AS quantite_en_stock, a.online AS en_ligne, a.moderation, a.removed_reason AS motif_retrait,
       a.created_at AS cree_le
FROM articles a JOIN merchants m ON m.user_id=a.merchant_id;

CREATE OR REPLACE VIEW v_clients AS
SELECT u.id, u.name AS nom_complet, u.email, u.phone AS telephone, u.status AS compte, u.created_at AS inscrit_le,
       count(o.id)::int AS nb_commandes,
       COALESCE(sum(o.total) FILTER (WHERE o.payment_status='paid'),0)::int AS total_paye,
       max(o.created_at) AS derniere_commande,
       string_agg(DISTINCT o.delivery_location, ' | ') AS lieux_de_livraison,
       string_agg(DISTINCT o.customer_phone, ' | ') AS telephones_utilises_en_commande
FROM users u LEFT JOIN orders o ON o.client_id=u.id
WHERE u.role='client'
GROUP BY u.id;

CREATE OR REPLACE VIEW v_utilisateurs AS
SELECT u.id, u.role, u.name AS nom, u.email, u.phone AS telephone, u.status AS compte, u.created_at AS inscrit_le,
       m.shop_name AS entreprise
FROM users u LEFT JOIN merchants m ON m.user_id=u.id;

CREATE OR REPLACE VIEW v_commandes AS
SELECT o.id, o.created_at AS date, u.name AS client, u.email AS email_client,
       o.customer_name AS nom_livraison, o.customer_phone AS tel_livraison, o.delivery_location AS lieu_livraison,
       o.payment_method AS moyen_paiement, o.payment_status AS paiement, o.status AS statut,
       o.total, o.deposit AS acompte,
       (SELECT string_agg(a.name || ' x' || oi.qty || ' à ' || oi.unit_price || ' (' || m.shop_name || ', ' || oi.status || ')', ' ; ' ORDER BY oi.id)
          FROM order_items oi JOIN articles a ON a.id=oi.article_id JOIN merchants m ON m.user_id=a.merchant_id
         WHERE oi.order_id=o.id) AS articles_commandes
FROM orders o JOIN users u ON u.id=o.client_id;

CREATE OR REPLACE VIEW v_paiements AS
SELECT p.id, p.created_at AS date, u.name AS payeur, u.role, p.kind AS type, p.amount AS montant, p.status AS statut,
       p.ref->>'orderId' AS commande, p.wave_session_id
FROM payments p JOIN users u ON u.id=p.user_id;

CREATE OR REPLACE VIEW v_abonnements AS
SELECT pl.id, pl.created_at AS date, m.shop_name AS entreprise, pl.tier AS formule, pl.amount AS montant,
       pl.status AS statut, pl.expires_at AS expire_le, pc.code AS code_promo
FROM plans pl JOIN merchants m ON m.user_id=pl.merchant_id LEFT JOIN promo_codes pc ON pc.id=m.promo_code_id;

CREATE OR REPLACE VIEW v_avis AS
SELECT r.id, r.created_at AS date, m.shop_name AS entreprise, u.name AS client, r.order_id AS commande, r.score AS note, r.comment AS commentaire
FROM reviews r JOIN merchants m ON m.user_id=r.merchant_id JOIN users u ON u.id=r.client_id;

CREATE OR REPLACE VIEW v_messages AS
SELECT ms.id, ms.created_at AS date, c.name AS client, m.shop_name AS entreprise, s.name AS expediteur,
       a.name AS article_concerne, ms.body AS message, ms.read AS lu
FROM messages ms JOIN users c ON c.id=ms.client_id JOIN merchants m ON m.user_id=ms.merchant_id
JOIN users s ON s.id=ms.sender_id LEFT JOIN articles a ON a.id=ms.article_id;

CREATE OR REPLACE VIEW v_codes_promo AS
SELECT id, code, standard_price AS prix_standard, premium_price AS prix_premium, uses AS utilisations, max_uses AS utilisations_max,
       CASE WHEN active THEN 'actif' ELSE 'desactive' END AS etat, created_at AS cree_le
FROM promo_codes;

-- Journal de toutes les operations, de la plus recente a la plus ancienne
CREATE OR REPLACE VIEW v_journal AS
SELECT created_at AS date, 'inscription' AS operation, name AS acteur,
       role || ' - ' || email AS detail, NULL::int AS montant FROM users
UNION ALL SELECT a.created_at, 'article ajoute', m.shop_name, a.name || ' (stock ' || a.stock || ')', a.price
  FROM articles a JOIN merchants m ON m.user_id=a.merchant_id
UNION ALL SELECT o.created_at, 'commande', u.name, 'commande n°' || o.id || ' - ' || o.payment_status || ' - ' || COALESCE(o.delivery_location,''), o.total
  FROM orders o JOIN users u ON u.id=o.client_id
UNION ALL SELECT p.created_at, 'paiement', u.name, p.kind || ' - ' || p.status, p.amount
  FROM payments p JOIN users u ON u.id=p.user_id
UNION ALL SELECT pl.created_at, 'abonnement', m.shop_name, pl.tier || ' - ' || pl.status, pl.amount
  FROM plans pl JOIN merchants m ON m.user_id=pl.merchant_id
UNION ALL SELECT r.created_at, 'avis', u.name, 'note ' || r.score || '/5 pour ' || m.shop_name, NULL
  FROM reviews r JOIN users u ON u.id=r.client_id JOIN merchants m ON m.user_id=r.merchant_id
UNION ALL SELECT ms.created_at, 'message', s.name, 'a ecrit (client : ' || c.name || ', boutique : ' || m.shop_name || ')', NULL
  FROM messages ms JOIN users s ON s.id=ms.sender_id JOIN users c ON c.id=ms.client_id JOIN merchants m ON m.user_id=ms.merchant_id;
