/* Detalhes de interface da tela de entrada (só visual — a autenticação fica em app.js).
 *
 *  - Olho para mostrar/ocultar a senha (nos dois campos de senha).
 *  - Aviso de Caps Lock ligado.
 *  - Medidor de força da senha (aparece só em "Criar acesso").
 *  - O mascote acompanha: ouve no e-mail, fecha os olhos quando você digita a
 *    senha e abre de novo quando você mostra a senha ou sai do campo.
 *  - Em computador (ponteiro de mouse), já deixa o cursor no e-mail; em celular
 *    e tablet não, para o teclado não cobrir a tela assim que o app abre.
 */
(function () {
  'use strict';

  var tela = document.getElementById('auth-screen');
  var email = document.getElementById('auth-email');
  var senha = document.getElementById('auth-password');
  var senha2 = document.getElementById('auth-password2');
  var olho = document.getElementById('auth-olho');
  var aviso = document.getElementById('auth-caps');
  var forca = document.getElementById('auth-forca');
  if (!tela || !email || !senha || !olho) return;

  /* ---------- mascote ---------- */
  function mascote() { return document.querySelector('#mascot-slot .mascot'); }
  function estado(novo, soSe) {
    var m = mascote();
    if (!m) return;
    var atual = m.getAttribute('data-estado');
    if (soSe && soSe.indexOf(atual) === -1) return; // não atropela dormindo/dúvida/feliz
    m.setAttribute('data-estado', novo);
  }
  function mostrando() { return senha.type === 'text'; }

  email.addEventListener('focus', function () { estado('ouvindo', ['repouso']); });
  email.addEventListener('blur', function () { estado('repouso', ['ouvindo']); });
  [senha, senha2].forEach(function (c) {
    if (!c) return;
    c.addEventListener('focus', function () { if (!mostrando()) estado('timido', ['repouso', 'ouvindo']); });
    c.addEventListener('blur', function () {
      setTimeout(function () {
        var foco = document.activeElement;
        if (foco !== senha && foco !== senha2) estado('repouso', ['timido']);
      }, 0);
    });
  });

  /* ---------- mostrar / ocultar senha ---------- */
  function alternar() {
    var mostrar = !mostrando();
    [senha, senha2].forEach(function (c) { if (c) c.type = mostrar ? 'text' : 'password'; });
    olho.classList.toggle('ligado', mostrar);
    olho.setAttribute('aria-pressed', String(mostrar));
    olho.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    olho.title = mostrar ? 'Ocultar senha' : 'Mostrar senha';
    var foco = document.activeElement;
    if (mostrar) estado('repouso', ['timido']);
    else if (foco === senha || foco === senha2) estado('timido', ['repouso', 'ouvindo']);
  }
  // pointerdown + preventDefault: não tira o foco do campo (no celular, o teclado não fecha)
  olho.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  olho.addEventListener('click', alternar);
  // ao sair da tela de entrada, a senha volta a ficar oculta
  window.addEventListener('grafia:auth', function (e) {
    if (e.detail && e.detail.logado && mostrando()) alternar();
  });

  /* ---------- Caps Lock ---------- */
  function conferirCaps(e) {
    if (!e.getModifierState) return;
    aviso.hidden = !e.getModifierState('CapsLock');
  }
  [senha, senha2].forEach(function (c) {
    if (!c) return;
    c.addEventListener('keydown', conferirCaps);
    c.addEventListener('keyup', conferirCaps);
    c.addEventListener('blur', function () { aviso.hidden = true; });
  });

  /* ---------- força da senha (só no cadastro) ---------- */
  var barras = forca.querySelectorAll('.forca-barra i');
  var texto = forca.querySelector('.forca-texto');
  var NOMES = ['Muito curta', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  function pontuar(v) {
    if (!v) return -1;
    if (v.length < 8) return 0;
    var p = 1;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) p++;
    if (/\d/.test(v)) p++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 14) p++;
    return Math.min(p, 4);
  }
  function atualizarForca() {
    var p = pontuar(senha.value);
    forca.setAttribute('data-nivel', String(p));
    barras.forEach(function (b, i) { b.classList.toggle('on', i < Math.max(p, 0)); });
    if (p < 0) texto.textContent = 'Use 8 ou mais caracteres.';
    else if (p === 0) texto.textContent = 'Muito curta — use 8 ou mais caracteres.';
    else texto.textContent = 'Senha ' + NOMES[p].toLowerCase() + (p < 3 ? ' — misture letras, números e símbolos.' : '.');
  }
  senha.addEventListener('input', atualizarForca);
  window.addEventListener('grafia:authmodo', atualizarForca);
  atualizarForca();

  /* ---------- foco inicial só com mouse ---------- */
  var finos = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  window.addEventListener('grafia:auth', function (e) {
    if (finos && e.detail && !e.detail.logado) setTimeout(function () { email.focus({ preventScroll: true }); }, 350);
  });
})();
