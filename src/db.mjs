import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB_PATH = process.env.RDA_DB_PATH || path.resolve('data/rda.sqlite');

export function nowIso() {
  return new Date().toISOString();
}

export function randomId() {
  return crypto.randomUUID();
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expected] = stored.split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  status TEXT NOT NULL DEFAULT 'active',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sport TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  contacts_json TEXT NOT NULL DEFAULT '{}',
  social_relation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  sport TEXT NOT NULL DEFAULT '',
  price_cents INTEGER,
  price_label TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  owner_type TEXT NOT NULL DEFAULT 'rda',
  partner_id TEXT REFERENCES partners(id) ON DELETE SET NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Padrão',
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  minimum_stock INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL DEFAULT 'rda',
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory_movements(variant_id, created_at);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS comparisons (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS partner_offerings (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  offering_type TEXT NOT NULL DEFAULT 'service',
  owner_type TEXT NOT NULL DEFAULT 'partner',
  price_cents INTEGER,
  availability_status TEXT NOT NULL DEFAULT 'to_confirm',
  stock_quantity INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_processes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  capacity INTEGER NOT NULL DEFAULT 100,
  planned_start TEXT,
  planned_end TEXT,
  age_min INTEGER,
  age_max INTEGER,
  location TEXT NOT NULL DEFAULT '',
  criteria_json TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_applications (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  process_id TEXT REFERENCES social_processes(id) ON DELETE SET NULL,
  applicant_name TEXT NOT NULL,
  birth_date TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  guardian_json TEXT NOT NULL DEFAULT '{}',
  school_json TEXT NOT NULL DEFAULT '{}',
  sport_json TEXT NOT NULL DEFAULT '{}',
  additional_info TEXT NOT NULL DEFAULT '',
  documents_json TEXT NOT NULL DEFAULT '[]',
  consent_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  current_step INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_apps_user ON social_applications(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_social_apps_status ON social_applications(status, updated_at);

CREATE TABLE IF NOT EXISTS social_application_history (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES social_applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS athletes (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  application_id TEXT UNIQUE REFERENCES social_applications(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  birth_date TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guardians (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guardian_athletes (
  guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(guardian_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_cohorts (
  id TEXT PRIMARY KEY,
  process_id TEXT REFERENCES social_processes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  cohort_id TEXT REFERENCES social_cohorts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES training_sessions(id) ON DELETE SET NULL,
  attendance_type TEXT NOT NULL DEFAULT 'training',
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  period_start TEXT,
  period_end TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_performance (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  school_name TEXT NOT NULL DEFAULT '',
  grade_average REAL,
  school_attendance_percent REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_evaluations (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  evaluator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  score REAL,
  notes TEXT NOT NULL DEFAULT '',
  evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benefits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  benefit_type TEXT NOT NULL DEFAULT 'activity',
  rules_json TEXT NOT NULL DEFAULT '{}',
  availability_status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benefit_assignments (
  id TEXT PRIMARY KEY,
  benefit_id TEXT NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'assigned',
  assigned_at TEXT NOT NULL,
  delivered_at TEXT,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES social_applications(id) ON DELETE CASCADE,
  athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  is_private INTEGER NOT NULL DEFAULT 1,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'event',
  modality TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  location TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  rules TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(starts_at, status);

CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL,
  UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'Educacional',
  status TEXT NOT NULL DEFAULT 'draft',
  is_demo INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_public ON articles(status, published_at);

CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  points_balance INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'Bronze',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT UNIQUE,
  points_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL,
  stock_quantity INTEGER,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
  points_cost INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'geral',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'local-guide',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES coach_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  goal_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES social_campaigns(id) ON DELETE SET NULL,
  supporter_name TEXT,
  amount_cents INTEGER,
  provider_reference TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'interest',
  created_at TEXT NOT NULL
);
`;

export function createDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  const migration = db.prepare('SELECT version FROM migrations WHERE version = 1').get();
  if (!migration) {
    db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)').run(1, nowIso());
  }
  return db;
}

function json(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function insertIfMissing(db, table, uniqueColumn, uniqueValue, columns, values) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE ${uniqueColumn} = ?`).get(uniqueValue);
  if (existing) return existing.id;
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  return values[0];
}

function ensureUser(db, { name, email, password, role }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const id = randomId();
  const now = nowIso();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(id, name, email, hashPassword(password), role, now, now);
  return id;
}

export function seedDemoData(db) {
  const now = nowIso();
  const categories = [
    ['futebol', 'Futebol', 'Bolas, camisas, chuteiras e acessórios.', 'Futebol'],
    ['fitness', 'Fitness', 'Roupas e acessórios para treinos.', 'Fitness'],
    ['corrida', 'Corrida', 'Itens para correr com conforto e segurança.', 'Corrida'],
    ['treinamento', 'Treinamento', 'Equipamentos leves e funcionais.', 'Treinamento'],
    ['acessorios', 'Acessórios', 'Mochilas, garrafas, bonés e bolsas.', 'Geral'],
    ['uniformes', 'Uniformes personalizados', 'Solicite um orçamento para sua equipe.', 'Personalizados'],
    ['outros', 'Outros', 'Categoria administrável pela equipe.', 'Geral']
  ];
  const categoryIds = {};
  for (const [slug, name, description, sport] of categories) {
    categoryIds[slug] = insertIfMissing(db, 'categories', 'slug', slug,
      ['id', 'slug', 'name', 'description', 'sport', 'created_at'],
      [randomId(), slug, name, description, sport, now]);
  }

  const brandIds = {};
  for (const name of ['Nike', 'Adidas', 'Puma', 'Umbro', 'Mizuno', 'Penalty']) {
    const slug = name.toLowerCase();
    brandIds[slug] = insertIfMissing(db, 'brands', 'slug', slug,
      ['id', 'slug', 'name', 'created_at'], [randomId(), slug, name, now]);
  }

  const adminId = ensureUser(db, { name: 'Administrador RDA', email: 'admin@rda.local', password: 'Admin@12345', role: 'admin' });
  const teamId = ensureUser(db, { name: 'Equipe RDA', email: 'equipe@rda.local', password: 'Equipe@12345', role: 'team' });
  const clientId = ensureUser(db, { name: 'Cliente Demonstração', email: 'cliente@rda.local', password: 'Cliente@12345', role: 'client' });
  const athleteUserId = ensureUser(db, { name: 'Atleta Demonstração', email: 'atleta@rda.local', password: 'Atleta@12345', role: 'athlete' });
  const guardianUserId = ensureUser(db, { name: 'Responsável Demonstração', email: 'responsavel@rda.local', password: 'Responsavel@12345', role: 'guardian' });

  const partnerId = insertIfMissing(db, 'partners', 'slug', 'e-lavamos-nos',
    ['id', 'slug', 'name', 'description', 'category', 'contacts_json', 'social_relation', 'status', 'is_demo', 'created_at', 'updated_at'],
    [randomId(), 'e-lavamos-nos', 'E Lavamos Nós', 'Parceiro demonstrativo com página própria e catálogo separado. Informações comerciais, endereço e condições dependem de validação documental.', 'Serviços', JSON.stringify({ whatsapp: '', instagram: '' }), 'Apoio ao RDA Social em estruturação.', 'published', 1, now, now]);

  const products = [
    ['camisa-treino-rda', 'Camisa de treino RDA', 'Modelo demonstrativo para treinos e atividades do dia a dia.', 'futebol', 'penalty', 8990, 1],
    ['bola-futebol-treino', 'Bola de futebol para treino', 'Bola demonstrativa para atividades recreativas e treinos.', 'futebol', 'penalty', 11990, 1],
    ['chuteira-campo-demo', 'Chuteira de campo', 'Produto demonstrativo; consultar tamanhos e preço atualizado.', 'futebol', 'nike', null, 1],
    ['caneleira-protecao', 'Caneleira de proteção', 'Acessório leve para prática esportiva.', 'futebol', 'adidas', 3990, 0],
    ['legging-movimento', 'Legging Movimento', 'Roupas demonstrativas para treino e mobilidade.', 'fitness', 'puma', 7990, 1],
    ['faixa-elastica-treino', 'Faixa elástica funcional', 'Equipamento leve para ativação e fortalecimento.', 'treinamento', 'puma', 2990, 0],
    ['garrafa-hidratacao', 'Garrafa de hidratação', 'Garrafa demonstrativa para treinos e corrida.', 'acessorios', 'mizuno', 4590, 1],
    ['mochila-esportiva', 'Mochila esportiva', 'Compartimentos para rotina, treino e eventos.', 'acessorios', 'umbro', null, 1],
    ['camiseta-corrida', 'Camiseta para corrida', 'Tecido leve; disponibilidade real a confirmar.', 'corrida', 'adidas', 6990, 0],
    ['meia-performance', 'Meia Performance', 'Par demonstrativo com suporte confortável.', 'corrida', 'nike', 2490, 0],
    ['kit-uniforme-equipe', 'Kit uniforme personalizado', 'Solicite orçamento para equipes, escolas e clubes.', 'uniformes', null, null, 1],
    ['boné-rda', 'Boné RDA', 'Item demonstrativo de identidade da marca.', 'acessorios', null, 4990, 1]
  ];
  for (const [slug, name, description, category, brand, price, featured] of products) {
    const productId = insertIfMissing(db, 'products', 'slug', slug,
      ['id', 'slug', 'name', 'description', 'category_id', 'brand_id', 'sport', 'price_cents', 'price_label', 'status', 'owner_type', 'featured', 'is_demo', 'created_at', 'updated_at'],
      [randomId(), slug, name, description, categoryIds[category], brand ? brandIds[brand] : null, categories.find(([s]) => s === category)?.[3] || 'Geral', price, price === null ? 'Consultar preço' : null, 'published', 'rda', featured, 1, now, now]);
    const variants = slug === 'camisa-treino-rda'
      ? [['P', 'P', 'Preta', 4], ['M', 'M', 'Preta', 8], ['G', 'G', 'Preta', 2]]
      : slug === 'chuteira-campo-demo'
        ? [['38', '38', 'Preta', 0], ['40', '40', 'Preta', 0]]
        : [['Único', '', 'Padrão', featured ? 5 : 0]];
    for (const [nameVariant, size, color, stock] of variants) {
      const sku = `${slug.toUpperCase().replaceAll('-', '-')}-${nameVariant}`;
      const existingVariant = db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku);
      if (!existingVariant) {
        db.prepare(`INSERT INTO product_variants (id, product_id, sku, name, size, color, stock_quantity, minimum_stock, availability, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomId(), productId, sku, nameVariant, size, color, stock, 1, stock > 0 ? 'available' : 'to_confirm', now, now);
      }
    }
  }

  const offeringNames = [
    ['Lavagem por ciclo', 'Serviço citado como referência pendente de validação. Não há preço ou disponibilidade confirmados.', 'service'],
    ['Cestos e sacolas', 'Item/serviço demonstrativo; proprietário e condições a confirmar.', 'physical'],
    ['Atendimento para pets', 'Referência pendente: confirmar se é equipamento ou serviço antes da publicação.', 'service']
  ];
  for (const [name, description, type] of offeringNames) {
    const exists = db.prepare('SELECT id FROM partner_offerings WHERE partner_id = ? AND name = ?').get(partnerId, name);
    if (!exists) {
      db.prepare(`INSERT INTO partner_offerings (id, partner_id, name, description, offering_type, owner_type, availability_status, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'partner', 'to_confirm', 1, ?, ?)`).run(randomId(), partnerId, name, description, type, now, now);
    }
  }

  const processId = insertIfMissing(db, 'social_processes', 'name', 'Turma RDA Social — demonstração',
    ['id', 'name', 'status', 'capacity', 'planned_start', 'planned_end', 'age_min', 'age_max', 'location', 'criteria_json', 'is_demo', 'created_at', 'updated_at'],
    [randomId(), 'Turma RDA Social — demonstração', 'active', 100, null, null, null, null, 'Local a confirmar', JSON.stringify({ school_attendance_min: 80, grade_min: 7, final_decision_by_team: true }), 1, now, now]);

  const cohortId = insertIfMissing(db, 'social_cohorts', 'name', 'Turma demonstrativa RDA Social',
    ['id', 'process_id', 'name', 'capacity', 'status', 'created_at'], [randomId(), processId, 'Turma demonstrativa RDA Social', 30, 'active', now]);
  const trainingId = insertIfMissing(db, 'training_sessions', 'title', 'Treino demonstrativo — confirme a agenda',
    ['id', 'cohort_id', 'title', 'starts_at', 'ends_at', 'location', 'status', 'created_at'],
    [randomId(), cohortId, 'Treino demonstrativo — confirme a agenda', new Date(Date.now() + 7 * 86400000).toISOString(), new Date(Date.now() + 7 * 86400000 + 90 * 60000).toISOString(), 'Local a confirmar', 'scheduled', now]);

  const athleteExisting = db.prepare('SELECT id FROM athletes WHERE user_id = ?').get(athleteUserId);
  let athleteId = athleteExisting?.id;
  if (!athleteId) {
    athleteId = randomId();
    db.prepare(`INSERT INTO athletes (id, user_id, full_name, birth_date, modality, position, status, created_at, updated_at)
      VALUES (?, ?, 'Atleta Demonstração', '2010-05-10', 'Futebol', 'Meio-campo', 'active', ?, ?)`).run(athleteId, athleteUserId, now, now);
  }
  const guardianExisting = db.prepare('SELECT id FROM guardians WHERE user_id = ?').get(guardianUserId);
  let guardianId = guardianExisting?.id;
  if (!guardianId) {
    guardianId = randomId();
    db.prepare('INSERT INTO guardians (id, user_id, created_at) VALUES (?, ?, ?)').run(guardianId, guardianUserId, now);
  }
  db.prepare(`INSERT OR IGNORE INTO guardian_athletes (guardian_id, athlete_id, verified, created_at) VALUES (?, ?, 1, ?)`)
    .run(guardianId, athleteId, now);
  db.prepare(`INSERT OR IGNORE INTO attendance (id, athlete_id, session_id, attendance_type, date, status, period_start, period_end, recorded_by, created_at)
    VALUES (?, ?, ?, 'training', ?, 'present', ?, ?, ?, ?)`)
    .run(randomId(), athleteId, trainingId, new Date().toISOString().slice(0, 10), new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10), teamId, now);
  if (!db.prepare('SELECT id FROM school_performance WHERE athlete_id = ?').get(athleteId)) {
    db.prepare(`INSERT INTO school_performance (id, athlete_id, period_start, period_end, school_name, grade_average, school_attendance_percent, source, recorded_by, created_at)
      VALUES (?, ?, ?, ?, 'Escola demonstrativa', 7.5, 86, 'manual-demo', ?, ?)`).run(randomId(), athleteId, '2026-01-01', '2026-06-30', teamId, now);
  }
  const benefitId = insertIfMissing(db, 'benefits', 'name', 'Kit esportivo — demonstração',
    ['id', 'name', 'description', 'benefit_type', 'rules_json', 'availability_status', 'created_at'],
    [randomId(), 'Kit esportivo — demonstração', 'Possibilidade de benefício; entrega depende de regras e disponibilidade reais.', 'material', JSON.stringify({ requires_team_decision: true }), 'to_confirm', now]);
  if (!db.prepare('SELECT id FROM benefit_assignments WHERE benefit_id = ? AND athlete_id = ?').get(benefitId, athleteId)) {
    db.prepare(`INSERT INTO benefit_assignments (id, benefit_id, athlete_id, status, assigned_at, assigned_by, notes)
      VALUES (?, ?, ?, 'available', ?, ?, 'Registro demonstrativo; não é direito garantido.')`).run(randomId(), benefitId, athleteId, now, teamId);
  }

  const eventId = insertIfMissing(db, 'events', 'slug', 'encontro-rda-demo',
    ['id', 'slug', 'title', 'type', 'modality', 'description', 'starts_at', 'ends_at', 'timezone', 'location', 'capacity', 'status', 'rules', 'is_demo', 'created_by', 'created_at', 'updated_at'],
    [randomId(), 'encontro-rda-demo', 'Encontro RDA — demonstração', 'encontro', 'Geral', 'Agenda de demonstração para validar o fluxo de inscrição. Data, local e realização ainda precisam de confirmação da equipe.', new Date(Date.now() + 14 * 86400000).toISOString(), new Date(Date.now() + 14 * 86400000 + 2 * 3600000).toISOString(), 'America/Sao_Paulo', 'Local a confirmar', 40, 'published', 'Participação sujeita à confirmação da equipe.', 1, teamId, now, now]);
  void eventId;

  const articleId = insertIfMissing(db, 'articles', 'slug', 'como-escolher-a-bola-certa',
    ['id', 'slug', 'title', 'summary', 'body', 'author_id', 'category', 'status', 'is_demo', 'published_at', 'created_at', 'updated_at'],
    [randomId(), 'como-escolher-a-bola-certa', 'Como escolher uma bola para treinar', 'Um guia educativo demonstrativo para observar modalidade, ambiente e frequência de uso.', 'Comece pela modalidade e pelo espaço disponível. Para treinos recreativos, observe a construção, o tamanho e a facilidade de manutenção. A escolha final depende do seu contexto e não substitui orientação profissional.', teamId, 'Guias de compra', 'published', 1, now, now, now]);
  void articleId;
  const faqs = [
    ['Catálogo', 'Os produtos estão disponíveis para compra imediata?', 'O catálogo inicial é demonstrativo. Preço, disponibilidade e autorização de revenda devem ser confirmados com a equipe pelo contato da aplicação.'],
    ['RDA Social', 'A inscrição garante uma vaga?', 'Não. A inscrição gera um protocolo para análise. A decisão final é da equipe autorizada e depende do processo ativo, documentação e capacidade.'],
    ['Privacidade', 'Documentos pessoais ficam públicos?', 'Não. A estrutura reserva documentos para acesso autorizado. A versão demonstrativa não solicita upload público de documentos.'],
    ['Elite', 'Consultas no catálogo geram pontos?', 'Não. Pontos só podem ser lançados por uma regra e origem registradas; consultar um produto não gera compra nem pontuação.']
  ];
  for (const [category, question, answer] of faqs) {
    if (!db.prepare('SELECT id FROM faqs WHERE question = ?').get(question)) {
      db.prepare('INSERT INTO faqs (id, category, question, answer, status, display_order, created_at) VALUES (?, ?, ?, ?, \'published\', ?, ?)')
        .run(randomId(), category, question, answer, faqs.indexOf(faqs.find((item) => item[1] === question)), now);
    }
  }

  const rewardId = insertIfMissing(db, 'rewards', 'name', 'Experiência RDA — demonstração',
    ['id', 'name', 'description', 'points_cost', 'stock_quantity', 'status', 'created_at'],
    [randomId(), 'Experiência RDA — demonstração', 'Recompensa em estruturação, sujeita à disponibilidade.', 100, 5, 'available', now]);
  const loyaltyExisting = db.prepare('SELECT id FROM loyalty_accounts WHERE user_id = ?').get(clientId);
  let loyaltyId = loyaltyExisting?.id;
  if (!loyaltyId) {
    loyaltyId = randomId();
    db.prepare('INSERT INTO loyalty_accounts (id, user_id, points_balance, level, created_at, updated_at) VALUES (?, ?, 180, \'Bronze\', ?, ?)').run(loyaltyId, clientId, now, now);
    db.prepare(`INSERT INTO loyalty_transactions (id, account_id, idempotency_key, points_delta, reason, source_type, author_id, created_at)
      VALUES (?, ?, 'seed-demo-client-180', 180, 'Saldo demonstrativo inicial', 'demo', ?, ?)`).run(randomId(), loyaltyId, adminId, now);
  }
  void rewardId;
  if (!db.prepare('SELECT id FROM notifications WHERE user_id = ?').get(clientId)) {
    db.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, \'welcome\', \'Bem-vindo à RDA Sports\', \'Este ambiente usa dados demonstrativos e já está pronto para você explorar.\', ?)').run(randomId(), clientId, now);
  }

  const settings = [
    ['brand_name', 'RDA Sports'],
    ['brand_slogan', 'Movendo a paixão pelo esporte.'],
    ['social_phrase', 'Jogue limpo. Jogue preparado.'],
    ['demo_mode', 'true'],
    ['whatsapp', ''],
    ['instagram', ''],
    ['contact_email', ''],
    ['social_capacity_planned', '100'],
    ['ai_mode', process.env.OPENAI_API_KEY ? 'openai-configured' : 'local-guide']
  ];
  for (const [key, value] of settings) {
    db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, now);
  }

  return { adminId, teamId, clientId, athleteUserId, guardianUserId, partnerId, processId };
}

export function readSettings(db) {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function audit(db, { actorId = null, action, entityType, entityId = null, payload = {} }) {
  db.prepare(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomId(), actorId, action, entityType, entityId, JSON.stringify(payload), nowIso());
}

export function parseJson(value, fallback = {}) {
  return json(value, fallback);
}
