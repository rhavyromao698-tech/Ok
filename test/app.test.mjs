import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';

async function startTestApp() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rda-sports-test-'));
  const server = createApp({ dbPath: path.join(directory, 'test.sqlite'), logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      server.closeDatabase();
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}

async function request(base, pathName, options = {}, jar = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  if (jar.cookie) headers.cookie = jar.cookie;
  const response = await fetch(base + pathName, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function login(base, email, password) {
  const jar = {};
  const response = await request(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, jar);
  assert.equal(response.status, 200);
  return { jar, user: response.payload.user };
}

test('public catalog, demo warning and partner page are available', async () => {
  const app = await startTestApp();
  try {
    const config = await request(app.base, '/api/config');
    assert.equal(config.status, 200);
    assert.equal(config.payload.demoMode, true);
    assert.equal(config.payload.ai.generativeConfigured, false);

    const products = await request(app.base, '/api/products?limit=3');
    assert.equal(products.status, 200);
    assert.equal(products.payload.items.length, 3);
    assert.equal(products.payload.items.every((item) => item.isDemo), true);

    const partner = await request(app.base, '/api/partners/e-lavamos-nos');
    assert.equal(partner.status, 200);
    assert.equal(partner.payload.name, 'E Lavamos Nós');
    assert.equal(partner.payload.offerings.every((item) => item.ownerType === 'partner'), true);

    const staticPage = await fetch(`${app.base}/rda-social`);
    assert.equal(staticPage.status, 200);
    assert.match(await staticPage.text(), /\/app\.js/);
  } finally {
    await app.close();
  }
});

test('login, favorite and comparison persist on the server', async () => {
  const app = await startTestApp();
  try {
    const client = await login(app.base, 'cliente@rda.local', 'Cliente@12345');
    const products = await request(app.base, '/api/products?limit=1', {}, client.jar);
    const product = products.payload.items[0];

    assert.equal((await request(app.base, `/api/favorites/${product.id}`, { method: 'POST' }, client.jar)).status, 200);
    assert.equal((await request(app.base, `/api/comparisons/${product.id}`, { method: 'POST' }, client.jar)).status, 200);
    const favorites = await request(app.base, '/api/favorites', {}, client.jar);
    const comparisons = await request(app.base, '/api/comparisons', {}, client.jar);
    assert.equal(favorites.payload.some((item) => item.id === product.id), true);
    assert.equal(comparisons.payload.some((item) => item.id === product.id), true);

    const unauthorized = await request(app.base, '/api/athlete/me', {}, client.jar);
    assert.equal(unauthorized.status, 403);
  } finally {
    await app.close();
  }
});

test('social draft, submission, approval and athlete access use real persisted records', async () => {
  const app = await startTestApp();
  try {
    const client = await login(app.base, 'cliente@rda.local', 'Cliente@12345');
    const draft = await request(app.base, '/api/social/applications', { method: 'POST', body: JSON.stringify({
      applicantName: 'Participante de Teste', birthDate: '2010-03-10', email: 'participante@example.com',
      phone: '11900000000', guardian: { name: 'Responsável de Teste', contact: '11911111111' },
      school: { name: 'Escola de Teste', grade: '8º ano', attendance: 88 },
      sport: { modality: 'Futebol', position: 'Meio-campo' }, consent: { terms: true }, currentStep: 7
    }) }, client.jar);
    assert.equal(draft.status, 201);
    assert.equal(draft.payload.status, 'draft');

    const submitted = await request(app.base, `/api/social/applications/${draft.payload.id}/submit`, { method: 'POST' }, client.jar);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.payload.status, 'submitted');
    assert.match(submitted.payload.protocol, /^RDA-\d{4}-/);

    const admin = await login(app.base, 'admin@rda.local', 'Admin@12345');
    const decision = await request(app.base, `/api/admin/social/applications/${draft.payload.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', reason: 'Critérios revisados pela equipe.' }) }, admin.jar);
    assert.equal(decision.status, 200);
    assert.equal(decision.payload.application.status, 'approved');

    const athlete = await request(app.base, '/api/athlete/me', {}, client.jar);
    assert.equal(athlete.status, 200);
    assert.equal(athlete.payload.name, 'Participante de Teste');

    const persisted = await request(app.base, `/api/social/applications/${draft.payload.id}`, {}, client.jar);
    assert.equal(persisted.payload.history.some((item) => item.to === 'approved'), true);
  } finally {
    await app.close();
  }
});

test('private social application is scoped to its account and inventory idempotency prevents duplicates', async () => {
  const app = await startTestApp();
  try {
    const owner = await login(app.base, 'cliente@rda.local', 'Cliente@12345');
    const other = await request(app.base, '/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Outra Conta', email: 'outra@example.com', password: 'OutraSenha@123' }) });
    assert.equal(other.status, 201);
    const otherJar = {};
    const otherLogin = await request(app.base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'outra@example.com', password: 'OutraSenha@123' }) }, otherJar);
    assert.equal(otherLogin.status, 200);
    const draft = await request(app.base, '/api/social/applications', { method: 'POST', body: JSON.stringify({ applicantName: 'Privado', currentStep: 1 }) }, owner.jar);
    assert.equal((await request(app.base, `/api/social/applications/${draft.payload.id}`, {}, otherJar)).status, 403);

    const admin = await login(app.base, 'admin@rda.local', 'Admin@12345');
    const product = (await request(app.base, '/api/products?limit=1')).payload.items[0];
    const variant = product.variants[0];
    const movement = { variantId: variant.id, quantityDelta: 2, reason: 'Teste de idempotência', idempotencyKey: 'test-stock-once' };
    const first = await request(app.base, '/api/admin/inventory/movements', { method: 'POST', body: JSON.stringify(movement) }, admin.jar);
    const second = await request(app.base, '/api/admin/inventory/movements', { method: 'POST', body: JSON.stringify(movement) }, admin.jar);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.payload.duplicate, true);
  } finally {
    await app.close();
  }
});

test('event registration is persistent and cannot duplicate', async () => {
  const app = await startTestApp();
  try {
    const client = await login(app.base, 'cliente@rda.local', 'Cliente@12345');
    const events = await request(app.base, '/api/events', {}, client.jar);
    const event = events.payload[0];
    const first = await request(app.base, `/api/events/${event.id}/register`, { method: 'POST' }, client.jar);
    const second = await request(app.base, `/api/events/${event.id}/register`, { method: 'POST' }, client.jar);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.payload.registration.status, 'confirmed');
    assert.equal(second.payload.registered, 1);
  } finally {
    await app.close();
  }
});

test('profile, notification and private document workflows remain server-backed', async () => {
  const app = await startTestApp();
  try {
    const client = await login(app.base, 'cliente@rda.local', 'Cliente@12345');
    const profile = await request(app.base, '/api/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Cliente Atualizado' }) }, client.jar);
    assert.equal(profile.status, 200);
    assert.equal(profile.payload.user.name, 'Cliente Atualizado');

    const marked = await request(app.base, '/api/notifications/read-all', { method: 'PATCH' }, client.jar);
    assert.equal(marked.status, 200);
    const notifications = await request(app.base, '/api/notifications', {}, client.jar);
    assert.equal(notifications.payload.every((item) => item.read), true);

    const draft = await request(app.base, '/api/social/applications', { method: 'POST', body: JSON.stringify({
      applicantName: 'Documento Teste', birthDate: '2011-03-10', email: 'documento@example.com',
      guardian: { name: 'Responsável', contact: '11922222222' }, school: { name: 'Escola', grade: '7º ano', attendance: 85 },
      sport: { modality: 'Corrida' }, consent: { terms: true }, currentStep: 7
    }) }, client.jar);
    await request(app.base, `/api/social/applications/${draft.payload.id}/submit`, { method: 'POST' }, client.jar);
    const admin = await login(app.base, 'admin@rda.local', 'Admin@12345');
    const document = await request(app.base, `/api/admin/social/applications/${draft.payload.id}/documents`, { method: 'POST', body: JSON.stringify({ purpose: 'Autorização do responsável' }) }, admin.jar);
    assert.equal(document.status, 201);
    assert.equal(document.payload.private, true);
    const privateDocuments = await request(app.base, `/api/social/applications/${draft.payload.id}/documents`, {}, client.jar);
    assert.equal(privateDocuments.status, 200);
    assert.equal(privateDocuments.payload[0].purpose, 'Autorização do responsável');
  } finally {
    await app.close();
  }
});

test('Command Center creates catalog, agenda, partner and content records', async () => {
  const app = await startTestApp();
  try {
    const admin = await login(app.base, 'admin@rda.local', 'Admin@12345');
    const product = await request(app.base, '/api/admin/products', { method: 'POST', body: JSON.stringify({ name: 'Produto Operacional', slug: 'produto-operacional', categorySlug: 'treinamento', priceCents: 12500, stockQuantity: 3 }) }, admin.jar);
    assert.equal(product.status, 201);
    assert.equal(product.payload.name, 'Produto Operacional');

    const event = await request(app.base, '/api/admin/events', { method: 'POST', body: JSON.stringify({ title: 'Workshop Operacional', startsAt: '2030-01-10T18:00:00.000Z', capacity: 20, location: 'Local a confirmar', description: 'Evento criado pelo painel.' }) }, admin.jar);
    assert.equal(event.status, 201);
    assert.equal(event.payload.title, 'Workshop Operacional');

    const partner = await request(app.base, '/api/admin/partners', { method: 'POST', body: JSON.stringify({ name: 'Parceiro Operacional', slug: 'parceiro-operacional', description: 'Página criada pelo painel.' }) }, admin.jar);
    assert.equal(partner.status, 201);
    assert.equal(partner.payload.slug, 'parceiro-operacional');

    const article = await request(app.base, '/api/admin/articles', { method: 'POST', body: JSON.stringify({ title: 'Artigo Operacional', slug: 'artigo-operacional', summary: 'Resumo', body: 'Texto educativo.' }) }, admin.jar);
    assert.equal(article.status, 201);
    assert.equal(article.payload.status, 'draft');

    const dashboard = await request(app.base, '/api/admin/dashboard', {}, admin.jar);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.payload.counts.products, 13);
  } finally {
    await app.close();
  }
});
