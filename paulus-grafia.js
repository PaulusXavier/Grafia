// Paulus no Grafia: toda a ligação com o copiloto fica neste arquivo.
//
// REGRAS (não mude sem pensar):
//  - O Paulus NÃO lê notas: este arquivo não toca em allNotes, no Firestore, no modal de nota nem no campo de busca.
//  - Não passa "fichas" e não registra buscas (seria ligar o Paulus ao conteúdo das notas).
//  - As ações só navegam (abrir nota em branco, ir para a busca). Nada salva, altera ou apaga.
//  - Respostas entram na tela só com textContent (nunca innerHTML).
//  - Pergunta com dado pessoal é bloqueada pelo Paulus antes de qualquer rede e a mensagem é ocultada na tela.
(function () {
  'use strict';

  // Endereço do Worker do Paulus (o mesmo do Argo, Anona e Toth). Vazio = IA desligada (só a base de normas offline).
  var ENDPOINT = 'https://paulus-ia.paulo-ae18.workers.dev';

  var P = window.Paulus;
  if (!P) return; // paulus.v1.js não carregou: o app segue normal, só sem o assistente

  P.init({
    app: 'grafia',
    endpoint: ENDPOINT,
    conhecimentoUrl: './conhecimento.json'
  });

  function porId(id) { return document.getElementById(id); }

  P.registrarAcao({
    id: 'nova-nota',
    rotulos: ['nova nota', 'criar nota', 'anotar'],
    executar: function () { fechar(); var b = porId('new-note-btn'); if (b) b.click(); }
  });
  P.registrarAcao({
    id: 'buscar-notas',
    rotulos: ['busca', 'buscar nas notas', 'pesquisar notas', 'campo de busca'],
    executar: function () { fechar(); var i = porId('search-input'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } }
  });

  var painel = null, lista = null, campo = null, botaoEnviar = null, chips = null, rosto = null, status = null;
  var ocupado = false, controlador = null, ultimaPergunta = '';

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function logado() { return window.__grafiaLogado === true; }

  // ---------------------------------------------------------------- painel

  function montar() {
    if (painel) return;
    painel = el('section', 'paulus-painel');
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-label', 'Conversa com o Paulus');
    painel.hidden = true;

    var topo = el('header', 'paulus-topo');
    rosto = el('div', 'paulus-rosto');
    var tpl = porId('mascot-template');
    if (tpl) rosto.appendChild(tpl.content.cloneNode(true));
    var titulos = el('div', 'paulus-titulos');
    titulos.appendChild(el('strong', null, 'Paulus'));
    status = el('span', 'paulus-status', 'aqui como Grafia');
    titulos.appendChild(status);
    var nova = el('button', 'paulus-btn-topo', 'Nova conversa');
    nova.type = 'button';
    nova.addEventListener('click', reiniciar);
    var fecha = el('button', 'paulus-btn-topo paulus-fechar', '✕');
    fecha.type = 'button';
    fecha.setAttribute('aria-label', 'Fechar');
    fecha.addEventListener('click', fechar);
    topo.appendChild(rosto); topo.appendChild(titulos); topo.appendChild(nova); topo.appendChild(fecha);

    lista = el('div', 'paulus-lista');
    lista.setAttribute('aria-live', 'polite');
    chips = el('div', 'paulus-chips');

    var form = el('form', 'paulus-form');
    campo = el('input', 'paulus-campo');
    campo.type = 'text';
    campo.maxLength = 1200;
    campo.placeholder = 'Pergunte sobre o app ou o SUAS…';
    campo.setAttribute('aria-label', 'Pergunta para o Paulus');
    campo.autocomplete = 'off';
    // Inclina a cabeça enquanto a pessoa digita (só aparência; o texto digitado não é lido aqui).
    campo.addEventListener('input', function () { if (!ocupado) estado(campo.value ? 'ouvindo' : estadoBase()); });
    campo.addEventListener('blur', function () { if (!ocupado) estado(estadoBase()); });
    botaoEnviar = el('button', 'paulus-enviar', 'Enviar');
    botaoEnviar.type = 'submit';
    form.appendChild(campo); form.appendChild(botaoEnviar);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (ocupado) { if (controlador) controlador.abort(); return; }
      var t = campo.value.trim();
      if (!t) return;
      campo.value = '';
      enviar(t);
    });

    var rodape = el('p', 'paulus-aviso', 'Não tenho acesso às suas notas. Não escreva nomes, documentos ou relatos de pessoas aqui. Resposta gerada por IA: confira antes de usar em atendimento.');

    painel.appendChild(topo); painel.appendChild(lista); painel.appendChild(chips); painel.appendChild(form); painel.appendChild(rodape);
    document.body.appendChild(painel);

    var sk = P.skin('grafia');
    if (sk) { balao('paulus', sk.saudacao); sugerir(sk.sugestoes); }
  }

  function abrir() {
    if (!logado()) return;
    montar();
    painel.hidden = false;
    setTimeout(function () { campo.focus(); }, 50);
  }
  function fechar() { if (painel) painel.hidden = true; }

  function destruir() {
    if (controlador) controlador.abort();
    P.limpar();
    if (painel && painel.parentNode) painel.parentNode.removeChild(painel);
    painel = lista = campo = botaoEnviar = chips = rosto = status = null;
    ocupado = false; ultimaPergunta = '';
  }

  function reiniciar() {
    if (controlador) controlador.abort();
    P.limpar();
    lista.textContent = '';
    ocupado = false; botaoEnviar.textContent = 'Enviar';
    var sk = P.skin('grafia');
    if (sk) { balao('paulus', sk.saudacao); sugerir(sk.sugestoes); }
  }

  function rolar() { lista.scrollTop = lista.scrollHeight; }

  function balao(quem, texto) {
    var b = el('div', 'paulus-balao paulus-' + (quem === 'voce' ? 'voce' : 'ele'));
    var t = el('div', 'paulus-texto', texto);
    b.appendChild(t);
    lista.appendChild(b);
    rolar();
    return b;
  }

  function sugerir(itens) {
    chips.textContent = '';
    (itens || []).slice(0, 3).forEach(function (s) {
      var c = el('button', 'paulus-chip', s);
      c.type = 'button';
      c.addEventListener('click', function () { if (!ocupado) enviar(s); });
      chips.appendChild(c);
    });
  }

  function fontesDe(b, fontes) {
    if (!fontes || !fontes.length) return;
    var d = el('details', 'paulus-fontes');
    d.appendChild(el('summary', null, 'Fontes (' + fontes.length + ')'));
    var ul = el('ul');
    fontes.forEach(function (f) {
      var partes = [f.documento, f.referencia, f.norma, f.ano].filter(Boolean).join(' · ');
      var li = el('li', null, partes + (f.tipo === 'referencia' ? ' (orientação técnica)' : f.tipo === 'apoio' ? ' (material de apoio)' : ''));
      ul.appendChild(li);
    });
    d.appendChild(ul);
    b.appendChild(d);
  }

  function ferramentas(b, r, pergunta) {
    var linha = el('div', 'paulus-acoes');
    var copiar = el('button', 'paulus-mini', 'Copiar');
    copiar.type = 'button';
    copiar.addEventListener('click', function () {
      var txt = r.texto || '';
      var ok = function () { copiar.textContent = 'Copiado'; setTimeout(function () { copiar.textContent = 'Copiar'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () {});
    });
    linha.appendChild(copiar);
    if (r.tipo === 'ia') {
      var curto = el('button', 'paulus-mini', 'Mais curto');
      curto.type = 'button';
      curto.addEventListener('click', function () { if (!ocupado) enviar('Explique de forma mais curta: ' + pergunta); });
      linha.appendChild(curto);
    }
    b.appendChild(linha);
  }

  // Estado do mascote (Grafi): só troca a aparência; não lê nada do app.
  // Vale para o mascote do topo e o do painel (não para o da tela de login).
  var estadoBase = function () { return navigator.onLine === false ? 'dormindo' : 'repouso'; };
  function estado(e) {
    var nos = document.querySelectorAll('#mascot-slot-sm .mascot, .paulus-rosto .mascot');
    for (var i = 0; i < nos.length; i++) nos[i].setAttribute('data-estado', e);
  }
  window.addEventListener('online', function () { if (!ocupado) estado(estadoBase()); });
  window.addEventListener('offline', function () { if (!ocupado) estado(estadoBase()); });
  estado(estadoBase());

  var timerEstado = null;
  function voltarDepois(e, ms) {
    estado(e);
    clearTimeout(timerEstado);
    timerEstado = setTimeout(function () { if (!ocupado) estado(estadoBase()); }, ms);
  }

  function marcarFase(t) {
    clearTimeout(timerEstado);
    if (status) status.textContent = t;
    estado(t.indexOf('pens') === 0 ? 'pensando' : t.indexOf('escrev') === 0 ? 'escrevendo' : estadoBase());
  }

  async function enviar(texto) {
    if (!painel || ocupado) return;
    ultimaPergunta = texto;
    chips.textContent = '';
    var meu = balao('voce', texto);
    var resp = balao('paulus', '…');
    var area = resp.querySelector('.paulus-texto');
    ocupado = true;
    botaoEnviar.textContent = 'Parar';
    marcarFase('pensando…');
    controlador = typeof AbortController === 'function' ? new AbortController() : null;

    var r;
    try {
      r = await P.perguntar(texto, {
        aba: 'Notas',
        sinal: controlador ? controlador.signal : undefined,
        onToken: function (_p, tudo) { marcarFase('escrevendo…'); area.textContent = tudo; rolar(); }
      });
    } catch (e) {
      r = { tipo: 'erro', texto: 'Não consegui responder agora.' };
    }
    if (!painel) return; // saiu da conta durante a resposta

    ocupado = false;
    controlador = null;
    botaoEnviar.textContent = 'Enviar';
    marcarFase('aqui como Grafia');

    if (r.tipo === 'bloqueio') {
      // A mensagem tinha dado pessoal: some da tela também.
      meu.querySelector('.paulus-texto').textContent = '(mensagem oculta: continha dado pessoal)';
    }
    // Texto final já limpo (sem o rótulo SUGESTÕES), tanto da IA quanto da base de normas.
    area.textContent = r.texto || '';

    if (r.tipo === 'crise') {
      if (r.titulo) resp.insertBefore(el('strong', 'paulus-crise', r.titulo), area);
      var ul = el('ul', 'paulus-telefones');
      (r.telefones || []).forEach(function (t) {
        var li = el('li');
        var a = el('a', null, t.numero + ' · ' + t.nome);
        a.href = 'tel:' + String(t.numero).replace(/\D/g, '');
        li.appendChild(a);
        ul.appendChild(li);
      });
      resp.appendChild(ul);
    }
    // O mascote acompanha o que o Paulus respondeu e volta ao normal depois de uns segundos.
    if (r.tipo === 'crise' || r.tipo === 'bloqueio') voltarDepois('atento', 10000);
    else if (r.tipo === 'sem_resposta' || r.tipo === 'erro') voltarDepois('duvida', 8000);
    if (r.tipo === 'acao' && r.pedeConfirmacao) {
      var ok = el('button', 'paulus-mini', 'Confirmar');
      ok.type = 'button';
      ok.addEventListener('click', function () { ok.disabled = true; r.confirmar(); });
      resp.appendChild(ok);
    }
    if (r.tipo === 'acao_desconhecida' && r.opcoes && r.opcoes.length) {
      resp.appendChild(el('div', 'paulus-aviso-mini', 'Posso abrir: ' + r.opcoes.join(', ') + '.'));
    }
    fontesDe(resp, r.fontes);
    (r.avisos || []).forEach(function (a) { resp.appendChild(el('div', 'paulus-aviso-mini', a)); });

    if (r.tipo === 'ia' || r.tipo === 'norma') ferramentas(resp, r, texto);
    if (r.tipo === 'erro' || r.tipo === 'sem_resposta') {
      if (!r.limite && texto) {
        var de = el('button', 'paulus-mini', '↻ Tentar de novo');
        de.type = 'button';
        de.addEventListener('click', function () { if (!ocupado) enviar(texto); });
        resp.appendChild(de);
      }
    }
    if (r.sugestoes && r.sugestoes.length) sugerir(r.sugestoes);
    else if (r.tipo !== 'crise') sugerir(P.skin('grafia').sugestoes);
    rolar();
  }

  // ---------------------------------------------------------------- ligações com o app

  // O mascote do topo (e só ele) abre o painel. Sem login, não faz nada.
  function ligarMascote() {
    var slot = porId('mascot-slot-sm');
    if (!slot || slot.dataset.paulus) return;
    slot.dataset.paulus = '1';
    slot.setAttribute('role', 'button');
    slot.setAttribute('tabindex', '0');
    slot.setAttribute('aria-label', 'Conversar com o Paulus');
    slot.title = 'Conversar com o Paulus';
    slot.classList.add('paulus-gatilho');
    var acionar = function () { if (painel && !painel.hidden) fechar(); else abrir(); };
    slot.addEventListener('click', acionar);
    slot.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acionar(); } });
  }
  ligarMascote();

  // app.js avisa quando entra/sai alguém (onAuthStateChanged).
  window.addEventListener('grafia:auth', function (e) {
    window.__grafiaLogado = !!(e.detail && e.detail.logado);
    if (!window.__grafiaLogado) destruir();
  });
  if (window.__grafiaLogado === false) destruir();

  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && painel && !painel.hidden) fechar(); });
})();
