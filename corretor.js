/* Corretor do Grafia
 *
 * Tudo roda no aparelho: o texto das notas NUNCA sai daqui (nada é enviado a
 * servidor nenhum, no mesmo espírito do Paulus, que não lê as notas).
 *
 * Duas camadas:
 *  1. Ortografia, com um dicionário Hunspell de português do Brasil
 *     (dicionario-pt.aff / dicionario-pt.dic, instalados pelo workflow do
 *     GitHub — veja .github/workflows/auto-versao.yml). Sem esses arquivos o
 *     corretor continua funcionando, só sem a parte de ortografia.
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

    function carregarDic(texto) {
      const linhas = texto.split(/\r?\n/);
      for (let i = 1; i < linhas.length; i++) { // linha 0 = quantidade
        const l = linhas[i];
        if (!l || l[0] === "#") continue;
        const sp = l.indexOf(" ");
        const entrada = sp === -1 ? l : l.slice(0, sp);
        const barra = entrada.indexOf("/");
        const palavra = barra === -1 ? entrada : entrada.slice(0, barra);
        if (!palavra) continue;
        const flags = barra === -1 ? "" : lerFlags(entrada.slice(barra + 1));
        const antes = palavras.get(palavra);
        if (antes === undefined) palavras.set(palavra, flags);
        else if (flags) palavras.set(palavra, Array.isArray(flags) ? [...antes, ...flags] : antes + flags);
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
      carregarAff, carregarDic, checar, sugerir,
      get pronto() { return pronto; },
      get tamanho() { return palavras.size; }
    };
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
      const re = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu;
      for (const m of texto.matchAll(re)) {
        const w = m[0].replace(/’/g, "'");
        if (w.length < 2 || ignoradas.has(w.toLocaleLowerCase(LANG))) continue;
        const antes = texto[m.index - 1], depois = texto[m.index + m[0].length];
        if (/\d/.test(antes || "") || /\d/.test(depois || "")) continue; // 3ª, 10h…
        if (w === w.toLocaleUpperCase(LANG) && w.length <= 6) continue; // siglas (CRP, SUAS)
        if (/\p{Ll}\p{Lu}/u.test(w)) continue; // iPhone, WhatsApp
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
    const dic = criarDicionario();
    let carregamento = null; // Promise
    let dicionarioOk = false;
    const ignoradas = new Set();
    const CHAVE = "grafia-dicionario-pessoal";
    const CHAVE_AUTO = "grafia-corretor-auto";
    const ignoradasAgora = new Set(); // "Ignorar" vale só para esta nota aberta
    let automatico = true;            // verifica sozinho enquanto escreve
    let silenciado = false;           // o usuário fechou o painel (✕) nesta nota
    let falhouEm = 0;                 // dicionário ausente: não insiste a cada pausa
    let temporizador = null;
    let ultimoTexto = null;
    const ROTULO = "✓ Corretor";

    try {
      JSON.parse(localStorage.getItem(CHAVE) || "[]").forEach((w) => ignoradas.add(w));
      automatico = localStorage.getItem(CHAVE_AUTO) !== "0";
    } catch (e) { /* sem armazenamento: só vale nesta sessão */ }

    function guardarPalavra(w) {
      ignoradas.add(w.toLocaleLowerCase(LANG));
      try { localStorage.setItem(CHAVE, JSON.stringify([...ignoradas])); } catch (e) { /* ok */ }
    }

    async function baixar(url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url + " " + r.status);
      return r;
    }

    function carregarDicionario(forcar) {
      if (!carregamento && (forcar || Date.now() - falhouEm > 60000)) {
        carregamento = (async () => {
          try {
            const [rAff, rDic] = await Promise.all([baixar(arquivos.aff), baixar(arquivos.dic)]);
            const bufAff = await rAff.arrayBuffer();
            const bufDic = await rDic.arrayBuffer();
            const cab = new TextDecoder("latin1").decode(bufAff.slice(0, 400));
            const set = (cab.match(/^SET\s+(\S+)/m) || [])[1] || "UTF-8";
            const dec = new TextDecoder(/utf-?8/i.test(set) ? "utf-8" : set);
            dic.carregarAff(dec.decode(bufAff));
            dic.carregarDic(dec.decode(bufDic));
            dicionarioOk = dic.pronto;
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

    function analisarAgora() {
      const todos = analisar(textarea.value, dicionarioOk ? dic : null, ignoradas);
      return todos.filter((p) => !ignoradasAgora.has(p.tipo + "|" + p.trecho));
    }

    function aplicar(p, substituto) {
      const v = textarea.value;
      // o texto pode ter mudado desde a análise: confere antes de trocar
      if (v.slice(p.inicio, p.fim) !== p.trecho) return rodar();
      textarea.value = v.slice(0, p.inicio) + substituto + v.slice(p.fim);
      textarea.dispatchEvent(new Event("input", { bubbles: true })); // o app guarda a página
      rodar();
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
      x.addEventListener("click", () => { silenciado = true; fechar(); });
      topo.append(x);
      painel.append(topo);

      const auto = el("label", "corretor-auto");
      const cx = el("input");
      cx.type = "checkbox";
      cx.checked = automatico;
      cx.addEventListener("change", () => {
        automatico = cx.checked;
        try { localStorage.setItem(CHAVE_AUTO, automatico ? "1" : "0"); } catch (e) { /* ok */ }
        if (automatico) { silenciado = false; verificar(); }
        else { clearTimeout(temporizador); }
      });
      auto.append(cx, " Verificar sozinho enquanto escrevo");
      painel.append(auto);

      if (!dicionarioOk) {
        painel.append(el("p", "corretor-aviso",
          "Dicionário de ortografia ainda não instalado neste aparelho — verificando só pontuação, espaços e erros comuns."));
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
          rodar();
        });
        acoes.append(ig);
        if (p.podeAdicionar) {
          const ad = el("button", "corretor-ign", "Adicionar ao dicionário");
          ad.type = "button";
          ad.addEventListener("click", () => { guardarPalavra(p.trecho); rodar(); });
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
      silenciado = false;
      botao.setAttribute("aria-expanded", "true");
      if (!dic.pronto && !carregamento) {
        painel.replaceChildren(el("p", "corretor-aviso", "Carregando dicionário…"));
      }
      await carregarDicionario(true);
      const problemas = analisarAgora();
      marcarBotao(problemas.length);
      desenhar(problemas);
    }

    // Automático: confere sozinho e só abre o painel se houver algo a revisar.
    async function verificar() {
      if (!automatico || (modal && modal.hidden)) return;
      const texto = textarea.value;
      if (!texto.trim()) { ultimoTexto = texto; marcarBotao(0); fechar(); return; }
      await carregarDicionario(false);
      if (textarea.value !== texto) return; // continuou digitando: a próxima pausa confere
      ultimoTexto = texto;
      const problemas = analisarAgora();
      marcarBotao(problemas.length);
      if (!problemas.length) { fechar(); return; }
      if (silenciado) return;
      painel.hidden = false;
      botao.setAttribute("aria-expanded", "true");
      desenhar(problemas);
    }

    function agendar(ms) {
      if (!automatico) return;
      clearTimeout(temporizador);
      temporizador = setTimeout(verificar, ms);
    }

    textarea.addEventListener("input", () => {
      if (textarea.value !== ultimoTexto) agendar(900); // espera uma pausa na digitação
    });

    botao.addEventListener("click", () => { painel.hidden ? rodar() : fechar(); });

    // Ao trocar de página ou abrir/fechar a nota, o painel (que mostra o texto
    // antigo) deixa de valer; se a nota está aberta, confere de novo sozinho.
    function reiniciar() {
      clearTimeout(temporizador);
      silenciado = false;
      ultimoTexto = null;
      ignoradasAgora.clear();
      fechar();
      marcarBotao(0);
      if (!modal || !modal.hidden) agendar(500);
    }
    if (indicadorPagina) {
      new MutationObserver(reiniciar).observe(indicadorPagina, { childList: true, characterData: true, subtree: true });
    }
    if (modal) {
      new MutationObserver(reiniciar).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    }

    return { rodar, verificar, fechar };
  }

  const api = { criarDicionario, analisar, init };
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
      arquivos: { aff: "dicionario-pt.aff", dic: "dicionario-pt.dic" },
      indicadorPagina: document.getElementById("page-indicator"),
      modal: document.getElementById("note-modal")
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar);
  else ligar();
})(typeof window !== "undefined" ? window : globalThis);
