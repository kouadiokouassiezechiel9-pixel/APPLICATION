CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('client','merchant','admin')),
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS merchants(
  user_id INT PRIMARY KEY REFERENCES users(id),
  shop_name TEXT NOT NULL, location TEXT,
  validated BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS subscriptions(
  id SERIAL PRIMARY KEY, merchant_id INT NOT NULL REFERENCES merchants(user_id),
  quota INT NOT NULL CHECK (quota > 0), amount INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS articles(
  id SERIAL PRIMARY KEY, merchant_id INT NOT NULL REFERENCES merchants(user_id),
  name TEXT NOT NULL, description TEXT, category TEXT,
  price INT NOT NULL CHECK (price > 0), stock INT NOT NULL CHECK (stock >= 0),
  online BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS orders(
  id SERIAL PRIMARY KEY, client_id INT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending', total INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS order_items(
  id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES orders(id),
  article_id INT NOT NULL REFERENCES articles(id),
  qty INT NOT NULL CHECK (qty > 0), unit_price INT NOT NULL);
CREATE TABLE IF NOT EXISTS payments(
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id),
  amount INT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_articles_merchant ON articles(merchant_id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_location TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS moderation TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS removed_reason TEXT;
CREATE TABLE IF NOT EXISTS messages(
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES users(id),
  merchant_id INT NOT NULL REFERENCES merchants(user_id),
  sender_id INT NOT NULL REFERENCES users(id),
  article_id INT REFERENCES articles(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(client_id, merchant_id, id);
CREATE TABLE IF NOT EXISTS plans(
  id SERIAL PRIMARY KEY, merchant_id INT NOT NULL REFERENCES merchants(user_id),
  tier TEXT NOT NULL CHECK (tier IN ('standard','premium')), amount INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_plans_merchant ON plans(merchant_id, id);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS wave_session_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ref JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_wave ON payments(wave_session_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit INT NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS photo BYTEA;
