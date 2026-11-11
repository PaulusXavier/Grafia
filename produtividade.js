/* Grafia · produtividade: atalhos, filtros, grupos por data e contador de palavras.
   Só mexe na interface; não lê nem grava notas. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var lista = $('notes-list'), busca = $('search-input'), modal = $('note-modal');
  var texto = $('note-content'), info = $('editor-info'), app = $('app-screen');
  var filtros = $('filtros'), contador = $('contador-notas');
  if (!lista || !busca || !modal) return;

  var obs;
  var filtro = 'todas';
  var emAplicacao = false;

  /* ---------- grupos por data + filtros + contador ---------- */
  function hojeISO() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function diasAte(iso) {
    var a = new Date(hojeISO() + 'T00:00:00'), b = new Date((iso || hojeISO()) + 'T00:00:00');
    return Math.round((a - b) / 86400000);
  }
  function grupo(iso) {
    var n = diasAte(iso);
    if (n <= 0) return 'Hoje';
    if (n === 1) return 'Ontem';
    if (n < 7) return 'Últimos 7 dias';
    if (n < 31) return 'Últimos 30 dias';
    return 'Mais antigas';
  }
  function passa(card) {
    if (filtro === 'hoje') return diasAte(card.dataset.data) <= 0;
    if (filtro === 'anexos') return card.dataset.anexos === '1';
    if (filtro === 'paginas') return card.dataset.paginas === '1';
    return true;
  }
  function aplicar() {
    if (emAplicacao) return;
    emAplicacao = true;
    lista.querySelectorAll('.grupo-titulo').forEach(function (h) { h.remove(); });
    var cards = Array.prototype.slice.call(lista.querySelectorAll('.note-card'));
    var atual = '', visiveis = 0, contagem = {}, ultimo = null;
    cards.forEach(function (c) {
      var ok = passa(c);
      c.hidden = !ok;
      if (!ok) return;
      visiveis++;
      var g = grupo(c.dataset.data);
      if (g !== atual) {
        atual = g;
        ultimo = document.createElement('h2');
        ultimo.className = 'grupo-titulo';
        ultimo.textContent = g;
        lista.insertBefore(ultimo, c);
        contagem[g] = 0;
      }
      contagem[g]++;
    });
    lista.querySelectorAll('.grupo-titulo').forEach(function (h) {
      var s = document.createElement('small');
      s.textContent = contagem[h.firstChild.textContent];
      h.append(s);
    });
    if (filtros) filtros.hidden = cards.length === 0;
    if (contador) {
      contador.textContent = cards.length
        ? (visiveis === 1 ? '1 nota' : visiveis + ' notas') + (visiveis !== cards.length ? ' de ' + cards.length : '')
        : '';
    }
    obs.takeRecords();
    emAplicacao = false;
  }
  obs = new MutationObserver(function () { if (!emAplicacao) aplicar(); });
  obs.observe(lista, { childList: true });
  if (filtros) filtros.addEventListener('click', function (e) {
    var b = e.target.closest('.filtro');
    if (!b) return;
    filtro = b.dataset.filtro;
    filtros.querySelectorAll('.filtro').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    aplicar();
  });

  /* ---------- contador de palavras ---------- */
  function contar() {
    if (!info || !texto) return;
    var t = texto.value.trim();
    var p = t ? t.split(/\s+/).length : 0;
    var mac = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
    info.innerHTML = '';
    info.append(p + (p === 1 ? ' palavra' : ' palavras') + ' · ' + texto.value.length + ' caracteres · ');
    var k = document.createElement('kbd');
    k.textContent = mac + '+Enter';
    info.append(k, ' salva');
  }
  if (texto) texto.addEventListener('input', contar);
  new MutationObserver(contar).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  if (texto) new MutationObserver(contar).observe(texto, { attributes: true, attributeFilter: ['value'] });
  ['page-prev-btn', 'page-next-btn', 'add-page-btn', 'delete-page-btn'].forEach(function (id) {
    var b = $(id); if (b) b.addEventListener('click', function () { setTimeout(contar, 0); });
  });

  /* ---------- modelos rápidos (só estrutura, sem conteúdo pronto) ---------- */
  function agora() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, '0'); };
    return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  var MODELOS = {
    atendimento: function () { return 'Data/hora: ' + agora() + '\nDemanda:\nObservações:\nEncaminhamentos:\nPróximo passo:\n'; },
    reuniao: function () { return 'Reunião · ' + agora() + '\nParticipantes:\nPauta:\nDecisões:\nTarefas e responsáveis:\n'; },
    tarefas: function () { return '☐ \n☐ \n☐ '; },
    agora: agora
  };
  var barra = document.querySelector('.modelos');
  if (barra && texto) barra.addEventListener('click', function (e) {
    var b = e.target.closest('.modelo');
    if (!b || !MODELOS[b.dataset.modelo]) return;
    var t = MODELOS[b.dataset.modelo]();
    var ini = texto.selectionStart, fim = texto.selectionEnd;
    var antes = texto.value.slice(0, ini);
    if (antes && !/\n$/.test(antes) && b.dataset.modelo !== 'agora') t = '\n' + t;
    texto.focus();
    texto.setRangeText(t, ini, fim, 'end');
    texto.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ---------- lista compacta (lembra a escolha neste aparelho) ---------- */
  var dens = $('densidade');
  function lerDens() { try { return localStorage.getItem('grafia:compacta') === '1'; } catch (_) { return false; } }
  function aplicarDens(on) {
    document.body.classList.toggle('compacto', on);
    if (dens) dens.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('grafia:compacta', on ? '1' : '0'); } catch (_) {}
  }
  if (dens) { aplicarDens(lerDens()); dens.addEventListener('click', function () { aplicarDens(!document.body.classList.contains('compacto')); }); }

  var cta = $('empty-cta');
  if (cta) cta.addEventListener('click', function () { $('new-note-btn').click(); });

  /* ---------- atalhos ---------- */
  function digitando(e) {
    var t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  document.addEventListener('keydown', function (e) {
    var meta = e.ctrlKey || e.metaKey;
    var modalAberto = !modal.hidden;
    if (modalAberto) {
      if (meta && (e.key === 'Enter' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        var s = $('note-save-btn');
        if (s && !s.disabled) $('note-form').requestSubmit();
      }
      return;
    }
    if (!app || app.hidden) return;
    if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); busca.focus(); busca.select(); return; }
    if (digitando(e) || meta || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); busca.focus(); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); $('new-note-btn').click(); }
  });
  busca.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && busca.value) { busca.value = ''; busca.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (e.key === 'Escape') busca.blur();
  });
})();
