const app = document.querySelector('#app');
const toastRoot = document.querySelector('#toast-root');

const state = {
  user: null,
  config: null,
  categories: [],
  brands: [],
  mobileMenu: false,
  chatMessages: [],
  chatConversationId: null
};

const localKey = (name) => `rda_${name}`;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function text(value) {
  return esc(value).replace(/\n/g, '<br>');
}

function money(cents, label = '') {
  if (cents === null || cents === undefined || cents === '') return esc(label || 'Consultar preço');
  return `R$ ${(Number(cents) / 100).toFixed(2).replace('.', ',')}`;
}

function date(value, withTime = false) {
  if (!value) return 'A confirmar';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'A confirmar';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: 'America/Sao_Paulo' }).format(parsed);
}

function dateParts(value) {
  if (!value) return { day: '--', month: 'A confirmar' };
  const parsed = new Date(value);
  return { day: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' }).format(parsed), month: new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' }).format(parsed).replace('.', '') };
}

function initials(name) {
  return String(name || 'RDA').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function statusLabel(status) {
  return ({ draft: 'Rascunho', submitted: 'Enviada', under_review: 'Em análise', awaiting_documents: 'Aguardando documentos', approved: 'Aprovada', waitlist: 'Lista de espera', rejected: 'Não aprovada', cancelled: 'Cancelada', published: 'Publicada', scheduled: 'Agendado', confirmed: 'Confirmada', requested: 'Solicitado', available: 'Disponível', delivered: 'Entregue' })[status] || status || 'A confirmar';
}

function demoBadge(isDemo) {
  return isDemo ? '<span class="pill pill-demo">Demonstração</span>' : '';
}

function toast(message, type = 'info') {
  const element = document.createElement('div');
  element.className = `toast ${type === 'error' ? 'error' : ''}`;
  element.textContent = message;
  toastRoot.append(element);
  setTimeout(() => element.remove(), 4300);
}

function navigate(path) {
  window.history.pushState({}, '', path);
  state.mobileMenu = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(path, { credentials: 'include', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || 'Não foi possível concluir a ação.');
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadBase() {
  if (state.config) return;
  const [config, categories, brands, session] = await Promise.all([
    api('/api/config'), api('/api/categories'), api('/api/brands'), api('/api/auth/me')
  ]);
  state.config = config;
  state.categories = categories;
  state.brands = brands;
  state.user = session.user;
}

function header() {
  const config = state.config || { brand: { name: 'RDA Sports', slogan: 'Movendo a paixão pelo esporte.' }, demoMode: true };
  const logged = state.user;
  const accountPath = logged?.role === 'admin' || logged?.role === 'team' ? '/admin' : logged?.role === 'athlete' ? '/atleta' : logged?.role === 'guardian' ? '/responsavel' : '/perfil';
  return `<div class="app-shell">
    <div class="demo-banner"><div class="container"><span class="demo-dot"></span><span>Ambiente demonstrativo: preços, estoque, vagas e agendas precisam de confirmação da equipe.</span></div></div>
    <header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="/" data-nav aria-label="RDA Sports, início"><span class="brand-mark">R</span><span>${esc(config.brand.name)}<small>${esc(config.brand.slogan)}</small></span></a>
        <button class="menu-toggle" data-action="toggle-menu" aria-label="Abrir menu">☰</button>
        <nav class="main-nav ${state.mobileMenu ? 'is-open' : ''}" aria-label="Navegação principal">
          <a href="/catalogo" data-nav>Catálogo</a>
          <a href="/rda-social" data-nav>RDA Social</a>
          <a href="/eventos" data-nav>Eventos</a>
          <a href="/central-rda" data-nav>Central RDA</a>
          <a href="/parceiros" data-nav>Parceiros</a>
          <a href="/elite-coach" data-nav>Coach AI</a>
        </nav>
        <div class="header-actions">
          <a class="btn btn-ghost btn-sm" href="/busca" data-nav aria-label="Buscar">⌕</a>
          ${logged ? `<a class="user-pill" href="${accountPath}" data-nav><span class="avatar">${esc(initials(logged.name))}</span><span>${esc(logged.name.split(' ')[0])}</span></a>` : '<a class="btn btn-primary btn-sm" href="/login" data-nav>Entrar</a>'}
        </div>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="footer"><div class="container">
    <div class="footer-grid">
      <div><a class="brand" href="/" data-nav><span class="brand-mark">R</span><span>RDA Sports<small>Movendo a paixão pelo esporte.</small></span></a><p style="margin-top:18px;max-width:280px">Esporte, comunidade e desenvolvimento com transparência. Loja física como núcleo do negócio; presença digital em evolução.</p></div>
      <div><h4>Explorar</h4><div class="footer-links"><a href="/catalogo" data-nav>Catálogo</a><a href="/categorias" data-nav>Categorias</a><a href="/quiz" data-nav>Quiz de orientação</a><a href="/central-rda" data-nav>Central RDA</a></div></div>
      <div><h4>Comunidade</h4><div class="footer-links"><a href="/rda-social" data-nav>RDA Social</a><a href="/eventos" data-nav>Eventos</a><a href="/parceiros" data-nav>Parceiros</a><a href="/rda-elite" data-nav>RDA Elite</a></div></div>
      <div><h4>Ajuda</h4><div class="footer-links"><a href="/contato" data-nav>Contato</a><a href="/faq" data-nav>FAQ</a><a href="/privacidade" data-nav>Privacidade</a><a href="/termos" data-nav>Termos</a></div></div>
    </div>
    <div class="footer-bottom"><span>© 2026 RDA Sports. Conteúdo demonstrativo quando indicado.</span><a href="/sobre" data-nav>Conheça a nossa história →</a></div>
  </div></footer></div>`;
}

function shell(content, title = 'RDA Sports') {
  document.title = `${title} — RDA Sports`;
  return `${header()}<main>${content}</main>${footer()}`;
}

function loading(title = 'Carregando') {
  return shell(`<section class="section"><div class="container narrow"><span class="eyebrow">RDA Sports</span><h1 style="font-size:3rem">${title}</h1><div class="stack"><div class="skeleton" style="height:22px;width:80%"></div><div class="skeleton" style="height:100px"></div><div class="skeleton" style="height:100px"></div></div></div></section>`);
}

function pageHero(eyebrow, title, description, dark = false) {
  return `<section class="page-hero ${dark ? 'page-hero-dark' : ''}"><div class="container"><span class="eyebrow ${dark ? 'eyebrow-light' : ''}">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${description ? `<p class="lead">${esc(description)}</p>` : ''}</div></section>`;
}

function productCard(product) {
  const localFavorites = JSON.parse(localStorage.getItem(localKey('favorites')) || '[]');
  const localComparisons = JSON.parse(localStorage.getItem(localKey('comparisons')) || '[]');
  const isFavorite = product.favorite || (!state.user && localFavorites.includes(product.id));
  const isCompared = product.comparison || (!state.user && localComparisons.includes(product.id));
  return `<article class="card product-card card-hover">
    <a href="/produto/${encodeURIComponent(product.slug)}" data-nav aria-label="Ver ${esc(product.name)}"><div class="product-visual"><span class="product-symbol">${product.category?.slug === 'corrida' ? '↗' : product.category?.slug === 'fitness' ? '◒' : product.category?.slug === 'acessorios' ? '◈' : '◉'}</span><span>${demoBadge(product.isDemo)}</span></div></a>
    <button class="heart-btn ${isFavorite ? 'is-active' : ''}" data-action="favorite" data-product="${esc(product.id)}" aria-label="${isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">${isFavorite ? '♥' : '♡'}</button>
    <div class="product-body"><div class="row between"><span class="pill">${esc(product.category?.name || product.sport || 'Esporte')}</span><span class="tiny muted">${product.hasAvailability ? 'Indicação de disponibilidade' : 'Consultar'}</span></div><h3><a href="/produto/${encodeURIComponent(product.slug)}" data-nav>${esc(product.name)}</a></h3><p>${esc(product.description)}</p><div class="row between"><strong class="product-price">${money(product.priceCents, product.priceLabel)}</strong><span class="tiny muted">${product.brand?.name ? esc(product.brand.name) : 'Marca a confirmar'}</span></div><div class="product-actions"><a class="btn btn-dark btn-sm" href="/produto/${encodeURIComponent(product.slug)}" data-nav>Detalhes</a><button class="btn btn-secondary btn-sm" data-action="compare" data-product="${esc(product.id)}">${isCompared ? 'Comparando' : 'Comparar'}</button></div></div>
  </article>`;
}

async function homePage() {
  const [products, events, partners, articles] = await Promise.all([
    api('/api/products?limit=6&sort=newest'), api('/api/events'), api('/api/partners'), api('/api/articles')
  ]);
  const categories = state.categories.slice(0, 6);
  return shell(`<section class="hero"><div class="container hero-grid"><div><span class="eyebrow eyebrow-light">RDA Sports · desde 2026</span><h1>Movendo a paixão pelo <span>esporte.</span></h1><p class="lead">Catálogo, comunidade e oportunidades para quem encontra no esporte um caminho de saúde, pertencimento e desenvolvimento.</p><div class="hero-actions"><a class="btn btn-primary" href="/catalogo" data-nav>Explorar catálogo <span>↗</span></a><a class="btn btn-secondary" href="/rda-social" data-nav>Conhecer o RDA Social</a></div><div class="hero-stripe"><span>Transparência em cada etapa</span><span>Jogue limpo. Jogue preparado.</span><span>Android first · acessível</span></div></div><aside class="hero-aside"><span class="eyebrow eyebrow-light">Núcleo do ecossistema</span><strong>Loja + Social</strong><p>Uma base preparada para conectar produtos, atletas, parceiros, eventos e acompanhamento responsável.</p><a href="/sobre" data-nav class="text-green small">Conheça a história →</a></aside></div></section>
    <section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">Escolha seu movimento</span><h2>Encontre sua modalidade.</h2><p>Estrutura preparada para futebol, fitness, corrida, treinamento e além.</p></div><a class="btn btn-dark" href="/categorias" data-nav>Ver categorias</a></div><div class="grid-3">${categories.map((category, index) => `<a class="card category-card card-hover" href="/catalogo?category=${encodeURIComponent(category.slug)}" data-nav><div><span class="category-icon">${['⚽', '◒', '↗', '◇', '◈', '✦'][index] || '◉'}</span><h3>${esc(category.name)}</h3><p>${esc(category.description)}</p></div><span class="arrow">→</span></a>`).join('')}</div></div></section>
    <section class="section section-soft"><div class="container"><div class="section-head"><div><span class="eyebrow">Catálogo demonstrativo</span><h2>Produtos para entrar em campo.</h2><p>Consulte detalhes, variações e disponibilidade. O contato leva o contexto do item para a equipe.</p></div><a class="btn btn-dark" href="/catalogo" data-nav>Ver catálogo completo</a></div><div class="product-grid">${products.items.slice(0, 6).map(productCard).join('')}</div></div></section>
    <section class="section section-dark"><div class="container grid-2" style="align-items:center"><div><span class="eyebrow eyebrow-light">RDA Sports Social</span><h2>O esporte como ponto de partida.</h2><p class="lead">O Social conecta oportunidades esportivas, educação e acompanhamento responsável. Cada inscrição tem processo, consentimento e análise humana.</p><div class="row" style="margin-top:24px"><a class="btn btn-primary" href="/rda-social" data-nav>Conhecer o projeto</a><a class="btn btn-secondary" href="/rda-social/como-participar" data-nav>Como participar</a></div></div><div class="dark-card"><span class="pill pill-demo">Capacidade planejada</span><h3 style="font-size:3.2rem;margin:18px 0 6px;color:var(--lime)">100</h3><p>vagas configuráveis para um processo real, quando ativado pela equipe. Este ambiente usa fluxo demonstrativo e não promete admissão.</p></div></div></section>
    <section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">Agenda</span><h2>Próximos encontros.</h2><p>Datas e locais publicados aparecem com o status correto.</p></div><a class="btn btn-dark" href="/eventos" data-nav>Ver agenda</a></div><div class="stack">${events.length ? events.slice(0, 3).map(eventRow).join('') : emptyState('Nenhum evento publicado', 'A equipe ainda está preparando a agenda.')}</div></div></section>
    <section class="section section-soft"><div class="container"><div class="section-head"><div><span class="eyebrow">Rede RDA</span><h2>Parceiros que ampliam o jogo.</h2></div><a class="btn btn-dark" href="/parceiros" data-nav>Conhecer parceiros</a></div><div class="grid-3">${partners.slice(0, 3).map((partner) => `<a class="card card-hover" href="/parceiros/${encodeURIComponent(partner.slug)}" data-nav><div class="row between"><span class="partner-mark" style="min-height:90px;width:90px;font-size:1.1rem;border-radius:16px">${esc(partner.name.split(' ').map((word) => word[0]).slice(0, 3).join(''))}</span>${demoBadge(partner.isDemo)}</div><h3 style="margin-top:20px">${esc(partner.name)}</h3><p>${esc(partner.description)}</p><span class="text-green small">Conhecer parceria →</span></a>`).join('')}</div></div></section>
    <section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">Central RDA</span><h2>Conteúdo para jogar melhor.</h2><p>Guias educativos originais, sem transformar demonstração em notícia ou promessa.</p></div><a class="btn btn-dark" href="/central-rda" data-nav>Explorar artigos</a></div><div class="grid-3">${articles.slice(0, 3).map((article) => `<a class="card card-hover" href="/artigo/${encodeURIComponent(article.slug)}" data-nav>${demoBadge(article.is_demo)}<h3 style="margin-top:16px">${esc(article.title)}</h3><p>${esc(article.summary)}</p><span class="text-green small">Ler artigo →</span></a>`).join('')}</div></div></section>
    <section class="section section-dark"><div class="container narrow center"><span class="eyebrow eyebrow-light">RDA Elite Coach AI</span><h2>Uma conversa para orientar o próximo passo.</h2><p class="lead" style="margin-inline:auto">Catálogo, Social, eventos e Elite em um só lugar — com transparência sobre o que está confirmado.</p><a class="btn btn-primary" href="/elite-coach" data-nav style="margin-top:16px">Abrir assistente</a></div></section>`, 'Início');
}

function eventRow(event) {
  const parts = dateParts(event.startsAt);
  return `<article class="card event-row"><div class="date-block"><strong>${esc(parts.day)}</strong><span>${esc(parts.month)}</span></div><div><div class="row">${demoBadge(event.isDemo)}<span class="pill">${esc(event.type)}</span></div><h3>${esc(event.title)}</h3><p>${esc(event.location || 'Local a confirmar')} · ${date(event.startsAt, true)} · ${event.availableSpots === null ? 'Vagas a confirmar' : `${event.availableSpots} vagas indicadas`}</p></div><a class="btn btn-dark btn-sm" href="/eventos/${encodeURIComponent(event.slug)}" data-nav>Ver evento</a></article>`;
}

function emptyState(title, description, action = '') {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
}

async function catalogPage() {
  const query = new URLSearchParams(window.location.search);
  const products = await api(`/api/products?${query.toString()}`);
  return `${pageHero('Catálogo RDA Sports', 'Escolha o equipamento do seu próximo movimento.', 'Produtos, variantes e categorias em estrutura de catálogo. Preços e disponibilidade demonstrativos quando indicado.')}
  <section class="section"><div class="container catalog-layout"><aside class="card filters"><div class="row between"><h3 style="margin:0">Filtrar</h3><button class="btn btn-ghost btn-sm" data-action="clear-filters">Limpar</button></div><form id="catalog-filters"><div class="filter-group"><h4>Categoria</h4><select name="category"><option value="">Todas</option>${state.categories.map((item) => `<option value="${esc(item.slug)}" ${query.get('category') === item.slug ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div><div class="filter-group"><h4>Marca</h4><select name="brand"><option value="">Todas</option>${state.brands.map((item) => `<option value="${esc(item.slug)}" ${query.get('brand') === item.slug ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div><div class="filter-group"><h4>Preço máximo (R$)</h4><input name="maxPrice" type="number" min="0" placeholder="Sem limite" value="${esc(query.get('maxPrice') || '')}" /></div><label class="check"><input type="checkbox" name="available" ${query.get('available') === 'true' ? 'checked' : ''}/> Mostrar indicação de disponibilidade</label><button class="btn btn-dark" style="width:100%;margin-top:18px">Aplicar filtros</button></form></aside><div><form class="catalog-toolbar" id="catalog-search"><input name="q" placeholder="Buscar por nome, descrição ou modalidade" value="${esc(query.get('q') || '')}"/><select name="sort" aria-label="Ordenar"><option value="relevance" ${!query.get('sort') || query.get('sort') === 'relevance' ? 'selected' : ''}>Relevância</option><option value="newest" ${query.get('sort') === 'newest' ? 'selected' : ''}>Novidades</option><option value="price-asc" ${query.get('sort') === 'price-asc' ? 'selected' : ''}>Menor preço</option><option value="price-desc" ${query.get('sort') === 'price-desc' ? 'selected' : ''}>Maior preço</option></select><button class="btn btn-dark">Buscar</button></form><div class="row between" style="margin-bottom:16px"><span class="muted small">${products.total} resultado(s) · página ${products.page} de ${products.pages}</span><a class="small text-green" href="/comparar" data-nav>Comparar itens →</a></div>${products.items.length ? `<div class="product-grid">${products.items.map(productCard).join('')}</div>` : emptyState('Nenhum resultado', 'Tente remover um filtro ou buscar por outra palavra.', '<a class="btn btn-dark btn-sm" href="/catalogo" data-nav style="margin-top:12px">Voltar ao catálogo</a>')}</div></div></section>`;
}

async function productPage(key) {
  const product = await api(`/api/products/${encodeURIComponent(key)}`);
  const selected = product.variants.find((variant) => variant.availability === 'available' && variant.stock_quantity > 0) || product.variants[0];
  const localFavorites = JSON.parse(localStorage.getItem(localKey('favorites')) || '[]');
  const localComparisons = JSON.parse(localStorage.getItem(localKey('comparisons')) || '[]');
  const isFavorite = product.favorite || (!state.user && localFavorites.includes(product.id));
  const isCompared = product.comparison || (!state.user && localComparisons.includes(product.id));
  return `${pageHero('Detalhe do produto', product.name, product.isDemo ? 'Item demonstrativo: disponibilidade, preço e condições dependem de confirmação da equipe.' : product.description)}<section class="section"><div class="container detail-grid"><div class="detail-visual">${product.category?.slug === 'corrida' ? '↗' : product.category?.slug === 'fitness' ? '◒' : '◉'}</div><div class="detail-content"><div class="row">${demoBadge(product.isDemo)}<span class="pill">${esc(product.category?.name || 'Esporte')}</span></div><h1>${esc(product.name)}</h1><p class="lead">${esc(product.description)}</p><div class="product-price">${money(product.priceCents, product.priceLabel)}</div><div class="grid-2 small"><div><strong>Marca</strong><br/><span class="muted">${esc(product.brand?.name || 'A confirmar')}</span></div><div><strong>Modalidade</strong><br/><span class="muted">${esc(product.sport || 'A confirmar')}</span></div></div><h3 style="margin:26px 0 10px;font-size:1rem;letter-spacing:0">Escolha uma variação</h3><div class="variant-list">${product.variants.map((variant) => `<button class="variant-option ${selected?.id === variant.id ? 'selected' : ''}" data-action="select-variant" data-variant="${esc(variant.id)}">${esc(variant.name)}${variant.size ? ` · ${esc(variant.size)}` : ''}${variant.color ? ` · ${esc(variant.color)}` : ''}</button>`).join('')}</div><p class="small muted" id="variant-status">${selected?.availability === 'available' && selected.stock_quantity > 0 ? 'Indicação de disponibilidade para esta variação.' : 'Disponibilidade específica a confirmar.'}</p><div class="row" style="margin-top:22px"><a class="btn btn-primary" href="/contato?subject=${encodeURIComponent(`Consulta sobre ${product.name}`)}&product=${encodeURIComponent(product.name)}" data-nav>Consultar com contexto</a><button class="btn btn-secondary ${isFavorite ? 'is-active' : ''}" data-action="favorite" data-product="${esc(product.id)}">${isFavorite ? '♥ Favoritado' : '♡ Favoritar'}</button><button class="btn btn-secondary" data-action="compare" data-product="${esc(product.id)}">${isCompared ? 'Comparando' : 'Comparar'}</button></div><div class="outline-card" style="margin-top:28px"><strong>Compra e estoque</strong><p class="small" style="margin:8px 0 0">O site é inicialmente catálogo. Consultar produto não reserva nem reduz estoque. A equipe confirma preço, variante, quantidade e canal de atendimento.</p></div></div></div></section>`;
}

async function categoriesPage() {
  return `${pageHero('Modalidades', 'Um mapa para cada jeito de se mover.', 'Categorias são administráveis e podem crescer conforme a loja, a comunidade e os parceiros evoluem.')}<section class="section"><div class="container grid-3">${state.categories.map((category, index) => `<a class="card category-card card-hover" href="/catalogo?category=${encodeURIComponent(category.slug)}" data-nav><span class="category-icon">${['⚽', '◒', '↗', '◇', '◈', '✦', '◉'][index] || '◉'}</span><h3>${esc(category.name)}</h3><p>${esc(category.description)}</p><span class="arrow">Explorar →</span></a>`).join('')}</div></section>`;
}

async function aboutPage() {
  return `${pageHero('Sobre a RDA', 'Uma marca em construção, com direção clara.', 'A RDA Sports nasce para unir artigos esportivos, tecnologia, comunidade e desenvolvimento pelo esporte — sem anunciar como pronto o que ainda está sendo estruturado.')}<section class="section"><div class="container grid-2"><div><span class="eyebrow">Missão</span><h2>Qualidade que incentiva movimento.</h2><p class="lead">Oferecer produtos e soluções que incentivem saúde, bem-estar e desenvolvimento pelo esporte.</p></div><div class="card"><span class="eyebrow">Visão</span><h3>Referência regional em artigos esportivos, atendimento e participação comunitária.</h3><div class="row" style="margin-top:24px">${['Transparência', 'Comprometimento', 'Respeito', 'Inovação', 'Excelência', 'Equipe', 'Cliente', 'Responsabilidade social'].map((item) => `<span class="pill">${item}</span>`).join('')}</div></div></div></section><section class="section section-dark"><div class="container grid-2"><div><span class="eyebrow eyebrow-light">Equipe consolidada</span><h2>Pessoas no centro da construção.</h2><p>A composição abaixo preserva as funções confirmadas. Fotos, biografias e detalhes adicionais devem ser aprovados e editados pela administração.</p></div><div class="stack">${[['Anderson de Jesus', 'Fundador principal'], ['Rhavy Romão', 'Estratégia'], ['Daniel Paviot', 'Operações'], ['Adriel Soares', 'Equipe RDA'], ['Lara Alves', 'Equipe RDA'], ['Chrys', 'Equipe RDA · função a confirmar'], ['Ariel', 'Equipe RDA · função a confirmar']].map(([name, role]) => `<div class="row between" style="padding:14px 0;border-bottom:1px solid var(--line)"><div class="row"><span class="avatar">${esc(initials(name))}</span><strong>${esc(name)}</strong></div><span class="small muted">${esc(role)}</span></div>`).join('')}</div></div></section><section class="section"><div class="container grid-3"><div class="card"><span class="eyebrow">Estrutura planejada</span><h3>120 m²</h3><p>Área de atendimento e exposição, estoque, escritório e sistema de gestão. Planejamento, não estrutura inaugurada.</p></div><div class="card"><span class="eyebrow">Próximos horizontes</span><h3>Marca própria</h3><p>Catálogo maior, novas unidades, parcerias com escolas e clubes, eventos e comunidade.</p></div><div class="card"><span class="eyebrow">Princípio</span><h3>Fato antes de promessa</h3><p>Indicadores públicos só aparecem quando existem registros verificáveis e autorização para publicação.</p></div></div></section>`;
}

async function socialPage() {
  return `${pageHero('RDA Sports Social', 'Jogue limpo. Jogue preparado.', 'O projeto social conecta oportunidades esportivas, educação e acompanhamento responsável. Não promete carreira, aprovação automática ou benefício garantido.', true)}<section class="section"><div class="container grid-3"><div class="dark-card"><span class="eyebrow eyebrow-light">01 · Participar</span><h3>Inscrição por etapas</h3><p>Identificação, responsável, escola, esporte, consentimentos e revisão. O rascunho pode ser retomado.</p><a class="btn btn-primary btn-sm" href="/rda-social/inscricao" data-nav>Começar inscrição</a></div><div class="dark-card"><span class="eyebrow eyebrow-light">02 · Acompanhar</span><h3>Dados com contexto</h3><p>Presença escolar e esportiva em períodos distintos, avaliações, metas e benefícios autorizados.</p><a class="btn btn-secondary btn-sm" href="/rda-social/minha-inscricao" data-nav>Ver minha inscrição</a></div><div class="dark-card"><span class="eyebrow eyebrow-light">03 · Conectar</span><h3>Rede responsável</h3><p>Escolas, parceiros e equipe com escopo claro. Informações privadas não entram na busca pública.</p><a class="btn btn-secondary btn-sm" href="/rda-social/como-participar" data-nav>Entender critérios</a></div></div></section><section class="section"><div class="container grid-2"><div><span class="eyebrow">Como funciona</span><h2>Processo antes de resultado.</h2><div class="timeline"><div class="timeline-item"><h3>1. Você cria um rascunho</h3><p>O formulário preserva os dados e permite retomar em outro momento.</p></div><div class="timeline-item"><h3>2. A equipe recebe o protocolo</h3><p>O status muda com histórico, autoria e motivo. Pendências podem ser solicitadas.</p></div><div class="timeline-item"><h3>3. Decisão autorizada</h3><p>Aprovação, lista de espera ou não aprovação são decisões humanas e registradas.</p></div><div class="timeline-item"><h3>4. Vínculo e acompanhamento</h3><p>Quando aprovado, o atleta é vinculado sem duplicação e passa a ter área autorizada.</p></div></div></div><div class="card"><span class="pill pill-demo">Configuração demonstrativa</span><h3 style="margin-top:18px">Critérios planejados</h3><ul><li>Presença escolar mínima de 80%.</li><li>Notas a partir de 7.</li><li>Disciplina, participação e compromisso.</li><li>Documentação e autorização quando aplicável.</li></ul><p class="small">Os critérios são configuráveis e servem para pré-análise explicável. Não substituem a decisão da equipe.</p></div></div></section><section class="section section-soft"><div class="container partner-banner"><div><span class="eyebrow">Cofrinho RDA Social</span><h2>Apoio com transparência.</h2></div><div><p>Campanhas e contribuições têm estrutura preparada, mas pagamentos não estão conectados neste ambiente. Você pode manifestar interesse sem confirmação de doação ou comprovante.</p><a class="btn btn-dark" href="/rda-social/cofrinho" data-nav>Conhecer o cofrinho</a></div></div></section>`;
}

async function socialHowPage() {
  return `${pageHero('RDA Social · Como participar', 'Critérios claros, decisão humana.', 'Leia as regras do processo ativo e reúna apenas os dados necessários para a participação.')}<section class="section"><div class="container grid-2"><div class="card"><span class="eyebrow">Jornada</span><h2>Do interesse ao acompanhamento.</h2><div class="stack"><div class="outline-card"><strong>1. Conta e inscrição</strong><p class="small">Crie uma conta para salvar e retomar seu formulário. O protocolo só é gerado quando o rascunho é criado.</p></div><div class="outline-card"><strong>2. Análise</strong><p class="small">A equipe confere informações e pode solicitar documentação complementar pelo mesmo processo.</p></div><div class="outline-card"><strong>3. Decisão</strong><p class="small">Status possíveis: enviada, em análise, aguardando documentação, aprovada, lista de espera, não aprovada ou cancelada.</p></div><div class="outline-card"><strong>4. Acompanhamento</strong><p class="small">Atletas e responsáveis verificados acessam somente os vínculos permitidos.</p></div></div></div><div class="card"><span class="eyebrow">Pré-análise</span><h3>O que será considerado</h3><div class="stack small"><div class="row"><span class="pill">80%</span><span>Presença escolar mínima planejada.</span></div><div class="row"><span class="pill">7+</span><span>Notas a partir do valor planejado.</span></div><div class="row"><span class="pill">+ contexto</span><span>Disciplina, participação, autorização e documentação.</span></div></div><p style="margin-top:22px">Presença em treino não é a mesma coisa que presença escolar. Cada registro guarda período e origem.</p><a class="btn btn-primary" href="/rda-social/inscricao" data-nav>Ir para inscrição</a></div></div></section>`;
}

async function applicationFormPage() {
  if (!state.user) return accessPanel('Inscrição do RDA Social', 'Entre ou crie sua conta para salvar o rascunho e acompanhar o protocolo.', '/login', 'Entrar para continuar');
  const applications = await api('/api/social/applications');
  const draft = applications.find((item) => ['draft', 'awaiting_documents'].includes(item.status)) || applications[0] || null;
  const guardian = draft?.guardian || {}; const school = draft?.school || {}; const sport = draft?.sport || {};
  return `${pageHero('RDA Social · Inscrição', draft ? `Retome seu protocolo ${draft.protocol}` : 'Comece pelo seu contexto.', 'Salve o rascunho e avance com calma. O envio só acontece quando as etapas obrigatórias estiverem completas.')}
  <section class="section"><div class="container"><form class="card form-card" id="application-form" data-application-id="${esc(draft?.id || '')}"><div class="row between"><div><span class="eyebrow">Etapa 1 → 7</span><h2 style="font-size:2rem">Dados para análise</h2></div>${draft ? `<span class="status-pill status-${esc(draft.status)}">${esc(statusLabel(draft.status))}</span>` : ''}</div><div class="form-grid"><div class="field"><label for="applicantName">Nome do participante *</label><input id="applicantName" name="applicantName" value="${esc(draft?.applicantName || state.user.name)}" required /></div><div class="field"><label for="birthDate">Data de nascimento *</label><input id="birthDate" name="birthDate" type="date" value="${esc(draft?.birthDate || '')}" required /></div><div class="field"><label for="email">E-mail de contato *</label><input id="email" name="email" type="email" value="${esc(draft?.email || state.user.email)}" required /></div><div class="field"><label for="phone">Telefone para contato</label><input id="phone" name="phone" value="${esc(draft?.phone || '')}" placeholder="Apenas se necessário ao processo" /></div><div class="field full"><label for="address">Endereço necessário ao processo</label><input id="address" name="address" value="${esc(draft?.address || '')}" placeholder="Não inclua informações além do necessário" /></div><div class="field full"><h3 style="font-size:1.1rem;margin:12px 0 0">Responsável</h3></div><div class="field"><label for="guardianName">Nome do responsável *</label><input id="guardianName" name="guardianName" value="${esc(guardian.name || '')}" /></div><div class="field"><label for="guardianRelationship">Vínculo</label><input id="guardianRelationship" name="guardianRelationship" value="${esc(guardian.relationship || '')}" placeholder="Ex.: mãe, pai, tutor" /></div><div class="field full"><label for="guardianContact">Contato do responsável *</label><input id="guardianContact" name="guardianContact" value="${esc(guardian.contact || '')}" /></div><div class="field full"><h3 style="font-size:1.1rem;margin:12px 0 0">Escola e período</h3></div><div class="field"><label for="schoolName">Nome da escola *</label><input id="schoolName" name="schoolName" value="${esc(school.name || '')}" /></div><div class="field"><label for="schoolGrade">Série/ano *</label><input id="schoolGrade" name="schoolGrade" value="${esc(school.grade || '')}" /></div><div class="field"><label for="schoolShift">Turno</label><input id="schoolShift" name="schoolShift" value="${esc(school.shift || '')}" /></div><div class="field"><label for="schoolPeriod">Período das informações</label><input id="schoolPeriod" name="schoolPeriod" value="${esc(school.period || '')}" placeholder="Ex.: 1º semestre de 2026" /></div><div class="field"><label for="schoolAttendance">Presença escolar (%) *</label><input id="schoolAttendance" name="schoolAttendance" type="number" min="0" max="100" value="${esc(school.attendance ?? '')}" /></div><div class="field"><label for="schoolGradeAverage">Média escolar</label><input id="schoolGradeAverage" name="schoolGradeAverage" type="number" min="0" max="10" step="0.1" value="${esc(school.gradeAverage ?? '')}" /></div><div class="field full"><h3 style="font-size:1.1rem;margin:12px 0 0">Esporte</h3></div><div class="field"><label for="modality">Modalidade *</label><select id="modality" name="modality"><option value="">Selecione</option><option ${sport.modality === 'Futebol' ? 'selected' : ''}>Futebol</option><option ${sport.modality === 'Corrida' ? 'selected' : ''}>Corrida</option><option ${sport.modality === 'Fitness' ? 'selected' : ''}>Fitness</option><option ${sport.modality === 'Treinamento' ? 'selected' : ''}>Treinamento</option></select></div><div class="field"><label for="position">Posição (se aplicável)</label><input id="position" name="position" value="${esc(sport.position || '')}" /></div><div class="field full"><label for="experience">Experiência e objetivos</label><textarea id="experience" name="experience" placeholder="Conte o que for pertinente para a participação.">${esc(sport.experience || '')}</textarea></div><div class="field full"><label for="additionalInfo">Informações adicionais</label><textarea id="additionalInfo" name="additionalInfo">${esc(draft?.additionalInfo || '')}</textarea></div><div class="field full"><label class="check"><input type="checkbox" name="terms" ${draft?.consent?.terms ? 'checked' : ''}/> Confirmo que li as informações do processo e autorizo a análise dos dados necessários à inscrição. *</label><small>Documentos pessoais não são enviados nesta versão demonstrativa.</small></div></div><div class="form-actions"><button class="btn btn-secondary" type="submit" data-save-only>Salvar rascunho</button><button class="btn btn-primary" type="submit" data-submit-application>Salvar e enviar para análise →</button></div></form></div></section>`;
}

function accessPanel(title, description, href, label) {
  return `${pageHero('Área privada', title, description)}<section class="section"><div class="container narrow"><div class="card center"><span class="avatar" style="margin:auto;width:52px;height:52px">R</span><h2 style="margin-top:18px;font-size:2rem">Acesso necessário</h2><p>${esc(description)}</p><a class="btn btn-primary" href="${href}" data-nav>${esc(label)}</a></div></div></section>`;
}

async function myApplicationPage() {
  if (!state.user) return accessPanel('Acompanhe sua inscrição', 'Entre para visualizar seus protocolos, status e pendências.', '/login', 'Entrar');
  const id = new URLSearchParams(window.location.search).get('id');
  const applications = id ? [await api(`/api/social/applications/${encodeURIComponent(id)}`)] : await api('/api/social/applications');
  return `${pageHero('RDA Social · Minha inscrição', applications.length ? 'Seu processo, com histórico.' : 'Nenhum protocolo ainda.', applications.length ? 'As mudanças aparecem quando registradas pela equipe. O histórico informa autoria e motivo.' : 'Crie um rascunho para iniciar sua jornada.') }<section class="section"><div class="container stack">${applications.length ? applications.map(applicationPanel).join('') : emptyState('Comece quando estiver pronto', 'Seu rascunho será salvo e poderá ser retomado.', '<a class="btn btn-primary" href="/rda-social/inscricao" data-nav style="margin-top:12px">Criar inscrição</a>')}</div></section>`;
}

function applicationPanel(application) {
  return `<article class="card"><div class="row between"><div><span class="eyebrow">Protocolo</span><h2 style="font-size:1.8rem;margin:7px 0">${esc(application.protocol)}</h2></div><span class="status-pill status-${esc(application.status)}">${esc(statusLabel(application.status))}</span></div><div class="grid-3 small"><div><strong>Participante</strong><br/><span class="muted">${esc(application.applicantName || 'A preencher')}</span></div><div><strong>Atualizado</strong><br/><span class="muted">${date(application.updatedAt, true)}</span></div><div><strong>Modalidade</strong><br/><span class="muted">${esc(application.sport?.modality || 'A preencher')}</span></div></div>${['draft', 'awaiting_documents'].includes(application.status) ? '<a class="btn btn-dark btn-sm" href="/rda-social/inscricao" data-nav style="margin-top:20px">Completar inscrição</a>' : ''}<div style="margin-top:26px"><h3 style="font-size:1.05rem">Histórico</h3><div class="timeline">${application.history?.length ? application.history.map((item) => `<div class="timeline-item"><h3>${esc(statusLabel(item.to))}</h3><p>${esc(item.reason || 'Atualização registrada.')} · <span class="muted">${esc(item.author)} · ${date(item.createdAt, true)}</span></p></div>`).join('') : '<p class="small">O histórico será preenchido a cada mudança relevante.</p>'}</div></div></article>`;
}

async function cofrinhoPage() {
  return `${pageHero('Cofrinho RDA Social', 'Apoiar também é acompanhar.', 'Campanhas e contribuições precisam de provedor, regras e prestação de contas antes de serem apresentadas como ativas.')}<section class="section"><div class="container grid-2"><div class="card"><span class="eyebrow">Estrutura preparada</span><h2>Transparência antes do pagamento.</h2><p>O sistema poderá organizar campanhas, metas e contribuições com referência de pagamento verificada. Neste ambiente, nenhum valor é arrecadado ou confirmado.</p><div class="row" style="margin-top:20px"><span class="pill pill-demo">Pagamentos não conectados</span><a class="btn btn-dark btn-sm" href="/contato?subject=Interesse em apoiar o RDA Social" data-nav>Manifestar interesse</a></div></div><div class="dark-card"><span class="eyebrow eyebrow-light">Como os recursos devem ser tratados</span><div class="stack" style="margin-top:20px"><div><strong>1. Campanha pública</strong><p class="small">Propósito e meta aprovados.</p></div><div><strong>2. Contribuição verificada</strong><p class="small">Provedor confirma o pagamento.</p></div><div><strong>3. Prestação agregada</strong><p class="small">Sem expor dados privados de apoiadores ou atletas.</p></div></div></div></div></section>`;
}

async function eventsPage() {
  const events = await api('/api/events');
  return `${pageHero('Agenda RDA', 'Encontros que colocam a comunidade em movimento.', 'Calendário e inscrições persistentes. Eventos demonstrativos aparecem identificados e não representam confirmação de realização.')}<section class="section"><div class="container stack">${events.length ? events.map(eventRow).join('') : emptyState('Agenda em construção', 'Nenhum evento foi publicado pela equipe ainda.')}</div></section>`;
}

async function eventPage(key) {
  const event = await api(`/api/events/${encodeURIComponent(key)}`);
  return `${pageHero('Detalhe do evento', event.title, event.isDemo ? 'Evento demonstrativo: data, local e realização ainda precisam de confirmação.' : event.description)}<section class="section"><div class="container grid-2"><div class="card"><div class="row">${demoBadge(event.isDemo)}<span class="pill">${esc(event.type)}</span></div><h2 style="margin-top:18px">${esc(event.title)}</h2><p>${text(event.description)}</p><div class="stack small" style="margin-top:24px"><div><strong>Quando</strong><br/><span class="muted">${date(event.startsAt, true)}${event.endsAt ? ` → ${date(event.endsAt, true)}` : ''}</span></div><div><strong>Onde</strong><br/><span class="muted">${esc(event.location || 'A confirmar')}</span></div><div><strong>Vagas indicadas</strong><br/><span class="muted">${event.availableSpots === null ? 'A confirmar' : `${event.registered} inscrito(s) · ${event.availableSpots} restante(s)`}</span></div></div></div><div class="card"><span class="eyebrow">Participação</span><h3>Inscrição sem duplicidade</h3><p>${esc(event.rules || 'A participação depende da confirmação da equipe.')}</p>${state.user ? `<button class="btn ${event.registration?.status === 'confirmed' ? 'btn-danger' : 'btn-primary'}" data-action="event-register" data-event="${esc(event.id)}">${event.registration?.status === 'confirmed' ? 'Cancelar inscrição' : 'Inscrever-me'}</button>` : '<a class="btn btn-primary" href="/login" data-nav>Entrar para inscrever</a>'}<p class="small muted" style="margin-top:18px">Nenhum evento reserva vaga por visualização. A inscrição só é registrada após salvar.</p></div></div></section>`;
}

async function partnersPage() {
  const partners = await api('/api/partners');
  return `${pageHero('Parceiros', 'Cada parceria com seu próprio contexto.', 'Catálogos, serviços e contatos de parceiros são separados do estoque RDA para preservar propriedade e disponibilidade.')}<section class="section"><div class="container grid-3">${partners.map((partner) => `<a class="card card-hover" href="/parceiros/${encodeURIComponent(partner.slug)}" data-nav><div class="row between"><span class="partner-mark" style="min-height:110px;width:110px;font-size:1.2rem">${esc(partner.name.split(' ').map((word) => word[0]).slice(0, 3).join(''))}</span>${demoBadge(partner.isDemo)}</div><h3 style="margin-top:20px">${esc(partner.name)}</h3><p>${esc(partner.description)}</p><span class="text-green small">Conhecer parceria →</span></a>`).join('')}</div></section>`;
}

async function partnerPage(slug) {
  const partner = await api(`/api/partners/${encodeURIComponent(slug)}`);
  return `${pageHero('Parceiro', partner.name, partner.isDemo ? 'Página demonstrativa: informações comerciais e condições dependem de validação documental.' : partner.description)}<section class="section"><div class="container"><div class="partner-banner card"><div class="partner-mark">${esc(partner.name.split(' ').map((word) => word[0]).slice(0, 3).join(''))}</div><div><div class="row">${demoBadge(partner.isDemo)}<span class="pill">${esc(partner.category || 'Parceiro')}</span></div><h2 style="margin-top:15px">${esc(partner.name)}</h2><p>${esc(partner.description)}</p><p class="small"><strong>Relação com o Social:</strong> ${esc(partner.socialRelation || 'A confirmar')}</p></div></div><div class="section-tight"><div class="section-head"><div><span class="eyebrow">Catálogo do parceiro</span><h2>Ofertas e serviços</h2></div></div><div class="grid-3">${partner.offerings.length ? partner.offerings.map((offering) => `<article class="card"><div class="row between">${demoBadge(offering.isDemo)}<span class="pill">${esc(offering.type === 'physical' ? 'Item' : 'Serviço')}</span></div><h3 style="margin-top:16px">${esc(offering.name)}</h3><p>${esc(offering.description)}</p><span class="small muted">Disponibilidade: ${esc(statusLabel(offering.availabilityStatus))}</span><br/><span class="small muted">Proprietário: ${esc(offering.ownerType === 'partner' ? partner.name : 'RDA Sports')}</span></article>`).join('') : emptyState('Catálogo em preparação', 'Nenhuma oferta publicada ainda.')}</div></div><a class="btn btn-dark" href="/contato?subject=${encodeURIComponent(`Contato sobre parceria ${partner.name}`)}" data-nav>Falar sobre esta parceria</a></div></section>`;
}

async function centralPage() {
  const articles = await api('/api/articles');
  return `${pageHero('Central RDA', 'Conteúdo para decidir com mais clareza.', 'Artigos educativos originais em categorias administráveis. Notícias e depoimentos só entram quando houver fonte e autorização.')}<section class="section"><div class="container grid-3">${articles.length ? articles.map((article) => `<a class="card card-hover" href="/artigo/${encodeURIComponent(article.slug)}" data-nav>${demoBadge(article.isDemo)}<span class="eyebrow" style="display:block;margin-top:14px">${esc(article.category)}</span><h3 style="margin-top:12px">${esc(article.title)}</h3><p>${esc(article.summary)}</p><span class="text-green small">Ler artigo →</span></a>`).join('') : emptyState('Conteúdo em construção', 'A equipe ainda não publicou artigos.')}</div></section>`;
}

async function articlePage(slug) {
  const article = await api(`/api/articles/${encodeURIComponent(slug)}`);
  return `${pageHero(article.category, article.title, article.summary)}<section class="section"><div class="container narrow"><div class="card"><div class="row between"><span class="small muted">Por ${esc(article.author)} · ${date(article.publishedAt)}</span>${demoBadge(article.isDemo)}</div><div style="margin-top:28px;font-size:1.05rem;line-height:1.8;color:#3f4d5e">${text(article.body)}</div></div></div></section>`;
}

async function coachPage() {
  const status = await api('/api/coach/status');
  if (!state.chatMessages.length) state.chatMessages.push({ role: 'assistant', content: 'Olá! Sou o guia da RDA Sports. Pergunte sobre catálogo, RDA Social, eventos, parceiros ou Elite. Vou indicar quando um dado for demonstrativo ou precisar de confirmação.' });
  return `${pageHero('RDA Elite Coach AI', 'Orientação com contexto, sem promessa vazia.', status.generativeConfigured ? 'O provedor generativo está configurado no servidor. Ainda assim, o assistente deve usar apenas fontes oficiais e sinalizar incertezas.' : 'O provedor generativo ainda não está conectado. Este ambiente usa um guia local baseado nos dados atuais da aplicação.', true)}<section class="section"><div class="container narrow"><div class="chat"><div class="chat-window" id="chat-window">${state.chatMessages.map((message) => `<div class="chat-message ${message.role}">${text(message.content)}</div>`).join('')}</div><form class="chat-compose" id="coach-form"><textarea name="message" placeholder="Ex.: Como funciona a inscrição do RDA Social?" required></textarea><button class="btn btn-primary">Enviar</button></form><p class="small muted">Modo atual: ${esc(status.mode)}. O assistente não acessa documentos privados, não aprova candidaturas, não altera estoque e não substitui avaliação profissional.</p></div></div></section>`;
}

async function favoritesPage() {
  let products = [];
  if (state.user) products = await api('/api/favorites');
  else {
    const ids = JSON.parse(localStorage.getItem(localKey('favorites')) || '[]');
    products = (await Promise.all(ids.map((id) => api(`/api/products/${encodeURIComponent(id)}`).catch(() => null)))).filter(Boolean);
  }
  return `${pageHero('Minhas listas', 'Favoritos para rever depois.', state.user ? 'Sincronizados com sua conta.' : 'Esta lista está salva apenas neste dispositivo. Entre para sincronizar em outros acessos.')}<section class="section"><div class="container">${products.length ? `<div class="product-grid">${products.map(productCard).join('')}</div>` : emptyState('Sua lista está vazia', 'Adicione produtos pelo catálogo para encontrá-los aqui.', '<a class="btn btn-dark" href="/catalogo" data-nav style="margin-top:12px">Explorar catálogo</a>')}</div></section>`;
}

async function comparisonPage() {
  let products = [];
  if (state.user) products = await api('/api/comparisons');
  else {
    const ids = JSON.parse(localStorage.getItem(localKey('comparisons')) || '[]');
    products = (await Promise.all(ids.slice(0, 4).map((id) => api(`/api/products/${encodeURIComponent(id)}`).catch(() => null)))).filter(Boolean);
  }
  return `${pageHero('Comparador', 'Coloque até quatro opções lado a lado.', 'Compare preço, marca, categoria, modalidade, variantes e indicação de disponibilidade.')}<section class="section"><div class="container">${products.length ? `<div class="table-wrap"><table><thead><tr><th>Critério</th>${products.map((item) => `<th>${esc(item.name)}<br/><button class="btn btn-danger btn-sm" data-action="compare" data-product="${esc(item.id)}">Remover</button></th>`).join('')}</tr></thead><tbody><tr><th>Preço</th>${products.map((item) => `<td>${money(item.priceCents, item.priceLabel)}</td>`).join('')}</tr><tr><th>Marca</th>${products.map((item) => `<td>${esc(item.brand?.name || 'A confirmar')}</td>`).join('')}</tr><tr><th>Categoria</th>${products.map((item) => `<td>${esc(item.category?.name || 'A confirmar')}</td>`).join('')}</tr><tr><th>Modalidade</th>${products.map((item) => `<td>${esc(item.sport || 'A confirmar')}</td>`).join('')}</tr><tr><th>Variantes</th>${products.map((item) => `<td>${item.variants.map((variant) => esc(variant.name)).join(', ') || 'A confirmar'}</td>`).join('')}</tr><tr><th>Disponibilidade</th>${products.map((item) => `<td>${item.hasAvailability ? 'Indicação demonstrativa' : 'Consultar'}</td>`).join('')}</tr></tbody></table></div>` : emptyState('Nada para comparar', 'Adicione até quatro produtos no catálogo.', '<a class="btn btn-dark" href="/catalogo" data-nav style="margin-top:12px">Ir ao catálogo</a>')}</div></section>`;
}

async function quizPage() {
  return `${pageHero('Quiz RDA', 'Uma orientação rápida para começar.', 'O resultado usa regras transparentes e produtos existentes. Não é diagnóstico físico e não garante o produto ideal.')}<section class="section"><div class="container narrow"><form class="card form-card" id="quiz-form"><div class="form-grid"><div class="field"><label>Modalidade</label><select name="category"><option value="">Ainda não sei</option>${state.categories.map((item) => `<option value="${esc(item.slug)}">${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label>Orçamento máximo (R$)</label><input name="budget" type="number" min="0" placeholder="Opcional" /></div><div class="field full"><label>Frequência</label><select name="frequency"><option>Começando agora</option><option>1–2 vezes por semana</option><option>3+ vezes por semana</option><option>Competição/objetivo específico</option></select></div></div><button class="btn btn-primary" style="margin-top:20px">Ver sugestões</button><div id="quiz-result" style="margin-top:24px"></div></form></div></section>`;
}

async function athletePage() {
  if (!state.user) return accessPanel('Área do atleta', 'Entre para acessar apenas seus registros autorizados.', '/login', 'Entrar');
  try {
    const athlete = await api('/api/athlete/me');
    return `${pageHero('Área do atleta', `Olá, ${athlete.name.split(' ')[0]}.`, 'Seu perfil esportivo, agenda e evolução em uma área privada.', true)}<section class="section"><div class="container stack"><div class="stat-grid"><div class="card number-card"><span class="icon">⚽</span><strong>${esc(athlete.modality)}</strong><span>Modalidade</span></div><div class="card number-card"><span class="icon">◷</span><strong>${esc(athlete.position || '—')}</strong><span>Posição</span></div><div class="card number-card"><span class="icon">✓</span><strong>${athlete.attendance.filter((item) => item.status === 'present').length}</strong><span>Presenças registradas</span></div><div class="card number-card"><span class="icon">★</span><strong>${athlete.benefits.length}</strong><span>Benefícios no histórico</span></div></div><div class="grid-2"><div class="card"><span class="eyebrow">Próximos treinos</span><h3>Agenda</h3>${athlete.upcoming.length ? `<div class="stack">${athlete.upcoming.map((item) => `<div class="outline-card"><strong>${esc(item.title)}</strong><p class="small">${date(item.starts_at, true)} · ${esc(item.location)}</p></div>`).join('')}</div>` : '<p>Nenhum treino futuro registrado.</p>'}</div><div class="card"><span class="eyebrow">Desempenho escolar</span><h3>Períodos registrados</h3>${athlete.school.length ? `<div class="table-wrap"><table><thead><tr><th>Período</th><th>Média</th><th>Presença</th></tr></thead><tbody>${athlete.school.map((item) => `<tr><td>${esc(item.period_start)} → ${esc(item.period_end)}</td><td>${item.grade_average ?? '—'}</td><td>${item.school_attendance_percent ?? '—'}%</td></tr>`).join('')}</tbody></table></div>` : '<p>Nenhum registro escolar.</p>'}</div></div><div class="grid-2"><div class="card"><span class="eyebrow">Presença esportiva</span><h3>Histórico</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Atividade</th><th>Status</th></tr></thead><tbody>${athlete.attendance.slice(0, 10).map((item) => `<tr><td>${esc(item.date)}</td><td>${esc(item.session_title || item.attendance_type)}</td><td>${esc(statusLabel(item.status))}</td></tr>`).join('')}</tbody></table></div></div><div class="card"><span class="eyebrow">Benefícios</span><h3>Possibilidades registradas</h3>${athlete.benefits.length ? `<div class="stack">${athlete.benefits.map((item) => `<div class="outline-card"><div class="row between"><strong>${esc(item.name)}</strong><span class="status-pill status-${esc(item.status)}">${esc(statusLabel(item.status))}</span></div><p class="small">${esc(item.description)}<br/>${esc(item.notes || '')}</p></div>`).join('')}</div>` : '<p>Nenhum benefício registrado.</p>'}</div></div></div></section>`;
  } catch (error) { return accessPanel('Área do atleta', error.message, '/contato', 'Falar com a equipe'); }
}

async function guardianPage() {
  if (!state.user) return accessPanel('Área do responsável', 'Entre para acessar somente os atletas vinculados e verificados.', '/login', 'Entrar');
  try {
    const data = await api('/api/guardian/me');
    return `${pageHero('Área do responsável', 'Acompanhar com cuidado.', 'Acesso limitado aos atletas vinculados e verificados; esta área não aprova candidaturas.', true)}<section class="section"><div class="container stack">${data.athletes.length ? data.athletes.map((athlete) => `<article class="card"><div class="row between"><div><span class="eyebrow">Atleta vinculado</span><h2 style="font-size:2rem;margin:8px 0">${esc(athlete.name)}</h2><p>${esc(athlete.modality)} · ${esc(athlete.position || 'Posição não informada')}</p></div><span class="status-pill status-approved">${esc(statusLabel(athlete.status))}</span></div><div class="grid-3"><div class="outline-card"><strong>Próxima agenda</strong><p class="small">${athlete.upcoming[0] ? `${date(athlete.upcoming[0].starts_at, true)} · ${esc(athlete.upcoming[0].location)}` : 'Nenhum registro'}</p></div><div class="outline-card"><strong>Presença escolar</strong><p class="small">${athlete.school[0]?.school_attendance_percent ?? '—'}% no período registrado</p></div><div class="outline-card"><strong>Documentos</strong><p class="small">Solicitações aparecem apenas quando a equipe abrir uma pendência.</p></div></div></article>`).join('') : emptyState('Nenhum vínculo verificado', 'A equipe precisa verificar o vínculo antes de exibir dados.')}</div></section>`;
  } catch (error) { return accessPanel('Área do responsável', error.message, '/contato', 'Falar com a equipe'); }
}

async function elitePage() {
  if (!state.user) return accessPanel('RDA Elite', 'Entre para consultar saldo, histórico e recompensas da sua conta.', '/login', 'Entrar');
  const data = await api('/api/elite');
  return `${pageHero('RDA Elite', 'Fidelidade com histórico auditável.', 'Níveis, pontos e recompensas dependem de políticas configuradas. Consulta de catálogo não gera pontos automaticamente.')}<section class="section"><div class="container stack"><div class="grid-2"><div class="dark-card"><span class="eyebrow eyebrow-light">Seu nível</span><h2 style="color:var(--lime);margin-top:12px">${esc(data.account.level)}</h2><p>Saldo atual</p><strong style="font-size:3.3rem;color:white;letter-spacing:-.08em">${data.account.pointsBalance} <span style="font-size:1rem;color:var(--green)">pts</span></strong></div><div class="card"><span class="eyebrow">Programa</span><h3>Bronze · Prata · Ouro · Elite</h3><p>Regras de pontuação, expiração, transição e resgate são editáveis pela administração. Sem política aprovada, esta tela permanece demonstrativa.</p><span class="pill pill-demo">Dados demonstrativos</span></div></div><div class="grid-2"><div class="card"><span class="eyebrow">Histórico</span><h3>Lançamentos</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Motivo</th><th>Pontos</th></tr></thead><tbody>${data.transactions.length ? data.transactions.map((item) => `<tr><td>${date(item.created_at)}</td><td>${esc(item.reason)}</td><td class="${item.points_delta > 0 ? 'text-green' : 'text-red'}">${item.points_delta > 0 ? '+' : ''}${item.points_delta}</td></tr>`).join('') : '<tr><td colspan="3">Nenhum lançamento.</td></tr>'}</tbody></table></div></div><div class="card"><span class="eyebrow">Recompensas</span><h3>Possibilidades</h3><div class="stack">${data.rewards.map((reward) => `<div class="outline-card"><div class="row between"><strong>${esc(reward.name)}</strong><span class="pill">${reward.points_cost} pts</span></div><p class="small">${esc(reward.description)}</p><button class="btn btn-dark btn-sm" data-action="redeem" data-reward="${esc(reward.id)}" ${data.account.pointsBalance < reward.points_cost ? 'disabled' : ''}>Solicitar resgate</button></div>`).join('')}</div></div></div></div></section>`;
}

async function notificationsPage() {
  if (!state.user) return accessPanel('Notificações', 'Entre para visualizar avisos privados.', '/login', 'Entrar');
  const notifications = await api('/api/notifications');
  return `${pageHero('Central de avisos', 'O que mudou no seu caminho.', 'Notificações persistentes sobre inscrições, eventos, benefícios e conta.')}<section class="section"><div class="container"><div class="right" style="margin-bottom:14px"><button class="btn btn-dark btn-sm" data-action="read-all">Marcar tudo como lido</button></div><div class="stack">${notifications.length ? notifications.map((item) => `<article class="card ${item.read ? '' : 'outline-card'}"><div class="row between"><span class="eyebrow">${esc(item.type)}</span><span class="small muted">${date(item.created_at, true)}</span></div><h3 style="margin-top:10px">${esc(item.title)}</h3><p>${esc(item.body)}</p>${!item.read ? `<button class="btn btn-secondary btn-sm" data-action="read-notification" data-notification="${esc(item.id)}">Marcar como lida</button>` : '<span class="small muted">Lida</span>'}</article>`).join('') : emptyState('Nada novo', 'Quando houver uma atualização relevante, ela aparecerá aqui.')}</div></div></section>`;
}

async function contactPage() {
  const params = new URLSearchParams(window.location.search);
  return `${pageHero('Contato', 'Converse com a equipe RDA.', 'Salvamos sua mensagem antes de confirmar o recebimento. Como não há WhatsApp ou e-mail conectado neste ambiente, o formulário é o canal funcional.')}<section class="section"><div class="container"><form class="card form-card" id="contact-form"><div class="form-grid"><div class="field"><label>Nome *</label><input name="name" required value="${esc(state.user?.name || '')}" /></div><div class="field"><label>E-mail *</label><input name="email" type="email" required value="${esc(state.user?.email || '')}" /></div><div class="field"><label>Telefone</label><input name="phone" /></div><div class="field"><label>Motivo</label><select name="reason"><option value="geral">Dúvida geral</option><option value="catalogo">Catálogo</option><option value="social">RDA Social</option><option value="evento">Eventos</option><option value="parceria">Parceria</option><option value="elite">RDA Elite</option></select></div><div class="field full"><label>Assunto *</label><input name="subject" required value="${esc(params.get('subject') || '')}" /></div><div class="field full"><label>Mensagem *</label><textarea name="message" required placeholder="Descreva o que você precisa.">${esc(params.get('product') ? `Produto de interesse: ${params.get('product')}\n\n` : '')}</textarea></div></div><div id="contact-feedback"></div><button class="btn btn-primary">Salvar mensagem</button></form></div></section>`;
}

async function faqPage() {
  const faqs = await api('/api/faqs');
  return `${pageHero('FAQ', 'Respostas sem atalhos.', 'Conteúdo administrado para catálogo, conta, Social, Elite, eventos, parceiros e privacidade.')}<section class="section"><div class="container narrow stack">${faqs.map((item) => `<details class="card"><summary><strong>${esc(item.question)}</strong><span class="pill">${esc(item.category)}</span></summary><p style="margin:16px 0 0">${text(item.answer)}</p></details>`).join('')}</div></section>`;
}

async function searchPage() {
  const q = new URLSearchParams(window.location.search).get('q') || '';
  const results = q ? await api(`/api/search?q=${encodeURIComponent(q)}`) : { products: [], articles: [], events: [], partners: [] };
  const all = [...results.products.map((item) => ({ ...item, kind: 'Produto', href: `/produto/${item.slug}`, title: item.name, summary: item.description })), ...results.articles.map((item) => ({ ...item, kind: 'Artigo', href: `/artigo/${item.slug}`, title: item.title, summary: item.summary })), ...results.events.map((item) => ({ ...item, kind: 'Evento', href: `/eventos/${item.slug}`, title: item.title, summary: item.description })), ...results.partners.map((item) => ({ ...item, kind: 'Parceiro', href: `/parceiros/${item.slug}`, title: item.name, summary: item.description }))];
  return `${pageHero('Busca global', 'Encontre dentro do ecossistema.', 'A busca consulta apenas conteúdo público. Documentos pessoais e registros privados ficam fora dela.')}<section class="section"><div class="container narrow"><form class="catalog-toolbar" id="global-search"><input name="q" value="${esc(q)}" placeholder="Produto, artigo, evento ou parceiro" required/><button class="btn btn-dark">Buscar</button></form>${q ? `<p class="muted small">${all.length} resultado(s) para “${esc(q)}”.</p><div class="stack" style="margin-top:18px">${all.length ? all.map((item) => `<a class="card card-hover" href="${esc(item.href)}" data-nav><span class="eyebrow">${esc(item.kind)}</span><h3 style="margin-top:8px">${esc(item.title)}</h3><p>${esc(item.summary || '')}</p><span class="text-green small">Abrir →</span></a>`).join('') : emptyState('Nada encontrado', 'Tente outra palavra ou veja o catálogo.')}</div>` : emptyState('Digite uma busca', 'Procure por produtos, categorias, artigos, eventos e parceiros.')}</div></section>`;
}

async function profilePage() {
  if (!state.user) return accessPanel('Seu perfil', 'Entre para atualizar seus dados e preferências.', '/login', 'Entrar');
  return `${pageHero('Minha conta', `Olá, ${state.user.name.split(' ')[0]}.`, 'Conta, preferências e atalhos para as áreas vinculadas.')}<section class="section"><div class="container grid-2"><form class="card" id="profile-form"><span class="eyebrow">Perfil</span><h3>Dados básicos</h3><div class="field"><label>Nome</label><input name="name" value="${esc(state.user.name)}" required /></div><div class="field" style="margin-top:14px"><label>E-mail</label><input value="${esc(state.user.email)}" disabled /></div><div id="profile-feedback" style="margin-top:14px"></div><button class="btn btn-primary" style="margin-top:16px">Salvar alterações</button></form><div class="card"><span class="eyebrow">Privacidade e áreas</span><h3>Seus acessos</h3><div class="stack"><a class="outline-card" href="/favoritos" data-nav>Favoritos →</a><a class="outline-card" href="/comparar" data-nav>Comparador →</a><a class="outline-card" href="/notificacoes" data-nav>Notificações →</a><a class="outline-card" href="/rda-elite" data-nav>RDA Elite →</a>${state.user.role === 'athlete' ? '<a class="outline-card" href="/atleta" data-nav>Área do atleta →</a>' : ''}${state.user.role === 'guardian' ? '<a class="outline-card" href="/responsavel" data-nav>Área do responsável →</a>' : ''}</div><button class="btn btn-danger" data-action="logout" style="margin-top:20px">Sair da conta</button></div></div></section>`;
}

async function loginPage() {
  return `${pageHero('Acesso', 'Entre no ecossistema RDA.', 'Uma conta pode ter vínculos diferentes. Permissões privadas são verificadas no servidor.')}<section class="section"><form class="card form-card" id="login-form"><div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="email" required /></div><div class="field" style="margin-top:14px"><label>Senha</label><input name="password" type="password" autocomplete="current-password" required /></div><div id="login-feedback" style="margin-top:14px"></div><button class="btn btn-primary" style="margin-top:18px;width:100%">Entrar</button><div class="row between" style="margin-top:18px"><a class="small text-green" href="/recuperar-senha" data-nav>Esqueci minha senha</a><a class="small text-green" href="/cadastro" data-nav>Criar conta</a></div><p class="small muted" style="margin-top:22px">Ambiente demonstrativo: contas de teste estão disponíveis no README.</p></form></section>`;
}

async function registerPage() {
  return `${pageHero('Cadastro', 'Crie uma conta para continuar.', 'O cadastro público cria apenas perfil de cliente. Funções de equipe e administração são atribuídas separadamente.')}<section class="section"><form class="card form-card" id="register-form"><div class="field"><label>Nome</label><input name="name" autocomplete="name" required /></div><div class="field" style="margin-top:14px"><label>E-mail</label><input name="email" type="email" autocomplete="email" required /></div><div class="field" style="margin-top:14px"><label>Senha</label><input name="password" type="password" minlength="8" autocomplete="new-password" required /><small>Mínimo de 8 caracteres.</small></div><label class="check" style="margin-top:16px"><input type="checkbox" name="terms" required /> Aceito consultar os termos e a política de privacidade antes de usar a conta.</label><div id="register-feedback" style="margin-top:14px"></div><button class="btn btn-primary" style="margin-top:18px;width:100%">Criar conta</button></form></section>`;
}

async function recoveryPage() {
  return `${pageHero('Recuperar acesso', 'Vamos começar pelo e-mail.', 'O serviço de envio de e-mail ainda não está conectado. O pedido é salvo apenas como uma orientação honesta.')}<section class="section"><form class="card form-card" id="recovery-form"><div class="field"><label>E-mail da conta</label><input name="email" type="email" required /></div><div id="recovery-feedback" style="margin-top:14px"></div><button class="btn btn-primary" style="margin-top:18px;width:100%">Solicitar recuperação</button></form></section>`;
}

async function legalPage(kind) {
  const title = kind === 'privacy' ? 'Privacidade e solicitações' : 'Condições de uso';
  return `${pageHero(kind === 'privacy' ? 'Privacidade' : 'Termos', title, 'Texto operacional inicial. A versão jurídica final depende das práticas reais, retenção e aprovações do operador.')}<section class="section"><div class="container narrow"><div class="card"><h2>${kind === 'privacy' ? 'Dados com finalidade e acesso controlado.' : 'Use o ecossistema com responsabilidade.'}</h2>${kind === 'privacy' ? '<p>Coletamos somente os dados necessários para conta, catálogo, contato, inscrição e acompanhamento autorizado. Dados escolares e documentos de atletas não devem ser publicados. O operador deve definir retenção, atendimento a solicitações de acesso, correção e exclusão, além de consentimentos específicos.</p><p>Para solicitar correção, exclusão ou esclarecer uma finalidade, use o <a class="text-green" href="/contato" data-nav>formulário de contato</a>. Não envie documentos sensíveis por este canal até que a equipe indique um meio privado.</p>' : '<p>O catálogo não é checkout e não confirma compra, estoque ou preço sem contato. Eventos e processos sociais demonstrativos não representam convocação ou admissão. O usuário não pode tentar acessar dados de outro atleta, alterar decisões ou usar informações privadas fora da finalidade autorizada.</p><p>Recursos externos como pagamentos, e-mail, WhatsApp, push, uploads e IA generativa só são considerados conectados quando configurados e testados pela equipe.</p>'}<span class="pill pill-demo">Revisão jurídica e operacional pendente</span></div></div></section>`;
}

async function adminPage() {
  if (!state.user || !['admin', 'team'].includes(state.user.role)) return accessPanel('RDA Command Center', 'Esta área é exclusiva para funções atribuídas pela administração.', '/login', 'Entrar');
  const [dashboard, applications, products] = await Promise.all([api('/api/admin/dashboard'), api('/api/admin/social/applications'), api('/api/products?limit=48')]);
  const variants = products.items.flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name })));
  return `${pageHero('RDA Command Center', 'Operação no celular, com histórico.', 'Indicadores calculados dos registros e ações protegidas no backend.', true)}<section class="section"><div class="container dashboard-grid"><nav class="side-nav"><a class="active" href="#resumo">Resumo</a><a href="#social">Social</a><a href="#produto">Produtos</a><a href="#evento">Eventos</a><a href="#parceiro">Parceiros</a><a href="#auditoria">Auditoria</a></nav><div class="stack"><div id="resumo" class="stat-grid">${[['products', 'Produtos', '◈'], ['users', 'Usuários', '◎'], ['athletes', 'Atletas', '⚽'], ['applications', 'Inscrições', '↗'], ['events', 'Eventos', '◷'], ['partners', 'Parceiros', '◇'], ['messages', 'Mensagens novas', '✉'], ['stockAlerts', 'Alertas de estoque', '!']].map(([key, label, icon]) => `<div class="card number-card"><span class="icon">${icon}</span><strong>${dashboard.counts[key]}</strong><span>${label}</span></div>`).join('')}</div><section id="social" class="card"><div class="section-head"><div><span class="eyebrow">Fila social</span><h2 style="font-size:2rem">Inscrições e decisões</h2></div><span class="pill">Acesso ${state.user.role === 'admin' ? 'administrador' : 'equipe'}</span></div>${applications.length ? `<div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Participante</th><th>Status</th><th>Atualizado</th><th>Decisão</th></tr></thead><tbody>${applications.map((item) => `<tr><td><strong>${esc(item.protocol)}</strong><br/><span class="tiny muted">${esc(item.processName || 'Processo não vinculado')}</span></td><td>${esc(item.applicantName)}<br/><span class="tiny muted">${esc(item.accountName || 'Sem conta')}</span></td><td><span class="status-pill status-${esc(item.status)}">${esc(statusLabel(item.status))}</span></td><td>${date(item.updatedAt, true)}</td><td><form class="row" data-form="admin-decision" data-application="${esc(item.id)}"><select name="status"><option value="under_review">Em análise</option><option value="awaiting_documents">Aguardando docs.</option><option value="approved">Aprovar</option><option value="waitlist">Lista de espera</option><option value="rejected">Não aprovar</option></select><input name="reason" placeholder="Motivo" style="max-width:150px;padding:8px;border:1px solid var(--line-light);border-radius:8px"/><button class="btn btn-dark btn-sm">Salvar</button></form></td></tr>`).join('')}</tbody></table></div>` : '<p>Nenhuma inscrição na fila.</p>'}</section><section id="produto" class="grid-2"><div class="card"><span class="eyebrow">Catálogo</span><h3>Criar produto</h3><form id="admin-product-form"><div class="field"><label>Nome</label><input name="name" required /></div><div class="form-grid" style="margin-top:12px"><div class="field"><label>Slug</label><input name="slug" placeholder="opcional" /></div><div class="field"><label>Preço em R$</label><input name="price" type="number" min="0" step="0.01" /></div><div class="field"><label>Categoria</label><select name="categorySlug"><option value="">Outra</option>${state.categories.map((item) => `<option value="${esc(item.slug)}">${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label>Estoque inicial</label><input name="stockQuantity" type="number" min="0" value="0" /></div></div><div class="field" style="margin-top:12px"><label>Descrição</label><textarea name="description"></textarea></div><div id="admin-product-feedback"></div><button class="btn btn-primary" style="margin-top:14px">Criar produto</button></form></div><div class="card"><span class="eyebrow">Estoque</span><h3>Registrar movimentação</h3><form id="inventory-form"><div class="field"><label>Variação</label><select name="variantId" required>${variants.map((item) => `<option value="${esc(item.id)}">${esc(item.productName)} · ${esc(item.name)} (${item.stock_quantity})</option>`).join('')}</select></div><div class="form-grid" style="margin-top:12px"><div class="field"><label>Delta (+ entrada / − saída)</label><input name="quantityDelta" type="number" required /></div><div class="field"><label>Motivo</label><input name="reason" required /></div></div><div id="inventory-feedback"></div><button class="btn btn-dark" style="margin-top:14px">Salvar movimento</button></form></div></section><section id="evento" class="grid-2"><div class="card"><span class="eyebrow">Agenda</span><h3>Criar evento</h3><form id="admin-event-form"><div class="field"><label>Título</label><input name="title" required /></div><div class="form-grid" style="margin-top:12px"><div class="field"><label>Data e hora</label><input name="startsAt" type="datetime-local" required /></div><div class="field"><label>Vagas</label><input name="capacity" type="number" min="0" /></div><div class="field"><label>Tipo</label><input name="type" value="evento" /></div><div class="field"><label>Local</label><input name="location" value="A confirmar" /></div></div><div class="field" style="margin-top:12px"><label>Descrição</label><textarea name="description"></textarea></div><div id="admin-event-feedback"></div><button class="btn btn-primary" style="margin-top:14px">Publicar evento</button></form></div><div class="card"><span class="eyebrow">Conteúdo</span><h3>Criar artigo</h3><form id="admin-article-form"><div class="field"><label>Título</label><input name="title" required /></div><div class="form-grid" style="margin-top:12px"><div class="field"><label>Slug</label><input name="slug" required /></div><div class="field"><label>Categoria</label><input name="category" value="Educacional" /></div></div><div class="field" style="margin-top:12px"><label>Resumo</label><input name="summary" /></div><div class="field" style="margin-top:12px"><label>Texto</label><textarea name="body"></textarea></div><div id="admin-article-feedback"></div><button class="btn btn-dark" style="margin-top:14px">Salvar artigo</button></form></div></section><section id="parceiro" class="card"><span class="eyebrow">Parcerias</span><h3>Cadastrar novo parceiro</h3><form id="admin-partner-form"><div class="form-grid"><div class="field"><label>Nome</label><input name="name" required /></div><div class="field"><label>Slug</label><input name="slug" required /></div><div class="field"><label>Categoria</label><input name="category" /></div><div class="field"><label>Relação com Social</label><input name="socialRelation" /></div><div class="field full"><label>Descrição</label><textarea name="description"></textarea></div></div><div id="admin-partner-feedback"></div><button class="btn btn-primary" style="margin-top:14px">Salvar parceiro</button></form></section><section id="auditoria" class="card"><div class="section-head"><div><span class="eyebrow">Auditoria</span><h3>Atividade recente</h3></div><span class="small muted">Ações relevantes deixam autoria e data.</span></div><div class="table-wrap"><table><thead><tr><th>Ação</th><th>Entidade</th><th>Autor</th><th>Data</th></tr></thead><tbody>${dashboard.recentAudit.map((item) => `<tr><td>${esc(item.action)}</td><td>${esc(item.entity_type)}<br/><span class="tiny muted">${esc(item.entity_id || '')}</span></td><td>${esc(item.actor_name || 'Sistema')}</td><td>${date(item.created_at, true)}</td></tr>`).join('')}</tbody></table></div></section></div></div></section>`;
}

function notFoundPage() {
  return `${pageHero('404', 'Página não encontrada.', 'O endereço pode ter mudado ou ainda não estar disponível.') }<section class="section"><div class="container center"><a class="btn btn-primary" href="/" data-nav>Voltar ao início</a></div></section>`;
}

async function routeContent() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/') return homePage();
  if (path === '/catalogo') return catalogPage();
  if (path === '/categorias') return categoriesPage();
  if (path === '/sobre') return aboutPage();
  if (path === '/rda-social') return socialPage();
  if (path === '/rda-social/como-participar') return socialHowPage();
  if (path === '/rda-social/inscricao') return applicationFormPage();
  if (path === '/rda-social/minha-inscricao') return myApplicationPage();
  if (path === '/rda-social/cofrinho') return cofrinhoPage();
  if (path === '/atleta') return athletePage();
  if (path === '/responsavel') return guardianPage();
  if (path === '/rda-elite') return elitePage();
  if (path === '/eventos') return eventsPage();
  if (path.startsWith('/eventos/')) return eventPage(path.split('/')[2]);
  if (path === '/central-rda') return centralPage();
  if (path.startsWith('/artigo/')) return articlePage(path.split('/')[2]);
  if (path === '/parceiros') return partnersPage();
  if (path.startsWith('/parceiros/')) return partnerPage(path.split('/')[2]);
  if (path === '/elite-coach') return coachPage();
  if (path === '/favoritos') return favoritesPage();
  if (path === '/comparar') return comparisonPage();
  if (path === '/quiz') return quizPage();
  if (path === '/busca') return searchPage();
  if (path === '/perfil') return profilePage();
  if (path === '/login') return loginPage();
  if (path === '/cadastro') return registerPage();
  if (path === '/recuperar-senha') return recoveryPage();
  if (path === '/notificacoes') return notificationsPage();
  if (path === '/contato') return contactPage();
  if (path === '/faq') return faqPage();
  if (path === '/privacidade') return legalPage('privacy');
  if (path === '/termos') return legalPage('terms');
  if (path === '/admin') return adminPage();
  if (path.startsWith('/produto/')) return productPage(path.split('/')[2]);
  return notFoundPage();
}

async function render() {
  app.innerHTML = loading('Preparando seu espaço');
  try {
    await loadBase();
    app.innerHTML = await routeContent();
    const privateRoute = /^\/(admin|perfil|atleta|responsavel|notificacoes|favoritos|comparar|rda-social\/(inscricao|minha-inscricao))/.test(window.location.pathname);
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.content = privateRoute ? 'noindex,nofollow' : 'index,follow';
    if (window.location.pathname === '/elite-coach') document.querySelector('#chat-window')?.scrollTo({ top: 99999 });
  } catch (error) {
    app.innerHTML = shell(`<section class="section"><div class="container narrow"><div class="card"><span class="eyebrow">Ops</span><h1 style="font-size:3rem">Não conseguimos carregar esta tela.</h1><p>${esc(error.message)}</p><div class="row"><button class="btn btn-dark" data-action="retry">Tentar novamente</button><a class="btn btn-secondary" href="/" data-nav>Voltar ao início</a></div></div></div></section>`, 'Erro');
  }
}

function formDataObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function toggleList(type, productId) {
  const endpoint = type === 'favorite' ? 'favorites' : 'comparisons';
  if (!state.user) {
    const key = localKey(type === 'favorite' ? 'favorites' : 'comparisons');
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const index = list.indexOf(productId);
    if (index >= 0) list.splice(index, 1); else { if (type === 'comparison' && list.length >= 4) return toast('O comparador permite até 4 itens.', 'error'); list.push(productId); }
    localStorage.setItem(key, JSON.stringify(list));
    toast(index >= 0 ? 'Removido da lista local.' : 'Adicionado à lista local.');
    await render();
    return;
  }
  const product = await api(`/api/${endpoint}/${encodeURIComponent(productId)}`, { method: indexInList(type, productId) ? 'DELETE' : 'POST' }).catch((error) => { toast(error.message, 'error'); return null; });
  if (product) { toast(type === 'favorite' ? 'Favoritos atualizados.' : 'Comparador atualizado.'); await render(); }
}

function indexInList(type, id) {
  if (type === 'favorite') return document.querySelector(`[data-action="favorite"][data-product="${CSS.escape(id)}"]`)?.classList.contains('is-active');
  return document.querySelector(`[data-action="compare"][data-product="${CSS.escape(id)}"]`)?.textContent.includes('Comparando') || window.location.pathname === '/comparar';
}

async function handleAction(element) {
  const action = element.dataset.action;
  if (action === 'toggle-menu') { state.mobileMenu = !state.mobileMenu; document.querySelector('.main-nav')?.classList.toggle('is-open', state.mobileMenu); return; }
  if (action === 'retry') return render();
  if (action === 'logout') { await api('/api/auth/logout', { method: 'POST' }); state.user = null; toast('Você saiu da conta.'); return navigate('/'); }
  if (action === 'favorite') return toggleList('favorite', element.dataset.product);
  if (action === 'compare') return toggleList('comparison', element.dataset.product);
  if (action === 'clear-filters') return navigate('/catalogo');
  if (action === 'select-variant') {
    document.querySelectorAll('.variant-option').forEach((button) => button.classList.remove('selected'));
    element.classList.add('selected');
    const product = document.querySelector('#variant-status');
    product.textContent = element.textContent.includes('Único') || element.textContent.includes('Padrão') ? 'Indicação de disponibilidade para esta variação.' : 'Variação selecionada; disponibilidade específica precisa ser confirmada.';
    return;
  }
  if (action === 'event-register') {
    const eventId = element.dataset.event;
    try {
      const event = await api(`/api/events/${encodeURIComponent(eventId)}/register`, { method: element.textContent.includes('Cancelar') ? 'DELETE' : 'POST' });
      toast(element.textContent.includes('Cancelar') ? 'Inscrição cancelada.' : 'Inscrição salva.');
      await render();
      return event;
    } catch (error) { toast(error.message, 'error'); return; }
  }
  if (action === 'redeem') {
    try { await api('/api/elite/redeem', { method: 'POST', body: JSON.stringify({ rewardId: element.dataset.reward }) }); toast('Solicitação de resgate salva.'); await render(); } catch (error) { toast(error.message, 'error'); }
  }
  if (action === 'read-notification') { try { await api(`/api/notifications/${encodeURIComponent(element.dataset.notification)}/read`, { method: 'PATCH' }); await render(); } catch (error) { toast(error.message, 'error'); } }
  if (action === 'read-all') { try { await api('/api/notifications/read-all', { method: 'PATCH' }); toast('Notificações marcadas como lidas.'); await render(); } catch (error) { toast(error.message, 'error'); } }
}

async function handleSubmit(form, submitter = null) {
  const data = formDataObject(form);
  const feedback = (id) => document.querySelector(`#${id}`);
  try {
    if (form.id === 'catalog-filters' || form.id === 'catalog-search') {
      const current = new URLSearchParams(window.location.search);
      Object.entries(data).forEach(([key, value]) => { if (value) current.set(key, value); else current.delete(key); });
      if (form.id === 'catalog-filters') current.delete('q');
      current.delete('page');
      return navigate(`/catalogo${current.toString() ? `?${current}` : ''}`);
    }
    if (form.id === 'global-search') return navigate(`/busca?q=${encodeURIComponent(data.q)}`);
    if (form.id === 'login-form') {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: data.email, password: data.password }) });
      state.user = result.user; toast(`Bem-vindo, ${result.user.name.split(' ')[0]}!`); return navigate(result.user.role === 'admin' || result.user.role === 'team' ? '/admin' : '/perfil');
    }
    if (form.id === 'register-form') {
      const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: data.name, email: data.email, password: data.password }) });
      state.user = result.user; toast('Conta criada com sucesso.'); return navigate('/perfil');
    }
    if (form.id === 'recovery-form') {
      const result = await api('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email: data.email }) });
      feedback('recovery-feedback').innerHTML = `<div class="form-success">${esc(result.message)}</div>`; return;
    }
    if (form.id === 'contact-form') {
      const result = await api('/api/contact', { method: 'POST', body: JSON.stringify(data) });
      feedback('contact-feedback').innerHTML = `<div class="form-success">${esc(result.message)}</div>`; form.reset(); return;
    }
    if (form.id === 'application-form') {
      const body = { id: form.dataset.applicationId || undefined, applicantName: data.applicantName, birthDate: data.birthDate, email: data.email, phone: data.phone, address: data.address, currentStep: 7, guardian: { name: data.guardianName, relationship: data.guardianRelationship, contact: data.guardianContact }, school: { name: data.schoolName, grade: data.schoolGrade, shift: data.schoolShift, period: data.schoolPeriod, attendance: data.schoolAttendance, gradeAverage: data.schoolGradeAverage }, sport: { modality: data.modality, position: data.position, experience: data.experience }, additionalInfo: data.additionalInfo, consent: { terms: data.terms === 'on' } };
      const saved = await api('/api/social/applications', { method: 'POST', body: JSON.stringify(body) });
      if (submitter?.hasAttribute('data-submit-application')) {
        const submitted = await api(`/api/social/applications/${encodeURIComponent(saved.id)}/submit`, { method: 'POST' });
        toast('Inscrição enviada para análise.'); return navigate(`/rda-social/minha-inscricao?id=${encodeURIComponent(submitted.id)}`);
      }
      toast('Rascunho salvo.'); return navigate(`/rda-social/minha-inscricao?id=${encodeURIComponent(saved.id)}`);
    }
    if (form.id === 'coach-form') {
      const message = data.message;
      state.chatMessages.push({ role: 'user', content: message });
      form.querySelector('textarea').value = '';
      app.innerHTML = await routeContent();
      const result = await api('/api/coach/chat', { method: 'POST', body: JSON.stringify({ message, conversationId: state.chatConversationId }) });
      state.chatConversationId = result.conversationId;
      state.chatMessages.push({ role: 'assistant', content: result.answer });
      app.innerHTML = await routeContent();
      document.querySelector('#chat-window')?.scrollTo({ top: 99999, behavior: 'smooth' }); return;
    }
    if (form.id === 'quiz-form') {
      const result = await api('/api/quiz/recommend', { method: 'POST', body: JSON.stringify(data) });
      document.querySelector('#quiz-result').innerHTML = `<div class="form-success">${esc(result.explanation)}</div><div class="product-grid" style="margin-top:18px">${result.items.map(productCard).join('')}</div>`; return;
    }
    if (form.id === 'profile-form') {
      const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ name: data.name }) });
      state.user = result.user; feedback('profile-feedback').innerHTML = '<div class="form-success">Perfil atualizado.</div>'; return;
    }
    if (form.id === 'admin-decision' || form.dataset.form === 'admin-decision') {
      const result = await api(`/api/admin/social/applications/${encodeURIComponent(form.dataset.application)}`, { method: 'PATCH', body: JSON.stringify({ status: data.status, reason: data.reason }) });
      toast(result.capacityAdjusted ? 'Capacidade atingida: candidatura enviada para lista de espera.' : 'Decisão registrada.'); return render();
    }
    if (form.id === 'admin-product-form') {
      const body = { name: data.name, slug: data.slug, description: data.description, categorySlug: data.categorySlug, priceCents: data.price ? Math.round(Number(data.price) * 100) : null, stockQuantity: Number(data.stockQuantity || 0) };
      const result = await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
      feedback('admin-product-feedback').innerHTML = `<div class="form-success">Produto ${esc(result.name)} criado.</div>`; form.reset(); return;
    }
    if (form.id === 'inventory-form') {
      const result = await api('/api/admin/inventory/movements', { method: 'POST', body: JSON.stringify(data) });
      feedback('inventory-feedback').innerHTML = `<div class="form-success">Movimentação salva. Novo estoque: ${result.stockQuantity}.</div>`; return;
    }
    if (form.id === 'admin-event-form') {
      const body = { ...data, capacity: data.capacity ? Number(data.capacity) : null };
      const result = await api('/api/admin/events', { method: 'POST', body: JSON.stringify(body) });
      feedback('admin-event-feedback').innerHTML = `<div class="form-success">Evento ${esc(result.title)} criado.</div>`; form.reset(); return;
    }
    if (form.id === 'admin-article-form') {
      const result = await api('/api/admin/articles', { method: 'POST', body: JSON.stringify(data) });
      feedback('admin-article-feedback').innerHTML = `<div class="form-success">Artigo ${esc(result.title)} salvo.</div>`; form.reset(); return;
    }
    if (form.id === 'admin-partner-form') {
      const result = await api('/api/admin/partners', { method: 'POST', body: JSON.stringify(data) });
      feedback('admin-partner-feedback').innerHTML = `<div class="form-success">Parceiro ${esc(result.name)} salvo.</div>`; form.reset(); return;
    }
  } catch (error) {
    const target = form.querySelector('[id$="feedback"]');
    const detail = error.payload?.details?.length ? ` ${error.payload.details.join(' ')}` : '';
    if (target) target.innerHTML = `<div class="form-error">${esc(error.message)}${esc(detail)}</div>`;
    else toast(`${error.message}${detail}`, 'error');
  }
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { event.preventDefault(); navigate(nav.getAttribute('href')); return; }
  const action = event.target.closest('[data-action]');
  if (action) { event.preventDefault(); handleAction(action); }
});
document.addEventListener('submit', (event) => { event.preventDefault(); handleSubmit(event.target, event.submitter); });
window.addEventListener('popstate', render);

render();
