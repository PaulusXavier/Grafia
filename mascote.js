/* Grafi, o mascote: vida própria.
   - Olhos que seguem o dedo/cursor.
   - Pulinho + frase ao toque (tela de entrada).
   - Balão de fala curto, em reação ao que acontece no app.
   - Saudação conforme a hora do dia ao entrar.
   - Cochila depois de um tempo parado e acorda ao mexer.
   Não lê notas nem dados: só recebe nomes de eventos ("grafia:mascote").
   O assistente (paulus-grafia.js) continua dono dos estados dele
   (pensando, escrevendo, atento, dúvida); aqui nada os atropela. */
(function () {
  'use strict';

  var OCUPADOS = { pensando: 1, escrevendo: 1, atento: 1, duvida: 1 };
  var SONECA_MS = 2 * 60 * 1000;
  var reduzMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function slots() {
    return [document.getElementById('mascot-slot'), document.getElementById('mascot-slot-sm')].filter(Boolean);
  }
  function visiveis() {
    // só o mascote da tela que está aparecendo
    return slots().filter(function (s) { return s.offsetParent !== null; });
  }
  function svgDe(slot) { return slot.querySelector('.mascot'); }
  function base() { return navigator.onLine === false ? 'dormindo' : 'repouso'; }
  function sortear(lista) { return lista[Math.floor(Math.random() * lista.length)]; }

  /* ---------- balão de fala ---------- */
  var timerFala = null;
  function falar(texto, ms) {
    if (!texto) return;
    visiveis().forEach(function (slot) {
      var b = slot.querySelector('.grafi-fala');
      if (!b) {
        b = document.createElement('div');
        b.className = 'grafi-fala';
        b.setAttribute('aria-hidden', 'true'); // o app já avisa por toast; evita leitura dupla
        slot.appendChild(b);
      }
      b.textContent = texto;
      // reflow para a transição rodar também quando já estava visível
      void b.offsetWidth;
      b.classList.add('show');
    });
    clearTimeout(timerFala);
    timerFala = setTimeout(calar, ms || 3200);
  }
  function calar() {
    slots().forEach(function (slot) {
      var b = slot.querySelector('.grafi-fala');
      if (b) b.classList.remove('show');
    });
  }

  /* ---------- estados temporários ---------- */
  var timerEstado = null;
  function reagir(estado, ms) {
    visiveis().forEach(function (slot) {
      var s = svgDe(slot);
      if (!s) return;
      var atual = s.getAttribute('data-estado');
      if (OCUPADOS[atual]) return; // Paulus está trabalhando: não atropela
      s.setAttribute('data-estado', estado);
    });
    clearTimeout(timerEstado);
    if (ms) {
      timerEstado = setTimeout(function () {
        slots().forEach(function (slot) {
          var s = svgDe(slot);
          if (s && s.getAttribute('data-estado') === estado) s.setAttribute('data-estado', base());
        });
      }, ms);
    }
  }

  function pular(slot) {
    var s = svgDe(slot);
    if (!s || reduzMovimento) return;
    s.classList.remove('pulando');
    void s.getBoundingClientRect();
    s.classList.add('pulando');
    setTimeout(function () { s.classList.remove('pulando'); }, 550);
  }

  /* ---------- olhar que segue o dedo/cursor ---------- */
  var quadro = false, alvoX = 0, alvoY = 0;
  function olhar() {
    quadro = false;
    visiveis().forEach(function (slot) {
      var s = svgDe(slot);
      if (!s) return;
      var olhos = s.querySelector('.m-olhos');
      if (!olhos) return;
      var estado = s.getAttribute('data-estado');
      // nos outros estados o olhar já faz parte da expressão
      if (estado !== 'repouso' && estado !== 'ouvindo') { olhos.style.transform = ''; return; }
      var r = s.getBoundingClientRect();
      var dx = alvoX - (r.left + r.width / 2);
      var dy = alvoY - (r.top + r.height * 0.35);
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var f = Math.min(d / 120, 1);
      olhos.style.transform = 'translate(' + (dx / d * 3.2 * f).toFixed(2) + 'px,' + (dy / d * 2.6 * f).toFixed(2) + 'px)';
    });
  }
  function aoMover(e) {
    var p = e.touches && e.touches[0] ? e.touches[0] : e;
    alvoX = p.clientX; alvoY = p.clientY;
    if (!quadro && !reduzMovimento) { quadro = true; requestAnimationFrame(olhar); }
  }
  document.addEventListener('pointermove', aoMover, { passive: true });
  document.addEventListener('touchstart', aoMover, { passive: true });

  /* ---------- soneca por inatividade ---------- */
  var timerSoneca = null;
  function acordar() {
    clearTimeout(timerSoneca);
    var acordou = false;
    slots().forEach(function (slot) {
      var s = svgDe(slot);
      if (s && s.getAttribute('data-estado') === 'dormindo' && navigator.onLine !== false) {
        s.setAttribute('data-estado', 'repouso');
        acordou = true;
      }
    });
    if (acordou) falar('Voltei!', 1600);
    timerSoneca = setTimeout(cochilar, SONECA_MS);
  }
  function cochilar() {
    slots().forEach(function (slot) {
      var s = svgDe(slot);
      if (s && s.getAttribute('data-estado') === 'repouso') s.setAttribute('data-estado', 'dormindo');
    });
  }
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, acordar, { passive: true, capture: true });
  });
  acordar();

  /* ---------- ouvindo enquanto a pessoa escreve uma nota ---------- */
  var timerOuvindo = null;
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#note-modal')) return;
    reagir('ouvindo');
    clearTimeout(timerOuvindo);
    timerOuvindo = setTimeout(function () {
      slots().forEach(function (slot) {
        var s = svgDe(slot);
        if (s && s.getAttribute('data-estado') === 'ouvindo') s.setAttribute('data-estado', base());
      });
    }, 1800);
  });

  /* ---------- toque no mascote ---------- */
  var FRASES = [
    'Oi! Pronto para anotar?',
    'Pode escrever, eu guardo.',
    'Suas notas estão seguras aqui.',
    'Tudo no seu ritmo.',
    'Um passo de cada vez.'
  ];
  document.addEventListener('click', function (e) {
    var slot = e.target.closest && e.target.closest('.mascot-slot');
    if (!slot || slots().indexOf(slot) === -1) return;
    pular(slot);
    // no topo o toque abre o Paulus; ali só o pulinho, sem balão por cima do painel
    if (slot.id === 'mascot-slot') { reagir('feliz', 1800); falar(sortear(FRASES)); }
  });

  /* ---------- saudação por hora ---------- */
  function saudacao() {
    var h = new Date().getHours();
    if (h < 5) return 'Boa madrugada! Eu fico de olho.';
    if (h < 12) return 'Bom dia! Vamos anotar?';
    if (h < 18) return 'Boa tarde! Pronto para anotar?';
    return 'Boa noite! Como foi o dia?';
  }

  /* ---------- eventos vindos do app ---------- */
  var EVENTOS = {
    'nota-salva':         function () { reagir('feliz', 2200); falar('Nota salva!'); },
    'nota-salva-offline': function () { reagir('feliz', 2200); falar('Guardei aqui. Envio quando a internet voltar.', 4200); },
    'nota-excluida':      function () { reagir('repouso', 0); falar('Pronto, apaguei.', 2200); },
    'sincronizado':       function () { reagir('feliz', 2200); falar('Tudo sincronizado!'); },
    'online':             function () { reagir('feliz', 2200); falar('Internet de volta!'); },
    'offline':            function () { reagir('dormindo', 0); falar('Sem internet. Eu guardo tudo aqui.', 4200); },
    'erro':               function () { reagir('duvida', 3500); falar('Hmm, algo não deu certo.', 3500); },
    'atualizacao':        function () { reagir('feliz', 2500); falar('Versão nova pronta!', 3500); },
    'entrou':             function () { reagir('feliz', 2200); falar(saudacao(), 3800); }
  };
  window.addEventListener('grafia:mascote', function (e) {
    var f = EVENTOS[e.detail && e.detail.evento];
    if (f) f();
  });

  // Saudação ao entrar (sai da tela de login e aparece o app).
  var jaSaudou = false;
  window.addEventListener('grafia:auth', function (e) {
    if (e.detail && e.detail.logado && !jaSaudou) {
      jaSaudou = true;
      setTimeout(function () { window.dispatchEvent(new CustomEvent('grafia:mascote', { detail: { evento: 'entrou' } })); }, 700);
    }
  });
  // Na tela de login, uma saudação discreta assim que o app abrir.
  window.addEventListener('load', function () {
    setTimeout(function () {
      var login = document.getElementById('auth-screen');
      if (login && !login.hidden) falar(saudacao(), 3800);
    }, 1200);
  });

  window.GrafiaMascote = { reagir: reagir, falar: falar };
})();
