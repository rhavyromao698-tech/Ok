import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  audit,
  createDatabase,
  hashPassword,
  hashToken,
  nowIso,
  parseJson,
  randomId,
  readSettings,
  seedDemoData,
  verifyPassword,
  DEFAULT_DB_PATH
} from './db.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const MAX_BODY_BYTES = 1_500_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map();

class HttpError extends Error {
  constructor(status, message, code = 'request_error', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(status, message, code = 'request_error', details) {
  throw new HttpError(status, message, code, details);
}

function jsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const baseHeaders = {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers
  };
  res.writeHead(status, baseHeaders);
  res.end(payload);
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, data, headers);
}

function noContent(res, headers = {}) {
  res.writeHead(204, headers);
  res.end();
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function cookieHeader(token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `rda_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'O envio excede o limite permitido.', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'O corpo da requisição precisa ser JSON válido.', 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function requiredText(value, label, max = 5000) {
  const clean = cleanText(value, max);
  if (!clean) fail(422, `${label} é obrigatório.`, 'validation_error');
  return clean;
}

function validEmail(value) {
  const email = cleanText(value, 190).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(422, 'Informe um e-mail válido.', 'validation_error');
  return email;
}

function asInt(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function protocol() {
  return `RDA-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}

function currentUser(db, req) {
  const token = parseCookies(req.headers.cookie).rda_session;
  if (!token) return null;
  const user = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`).get(hashToken(token), nowIso());
  return user || null;
}

function requireUser(ctx) {
  if (!ctx.user) fail(401, 'Faça login para continuar.', 'authentication_required');
  return ctx.user;
}

function requireStaff(ctx) {
  const user = requireUser(ctx);
  if (!['admin', 'team'].includes(user.role)) fail(403, 'Esta ação exige permissão da equipe RDA.', 'forbidden');
  return user;
}

function requireAdmin(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'admin') fail(403, 'Esta ação exige permissão de administrador.', 'forbidden');
  return user;
}

function enforceRateLimit(key, limit = 40) {
  const now = Date.now();
  const existing = rateBuckets.get(key) || [];
  const fresh = existing.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= limit) fail(429, 'Muitas tentativas em pouco tempo. Aguarde um minuto.', 'rate_limited');
  fresh.push(now);
  rateBuckets.set(key, fresh);
}

function createSession(db, userId) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(raw), userId, expiresAt, nowIso());
  return raw;
}

function revokeSession(db, req) {
  const token = parseCookies(req.headers.cookie).rda_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function getCategoryMap(db) {
  return Object.fromEntries(db.prepare('SELECT id, slug, name FROM categories').all().map((row) => [row.slug, row]));
}

function serializeProduct(db, row, userId = null) {
  const variants = db.prepare(`SELECT id, sku, name, size, color, stock_quantity, minimum_stock, availability
    FROM product_variants WHERE product_id = ? ORDER BY size, name`).all(row.id);
  const favorite = userId ? Boolean(db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?').get(userId, row.id)) : false;
  const comparison = userId ? Boolean(db.prepare('SELECT 1 FROM comparisons WHERE user_id = ? AND product_id = ?').get(userId, row.id)) : false;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category_name ? { id: row.category_id, slug: row.category_slug, name: row.category_name } : null,
    brand: row.brand_name ? { id: row.brand_id, slug: row.brand_slug, name: row.brand_name } : null,
    sport: row.sport,
    priceCents: row.price_cents,
    priceLabel: row.price_cents === null ? (row.price_label || 'Consultar preço') : null,
    status: row.status,
    ownerType: row.owner_type,
    partnerId: row.partner_id,
    featured: Boolean(row.featured),
    isDemo: Boolean(row.is_demo),
    stockQuantity: variants.reduce((total, variant) => total + Number(variant.stock_quantity || 0), 0),
    hasAvailability: variants.some((variant) => variant.availability === 'available' && variant.stock_quantity > 0),
    variants,
    favorite,
    comparison
  };
}

function productSelect() {
  return `SELECT p.*, c.slug AS category_slug, c.name AS category_name,
    b.slug AS brand_slug, b.name AS brand_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id`;
}

function listProducts(db, query, userId = null) {
  const clauses = ["p.status = 'published'"];
  const params = [];
  const search = cleanText(query.get('q'), 120);
  if (search) {
    clauses.push('(p.name LIKE ? OR p.description LIKE ? OR p.sport LIKE ? OR c.name LIKE ? OR b.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (query.get('category')) { clauses.push('c.slug = ?'); params.push(cleanText(query.get('category'), 80)); }
  if (query.get('brand')) { clauses.push('b.slug = ?'); params.push(cleanText(query.get('brand'), 80)); }
  if (query.get('sport')) { clauses.push('p.sport LIKE ?'); params.push(`%${cleanText(query.get('sport'), 80)}%`); }
  if (query.get('minPrice')) { clauses.push('p.price_cents >= ?'); params.push(Math.max(0, asInt(query.get('minPrice'), 0) * 100)); }
  if (query.get('maxPrice')) { clauses.push('p.price_cents <= ?'); params.push(Math.max(0, asInt(query.get('maxPrice'), 0) * 100)); }
  if (query.get('available') === 'true') clauses.push(`EXISTS (SELECT 1 FROM product_variants va WHERE va.product_id = p.id AND va.stock_quantity > 0 AND va.availability = 'available')`);
  const order = query.get('sort') === 'price-asc' ? 'p.price_cents IS NULL, p.price_cents ASC' : query.get('sort') === 'price-desc' ? 'p.price_cents IS NULL, p.price_cents DESC' : query.get('sort') === 'newest' ? 'p.created_at DESC' : 'p.featured DESC, p.created_at DESC';
  const page = Math.max(1, asInt(query.get('page'), 1));
  const limit = Math.min(48, Math.max(1, asInt(query.get('limit'), 12)));
  const offset = (page - 1) * limit;
  const rows = db.prepare(`${productSelect()} WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id WHERE ${clauses.join(' AND ')}`).get(...params).count;
  return { items: rows.map((row) => serializeProduct(db, row, userId)), page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

function findProduct(db, key, userId = null) {
  const row = db.prepare(`${productSelect()} WHERE p.id = ? OR p.slug = ?`).get(key, key);
  if (!row || row.status !== 'published') fail(404, 'Produto não encontrado.', 'not_found');
  return serializeProduct(db, row, userId);
}

function serializeEvent(db, row, userId = null) {
  const registrationCount = db.prepare("SELECT COUNT(*) AS count FROM event_registrations WHERE event_id = ? AND status = 'confirmed'").get(row.id).count;
  const registration = userId ? db.prepare('SELECT id, status, created_at FROM event_registrations WHERE event_id = ? AND user_id = ?').get(row.id, userId) : null;
  return {
    id: row.id, slug: row.slug, title: row.title, type: row.type, modality: row.modality,
    description: row.description, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone,
    location: row.location, capacity: row.capacity, registered: registrationCount, availableSpots: row.capacity === null ? null : Math.max(0, row.capacity - registrationCount),
    status: row.status, rules: row.rules, isDemo: Boolean(row.is_demo), registration: registration || null
  };
}

function serializePartner(db, row) {
  const offerings = db.prepare(`SELECT id, name, description, offering_type, owner_type, price_cents,
    availability_status, stock_quantity, is_demo FROM partner_offerings WHERE partner_id = ? ORDER BY created_at`).all(row.id);
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description, category: row.category,
    logoUrl: row.logo_url, contacts: jsonParse(row.contacts_json, {}), socialRelation: row.social_relation,
    status: row.status, isDemo: Boolean(row.is_demo), offerings: offerings.map((item) => ({
      id: item.id, name: item.name, description: item.description, type: item.offering_type, ownerType: item.owner_type,
      priceCents: item.price_cents, availabilityStatus: item.availability_status, stockQuantity: item.stock_quantity, isDemo: Boolean(item.is_demo)
    }))
  };
}

function serializeApplication(db, row, includePrivate = true) {
  const history = db.prepare(`SELECT h.id, h.from_status, h.to_status, h.reason, h.created_at,
    u.name AS author_name FROM social_application_history h LEFT JOIN users u ON u.id = h.author_id
    WHERE h.application_id = ? ORDER BY h.created_at DESC`).all(row.id);
  return {
    id: row.id,
    protocol: row.protocol,
    status: row.status,
    currentStep: row.current_step,
    applicantName: row.applicant_name,
    birthDate: row.birth_date,
    email: row.email,
    phone: row.phone,
    address: row.address,
    guardian: includePrivate ? jsonParse(row.guardian_json, {}) : {},
    school: includePrivate ? jsonParse(row.school_json, {}) : {},
    sport: includePrivate ? jsonParse(row.sport_json, {}) : {},
    additionalInfo: row.additional_info,
    consent: includePrivate ? jsonParse(row.consent_json, {}) : {},
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: history.map((item) => ({ id: item.id, from: item.from_status, to: item.to_status, reason: item.reason, author: item.author_name || 'Sistema', createdAt: item.created_at }))
  };
}

function applicationOwner(ctx, application) {
  if (!application) fail(404, 'Inscrição não encontrada.', 'not_found');
  if (['admin', 'team'].includes(ctx.user?.role)) return true;
  if (application.user_id !== ctx.user?.id) fail(403, 'Você só pode acessar suas próprias inscrições.', 'forbidden');
  return true;
}

function parseApplicationPayload(body, current = null) {
  const guardian = body.guardian ?? (current ? jsonParse(current.guardian_json, {}) : {});
  const school = body.school ?? (current ? jsonParse(current.school_json, {}) : {});
  const sport = body.sport ?? (current ? jsonParse(current.sport_json, {}) : {});
  const consent = body.consent ?? (current ? jsonParse(current.consent_json, {}) : {});
  return {
    applicantName: cleanText(body.applicantName ?? body.name ?? current?.applicant_name, 180),
    birthDate: cleanText(body.birthDate ?? current?.birth_date, 20),
    email: cleanText(body.email ?? current?.email, 190).toLowerCase(),
    phone: cleanText(body.phone ?? current?.phone, 60),
    address: cleanText(body.address ?? current?.address, 300),
    guardian: typeof guardian === 'object' && guardian ? guardian : {},
    school: typeof school === 'object' && school ? school : {},
    sport: typeof sport === 'object' && sport ? sport : {},
    additionalInfo: cleanText(body.additionalInfo ?? current?.additional_info, 3000),
    consent: typeof consent === 'object' && consent ? consent : {},
    currentStep: Math.min(7, Math.max(1, asInt(body.currentStep ?? current?.current_step, 1)))
  };
}

function validateApplicationForSubmission(application) {
  const errors = [];
  if (!application.applicant_name) errors.push('Informe o nome do participante.');
  if (!application.birth_date) errors.push('Informe a data de nascimento.');
  if (!application.email || !/^\S+@\S+\.\S+$/.test(application.email)) errors.push('Informe um e-mail válido.');
  const guardian = jsonParse(application.guardian_json, {});
  const school = jsonParse(application.school_json, {});
  const sport = jsonParse(application.sport_json, {});
  const consent = jsonParse(application.consent_json, {});
  if (!guardian.name || !guardian.contact) errors.push('Informe responsável e contato para a etapa de autorização.');
  if (!school.name || !school.grade || school.attendance === undefined || school.attendance === '') errors.push('Complete os dados escolares do período informado.');
  if (!sport.modality) errors.push('Informe a modalidade de interesse.');
  if (consent.terms !== true) errors.push('É necessário aceitar o termo de participação para enviar.');
  return errors;
}

function getAthletePayload(db, athleteId) {
  const athlete = db.prepare('SELECT * FROM athletes WHERE id = ?').get(athleteId);
  if (!athlete) fail(404, 'Atleta não encontrado.', 'not_found');
  const attendance = db.prepare(`SELECT a.id, a.attendance_type, a.date, a.status, s.title AS session_title, s.starts_at, s.location
    FROM attendance a LEFT JOIN training_sessions s ON s.id = a.session_id WHERE a.athlete_id = ? ORDER BY a.date DESC LIMIT 100`).all(athleteId);
  const school = db.prepare('SELECT id, period_start, period_end, school_name, grade_average, school_attendance_percent, source, created_at FROM school_performance WHERE athlete_id = ? ORDER BY period_end DESC').all(athleteId);
  const evaluations = db.prepare('SELECT id, category, score, notes, evaluated_at FROM social_evaluations WHERE athlete_id = ? ORDER BY evaluated_at DESC').all(athleteId);
  const benefits = db.prepare(`SELECT ba.id, ba.status, ba.assigned_at, ba.delivered_at, ba.notes, b.name, b.description
    FROM benefit_assignments ba JOIN benefits b ON b.id = ba.benefit_id WHERE ba.athlete_id = ? ORDER BY ba.assigned_at DESC`).all(athleteId);
  const upcoming = db.prepare(`SELECT ts.id, ts.title, ts.starts_at, ts.ends_at, ts.location, ts.status
    FROM training_sessions ts JOIN social_cohorts sc ON sc.id = ts.cohort_id
    WHERE ts.starts_at >= ? ORDER BY ts.starts_at LIMIT 20`).all(new Date().toISOString());
  return { id: athlete.id, name: athlete.full_name, birthDate: athlete.birth_date, modality: athlete.modality, position: athlete.position, status: athlete.status, attendance, school, evaluations, benefits, upcoming };
}

function getDashboard(db) {
  const count = (table, where = '') => db.prepare(`SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ''}`).get().count;
  const stockAlerts = db.prepare(`SELECT COUNT(*) AS count FROM product_variants WHERE stock_quantity <= minimum_stock`).get().count;
  const socialByStatus = db.prepare('SELECT status, COUNT(*) AS count FROM social_applications GROUP BY status').all();
  return {
    counts: {
      products: count('products', "status = 'published'"), users: count('users', "status = 'active'"), athletes: count('athletes'),
      applications: count('social_applications'), events: count('events'), partners: count('partners', "status = 'published'"),
      articles: count('articles', "status = 'published'"), messages: count('contact_messages', "status = 'new'"), stockAlerts
    },
    socialByStatus,
    recentAudit: db.prepare(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.name AS actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 12`).all()
  };
}

function getKnowledge(db) {
  const settings = readSettings(db);
  const categories = db.prepare('SELECT name FROM categories WHERE active = 1 ORDER BY name').all().map((row) => row.name);
  const events = db.prepare("SELECT title, starts_at, location, is_demo FROM events WHERE status = 'published' ORDER BY starts_at LIMIT 8").all();
  const processes = db.prepare("SELECT name, status, capacity, is_demo FROM social_processes WHERE status = 'active' ORDER BY created_at DESC LIMIT 4").all();
  return { brand: settings.brand_name, slogan: settings.brand_slogan, demoMode: settings.demo_mode === 'true', categories, events, processes, partners: db.prepare("SELECT name, is_demo FROM partners WHERE status = 'published'").all() };
}

function localCoachAnswer(db, message) {
  const text = message.toLowerCase();
  const knowledge = getKnowledge(db);
  if (text.includes('estoque') || text.includes('dispon') || text.includes('preço') || text.includes('preco')) {
    const products = listProducts(db, new URLSearchParams({ q: message, limit: '5' })).items;
    if (!products.length) return 'Não encontrei um item correspondente no catálogo demonstrativo. Posso orientar pela categoria, mas a disponibilidade e o preço precisam ser confirmados pela equipe.';
    return `Encontrei ${products.length} item(ns) relacionado(s): ${products.map((item) => `${item.name} — ${item.priceCents === null ? 'consultar preço' : `R$ ${(item.priceCents / 100).toFixed(2).replace('.', ',')}`}; ${item.hasAvailability ? 'há indicação de disponibilidade demonstrativa' : 'disponibilidade a confirmar'}`).join('; ')}. Este ambiente usa dados demonstrativos.`;
  }
  if (text.includes('social') || text.includes('inscri') || text.includes('atleta') || text.includes('vaga')) {
    const process = knowledge.processes[0];
    return process ? `O RDA Social tem um processo ${process.is_demo ? 'demonstrativo' : 'ativo'} chamado “${process.name}”, com capacidade planejada de ${process.capacity} participantes. A inscrição gera protocolo e passa por análise da equipe; não garante aprovação ou vaga. Acesse /rda-social/inscricao para começar.` : 'O RDA Social está em estruturação. A equipe ainda não ativou um processo de inscrição.';
  }
  if (text.includes('evento') || text.includes('treino') || text.includes('agenda')) {
    return knowledge.events.length ? `Há ${knowledge.events.length} registro(s) de agenda publicado(s). Eles estão marcados como demonstração quando aplicável; data, local e realização precisam ser confirmados pela equipe. Veja /eventos.` : 'Não há eventos publicados no momento. Consulte a equipe pelo formulário de contato.';
  }
  if (text.includes('parceir') || text.includes('lavamos')) return 'O parceiro inicial é E Lavamos Nós. A página própria separa serviços e itens do parceiro, todos identificados como demonstração enquanto faltam validações documentais. Acesse /parceiros/e-lavamos-nos.';
  if (text.includes('elite') || text.includes('ponto') || text.includes('recompensa')) return 'O RDA Elite possui níveis Bronze, Prata, Ouro e Elite. Pontos só entram por lançamentos registrados; consultas de catálogo não geram pontuação. O programa demonstrativo está em estruturação.';
  if (text.includes('privac') || text.includes('document')) return 'Dados escolares, documentos e informações de atletas devem permanecer em áreas autorizadas. Não compartilho registros privados e encaminho dúvidas específicas para a equipe.';
  return `Sou o guia local da ${knowledge.brand}. Posso ajudar com catálogo, categorias (${knowledge.categories.join(', ')}), RDA Social, eventos, parceiros e Elite. Como este ambiente está em demonstração, vou sinalizar quando preço, estoque, vagas ou datas ainda não estiverem confirmados.`;
}

async function openAIAnswer(db, message) {
  if (!process.env.OPENAI_API_KEY) return { answer: localCoachAnswer(db, message), mode: 'local-guide' };
  const knowledge = getKnowledge(db);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: `Você é o RDA Elite Coach AI. Responda em português brasileiro, com clareza e concisão. Use somente o contexto oficial abaixo. Não invente preço, estoque, evento, vaga, critério, benefício, diagnóstico ou aprovação. Diga quando algo for demonstrativo ou não confirmado. Não revele dados privados. Contexto: ${JSON.stringify(knowledge)}` },
          { role: 'user', content: message }
        ]
      })
    });
    if (!response.ok) throw new Error(`provider_${response.status}`);
    const data = await response.json();
    const answer = cleanText(data?.choices?.[0]?.message?.content, 5000);
    if (!answer) throw new Error('provider_empty');
    return { answer, mode: 'openai' };
  } catch {
    return { answer: `${localCoachAnswer(db, message)}\n\nO provedor generativo está temporariamente indisponível; usei o guia local com dados oficiais da aplicação.`, mode: 'provider-fallback' };
  } finally {
    clearTimeout(timeout);
  }
}

function serializeSettings(db) {
  const settings = readSettings(db);
  return {
    brand: { name: settings.brand_name || 'RDA Sports', slogan: settings.brand_slogan || 'Movendo a paixão pelo esporte.', socialPhrase: settings.social_phrase || 'Jogue limpo. Jogue preparado.' },
    demoMode: settings.demo_mode === 'true',
    contacts: { whatsapp: settings.whatsapp || '', instagram: settings.instagram || '', email: settings.contact_email || '' },
    ai: { mode: process.env.OPENAI_API_KEY ? 'openai-configured' : 'local-guide', generativeConfigured: Boolean(process.env.OPENAI_API_KEY) }
  };
}

async function apiRoute(ctx) {
  const { db, req, res, method, pathname, query } = ctx;
  const parts = pathname.split('/').filter(Boolean).slice(1).map((part) => decodeURIComponent(part));
  const userId = ctx.user?.id || null;

  if (method === 'GET' && pathname === '/api/config') return sendJson(res, 200, serializeSettings(db));
  if (method === 'GET' && pathname === '/api/categories') return sendJson(res, 200, db.prepare('SELECT id, slug, name, description, sport FROM categories WHERE active = 1 ORDER BY name').all());
  if (method === 'GET' && pathname === '/api/brands') return sendJson(res, 200, db.prepare('SELECT id, slug, name FROM brands ORDER BY name').all());
  if (method === 'GET' && pathname === '/api/products') return sendJson(res, 200, listProducts(db, query, userId));
  if (method === 'GET' && parts[0] === 'products' && parts[1]) return sendJson(res, 200, findProduct(db, parts[1], userId));
  if (method === 'GET' && pathname === '/api/partners') return sendJson(res, 200, db.prepare("SELECT * FROM partners WHERE status = 'published' ORDER BY name").all().map((row) => serializePartner(db, row)));
  if (method === 'GET' && parts[0] === 'partners' && parts[1]) {
    const partner = db.prepare("SELECT * FROM partners WHERE (id = ? OR slug = ?) AND status = 'published'").get(parts[1], parts[1]);
    if (!partner) fail(404, 'Parceiro não encontrado.', 'not_found');
    return sendJson(res, 200, serializePartner(db, partner));
  }
  if (method === 'GET' && pathname === '/api/articles') return sendJson(res, 200, db.prepare("SELECT id, slug, title, summary, cover_url, category, status, is_demo, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC").all().map((row) => ({ ...row, isDemo: Boolean(row.is_demo) })));
  if (method === 'GET' && parts[0] === 'articles' && parts[1]) {
    const article = db.prepare("SELECT a.*, u.name AS author_name FROM articles a LEFT JOIN users u ON u.id = a.author_id WHERE (a.slug = ? OR a.id = ?) AND a.status = 'published'").get(parts[1], parts[1]);
    if (!article) fail(404, 'Artigo não encontrado.', 'not_found');
    return sendJson(res, 200, { id: article.id, slug: article.slug, title: article.title, summary: article.summary, coverUrl: article.cover_url, body: article.body, category: article.category, author: article.author_name || 'Equipe RDA', publishedAt: article.published_at, isDemo: Boolean(article.is_demo) });
  }
  if (method === 'GET' && pathname === '/api/faqs') return sendJson(res, 200, db.prepare("SELECT id, category, question, answer FROM faqs WHERE status = 'published' ORDER BY display_order, category").all());
  if (method === 'GET' && pathname === '/api/events') {
    const rows = db.prepare("SELECT * FROM events WHERE status = 'published' ORDER BY starts_at").all();
    return sendJson(res, 200, rows.map((row) => serializeEvent(db, row, userId)));
  }
  if (method === 'GET' && parts[0] === 'events' && parts[1]) {
    const row = db.prepare("SELECT * FROM events WHERE (id = ? OR slug = ?) AND status = 'published'").get(parts[1], parts[1]);
    if (!row) fail(404, 'Evento não encontrado.', 'not_found');
    return sendJson(res, 200, serializeEvent(db, row, userId));
  }
  if (method === 'GET' && pathname === '/api/search') {
    const q = cleanText(query.get('q'), 100);
    if (!q) return sendJson(res, 200, { products: [], articles: [], events: [], partners: [] });
    const like = `%${q}%`;
    const products = listProducts(db, new URLSearchParams({ q, limit: '8' }), userId).items;
    const articles = db.prepare("SELECT slug, title, summary, 'article' AS type, is_demo FROM articles WHERE status = 'published' AND (title LIKE ? OR summary LIKE ?) ORDER BY published_at DESC LIMIT 8").all(like, like);
    const events = db.prepare("SELECT slug, title, description, 'event' AS type, is_demo FROM events WHERE status = 'published' AND (title LIKE ? OR description LIKE ?) ORDER BY starts_at LIMIT 8").all(like, like);
    const partners = db.prepare("SELECT slug, name, description, 'partner' AS type, is_demo FROM partners WHERE status = 'published' AND (name LIKE ? OR description LIKE ?) ORDER BY name LIMIT 8").all(like, like);
    return sendJson(res, 200, { products, articles, events, partners });
  }
  if (method === 'POST' && pathname === '/api/quiz/recommend') {
    const body = await readBody(req);
    const category = cleanText(body.category, 60);
    const budget = asInt(body.budget, null);
    const frequency = cleanText(body.frequency, 60);
    const params = new URLSearchParams({ limit: '6' });
    if (category) params.set('category', category);
    if (budget) params.set('maxPrice', String(budget));
    const result = listProducts(db, params, userId);
    return sendJson(res, 200, { explanation: `Sugestões baseadas em modalidade${category ? ` (${category})` : ''}, orçamento${budget ? ` até R$ ${budget}` : ' não informado'} e frequência${frequency ? ` (${frequency})` : ''}. O resultado é orientação, não diagnóstico nem garantia de produto ideal.`, items: result.items });
  }
  if (method === 'POST' && pathname === '/api/contact') {
    enforceRateLimit(`contact:${ctx.ip}`, 10);
    const body = await readBody(req);
    const name = requiredText(body.name, 'Nome', 160);
    const email = validEmail(body.email);
    const subject = requiredText(body.subject, 'Assunto', 180);
    const message = requiredText(body.message, 'Mensagem', 4000);
    const id = randomId();
    db.prepare(`INSERT INTO contact_messages (id, name, email, phone, subject, reason, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, email, cleanText(body.phone, 60), subject, cleanText(body.reason, 80) || 'geral', message, nowIso());
    audit(db, { action: 'contact.created', entityType: 'contact_message', entityId: id, payload: { subject } });
    return sendJson(res, 201, { id, message: 'Mensagem salva. A equipe poderá responder pelo canal informado.' });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    enforceRateLimit(`register:${ctx.ip}`, 8);
    const body = await readBody(req);
    const name = requiredText(body.name, 'Nome', 160);
    const email = validEmail(body.email);
    const password = String(body.password || '');
    if (password.length < 8) fail(422, 'A senha precisa ter pelo menos 8 caracteres.', 'validation_error');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail(409, 'Já existe uma conta com este e-mail.', 'email_in_use');
    const id = randomId();
    const now = nowIso();
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'client', 'active', ?, ?)`).run(id, name, email, hashPassword(password), now, now);
    const token = createSession(db, id);
    db.prepare('INSERT INTO loyalty_accounts (id, user_id, points_balance, level, created_at, updated_at) VALUES (?, ?, 0, \'Bronze\', ?, ?)').run(randomId(), id, now, now);
    audit(db, { actorId: id, action: 'user.registered', entityType: 'user', entityId: id });
    return sendJson(res, 201, { user: { id, name, email, role: 'client', status: 'active' } }, { 'Set-Cookie': cookieHeader(token, SESSION_DAYS * 86400) });
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    enforceRateLimit(`login:${ctx.ip}`, 12);
    const body = await readBody(req);
    const email = validEmail(body.email);
    const user = db.prepare('SELECT id, name, email, password_hash, role, status FROM users WHERE email = ?').get(email);
    if (!user || user.status !== 'active' || !verifyPassword(String(body.password || ''), user.password_hash)) fail(401, 'E-mail ou senha inválidos.', 'invalid_credentials');
    const token = createSession(db, user.id);
    audit(db, { actorId: user.id, action: 'user.login', entityType: 'user', entityId: user.id });
    return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': cookieHeader(token, SESSION_DAYS * 86400) });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    revokeSession(db, req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
  }
  if (method === 'GET' && pathname === '/api/auth/me') return sendJson(res, 200, { user: publicUser(ctx.user) });
  if (method === 'POST' && pathname === '/api/auth/recover') {
    const body = await readBody(req);
    const email = validEmail(body.email);
    const exists = Boolean(db.prepare('SELECT id FROM users WHERE email = ?').get(email));
    return sendJson(res, 200, { ok: true, message: 'Se houver uma conta para esse e-mail, a equipe poderá iniciar a recuperação. Neste ambiente não há serviço de e-mail conectado.', accountFound: exists });
  }
  if (method === 'PATCH' && pathname === '/api/profile') {
    const user = requireUser(ctx);
    const body = await readBody(req);
    const name = requiredText(body.name, 'Nome', 160);
    db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), user.id);
    audit(db, { actorId: user.id, action: 'profile.updated', entityType: 'user', entityId: user.id, payload: { fields: ['name'] } });
    return sendJson(res, 200, { user: publicUser(db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(user.id)) });
  }

  if (method === 'GET' && pathname === '/api/coach/status') return sendJson(res, 200, { mode: process.env.OPENAI_API_KEY ? 'openai-configured' : 'local-guide', generativeConfigured: Boolean(process.env.OPENAI_API_KEY) });
  if (method === 'DELETE' && parts[0] === 'coach' && parts[1] === 'conversations' && parts[2]) {
    const user = requireUser(ctx);
    const conversation = db.prepare('SELECT id FROM coach_conversations WHERE id = ? AND user_id = ?').get(parts[2], user.id);
    if (!conversation) fail(404, 'Conversa não encontrada.', 'not_found');
    db.prepare('DELETE FROM coach_conversations WHERE id = ?').run(conversation.id);
    audit(db, { actorId: user.id, action: 'coach.conversation.deleted', entityType: 'coach_conversation', entityId: conversation.id });
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/coach/chat') {
    enforceRateLimit(`coach:${ctx.user?.id || ctx.ip}`, 30);
    const body = await readBody(req);
    const message = requiredText(body.message, 'Mensagem', 2000);
    const result = await openAIAnswer(db, message);
    const conversationId = body.conversationId || randomId();
    if (!body.conversationId) db.prepare('INSERT INTO coach_conversations (id, user_id, mode, created_at) VALUES (?, ?, ?, ?)').run(conversationId, userId, result.mode, nowIso());
    else {
      const conversation = db.prepare('SELECT id, user_id FROM coach_conversations WHERE id = ?').get(conversationId);
      if (!conversation || (conversation.user_id && conversation.user_id !== userId)) fail(403, 'Conversa não autorizada.', 'forbidden');
    }
    db.prepare('INSERT INTO coach_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, \'user\', ?, ?)').run(randomId(), conversationId, message, nowIso());
    db.prepare('INSERT INTO coach_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, \'assistant\', ?, ?)').run(randomId(), conversationId, result.answer, nowIso());
    return sendJson(res, 200, { conversationId, answer: result.answer, mode: result.mode, disclaimer: result.mode === 'openai' ? 'Resposta baseada no conteúdo oficial disponível; confirme informações operacionais com a equipe.' : 'Guia local com base em dados oficiais/demonstrativos. A IA generativa ainda não está conectada neste ambiente.' });
  }

  if (method === 'GET' && pathname === '/api/favorites') {
    requireUser(ctx);
    const rows = db.prepare(`${productSelect()} JOIN favorites f ON f.product_id = p.id WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(userId);
    return sendJson(res, 200, rows.map((row) => serializeProduct(db, row, userId)));
  }
  if (parts[0] === 'favorites' && parts[1] && ['POST', 'DELETE'].includes(method)) {
    requireUser(ctx);
    const product = db.prepare('SELECT id FROM products WHERE id = ? OR slug = ?').get(parts[1], parts[1]);
    if (!product) fail(404, 'Produto não encontrado.', 'not_found');
    if (method === 'POST') db.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id, created_at) VALUES (?, ?, ?)').run(userId, product.id, nowIso());
    else db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(userId, product.id);
    return sendJson(res, 200, { ok: true, favorite: method === 'POST' });
  }
  if (method === 'GET' && pathname === '/api/comparisons') {
    requireUser(ctx);
    const rows = db.prepare(`${productSelect()} JOIN comparisons cpm ON cpm.product_id = p.id WHERE cpm.user_id = ? ORDER BY cpm.created_at DESC LIMIT 4`).all(userId);
    return sendJson(res, 200, rows.map((row) => serializeProduct(db, row, userId)));
  }
  if (parts[0] === 'comparisons' && parts[1] && ['POST', 'DELETE'].includes(method)) {
    requireUser(ctx);
    const product = db.prepare('SELECT id FROM products WHERE id = ? OR slug = ?').get(parts[1], parts[1]);
    if (!product) fail(404, 'Produto não encontrado.', 'not_found');
    if (method === 'POST') {
      const current = db.prepare('SELECT COUNT(*) AS count FROM comparisons WHERE user_id = ?').get(userId).count;
      if (current >= 4 && !db.prepare('SELECT 1 FROM comparisons WHERE user_id = ? AND product_id = ?').get(userId, product.id)) fail(422, 'O comparador permite até 4 produtos.', 'comparison_limit');
      db.prepare('INSERT OR IGNORE INTO comparisons (user_id, product_id, created_at) VALUES (?, ?, ?)').run(userId, product.id, nowIso());
    } else db.prepare('DELETE FROM comparisons WHERE user_id = ? AND product_id = ?').run(userId, product.id);
    return sendJson(res, 200, { ok: true, comparison: method === 'POST' });
  }

  if (parts[0] === 'events' && parts[1] && parts[2] === 'register' && method === 'POST') {
    requireUser(ctx);
    db.exec('BEGIN IMMEDIATE');
    try {
      const event = db.prepare("SELECT * FROM events WHERE (id = ? OR slug = ?) AND status = 'published'").get(parts[1], parts[1]);
      if (!event) fail(404, 'Evento não encontrado.', 'not_found');
      const existing = db.prepare('SELECT id, status FROM event_registrations WHERE event_id = ? AND user_id = ?').get(event.id, userId);
      if (existing?.status === 'confirmed') { db.exec('COMMIT'); return sendJson(res, 200, serializeEvent(db, event, userId)); }
      const registered = db.prepare("SELECT COUNT(*) AS count FROM event_registrations WHERE event_id = ? AND status = 'confirmed'").get(event.id).count;
      if (event.capacity !== null && registered >= event.capacity) fail(409, 'As vagas confirmadas deste evento foram preenchidas.', 'capacity_reached');
      if (existing) db.prepare("UPDATE event_registrations SET status = 'confirmed', created_at = ? WHERE id = ?").run(nowIso(), existing.id);
      else db.prepare("INSERT INTO event_registrations (id, event_id, user_id, status, created_at) VALUES (?, ?, ?, 'confirmed', ?)").run(randomId(), event.id, userId, nowIso());
      db.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, \'event\', ?, ?, ?)').run(randomId(), userId, `Inscrição em ${event.title}`, 'Sua inscrição foi salva e aguarda as orientações da equipe.', nowIso());
      audit(db, { actorId: userId, action: 'event.registered', entityType: 'event', entityId: event.id });
      db.exec('COMMIT');
      return sendJson(res, 201, serializeEvent(db, event, userId));
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  if (parts[0] === 'events' && parts[1] && parts[2] === 'register' && method === 'DELETE') {
    requireUser(ctx);
    const event = db.prepare('SELECT id FROM events WHERE id = ? OR slug = ?').get(parts[1], parts[1]);
    if (!event) fail(404, 'Evento não encontrado.', 'not_found');
    db.prepare("UPDATE event_registrations SET status = 'cancelled' WHERE event_id = ? AND user_id = ?").run(event.id, userId);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/social/applications' && method === 'GET') {
    requireUser(ctx);
    const rows = db.prepare('SELECT * FROM social_applications WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
    return sendJson(res, 200, rows.map((row) => serializeApplication(db, row)));
  }
  if (pathname === '/api/social/applications' && method === 'POST') {
    const user = requireUser(ctx);
    const body = await readBody(req);
    const current = body.id ? db.prepare('SELECT * FROM social_applications WHERE id = ?').get(body.id) : null;
    if (current) applicationOwner(ctx, current);
    const data = parseApplicationPayload(body, current);
    const now = nowIso();
    let id = current?.id;
    if (current) {
      if (!['draft', 'awaiting_documents'].includes(current.status) && !['admin', 'team'].includes(user.role)) fail(409, 'Esta inscrição não aceita novas alterações no estado atual.', 'application_locked');
      db.prepare(`UPDATE social_applications SET applicant_name = ?, birth_date = ?, email = ?, phone = ?, address = ?, guardian_json = ?, school_json = ?, sport_json = ?, additional_info = ?, consent_json = ?, current_step = ?, updated_at = ? WHERE id = ?`)
        .run(data.applicantName, data.birthDate, data.email, data.phone, data.address, JSON.stringify(data.guardian), JSON.stringify(data.school), JSON.stringify(data.sport), data.additionalInfo, JSON.stringify(data.consent), data.currentStep, now, current.id);
    } else {
      id = randomId();
      const activeProcess = db.prepare("SELECT id FROM social_processes WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
      db.prepare(`INSERT INTO social_applications (id, protocol, user_id, process_id, applicant_name, birth_date, email, phone, address, guardian_json, school_json, sport_json, additional_info, consent_json, status, current_step, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
        .run(id, protocol(), user.id, activeProcess?.id || null, data.applicantName, data.birthDate, data.email || user.email, data.phone, data.address, JSON.stringify(data.guardian), JSON.stringify(data.school), JSON.stringify(data.sport), data.additionalInfo, JSON.stringify(data.consent), data.currentStep, now, now);
      db.prepare(`INSERT INTO social_application_history (id, application_id, from_status, to_status, reason, author_id, created_at) VALUES (?, ?, NULL, 'draft', 'Rascunho criado pelo participante.', ?, ?)`)
        .run(randomId(), id, user.id, now);
      audit(db, { actorId: user.id, action: 'social.application.draft_created', entityType: 'social_application', entityId: id });
    }
    const saved = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(id);
    return sendJson(res, current ? 200 : 201, serializeApplication(db, saved));
  }
  if (parts[0] === 'social' && parts[1] === 'applications' && parts[2] && parts[3] === 'submit' && method === 'POST') {
    const user = requireUser(ctx);
    const application = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(parts[2]);
    applicationOwner(ctx, application);
    const errors = validateApplicationForSubmission(application);
    if (errors.length) fail(422, 'Complete as informações pendentes antes de enviar.', 'application_incomplete', errors);
    const process = application.process_id ? db.prepare('SELECT * FROM social_processes WHERE id = ?').get(application.process_id) : null;
    if (!process || process.status !== 'active') fail(409, 'Não há um processo de inscrição ativo para envio neste momento.', 'process_inactive');
    const now = nowIso();
    db.prepare("UPDATE social_applications SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?").run(now, now, application.id);
    db.prepare(`INSERT INTO social_application_history (id, application_id, from_status, to_status, reason, author_id, created_at) VALUES (?, ?, ?, 'submitted', 'Inscrição enviada pelo participante.', ?, ?)`)
      .run(randomId(), application.id, application.status, user.id, now);
    audit(db, { actorId: user.id, action: 'social.application.submitted', entityType: 'social_application', entityId: application.id });
    return sendJson(res, 200, serializeApplication(db, db.prepare('SELECT * FROM social_applications WHERE id = ?').get(application.id)));
  }
  if (parts[0] === 'social' && parts[1] === 'applications' && parts[2] && !parts[3] && method === 'GET') {
    requireUser(ctx);
    const application = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(parts[2]);
    applicationOwner(ctx, application);
    return sendJson(res, 200, serializeApplication(db, application));
  }
  if (parts[0] === 'social' && parts[1] === 'applications' && parts[2] && parts[3] === 'documents' && method === 'GET') {
    requireUser(ctx);
    const application = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(parts[2]);
    applicationOwner(ctx, application);
    return sendJson(res, 200, db.prepare(`SELECT id, purpose, file_name, status, is_private, created_at
      FROM documents WHERE application_id = ? ORDER BY created_at DESC`).all(application.id).map((document) => ({ ...document, isPrivate: Boolean(document.is_private) })));
  }

  if (method === 'GET' && pathname === '/api/athlete/me') {
    const user = requireUser(ctx);
    const athlete = db.prepare('SELECT id FROM athletes WHERE user_id = ?').get(user.id);
    if (!athlete) fail(403, 'Sua conta não possui um vínculo de atleta verificado.', 'forbidden');
    return sendJson(res, 200, getAthletePayload(db, athlete.id));
  }
  if (method === 'GET' && pathname === '/api/guardian/me') {
    const user = requireUser(ctx);
    const guardian = db.prepare('SELECT id FROM guardians WHERE user_id = ?').get(user.id);
    if (!guardian) fail(403, 'Sua conta não possui um vínculo de responsável verificado.', 'forbidden');
    const athletes = db.prepare('SELECT a.id FROM guardian_athletes ga JOIN athletes a ON a.id = ga.athlete_id WHERE ga.guardian_id = ? AND ga.verified = 1').all(guardian.id).map((row) => getAthletePayload(db, row.id));
    return sendJson(res, 200, { guardian: { id: guardian.id, user: publicUser(user) }, athletes });
  }

  if (method === 'GET' && pathname === '/api/notifications') {
    const user = requireUser(ctx);
    return sendJson(res, 200, db.prepare('SELECT id, type, title, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(user.id).map((row) => ({ ...row, read: Boolean(row.read_at) })));
  }
  if (parts[0] === 'notifications' && parts[1] && parts[2] === 'read' && method === 'PATCH') {
    const user = requireUser(ctx);
    const notification = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(parts[1], user.id);
    if (!notification) fail(404, 'Notificação não encontrada.', 'not_found');
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), notification.id);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'PATCH' && pathname === '/api/notifications/read-all') {
    const user = requireUser(ctx);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/elite') {
    const user = requireUser(ctx);
    let account = db.prepare('SELECT * FROM loyalty_accounts WHERE user_id = ?').get(user.id);
    if (!account) { account = { id: randomId(), user_id: user.id, points_balance: 0, level: 'Bronze' }; db.prepare('INSERT INTO loyalty_accounts (id, user_id, points_balance, level, created_at, updated_at) VALUES (?, ?, 0, \'Bronze\', ?, ?)').run(account.id, user.id, nowIso(), nowIso()); }
    const transactions = db.prepare(`SELECT id, points_delta, reason, source_type, created_at FROM loyalty_transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`).all(account.id);
    const rewards = db.prepare("SELECT id, name, description, points_cost, stock_quantity, status FROM rewards WHERE status = 'available' ORDER BY points_cost").all();
    return sendJson(res, 200, { account: { id: account.id, pointsBalance: account.points_balance, level: account.level }, transactions, rewards });
  }
  if (method === 'POST' && pathname === '/api/elite/redeem') {
    const user = requireUser(ctx);
    const body = await readBody(req);
    const rewardId = requiredText(body.rewardId, 'Recompensa', 80);
    db.exec('BEGIN IMMEDIATE');
    try {
      const account = db.prepare('SELECT * FROM loyalty_accounts WHERE user_id = ?').get(user.id);
      const reward = db.prepare("SELECT * FROM rewards WHERE id = ? AND status = 'available'").get(rewardId);
      if (!account || !reward) fail(404, 'Conta ou recompensa não encontrada.', 'not_found');
      if (account.points_balance < reward.points_cost) fail(422, 'Saldo de pontos insuficiente.', 'insufficient_points');
      if (reward.stock_quantity !== null && reward.stock_quantity <= 0) fail(409, 'Recompensa sem disponibilidade.', 'out_of_stock');
      const redemptionId = randomId();
      db.prepare(`INSERT INTO reward_redemptions (id, account_id, reward_id, points_cost, status, created_at) VALUES (?, ?, ?, ?, 'requested', ?)`)
        .run(redemptionId, account.id, reward.id, reward.points_cost, nowIso());
      db.prepare('UPDATE loyalty_accounts SET points_balance = points_balance - ?, updated_at = ? WHERE id = ?').run(reward.points_cost, nowIso(), account.id);
      if (reward.stock_quantity !== null) db.prepare('UPDATE rewards SET stock_quantity = stock_quantity - 1 WHERE id = ?').run(reward.id);
      db.prepare(`INSERT INTO loyalty_transactions (id, account_id, idempotency_key, points_delta, reason, source_type, source_id, created_at)
        VALUES (?, ?, ?, ?, ?, 'redemption', ?, ?)`).run(randomId(), account.id, `redemption-${redemptionId}`, -reward.points_cost, `Resgate solicitado: ${reward.name}`, redemptionId, nowIso());
      audit(db, { actorId: user.id, action: 'elite.reward_requested', entityType: 'reward_redemption', entityId: redemptionId, payload: { rewardId: reward.id } });
      db.exec('COMMIT');
      return sendJson(res, 201, { id: redemptionId, status: 'requested', message: 'Solicitação de resgate salva para análise da equipe.' });
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }

  if (pathname.startsWith('/api/admin/')) return adminRoute(ctx);
  fail(404, 'Rota de API não encontrada.', 'not_found');
}

async function adminRoute(ctx) {
  const { db, req, res, method, pathname } = ctx;
  const staff = requireStaff(ctx);
  const parts = pathname.split('/').filter(Boolean).slice(2).map((part) => decodeURIComponent(part));
  if (method === 'GET' && pathname === '/api/admin/dashboard') return sendJson(res, 200, getDashboard(db));
  if (method === 'GET' && pathname === '/api/admin/audit') return sendJson(res, 200, db.prepare(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.payload_json, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 100`).all());
  if (method === 'GET' && pathname === '/api/admin/products') {
    return sendJson(res, 200, listProducts(db, new URLSearchParams({ limit: '48', sort: 'newest' }), staff.id));
  }
  if (method === 'GET' && pathname === '/api/admin/social/applications') {
    return sendJson(res, 200, db.prepare(`SELECT s.*, p.name AS process_name, u.name AS account_name FROM social_applications s LEFT JOIN social_processes p ON p.id = s.process_id LEFT JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC`).all().map((row) => ({ ...serializeApplication(db, row), processName: row.process_name, accountName: row.account_name })));
  }
  if (method === 'PATCH' && parts[0] === 'social' && parts[1] === 'applications' && parts[2]) {
    const body = await readBody(req);
    const application = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(parts[2]);
    if (!application) fail(404, 'Inscrição não encontrada.', 'not_found');
    const target = ['submitted', 'under_review', 'awaiting_documents', 'approved', 'waitlist', 'rejected', 'cancelled'].includes(body.status) ? body.status : null;
    if (!target) fail(422, 'Status de decisão inválido.', 'validation_error');
    const reason = cleanText(body.reason, 1000);
    const now = nowIso();
    let finalStatus = target;
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(application.id);
      if (target === 'approved') {
        const process = fresh.process_id ? db.prepare('SELECT * FROM social_processes WHERE id = ?').get(fresh.process_id) : null;
        const approvedCount = process ? db.prepare("SELECT COUNT(*) AS count FROM social_applications WHERE process_id = ? AND status = 'approved'").get(process.id).count : 0;
        if (process && approvedCount >= process.capacity && fresh.status !== 'approved') finalStatus = 'waitlist';
      }
      db.prepare('UPDATE social_applications SET status = ?, updated_at = ? WHERE id = ?').run(finalStatus, now, fresh.id);
      db.prepare(`INSERT INTO social_application_history (id, application_id, from_status, to_status, reason, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(randomId(), fresh.id, fresh.status, finalStatus, reason || (finalStatus === 'waitlist' ? 'Capacidade atingida; processo mantido em lista de espera.' : 'Decisão registrada pela equipe.'), staff.id, now);
      if (finalStatus === 'approved') {
        const existingAthlete = db.prepare('SELECT id FROM athletes WHERE application_id = ?').get(fresh.id);
        if (!existingAthlete) {
          const athleteId = randomId();
          const sport = jsonParse(fresh.sport_json, {});
          db.prepare(`INSERT INTO athletes (id, user_id, application_id, full_name, birth_date, modality, position, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(athleteId, fresh.user_id, fresh.id, fresh.applicant_name, fresh.birth_date, cleanText(sport.modality, 80), cleanText(sport.position, 80), now, now);
        }
      }
      if (fresh.user_id) db.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, \'social\', ?, ?, ?)').run(randomId(), fresh.user_id, `Atualização da inscrição ${fresh.protocol}`, `O status da sua inscrição agora é “${finalStatus}”.${reason ? ` Observação: ${reason}` : ''}`, now);
      audit(db, { actorId: staff.id, action: 'social.application.status_changed', entityType: 'social_application', entityId: fresh.id, payload: { from: fresh.status, to: finalStatus, reason } });
      db.exec('COMMIT');
      return sendJson(res, 200, { application: serializeApplication(db, db.prepare('SELECT * FROM social_applications WHERE id = ?').get(fresh.id)), capacityAdjusted: finalStatus !== target });
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  if (method === 'POST' && parts[0] === 'social' && parts[1] === 'applications' && parts[2] && parts[3] === 'documents') {
    const body = await readBody(req);
    const application = db.prepare('SELECT * FROM social_applications WHERE id = ?').get(parts[2]);
    if (!application) fail(404, 'Inscrição não encontrada.', 'not_found');
    const purpose = requiredText(body.purpose, 'Finalidade do documento', 180);
    const id = randomId(); const now = nowIso();
    db.prepare(`INSERT INTO documents (id, application_id, purpose, file_name, storage_key, status, is_private, uploaded_by, created_at)
      VALUES (?, ?, ?, 'Aguardando envio privado', NULL, 'requested', 1, NULL, ?)`).run(id, application.id, purpose, now);
    db.prepare('UPDATE social_applications SET status = \'awaiting_documents\', updated_at = ? WHERE id = ?').run(now, application.id);
    db.prepare(`INSERT INTO social_application_history (id, application_id, from_status, to_status, reason, author_id, created_at)
      VALUES (?, ?, ?, 'awaiting_documents', ?, ?, ?)`).run(randomId(), application.id, application.status, `Documento solicitado: ${purpose}`, staff.id, now);
    if (application.user_id) db.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, \'social\', ?, ?, ?)').run(randomId(), application.user_id, 'Pendência na inscrição', `A equipe solicitou: ${purpose}. A complementação deve usar o mesmo protocolo.`, now);
    audit(db, { actorId: staff.id, action: 'social.document.requested', entityType: 'document', entityId: id, payload: { applicationId: application.id, purpose } });
    return sendJson(res, 201, { id, status: 'requested', purpose, private: true });
  }
  if (method === 'POST' && parts[0] === 'athletes' && parts[1] && parts[2] === 'attendance') {
    const athlete = db.prepare('SELECT id, user_id FROM athletes WHERE id = ?').get(parts[1]);
    if (!athlete) fail(404, 'Atleta não encontrado.', 'not_found');
    const body = await readBody(req);
    const dateValue = cleanText(body.date, 20) || new Date().toISOString().slice(0, 10);
    const type = cleanText(body.attendanceType, 30) || 'training';
    const status = ['present', 'absent', 'excused', 'pending'].includes(body.status) ? body.status : 'present';
    const existing = db.prepare('SELECT id FROM attendance WHERE athlete_id = ? AND date = ? AND attendance_type = ? AND (session_id = ? OR (session_id IS NULL AND ? IS NULL))').get(athlete.id, dateValue, type, body.sessionId || null, body.sessionId || null);
    const now = nowIso();
    if (existing) db.prepare('UPDATE attendance SET status = ?, recorded_by = ?, created_at = ? WHERE id = ?').run(status, staff.id, now, existing.id);
    else db.prepare(`INSERT INTO attendance (id, athlete_id, session_id, attendance_type, date, status, period_start, period_end, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomId(), athlete.id, body.sessionId || null, type, dateValue, status, cleanText(body.periodStart, 20) || null, cleanText(body.periodEnd, 20) || null, staff.id, now);
    audit(db, { actorId: staff.id, action: 'athlete.attendance.recorded', entityType: 'athlete', entityId: athlete.id, payload: { date: dateValue, status, type } });
    return sendJson(res, 201, { ok: true, athleteId: athlete.id, date: dateValue, status });
  }
  if (method === 'POST' && parts[0] === 'athletes' && parts[1] && parts[2] === 'performance') {
    const athlete = db.prepare('SELECT id FROM athletes WHERE id = ?').get(parts[1]);
    if (!athlete) fail(404, 'Atleta não encontrado.', 'not_found');
    const body = await readBody(req);
    const periodStart = requiredText(body.periodStart, 'Início do período', 20);
    const periodEnd = requiredText(body.periodEnd, 'Fim do período', 20);
    const existing = db.prepare('SELECT id FROM school_performance WHERE athlete_id = ? AND period_start = ? AND period_end = ?').get(athlete.id, periodStart, periodEnd);
    const values = [cleanText(body.schoolName, 180), body.gradeAverage === '' ? null : Number(body.gradeAverage), body.schoolAttendancePercent === '' ? null : Number(body.schoolAttendancePercent), cleanText(body.source, 60) || 'manual', staff.id, nowIso()];
    if (existing) db.prepare('UPDATE school_performance SET school_name = ?, grade_average = ?, school_attendance_percent = ?, source = ?, recorded_by = ?, created_at = ? WHERE id = ?').run(...values, existing.id);
    else db.prepare(`INSERT INTO school_performance (id, athlete_id, period_start, period_end, school_name, grade_average, school_attendance_percent, source, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomId(), athlete.id, periodStart, periodEnd, ...values);
    audit(db, { actorId: staff.id, action: 'athlete.school_performance.recorded', entityType: 'athlete', entityId: athlete.id, payload: { periodStart, periodEnd } });
    return sendJson(res, 201, { ok: true, athleteId: athlete.id, periodStart, periodEnd });
  }
  if (method === 'POST' && parts[0] === 'athletes' && parts[1] && parts[2] === 'evaluations') {
    const athlete = db.prepare('SELECT id FROM athletes WHERE id = ?').get(parts[1]);
    if (!athlete) fail(404, 'Atleta não encontrado.', 'not_found');
    const body = await readBody(req);
    const category = requiredText(body.category, 'Categoria da avaliação', 100);
    const id = randomId();
    db.prepare(`INSERT INTO social_evaluations (id, athlete_id, evaluator_id, category, score, notes, evaluated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, athlete.id, staff.id, category, body.score === '' ? null : Number(body.score), cleanText(body.notes, 2000), cleanText(body.evaluatedAt, 30) || nowIso(), nowIso());
    audit(db, { actorId: staff.id, action: 'athlete.evaluation.created', entityType: 'social_evaluation', entityId: id, payload: { athleteId: athlete.id, category } });
    return sendJson(res, 201, { ok: true, id });
  }
  if (method === 'POST' && parts[0] === 'athletes' && parts[1] && parts[2] === 'benefits') {
    const athlete = db.prepare('SELECT id FROM athletes WHERE id = ?').get(parts[1]);
    if (!athlete) fail(404, 'Atleta não encontrado.', 'not_found');
    const body = await readBody(req);
    const benefit = db.prepare('SELECT id, name FROM benefits WHERE id = ?').get(requiredText(body.benefitId, 'Benefício', 80));
    if (!benefit) fail(404, 'Benefício não encontrado.', 'not_found');
    const existing = db.prepare('SELECT id FROM benefit_assignments WHERE benefit_id = ? AND athlete_id = ?').get(benefit.id, athlete.id);
    if (existing) return sendJson(res, 200, { ok: true, duplicate: true, id: existing.id });
    const id = randomId(); const now = nowIso();
    db.prepare(`INSERT INTO benefit_assignments (id, benefit_id, athlete_id, status, assigned_at, assigned_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, benefit.id, athlete.id, ['assigned', 'available', 'delivered'].includes(body.status) ? body.status : 'assigned', now, staff.id, cleanText(body.notes, 1000));
    audit(db, { actorId: staff.id, action: 'athlete.benefit.assigned', entityType: 'benefit_assignment', entityId: id, payload: { athleteId: athlete.id, benefitId: benefit.id } });
    return sendJson(res, 201, { ok: true, id, benefit: benefit.name });
  }
  if (method === 'POST' && pathname === '/api/admin/products') {
    const body = await readBody(req);
    const name = requiredText(body.name, 'Nome do produto', 180);
    const slug = cleanText(body.slug || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), 180);
    if (!slug) fail(422, 'Informe um slug válido.', 'validation_error');
    if (db.prepare('SELECT id FROM products WHERE slug = ?').get(slug)) fail(409, 'Já existe um produto com esse slug.', 'slug_in_use');
    const category = body.categorySlug ? db.prepare('SELECT id FROM categories WHERE slug = ?').get(cleanText(body.categorySlug, 80)) : null;
    const brand = body.brandSlug ? db.prepare('SELECT id FROM brands WHERE slug = ?').get(cleanText(body.brandSlug, 80)) : null;
    const id = randomId();
    const now = nowIso();
    db.prepare(`INSERT INTO products (id, slug, name, description, category_id, brand_id, sport, price_cents, price_label, status, owner_type, featured, is_demo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rda', ?, 0, ?, ?)`).run(id, slug, name, cleanText(body.description, 4000), category?.id || null, brand?.id || null, cleanText(body.sport, 80), body.priceCents === null || body.priceCents === '' ? null : asInt(body.priceCents, null), cleanText(body.priceLabel, 100) || null, body.status === 'draft' ? 'draft' : 'published', body.featured ? 1 : 0, now, now);
    const variantId = randomId();
    db.prepare(`INSERT INTO product_variants (id, product_id, sku, name, size, color, stock_quantity, minimum_stock, availability, created_at, updated_at)
      VALUES (?, ?, ?, 'Padrão', ?, ?, ?, ?, ?, ?, ?)`).run(variantId, id, cleanText(body.sku || `${slug.toUpperCase()}-PADRAO`, 80), cleanText(body.size, 30), cleanText(body.color, 50), Math.max(0, asInt(body.stockQuantity, 0)), Math.max(0, asInt(body.minimumStock, 0)), asInt(body.stockQuantity, 0) > 0 ? 'available' : 'to_confirm', now, now);
    audit(db, { actorId: staff.id, action: 'product.created', entityType: 'product', entityId: id, payload: { name, isDemo: false } });
    return sendJson(res, 201, serializeProduct(db, db.prepare(`${productSelect()} WHERE p.id = ?`).get(id), staff.id));
  }
  if (method === 'PATCH' && parts[0] === 'products' && parts[1]) {
    const body = await readBody(req);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(parts[1]);
    if (!product) fail(404, 'Produto não encontrado.', 'not_found');
    const fields = []; const values = [];
    for (const [key, column, max] of [['name', 'name', 180], ['description', 'description', 4000], ['sport', 'sport', 80], ['priceLabel', 'price_label', 100], ['status', 'status', 30]]) {
      if (body[key] !== undefined) { fields.push(`${column} = ?`); values.push(cleanText(body[key], max)); }
    }
    if (body.priceCents !== undefined) { fields.push('price_cents = ?'); values.push(body.priceCents === null || body.priceCents === '' ? null : asInt(body.priceCents, null)); }
    if (body.featured !== undefined) { fields.push('featured = ?'); values.push(body.featured ? 1 : 0); }
    if (fields.length) { fields.push('updated_at = ?'); values.push(nowIso(), product.id); db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values); }
    audit(db, { actorId: staff.id, action: 'product.updated', entityType: 'product', entityId: product.id, payload: { fields: fields.map((field) => field.split(' = ')[0]) } });
    return sendJson(res, 200, serializeProduct(db, db.prepare(`${productSelect()} WHERE p.id = ?`).get(product.id), staff.id));
  }
  if (method === 'POST' && pathname === '/api/admin/inventory/movements') {
    const body = await readBody(req);
    const variantId = requiredText(body.variantId, 'Variação', 80);
    const delta = asInt(body.quantityDelta, null);
    if (delta === null || delta === 0) fail(422, 'Informe uma movimentação diferente de zero.', 'validation_error');
    const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) fail(404, 'Variação não encontrada.', 'not_found');
    if (variant.stock_quantity + delta < 0) fail(422, 'A movimentação não pode deixar o estoque negativo.', 'negative_stock');
    const idempotencyKey = cleanText(body.idempotencyKey, 120) || null;
    if (idempotencyKey && db.prepare('SELECT id FROM inventory_movements WHERE idempotency_key = ?').get(idempotencyKey)) return sendJson(res, 200, { ok: true, duplicate: true });
    const now = nowIso();
    db.prepare('UPDATE product_variants SET stock_quantity = ?, availability = ?, updated_at = ? WHERE id = ?').run(variant.stock_quantity + delta, variant.stock_quantity + delta > 0 ? 'available' : 'to_confirm', now, variant.id);
    const id = randomId();
    db.prepare(`INSERT INTO inventory_movements (id, variant_id, owner_type, quantity_delta, reason, idempotency_key, author_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, variant.id, body.ownerType === 'partner' ? 'partner' : 'rda', delta, requiredText(body.reason, 'Motivo', 180), idempotencyKey, staff.id, now);
    audit(db, { actorId: staff.id, action: 'inventory.movement.created', entityType: 'product_variant', entityId: variant.id, payload: { quantityDelta: delta } });
    return sendJson(res, 201, { id, variantId: variant.id, stockQuantity: variant.stock_quantity + delta });
  }
  if (method === 'POST' && pathname === '/api/admin/events') {
    const body = await readBody(req);
    const title = requiredText(body.title, 'Título', 180);
    const slug = cleanText(body.slug || title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), 180);
    const startsAt = requiredText(body.startsAt, 'Data e hora', 60);
    if (Number.isNaN(Date.parse(startsAt))) fail(422, 'Informe uma data válida.', 'validation_error');
    if (db.prepare('SELECT id FROM events WHERE slug = ?').get(slug)) fail(409, 'Já existe um evento com esse slug.', 'slug_in_use');
    const id = randomId(); const now = nowIso();
    db.prepare(`INSERT INTO events (id, slug, title, type, modality, description, starts_at, ends_at, timezone, location, capacity, status, rules, is_demo, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'America/Sao_Paulo', ?, ?, ?, ?, 0, ?, ?, ?)`).run(id, slug, title, cleanText(body.type, 60) || 'event', cleanText(body.modality, 80), cleanText(body.description, 4000), new Date(startsAt).toISOString(), body.endsAt ? new Date(body.endsAt).toISOString() : null, cleanText(body.location, 180), body.capacity === null || body.capacity === '' ? null : Math.max(0, asInt(body.capacity, 0)), body.status === 'draft' ? 'draft' : 'published', cleanText(body.rules, 1000), staff.id, now, now);
    audit(db, { actorId: staff.id, action: 'event.created', entityType: 'event', entityId: id });
    return sendJson(res, 201, serializeEvent(db, db.prepare('SELECT * FROM events WHERE id = ?').get(id)));
  }
  if (method === 'PATCH' && parts[0] === 'events' && parts[1]) {
    const body = await readBody(req);
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(parts[1]);
    if (!event) fail(404, 'Evento não encontrado.', 'not_found');
    const updates = []; const values = [];
    for (const [key, column, max] of [['title', 'title', 180], ['description', 'description', 4000], ['location', 'location', 180], ['rules', 'rules', 1000], ['status', 'status', 30]]) {
      if (body[key] !== undefined) { updates.push(`${column} = ?`); values.push(cleanText(body[key], max)); }
    }
    if (body.startsAt) { updates.push('starts_at = ?'); values.push(new Date(body.startsAt).toISOString()); }
    if (body.capacity !== undefined) { updates.push('capacity = ?'); values.push(body.capacity === null || body.capacity === '' ? null : Math.max(0, asInt(body.capacity, 0))); }
    if (updates.length) { updates.push('updated_at = ?'); values.push(nowIso(), event.id); db.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...values); }
    audit(db, { actorId: staff.id, action: 'event.updated', entityType: 'event', entityId: event.id });
    return sendJson(res, 200, serializeEvent(db, db.prepare('SELECT * FROM events WHERE id = ?').get(event.id)));
  }
  if (method === 'POST' && pathname === '/api/admin/partners') {
    const body = await readBody(req);
    const name = requiredText(body.name, 'Nome', 180);
    const slug = requiredText(body.slug, 'Slug', 180);
    if (db.prepare('SELECT id FROM partners WHERE slug = ?').get(slug)) fail(409, 'Já existe um parceiro com esse slug.', 'slug_in_use');
    const id = randomId(); const now = nowIso();
    db.prepare(`INSERT INTO partners (id, slug, name, description, category, contacts_json, social_relation, status, is_demo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(id, slug, name, cleanText(body.description, 4000), cleanText(body.category, 100), JSON.stringify(body.contacts || {}), cleanText(body.socialRelation, 1000), body.status === 'draft' ? 'draft' : 'published', now, now);
    audit(db, { actorId: staff.id, action: 'partner.created', entityType: 'partner', entityId: id });
    return sendJson(res, 201, serializePartner(db, db.prepare('SELECT * FROM partners WHERE id = ?').get(id)));
  }
  if (method === 'POST' && pathname === '/api/admin/articles') {
    const body = await readBody(req);
    const title = requiredText(body.title, 'Título', 180);
    const slug = requiredText(body.slug, 'Slug', 180);
    if (db.prepare('SELECT id FROM articles WHERE slug = ?').get(slug)) fail(409, 'Já existe um artigo com esse slug.', 'slug_in_use');
    const id = randomId(); const now = nowIso(); const status = body.status === 'published' ? 'published' : 'draft';
    db.prepare(`INSERT INTO articles (id, slug, title, summary, body, author_id, category, status, is_demo, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(id, slug, title, cleanText(body.summary, 500), cleanText(body.body, 12000), staff.id, cleanText(body.category, 100) || 'Educacional', status, status === 'published' ? now : null, now, now);
    audit(db, { actorId: staff.id, action: 'article.created', entityType: 'article', entityId: id });
    return sendJson(res, 201, { id, slug, title, status });
  }
  if (method === 'POST' && pathname === '/api/admin/elite/transactions') {
    const admin = requireAdmin(ctx);
    const body = await readBody(req);
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ? OR email = ?').get(cleanText(body.userId, 80), cleanText(body.email, 190).toLowerCase());
    if (!targetUser) fail(404, 'Usuário não encontrado.', 'not_found');
    const delta = asInt(body.pointsDelta, null);
    if (delta === null || delta === 0) fail(422, 'Informe uma quantidade de pontos diferente de zero.', 'validation_error');
    const account = db.prepare('SELECT * FROM loyalty_accounts WHERE user_id = ?').get(targetUser.id);
    if (!account) fail(404, 'Conta Elite não encontrada.', 'not_found');
    if (account.points_balance + delta < 0) fail(422, 'O lançamento não pode deixar o saldo negativo.', 'negative_balance');
    const idempotencyKey = cleanText(body.idempotencyKey, 120);
    if (!idempotencyKey) fail(422, 'Chave de idempotência é obrigatória para lançamento manual.', 'validation_error');
    if (db.prepare('SELECT id FROM loyalty_transactions WHERE idempotency_key = ?').get(idempotencyKey)) return sendJson(res, 200, { ok: true, duplicate: true });
    const now = nowIso();
    db.prepare('UPDATE loyalty_accounts SET points_balance = ?, updated_at = ? WHERE id = ?').run(account.points_balance + delta, now, account.id);
    db.prepare(`INSERT INTO loyalty_transactions (id, account_id, idempotency_key, points_delta, reason, source_type, source_id, author_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`).run(randomId(), account.id, idempotencyKey, delta, requiredText(body.reason, 'Motivo', 200), cleanText(body.sourceId, 100) || null, admin.id, now);
    audit(db, { actorId: admin.id, action: 'elite.points_adjusted', entityType: 'loyalty_account', entityId: account.id, payload: { delta } });
    return sendJson(res, 201, { ok: true, pointsBalance: account.points_balance + delta });
  }
  if (method === 'GET' && pathname === '/api/admin/users') return sendJson(res, 200, db.prepare('SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 100').all());
  if (method === 'PATCH' && parts[0] === 'users' && parts[1]) {
    const admin = requireAdmin(ctx);
    const target = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(parts[1]);
    if (!target) fail(404, 'Usuário não encontrado.', 'not_found');
    const body = await readBody(req);
    const role = ['client', 'athlete', 'guardian', 'team', 'admin'].includes(body.role) ? body.role : target.role;
    const status = ['active', 'inactive'].includes(body.status) ? body.status : target.status;
    db.prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?').run(role, status, nowIso(), target.id);
    audit(db, { actorId: admin.id, action: 'user.permissions.updated', entityType: 'user', entityId: target.id, payload: { role, status } });
    return sendJson(res, 200, { user: { ...target, role, status } });
  }
  fail(404, 'Rota administrativa não encontrada.', 'not_found');
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' })[ext] || 'application/octet-stream';
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, 'http://localhost').pathname;
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const candidate = path.resolve(PUBLIC_DIR, relative);
  const safe = candidate === PUBLIC_DIR || candidate.startsWith(`${PUBLIC_DIR}${path.sep}`);
  const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(filePath)) return send(res, 404, 'Aplicação ainda não foi compilada.');
  const cache = filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': mimeType(filePath), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(filePath).pipe(res);
}

export function createApp({ dbPath = process.env.RDA_DB_PATH || DEFAULT_DB_PATH, seed = true, logger = console } = {}) {
  const db = createDatabase(dbPath);
  if (seed) seedDemoData(db);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const ctx = { db, req, res, method: req.method, pathname: url.pathname, query: url.searchParams, user: currentUser(db, req), ip: req.socket.remoteAddress || 'unknown' };
    if (req.method === 'OPTIONS') return noContent(res);
    if (url.pathname.startsWith('/api/')) {
      apiRoute(ctx).catch((error) => {
        const status = error instanceof HttpError ? error.status : 500;
        if (status >= 500) logger.error?.(error);
        sendJson(res, status, { error: error.message || 'Erro interno.', code: error.code || 'internal_error', ...(error.details ? { details: error.details } : {}) });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido.');
    serveStatic(req, res);
  });
  server.db = db;
  server.closeDatabase = () => db.close();
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createApp();
  server.listen(DEFAULT_PORT, '0.0.0.0', () => console.log(`RDA Sports disponível em http://localhost:${DEFAULT_PORT}`));
  const close = () => server.close(() => { server.closeDatabase(); process.exit(0); });
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
