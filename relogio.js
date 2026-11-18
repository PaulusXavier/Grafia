/* Grafia · relógio de anéis (dia, mês e dia da semana + relógio analógico).
 *
 * Aparece só dentro do app (nunca na tela de entrada): na tela principal
 * (#app-relogio), num cartão acima da lista de notas, com a hora e a data por
 * extenso ao lado (#relogio-hora, #relogio-seg, #relogio-data).
 *
 * Roda só no aparelho: sem rede e sem ler nenhuma nota. Usa o horário do próprio
 * aparelho. Só se mexe enquanto está visível (a tela principal fica oculta
 * até o login, com o atributo "hidden"). As cores ficam em tema.css (".ar-").
 *
 * Uso em outro lugar:  var r = GrafiaRelogio.montar(elemento, { tz: 'America/Boa_Vista', aoTique: function (p) {} });  r.parar();
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  var SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  var MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var SEMANA_LONGA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var DIAS = [];
  for (var d = 1; d <= 31; d++) DIAS.push(String(d));
  var formatadores = {};

  function dois(n) { return (n < 10 ? '0' : '') + n; }

  // Data e hora em números. Sem "tz", vale o fuso do aparelho. O formatador é guardado: criar um por quadro seria pesado.
  function partes(data, tz) {
    var chave = tz || 'local';
    var f = formatadores[chave];
    if (f === undefined) {
      try {
        var o = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' };
        if (tz) o.timeZone = tz;
        f = new Intl.DateTimeFormat('en-GB', o);
      } catch (e) { f = null; }
      formatadores[chave] = f;
    }
    var a, mes, dia, h, m, s;
    if (f) {
      var x = {};
      f.formatToParts(data).forEach(function (p) { x[p.type] = p.value; });
      a = +x.year; mes = +x.month; dia = +x.day; h = (+x.hour) % 24; m = +x.minute; s = +x.second;
    } else {
      a = data.getFullYear(); mes = data.getMonth() + 1; dia = data.getDate(); h = data.getHours(); m = data.getMinutes(); s = data.getSeconds();
    }
    var sem = new Date(Date.UTC(a, mes - 1, dia)).getUTCDay();
    return { a: a, mes: mes, dia: dia, h: h, m: m, s: s, sem: sem, semLonga: SEMANA_LONGA[sem], mesLongo: MESES_LONGOS[mes - 1] };
  }

  function no(nome, attrs, pai) {
    var e = document.createElementNS(NS, nome);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (pai) pai.appendChild(e);
    return e;
  }

  // Um anel de rótulos igualmente espaçados; o anel gira para deixar o item atual no topo.
  function criarAnel(svg, raio, itens, classe) {
    var g = no('g', { 'class': 'ar-anel ' + classe }, svg);
    var passo = 360 / itens.length;
    var nos = itens.map(function (rotulo, i) {
      var t = no('text', { x: 200, y: 200 - raio + 4, 'text-anchor': 'middle', transform: 'rotate(' + (i * passo) + ' 200 200)' }, g);
      t.textContent = rotulo;
      return t;
    });
    return { g: g, nos: nos, passo: passo, atual: -1, ang: null };
  }

  // Gira pelo caminho mais curto (de dezembro para janeiro não dá a volta ao contrário).
  function ajustarAnel(anel, indice) {
    if (anel.atual === indice) return;
    if (anel.atual >= 0) anel.nos[anel.atual].classList.remove('ar-atual');
    anel.nos[indice].classList.add('ar-atual');
    anel.atual = indice;
    var alvo = -indice * anel.passo;
    if (anel.ang === null) anel.ang = alvo;
    else anel.ang += ((alvo - anel.ang + 540) % 360) - 180;
    anel.g.style.transform = 'rotate(' + anel.ang + 'deg)';
  }

  function montar(host, opc) {
    if (!host) return { parar: function () {} };
    opc = opc || {};
    var tz = opc.tz || '';
    if (host.__grafiaRelogio) host.__grafiaRelogio.parar();
    host.textContent = '';
    host.classList.add('ar-relogio', 'ar-parado');

    var svg = no('svg', { viewBox: '0 0 400 400', role: 'img', 'aria-label': 'Relógio', focusable: 'false' });
    host.appendChild(svg);
    no('circle', { 'class': 'ar-fundo', cx: 200, cy: 200, r: 196 }, svg);
    [178, 148, 118].forEach(function (r) { no('circle', { 'class': 'ar-trilha', cx: 200, cy: 200, r: r }, svg); });
    [191, 165, 135].forEach(function (r) { no('circle', { 'class': 'ar-borda', cx: 200, cy: 200, r: r }, svg); });
    no('circle', { 'class': 'ar-face', cx: 200, cy: 200, r: 103 }, svg);
    var aneis = {
      dia: criarAnel(svg, 178, DIAS, 'ar-anel-dia'),
      mes: criarAnel(svg, 148, MESES, 'ar-anel-mes'),
      sem: criarAnel(svg, 118, SEMANA, 'ar-anel-sem')
    };
    for (var i = 0; i < 60; i++) {
      var forte = i % 5 === 0;
      no('line', { 'class': 'ar-marca' + (forte ? ' ar-forte' : ''), x1: 200, x2: 200, y1: 101, y2: forte ? 112 : 106, transform: 'rotate(' + (i * 6) + ' 200 200)' }, svg);
    }
    for (var n = 1; n <= 12; n++) {
      var ang = n * Math.PI / 6;
      var t = no('text', {
        'class': 'ar-num' + (n % 3 === 0 ? ' ar-forte' : ''),
        x: (200 + 71 * Math.sin(ang)).toFixed(2), y: (200 - 71 * Math.cos(ang) + 5).toFixed(2), 'text-anchor': 'middle'
      }, svg);
      t.textContent = String(n);
    }
    var mHora = no('line', { 'class': 'ar-mao ar-mao-hora', x1: 200, y1: 212, x2: 200, y2: 150 }, svg);
    var mMin = no('line', { 'class': 'ar-mao ar-mao-min', x1: 200, y1: 214, x2: 200, y2: 122 }, svg);
    var mSeg = no('line', { 'class': 'ar-mao ar-mao-seg', x1: 200, y1: 218, x2: 200, y2: 112 }, svg);
    no('circle', { 'class': 'ar-eixo', cx: 200, cy: 200, r: 5 }, svg);
    no('circle', { 'class': 'ar-eixo-centro', cx: 200, cy: 200, r: 2 }, svg);

    var reduzir = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var parado = false, raf = 0, timer = 0, segAtual = -1, p = null, primeiro = true, minutoRotulo = -1;

    function quadro() {
      raf = 0; timer = 0;
      if (parado || !host.isConnected) return;
      // Escondido (outra tela, aba em segundo plano): só confere de vez em quando.
      if (document.hidden || !host.getClientRects().length) { timer = setTimeout(quadro, 400); return; }
      var agora = Date.now();
      var seg = Math.floor(agora / 1000);
      if (seg !== segAtual) {
        segAtual = seg;
        p = partes(new Date(agora), tz);
        ajustarAnel(aneis.dia, p.dia - 1);
        ajustarAnel(aneis.mes, p.mes - 1);
        ajustarAnel(aneis.sem, p.sem);
        if (p.m !== minutoRotulo) {
          minutoRotulo = p.m;
          svg.setAttribute('aria-label', 'Relógio: ' + p.semLonga + ', ' + p.dia + ' de ' + p.mesLongo + ', ' + dois(p.h) + ':' + dois(p.m));
        }
        if (typeof opc.aoTique === 'function') { try { opc.aoTique(p); } catch (e) { /* o relógio segue mesmo se o texto ao lado falhar */ } }
        if (primeiro) {
          primeiro = false;
          // Os anéis já abrem na posição certa; só os giros seguintes são animados.
          requestAnimationFrame(function () { requestAnimationFrame(function () { host.classList.remove('ar-parado'); }); });
        }
      }
      var s = p.s + (reduzir ? 0 : (agora % 1000) / 1000);
      var m = p.m + s / 60;
      var h = (p.h % 12) + m / 60;
      mSeg.setAttribute('transform', 'rotate(' + (s * 6).toFixed(2) + ' 200 200)');
      mMin.setAttribute('transform', 'rotate(' + (m * 6).toFixed(2) + ' 200 200)');
      mHora.setAttribute('transform', 'rotate(' + (h * 30).toFixed(2) + ' 200 200)');
      if (reduzir) timer = setTimeout(quadro, 250);
      else raf = requestAnimationFrame(quadro);
    }
    quadro();

    var ctl = {
      parar: function () {
        parado = true;
        if (raf) cancelAnimationFrame(raf);
        if (timer) clearTimeout(timer);
        if (host.__grafiaRelogio === ctl) host.__grafiaRelogio = null;
      }
    };
    host.__grafiaRelogio = ctl;
    return ctl;
  }

  window.GrafiaRelogio = { montar: montar };

  // ---------- liga no cartão da tela principal ----------
  function iniciar() {
    var elHora = document.getElementById('relogio-hora');
    var elSeg = document.getElementById('relogio-seg');
    var elData = document.getElementById('relogio-data');

    montar(document.getElementById('app-relogio'), {
      aoTique: function (p) {
        if (elHora) elHora.textContent = dois(p.h) + ':' + dois(p.m);
        if (elSeg) elSeg.textContent = ':' + dois(p.s);
        if (elData) {
          var diaSemana = p.semLonga.charAt(0).toUpperCase() + p.semLonga.slice(1);
          elData.textContent = diaSemana + ', ' + p.dia + ' de ' + p.mesLongo + ' de ' + p.a;
        }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
