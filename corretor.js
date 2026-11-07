/* Corretor do Grafia
 *
 * Tudo roda no aparelho: o texto das notas NUNCA sai daqui (nada é enviado a
 * servidor nenhum, no mesmo espírito do Paulus, que não lê as notas).
 *
 * Duas camadas:
 *  1. Ortografia, com o mesmo dicionário do Verbus: Hunspell em WebAssembly
 *     (pasta spell/: pt.aff, pt.dic e spell-worker.js) rodando num Web Worker,
 *     então a tela não trava. Palavras erradas ganham sublinhado ondulado na
 *     própria caixa de texto; ao tocar nelas aparecem as sugestões. Se o
 *     Worker não puder ser usado, entra um motor simples em JavaScript que lê
 *     os mesmos arquivos. Sem dicionário o corretor continua com as regras.
 *  2. Regras de escrita: palavra repetida, espaços duplos, espaço antes/depois
 *     de pontuação, letra minúscula após ponto e erros comuns do português.
 *
 * O botão "Corretor" e o painel são ligados em corretor.init() (ver o final
 * deste arquivo). Nada em app.js precisa saber que o corretor existe: ele
 * troca o texto da caixa e dispara o evento "input", que o app já escuta.
 */
(function (root) {
  "use strict";

  const LANG = "pt-BR";
  const ALFABETO = "abcdefghijklmnopqrstuvwxyzáàâãéêíóôõúüç".split("");

  /* ------------------------------------------------------------------ *
   * Motor de ortografia (subconjunto do Hunspell: afixos PFX/SFX)
   * ------------------------------------------------------------------ */

  function criarDicionario() {
    const palavras = new Map(); // palavra -> flags (string ou array) | ""
    const sfx = {}; // último caractere do afixo -> [regras]
    const pfxList = [];
    let modoFlag = "char";
    let pronto = false;

    function lerFlags(s) {
      if (!s) return "";
      if (modoFlag === "long") return s.match(/.{1,2}/g) || [];
      if (modoFlag === "num") return s.split(",");
      return s;
    }
    const temFlag = (palavra, flag) => {
      const f = palavras.get(palavra);
      return !!f && f.includes(flag);
    };

    function carregarAff(texto) {
      const cruza = {}; // "SFXA" -> true/false (pode combinar prefixo+sufixo)
      for (const linha of texto.split(/\r?\n/)) {
        const t = linha.trim();
        if (!t || t[0] === "#") continue;
        const p = t.split(/\s+/);
        const k = p[0];
        if (k === "FLAG") {
          modoFlag = p[1] === "long" ? "long" : p[1] === "num" ? "num" : "char";
        } else if ((k === "PFX" || k === "SFX") && p.length === 4) {
          cruza[k + p[1]] = p[2] === "Y";
        } else if ((k === "PFX" || k === "SFX") && p.length >= 5) {
          const add = (p[3].split("/")[0] || "").replace(/^0$/, "");
          const strip = p[2] === "0" ? "" : p[2];
          let cond = null;
          if (p[4] !== ".") {
            try { cond = new RegExp(k === "SFX" ? p[4] + "$" : "^" + p[4]); } catch (e) { continue; }
          }
          const regra = { flag: p[1], strip, add, cond, cross: !!cruza[k + p[1]] };
          if (k === "SFX") {
            const ch = add ? add[add.length - 1] : "";
            (sfx[ch] || (sfx[ch] = [])).push(regra);
          } else {
            pfxList.push(regra);
          }
        }
      }
    }

    function adicionarLinhaDic(l) {
      if (!l || l[0] === "#") return;
      const sp = l.indexOf(" ");
      const entrada = sp === -1 ? l : l.slice(0, sp);
      const barra = entrada.indexOf("/");
      const palavra = barra === -1 ? entrada : entrada.slice(0, barra);
      if (!palavra) return;
      const flags = barra === -1 ? "" : lerFlags(entrada.slice(barra + 1));
      const antes = palavras.get(palavra);
      if (antes === undefined) palavras.set(palavra, flags);
      else if (flags) palavras.set(palavra, Array.isArray(flags) ? [...antes, ...flags] : antes + flags);
    }

    function carregarDic(texto) {
      const linhas = texto.split(/\r?\n/);
      for (let i = 1; i < linhas.length; i++) adicionarLinhaDic(linhas[i]); // linha 0 = quantidade
      pronto = palavras.size > 0;
    }

    // Mesma coisa, mas devolvendo o controle à tela a cada fatia. O dicionário
    // tem centenas de milhares de palavras: de uma vez só, num tablet Android
    // de entrada, travava toque e digitação por alguns segundos logo ao abrir
    // a nota. Em fatias, a tela continua respondendo enquanto ele carrega.
    async function carregarDicAsync(texto) {
      const linhas = texto.split(/\r?\n/);
      const FATIA = 8000;
      for (let i = 1; i < linhas.length; i++) {
        adicionarLinhaDic(linhas[i]);
        if (i % FATIA === 0) await new Promise((r) => setTimeout(r, 0));
      }
      pronto = palavras.size > 0;
    }

    function viaAfixo(w) {
      const candidatos = (sfx[w[w.length - 1]] || []).concat(sfx[""] || []);
      // só sufixo (e prefixo + sufixo)
      for (const r of candidatos) {
        if (r.add && !w.endsWith(r.add)) continue;
        const base = w.slice(0, w.length - r.add.length) + r.strip;
        if (r.cond && !r.cond.test(base)) continue;
        if (temFlag(base, r.flag)) return true;
        if (r.cross) {
          for (const p of pfxList) {
            if (!p.cross || !p.add || !base.startsWith(p.add)) continue;
            const base2 = p.strip + base.slice(p.add.length);
            if (p.cond && !p.cond.test(base2)) continue;
            if (temFlag(base2, p.flag) && temFlag(base2, r.flag)) return true;
          }
        }
      }
      // só prefixo
      for (const p of pfxList) {
        if (!p.add || !w.startsWith(p.add)) continue;
        const base = p.strip + w.slice(p.add.length);
        if (p.cond && !p.cond.test(base)) continue;
        if (temFlag(base, p.flag)) return true;
      }
      return false;
    }

    const existe = (w) => palavras.has(w) || viaAfixo(w);

    function checar(w) {
      if (existe(w)) return true;
      const min = w.toLocaleLowerCase(LANG);
      if (min === w) return false;
      const cap = min.charAt(0).toLocaleUpperCase(LANG) + min.slice(1);
      if (w === cap) return existe(min); // "Casa" no começo da frase
      if (w === w.toLocaleUpperCase(LANG)) return existe(min) || existe(cap); // "CASA"
      return false;
    }

    function sugerir(w, max = 5) {
      const min = w.toLocaleLowerCase(LANG);
      const cand = new Set();
      for (let i = 0; i <= min.length; i++) {
        const e = min.slice(0, i), d = min.slice(i);
        if (d) cand.add(e + d.slice(1)); // apagar
        if (d.length > 1) cand.add(e + d[1] + d[0] + d.slice(2)); // trocar ordem
        for (const c of ALFABETO) {
          if (d) cand.add(e + c + d.slice(1)); // trocar letra
          cand.add(e + c + d); // inserir letra
        }
      }
      cand.delete(min);
      const semAcento = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");
      const alvo = semAcento(min);
      const validas = [...cand].filter(existe);
      // melhor primeiro: só o acento muda (voce → você), depois o resto
      validas.sort((a, b) => (semAcento(b) === alvo) - (semAcento(a) === alvo));
      const ehMaiuscula = w === w.toLocaleUpperCase(LANG) && w.length > 1;
      const ehCapital = w[0] !== w[0].toLocaleLowerCase(LANG);
      return validas.slice(0, max).map((s) =>
        ehMaiuscula ? s.toLocaleUpperCase(LANG)
          : ehCapital ? s.charAt(0).toLocaleUpperCase(LANG) + s.slice(1) : s);
    }

    return {
      carregarAff, carregarDic, carregarDicAsync, checar, sugerir,
      preparar() { return Promise.resolve(); },
      adicionar() { /* o dicionário pessoal já é consultado em analisar() */ },
      get pronto() { return pronto; },
      get tamanho() { return palavras.size; }
    };
  }

  /* ------------------------------------------------------------------ *
   * Dicionário Hunspell (WebAssembly) num Web Worker — mesmo do Verbus
   * ------------------------------------------------------------------ */

  // Termos do trabalho no SUAS/psicologia que o dicionário geral não traz.
  const DIC_EXTRA = ("condicionalidade condicionalidades socioassistencial socioassistenciais socioeducativo " +
    "socioeducativa socioeducativos socioeducativas intersetorial intersetoriais intersetorialidade pix emoji emojis " +
    "podcast podcasts selfie selfies online offline smartphone smartphones wifi whatsapp instagram wi-fi app apps gov " +
    "genograma genogramas ecomapa ecomapas déficit déficits psicoeducação matriciamento socioemocional socioemocionais " +
    "neurodivergente neurodivergentes neurodivergência cisgênero heteroagressividade intrafamiliar intrafamiliares " +
    "transgeracional transgeracionais contrarreferência contrarreferências referenciamento vulnerabilização " +
    "revitimização parentalidade coparentalidade homoparental homoparentais cadúnico paif paefi suas sicon").split(" ");

  const semAcento = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");

  function criarDicionarioWorker(extra) {
    return new Promise((ok, no) => {
      let w;
      try { w = new Worker("spell/spell-worker.js", { type: "module" }); } catch (e) { return no(e); }
      const cache = new Map(); // palavra -> { ok, sug }
      let aguardando = null;   // resolve a conferência em andamento
      let fila = Promise.resolve();
      const fim = setTimeout(() => { try { w.terminate(); } catch (_) { /* ok */ } no(new Error("o dicionário demorou")); }, 60000);
      const falha = (e) => {
        clearTimeout(fim);
        try { w.terminate(); } catch (_) { /* ok */ }
        if (aguardando) { aguardando(); aguardando = null; }
        no(e instanceof Error ? e : new Error(String(e)));
      };
      w.onerror = () => falha(new Error("worker"));
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.t === "ready") {
          clearTimeout(fim);
          ok(api);
        } else if (m.t === "fail") {
          falha(new Error(m.e));
        } else if (m.t === "res") {
          m.out.forEach(([x, bom, sug]) => cache.set(x, { ok: !!bom, sug: sug || [] }));
          if (aguardando) { aguardando(); aguardando = null; }
        }
      };
      const api = {
        pronto: true,
        // Palavras ainda não conferidas vão ao Worker (uma conferência por vez).
        preparar(palavras) {
          const novas = [...new Set(palavras)].filter((x) => !cache.has(x));
          if (!novas.length) return Promise.resolve();
          for (let i = 0; i < novas.length; i += 400) {
            const lote = novas.slice(i, i + 400);
            fila = fila.then(() => new Promise((res) => {
              aguardando = res;
              w.postMessage({ t: "check", words: lote, sug: true });
            }));
          }
          return fila;
        },
        checar(x) { const r = cache.get(x); return r ? r.ok : true; }, // ainda sem resposta: não acusa
        sugerir(x, max = 4) {
          const r = cache.get(x);
          const alvo = semAcento(x).toLowerCase();
          // mesma palavra com o acento corrigido (voce → você) vem primeiro
          return ((r && r.sug) || []).slice()
            .sort((a, b) => (semAcento(b).toLowerCase() === alvo) - (semAcento(a).toLowerCase() === alvo))
            .slice(0, max);
        },
        adicionar(x) {
          w.postMessage({ t: "add", w: x });
          cache.set(x, { ok: true, sug: [] });
          for (const [k, v] of cache) if (!v.ok) cache.delete(k); // refaz o que estava errado
        }
      };
      w.postMessage({ t: "init", extra: extra || [] });
    });
  }

  /* ------------------------------------------------------------------ *
   * Análise do texto
   * ------------------------------------------------------------------ */

  const L = "\\p{L}";
  // Abreviações após as quais uma letra minúscula é normal ("Dr. silva" não é erro de frase)
  const ABREVIACOES = new Set(["dr", "dra", "sr", "sra", "srta", "prof", "profa", "ex", "etc", "av",
    "p", "pp", "cap", "art", "obs", "nº", "no", "ltda", "cia", "pág", "fig", "ref", "tel", "cel", "crp", "min", "seg"]);

  const ERROS_COMUNS = [
    [/(?<![\p{L}])a nível de(?![\p{L}])/giu, "em nível de", "Prefira “em nível de” (ou “no nível de”)."],
    [/(?<![\p{L}])afim de(?![\p{L}])/giu, "a fim de", "“A fim de” (finalidade) se escreve separado."],
    [/(?<![\p{L}])derrepente(?![\p{L}])/giu, "de repente", "Escreve-se “de repente”."],
    [/(?<![\p{L}])haja visto(?![\p{L}])/giu, "haja vista", "A expressão correta é “haja vista”."],
    [/(?<![\p{L}])menas(?![\p{L}])/giu, "menos", "“Menos” não varia: nunca “menas”."],
    [/(?<![\p{L}])[aà] muito tempo(?![\p{L}])/giu, "há muito tempo", "Tempo passado pede “há”."],
    [/(?<![\p{L}])houveram(?![\p{L}])/giu, "houve", "“Haver” no sentido de existir/ocorrer fica no singular: “houve”."],
    [/(?<![\p{L}])pra mim (fazer|dizer|ver|ler|falar|ir)(?![\p{L}])/giu, "para eu $1", "Antes de verbo no infinitivo, use “eu”: “para eu $1”."],
    [/(?<![\p{L}])por isso mesmo que(?![\p{L}])/giu, "por isso mesmo, porque", "Confira se não é “porque”."]
  ];

  // Palavras que valem ser conferidas no dicionário (mesmos filtros para a
  // análise e para a lista enviada ao Worker).
  function* palavrasParaConferir(texto, ignoradas) {
    const re = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu;
    for (const m of texto.matchAll(re)) {
      const w = m[0].replace(/’/g, "'");
      if (w.length < 2 || ignoradas.has(w.toLocaleLowerCase(LANG))) continue;
      const antes = texto[m.index - 1], depois = texto[m.index + m[0].length];
      if (/\d/.test(antes || "") || /\d/.test(depois || "")) continue; // 3ª, 10h…
      if (w === w.toLocaleUpperCase(LANG) && w.length <= 6) continue; // siglas (CRP, SUAS)
      if (/\p{Ll}\p{Lu}/u.test(w)) continue; // iPhone, WhatsApp
      // Nome próprio no meio da frase (Roraima, Paulo): o dicionário geral não os traz
      if (w[0] !== w[0].toLocaleLowerCase(LANG) && !inicioDeFrase(texto, m.index)) continue;
      yield [m, w];
    }
  }

  function inicioDeFrase(texto, i) {
    let k = i - 1;
    while (k >= 0 && /[\s"“”'‘’(\[«*•\-–—]/.test(texto[k])) k--;
    return k < 0 || /[.!?…:;\n]/.test(texto[k]) || texto.lastIndexOf("\n", i - 1) > k;
  }

  function analisar(texto, dic, ignoradas) {
    const problemas = [];
    const protegidos = []; // faixas de URL/e-mail: não corrigir
    for (const m of texto.matchAll(/\S+@\S+|https?:\/\/\S+|www\.\S+/g)) {
      protegidos.push([m.index, m.index + m[0].length]);
    }
    const protegido = (a, b) => protegidos.some(([x, y]) => a < y && b > x);
    const add = (p) => { if (!protegido(p.inicio, p.fim)) problemas.push(p); };

    // 1. Ortografia
    if (dic && dic.pronto) {
      for (const [m, w] of palavrasParaConferir(texto, ignoradas)) {
        if (dic.checar(w)) continue;
        if (w.includes("-") && w.split("-").every((parte) => !parte || dic.checar(parte))) continue;
        add({
          tipo: "ortografia", inicio: m.index, fim: m.index + m[0].length, trecho: m[0],
          mensagem: "Palavra não encontrada no dicionário.",
          sugestoes: dic.sugerir(m[0]), podeAdicionar: true
        });
      }
    }

    // 2. Palavra repetida ("o o paciente")
    for (const m of texto.matchAll(/(?<![\p{L}\d])(\p{L}+)([ \t]+)\1(?![\p{L}\d])/giu)) {
      if (/^\d/.test(m[1])) continue;
      add({
        tipo: "escrita", inicio: m.index, fim: m.index + m[0].length, trecho: m[0],
        mensagem: "Palavra repetida.", sugestoes: [m[1]]
      });
    }

    // 3. Espaços duplos no meio da frase
    for (const m of texto.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
      add({ tipo: "escrita", inicio: m.index, fim: m.index + m[0].length, trecho: m[0],
        mensagem: "Espaço duplicado.", sugestoes: [" "] });
    }

    // 4. Espaço antes de pontuação
    for (const m of texto.matchAll(/(?<=[\p{L}\d)”"]) +(?=[,.;:!?](?![.!?]))/gu)) {
      add({ tipo: "escrita", inicio: m.index, fim: m.index + m[0].length, trecho: m[0],
        mensagem: "Não há espaço antes da pontuação.", sugestoes: [""] });
    }

    // 5. Falta de espaço depois da pontuação
    for (const m of texto.matchAll(/(?<=\p{L})[,;:!?](?=\p{L})|(?<=\p{Ll}{2})\.(?=\p{Lu}\p{Ll})/gu)) {
      add({ tipo: "escrita", inicio: m.index, fim: m.index + 1, trecho: m[0],
        mensagem: "Falta um espaço depois da pontuação.", sugestoes: [m[0] + " "], rotulos: ["Inserir espaço"] });
    }

    // 6. Frase começando com letra minúscula
    for (const m of texto.matchAll(/([\p{L}\d]+)([.!?]+)(\s+)(\p{Ll})/gu)) {
      if (ABREVIACOES.has(m[1].toLocaleLowerCase(LANG)) || /^\d+$/.test(m[1])) continue;
      if (m[1].length === 1 && m[2] === ".") continue; // iniciais e "p. 3"
      const pos = m.index + m[1].length + m[2].length + m[3].length;
      add({ tipo: "escrita", inicio: pos, fim: pos + 1, trecho: m[4],
        mensagem: "Início de frase com letra minúscula.", sugestoes: [m[4].toLocaleUpperCase(LANG)], rotulos: ["Pôr em maiúscula"] });
    }

    // 7. Erros comuns
    for (const [re, certo, msg] of ERROS_COMUNS) {
      for (const m of texto.matchAll(re)) {
        const sug = certo.replace(/\$(\d)/g, (_, n) => m[n] || "");
        add({ tipo: "escrita", inicio: m.index, fim: m.index + m[0].length, trecho: m[0],
          mensagem: msg.replace(/\$(\d)/g, (_, n) => m[n] || ""), sugestoes: [sug] });
      }
    }

    problemas.sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
    // descarta sobreposições (mantém o primeiro)
    const limpos = [];
    let fimAnterior = -1;
    for (const p of problemas) {
      if (p.inicio < fimAnterior) continue;
      limpos.push(p);
      fimAnterior = p.fim;
    }
    return limpos;
  }

  /* ------------------------------------------------------------------ *
   * Interface (botão + painel dentro do modal da nota)
   * ------------------------------------------------------------------ */

  function init({ textarea, botao, painel, arquivos, indicadorPagina, modal }) {
    let dic = criarDicionario();      // motor simples (reserva); trocado pelo Hunspell se o Worker subir
    let carregamento = null;          // Promise
    let dicionarioOk = false;
    const ignoradas = new Set();
    const CHAVE = "grafia-dicionario-pessoal";
    const CHAVE_AUTO = "grafia-corretor-auto";
    const ignoradasAgora = new Set(); // "Ignorar" vale só para esta nota aberta
    let automatico = true;            // verifica sozinho enquanto escreve
    let falhouEm = 0;                 // dicionário ausente: não insiste a cada pausa
    let temporizador = null;
    let ultimoTexto = null;
    let todos = [];                   // problemas da última análise (relativos a textarea.value)
    let textoMarcado = "";            // texto a que `todos` se refere
    let digitando = false;            // última ação foi digitar: não sublinha a palavra em curso
    const ROTULO = "✓ Corretor";

    try {
      JSON.parse(localStorage.getItem(CHAVE) || "[]").forEach((w) => ignoradas.add(w));
      automatico = localStorage.getItem(CHAVE_AUTO) !== "0";
    } catch (e) { /* sem armazenamento: só vale nesta sessão */ }

    function guardarPalavra(w) {
      ignoradas.add(w.toLocaleLowerCase(LANG));
      try { localStorage.setItem(CHAVE, JSON.stringify([...ignoradas])); } catch (e) { /* ok */ }
      if (dic.adicionar) dic.adicionar(w);
    }

    async function baixar(url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url + " " + r.status);
      return r;
    }

    // Motor simples em JavaScript (só se o Worker/WebAssembly não funcionar).
    async function carregarMotorSimples() {
      const [rAff, rDic] = await Promise.all([baixar(arquivos.aff), baixar(arquivos.dic)]);
      const bufAff = await rAff.arrayBuffer();
      const bufDic = await rDic.arrayBuffer();
      const cab = new TextDecoder("latin1").decode(bufAff.slice(0, 400));
      const set = (cab.match(/^SET\s+(\S+)/m) || [])[1] || "UTF-8";
      const dec = new TextDecoder(/utf-?8/i.test(set) ? "utf-8" : set);
      const motor = criarDicionario();
      motor.carregarAff(dec.decode(bufAff));
      await motor.carregarDicAsync(dec.decode(bufDic));
      DIC_EXTRA.forEach((w) => motor.carregarDic("1\n" + w));
      return motor;
    }

    function carregarDicionario(forcar) {
      if (!carregamento && (forcar || Date.now() - falhouEm > 60000)) {
        carregamento = (async () => {
          try {
            const pessoais = [...ignoradas];
            try {
              dic = await criarDicionarioWorker(DIC_EXTRA.concat(pessoais));
            } catch (e) {
              console.warn("Corretor: Worker indisponível, usando o motor simples.", e);
              dic = await carregarMotorSimples();
            }
            dicionarioOk = dic.pronto;
            textarea.spellcheck = !dicionarioOk; // o sublinhado do app substitui o do navegador
          } catch (e) {
            console.warn("Corretor: dicionário indisponível, só regras de escrita.", e);
            dicionarioOk = false;
            carregamento = null;
            falhouEm = Date.now(); // só tenta de novo daqui a um tempo
          }
        })();
      }
      return carregamento || Promise.resolve();
    }

    function el(tag, classe, texto) {
      const e = document.createElement(tag);
      if (classe) e.className = classe;
      if (texto != null) e.textContent = texto;
      return e;
    }

    /* ---------- Sublinhado ao vivo (espelho atrás/sobre a caixa de texto) ---------- */

    const wrap = el("div", "corretor-wrap");
    const espelho = el("div", "corretor-espelho");
    espelho.setAttribute("aria-hidden", "true");
    textarea.parentNode.insertBefore(wrap, textarea);
    wrap.append(textarea, espelho);
    let marcas = []; // { p, el }

    const PROPS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
      "textTransform", "wordSpacing", "textIndent", "tabSize", "textAlign",
      "paddingTop", "paddingLeft", "borderTopWidth", "borderLeftWidth", "borderBottomWidth", "borderRightWidth"];
    function sincEstilo() {
      const cs = getComputedStyle(textarea);
      for (const p of PROPS) espelho.style[p] = cs[p];
      const barra = Math.max(0, textarea.offsetWidth - textarea.clientWidth -
        parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth));
      espelho.style.paddingRight = (parseFloat(cs.paddingRight) + barra) + "px";
      espelho.style.paddingBottom = cs.paddingBottom;
      espelho.style.top = textarea.offsetTop + "px";
      espelho.style.left = textarea.offsetLeft + "px";
      espelho.style.width = textarea.offsetWidth + "px";
      espelho.style.height = textarea.offsetHeight + "px";
      espelho.scrollTop = textarea.scrollTop;
    }

    // Desloca os pontos já achados quando o texto muda, para o sublinhado
    // acompanhar a digitação sem esperar a próxima análise.
    function ajustar(lista, antes, depois) {
      if (antes === depois) return lista;
      let i = 0;
      while (i < antes.length && i < depois.length && antes[i] === depois[i]) i++;
      let j = 0;
      while (j < antes.length - i && j < depois.length - i &&
        antes[antes.length - 1 - j] === depois[depois.length - 1 - j]) j++;
      const delta = depois.length - antes.length, fimAntes = antes.length - j;
      return lista
        .filter((p) => p.fim <= i || p.inicio >= fimAntes)
        .map((p) => (p.fim <= i ? p : { ...p, inicio: p.inicio + delta, fim: p.fim + delta }));
    }

    function desenharEspelho() {
      const v = textarea.value;
      if (v !== textoMarcado) { todos = ajustar(todos, textoMarcado, v); textoMarcado = v; }
      espelho.replaceChildren();
      marcas = [];
      if (!automatico) return;
      const c = textarea.selectionStart, foco = document.activeElement === textarea;
      let pos = 0;
      for (const p of todos) {
        if (ignoradasAgora.has(p.tipo + "|" + p.trecho)) continue;
        if (p.tipo === "ortografia" && ignoradas.has(p.trecho.toLocaleLowerCase(LANG))) continue;
        if (digitando && foco && p.tipo === "ortografia" && c >= p.inicio && c <= p.fim) continue;
        if (p.inicio < pos || v.slice(p.inicio, p.fim) !== p.trecho) continue;
        espelho.append(v.slice(pos, p.inicio));
        const m = el("span", "corretor-marca corretor-marca-" + p.tipo, v.slice(p.inicio, p.fim));
        espelho.append(m);
        marcas.push({ p, el: m });
        pos = p.fim;
      }
      espelho.append(v.slice(pos) + "​");
      espelho.scrollTop = textarea.scrollTop;
    }

    /* ---------- Janelinha de sugestões ao tocar numa palavra marcada ---------- */

    const pop = el("div", "corretor-pop");
    pop.hidden = true;
    pop.setAttribute("role", "menu");
    wrap.append(pop);
    // não tirar o foco da caixa (no celular, fecharia o teclado)
    pop.addEventListener("pointerdown", (e) => e.preventDefault());
    pop.addEventListener("mousedown", (e) => e.preventDefault());

    function fecharPop() { pop.hidden = true; pop.replaceChildren(); }

    function abrirPop(marca) {
      const p = marca.p;
      pop.replaceChildren();
      pop.append(el("p", "corretor-pop-msg", p.tipo === "ortografia" ? "“" + p.trecho + "” — não encontrada" : p.mensagem));
      const acoes = el("div", "corretor-acoes");
      if (!p.sugestoes.length) acoes.append(el("span", "corretor-pop-vazio", "Sem sugestões"));
      for (const [i, s] of p.sugestoes.entries()) {
        const rotulo = (p.rotulos && p.rotulos[i]) || (s === "" ? "Remover" : s === " " ? "Um espaço" : s);
        const b = el("button", "corretor-sug", rotulo);
        b.type = "button";
        b.addEventListener("click", () => { fecharPop(); aplicar(p, s, false); });
        acoes.append(b);
      }
      const ig = el("button", "corretor-ign", "Ignorar");
      ig.type = "button";
      ig.addEventListener("click", () => { fecharPop(); ignoradasAgora.add(p.tipo + "|" + p.trecho); atualizarVista(); });
      acoes.append(ig);
      if (p.podeAdicionar) {
        const ad = el("button", "corretor-ign", "Adicionar ao dicionário");
        ad.type = "button";
        ad.addEventListener("click", () => { fecharPop(); guardarPalavra(p.trecho); verificar(); });
        acoes.append(ad);
      }
      pop.append(acoes);
      pop.hidden = false;
      // posição: logo abaixo da palavra (ou acima, se faltar espaço)
      const w = wrap.getBoundingClientRect(), r = marca.el.getBoundingClientRect();
      const largura = pop.offsetWidth, altura = pop.offsetHeight;
      let x = r.left - w.left, y = r.bottom - w.top + 4;
      x = Math.max(0, Math.min(x, w.width - largura));
      if (y + altura > w.height && r.top - w.top - altura - 4 >= 0) y = r.top - w.top - altura - 4;
      pop.style.left = x + "px";
      pop.style.top = Math.max(0, y) + "px";
    }

    function marcaNoCursor() {
      if (textarea.selectionStart !== textarea.selectionEnd) return null;
      const c = textarea.selectionStart;
      return marcas.find((m) => c >= m.p.inicio && c <= m.p.fim) || null;
    }

    textarea.addEventListener("pointerdown", () => { digitando = false; fecharPop(); });
    textarea.addEventListener("click", () => {
      digitando = false;
      desenharEspelho();
      const m = marcaNoCursor();
      if (m) abrirPop(m); else fecharPop();
    });
    textarea.addEventListener("contextmenu", (e) => { // clique direito no computador
      const m = marcaNoCursor();
      if (m) { e.preventDefault(); abrirPop(m); }
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !pop.hidden) { e.stopPropagation(); fecharPop(); }
    });
    textarea.addEventListener("scroll", () => { espelho.scrollTop = textarea.scrollTop; fecharPop(); });
    textarea.addEventListener("blur", () => { digitando = false; setTimeout(() => { fecharPop(); desenharEspelho(); }, 150); });
    let quadro = 0;
    document.addEventListener("selectionchange", () => {
      if (document.activeElement !== textarea || quadro) return;
      quadro = requestAnimationFrame(() => { quadro = 0; desenharEspelho(); });
    });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { sincEstilo(); });
      ro.observe(textarea);
      ro.observe(wrap);
    }
    window.addEventListener("resize", sincEstilo);
    sincEstilo();

    /* ---------- Painel de revisão (botão ✓ Corretor) ---------- */

    function fechar() {
      painel.hidden = true;
      painel.replaceChildren();
      botao.setAttribute("aria-expanded", "false");
    }

    function marcarBotao(n) {
      botao.textContent = n ? `${ROTULO} · ${n}` : ROTULO;
      botao.classList.toggle("tem-erros", n > 0);
      botao.setAttribute("aria-label", n
        ? `Corretor: ${n} ${n === 1 ? "ponto para revisar" : "pontos para revisar"}`
        : "Corretor");
    }

    function visiveis() {
      return todos.filter((p) =>
        !ignoradasAgora.has(p.tipo + "|" + p.trecho) &&
        !(p.tipo === "ortografia" && ignoradas.has(p.trecho.toLocaleLowerCase(LANG))));
    }

    // Confere o texto atual (com o dicionário) e devolve o que há a revisar.
    async function analisarAgora(forcarDic) {
      await carregarDicionario(!!forcarDic);
      const texto = textarea.value;
      if (dicionarioOk) {
        const lista = [];
        for (const [, w] of palavrasParaConferir(texto, ignoradas)) lista.push(w);
        await dic.preparar(lista);
      }
      const achados = analisar(texto, dicionarioOk ? dic : null, ignoradas);
      return { texto, achados };
    }

    // Atualiza sublinhado, contador e (se aberto) o painel, a partir de `todos`.
    function atualizarVista() {
      const lista = visiveis();
      marcarBotao(lista.length);
      desenharEspelho();
      if (!painel.hidden) desenhar(lista);
    }

    function aplicar(p, substituto, abrirPainel = true) {
      const v = textarea.value;
      // o texto pode ter mudado desde a análise: confere antes de trocar
      if (v.slice(p.inicio, p.fim) !== p.trecho) return abrirPainel ? rodar() : verificar();
      textarea.value = v.slice(0, p.inicio) + substituto + v.slice(p.fim);
      const cursor = p.inicio + substituto.length;
      try { textarea.setSelectionRange(cursor, cursor); } catch (e) { /* ok */ }
      textarea.dispatchEvent(new Event("input", { bubbles: true })); // o app guarda a página
      return abrirPainel ? rodar() : verificar();
    }

    function contexto(p) {
      const v = textarea.value;
      const a = Math.max(0, p.inicio - 28), b = Math.min(v.length, p.fim + 28);
      const c = el("p", "corretor-contexto");
      c.append(
        (a > 0 ? "…" : "") + v.slice(a, p.inicio).replace(/\s+/g, " "),
        el("mark", null, p.trecho.replace(/ /g, "·") || "·"),
        v.slice(p.fim, b).replace(/\s+/g, " ") + (b < v.length ? "…" : "")
      );
      return c;
    }

    function desenhar(problemas) {
      painel.replaceChildren();
      const topo = el("div", "corretor-topo");
      const nOrt = problemas.filter((p) => p.tipo === "ortografia").length;
      topo.append(el("strong", null, problemas.length
        ? `${problemas.length} ${problemas.length === 1 ? "ponto para revisar" : "pontos para revisar"}`
        : "Nenhum problema encontrado ✓"));
      const x = el("button", "corretor-fechar", "✕");
      x.type = "button";
      x.setAttribute("aria-label", "Fechar corretor");
      x.addEventListener("click", () => fechar());
      topo.append(x);
      painel.append(topo);

      const auto = el("label", "corretor-auto");
      const cx = el("input");
      cx.type = "checkbox";
      cx.checked = automatico;
      cx.addEventListener("change", () => {
        automatico = cx.checked;
        try { localStorage.setItem(CHAVE_AUTO, automatico ? "1" : "0"); } catch (e) { /* ok */ }
        if (automatico) { verificar(); }
        else { clearTimeout(temporizador); desenharEspelho(); if (dicionarioOk) textarea.spellcheck = true; }
        if (automatico && dicionarioOk) textarea.spellcheck = false;
      });
      auto.append(cx, " Sublinhar erros enquanto escrevo");
      painel.append(auto);

      if (!dicionarioOk) {
        painel.append(el("p", "corretor-aviso",
          "Dicionário de ortografia ainda não carregado neste aparelho — verificando só pontuação, espaços e erros comuns."));
      } else if (!nOrt && !problemas.length) {
        painel.append(el("p", "corretor-aviso", "Ortografia, pontuação e espaços conferidos."));
      }

      const lista = el("ul", "corretor-lista");
      for (const p of problemas.slice(0, 60)) {
        const li = el("li", "corretor-item corretor-" + p.tipo);
        li.append(contexto(p), el("p", "corretor-msg", p.mensagem));
        const acoes = el("div", "corretor-acoes");
        for (const [i, s] of p.sugestoes.entries()) {
          const rotulo = (p.rotulos && p.rotulos[i]) || (s === "" ? "Remover" : s === " " ? "Um espaço" : s);
          const b = el("button", "corretor-sug", rotulo);
          b.type = "button";
          b.addEventListener("click", () => aplicar(p, s));
          acoes.append(b);
        }
        const ig = el("button", "corretor-ign", "Ignorar");
        ig.type = "button";
        ig.addEventListener("click", () => {
          ignoradasAgora.add(p.tipo + "|" + p.trecho);
          atualizarVista();
        });
        acoes.append(ig);
        if (p.podeAdicionar) {
          const ad = el("button", "corretor-ign", "Adicionar ao dicionário");
          ad.type = "button";
          ad.addEventListener("click", () => { guardarPalavra(p.trecho); verificar(); });
          acoes.append(ad);
        }
        li.append(acoes);
        lista.append(li);
      }
      painel.append(lista);
      if (problemas.length > 60) {
        painel.append(el("p", "corretor-aviso", "Mostrando os 60 primeiros; corrija e confira de novo."));
      }
    }

    // Botão: sempre mostra o painel, mesmo sem problemas.
    async function rodar() {
      painel.hidden = false;
      botao.setAttribute("aria-expanded", "true");
      if (!dicionarioOk && !carregamento) {
        painel.replaceChildren(el("p", "corretor-aviso", "Carregando dicionário…"));
      }
      const { texto, achados } = await analisarAgora(true);
      if (textarea.value !== texto) return rodar(); // mudou enquanto conferia
      todos = achados; textoMarcado = texto; ultimoTexto = texto;
      atualizarVista();
      if (painel.hidden) return;
      desenhar(visiveis());
    }

    // Automático: confere sozinho, sublinha e atualiza o contador. O painel só
    // abre pelo botão (ou se já estiver aberto, é atualizado).
    async function verificar() {
      if (modal && modal.hidden) return;
      const texto0 = textarea.value;
      if (!texto0.trim()) { ultimoTexto = texto0; todos = []; textoMarcado = texto0; atualizarVista(); if (!painel.hidden) fechar(); return; }
      if (!automatico && painel.hidden) return;
      const { texto, achados } = await analisarAgora(false);
      if (textarea.value !== texto) return; // continuou digitando: a próxima pausa confere
      ultimoTexto = texto;
      todos = achados; textoMarcado = texto;
      atualizarVista();
    }

    function agendar(ms) {
      if (!automatico) return;
      clearTimeout(temporizador);
      temporizador = setTimeout(verificar, ms);
    }

    textarea.addEventListener("input", () => {
      digitando = true;
      fecharPop();
      desenharEspelho(); // sublinhado acompanha a digitação na hora
      if (textarea.value !== ultimoTexto) agendar(500); // espera uma pausa na digitação
    });

    botao.addEventListener("click", () => { painel.hidden ? rodar() : fechar(); });

    // Ao trocar de página ou abrir/fechar a nota, a análise antiga deixa de
    // valer; se a nota está aberta, confere de novo sozinho.
    function reiniciar() {
      clearTimeout(temporizador);
      ultimoTexto = null;
      ignoradasAgora.clear();
      todos = []; textoMarcado = textarea.value;
      fecharPop();
      fechar();
      marcarBotao(0);
      sincEstilo();
      desenharEspelho();
      if (!modal || !modal.hidden) agendar(300);
    }
    if (indicadorPagina) {
      new MutationObserver(reiniciar).observe(indicadorPagina, { childList: true, characterData: true, subtree: true });
    }
    if (modal) {
      new MutationObserver(reiniciar).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    }
    // Começa a baixar o dicionário já na primeira abertura do app.
    setTimeout(() => carregarDicionario(false), 1500);

    return { rodar, verificar, fechar };
  }

  const api = { criarDicionario, criarDicionarioWorker, analisar, palavrasParaConferir, init };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.Corretor = api;

  // Liga sozinho ao modal da nota (a CSP do app não permite script inline).
  function ligar() {
    const textarea = document.getElementById("note-content");
    const botao = document.getElementById("corretor-btn");
    const painel = document.getElementById("corretor-panel");
    if (!textarea || !botao || !painel) return;
    init({
      textarea, botao, painel,
      arquivos: { aff: "spell/pt.aff", dic: "spell/pt.dic" },
      indicadorPagina: document.getElementById("page-indicator"),
      modal: document.getElementById("note-modal")
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar);
  else ligar();
})(typeof window !== "undefined" ? window : globalThis);
