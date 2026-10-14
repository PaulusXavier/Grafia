import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  deleteField,
  terminate,
  clearIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- Elementos ---------- */
const offlineBanner = document.getElementById("offline-banner");

const mascotTemplate = document.getElementById("mascot-template");
const mascotSlot   = document.getElementById("mascot-slot");
const mascotSlotSm = document.getElementById("mascot-slot-sm");

// O mascote (um SVG) fica guardado uma única vez num <template> e é clonado
// para cada lugar que o usa — a tela de entrada (grande) e o topo do app
// (pequeno, via CSS) — em vez de repetir o mesmo desenho duas vezes no HTML.
function mountMascot(slot) {
  if (!slot || !mascotTemplate) return;
  slot.appendChild(mascotTemplate.content.cloneNode(true));
}
mountMascot(mascotSlot);
mountMascot(mascotSlotSm);

const loadingScreen = document.getElementById("loading-screen");
const authScreen   = document.getElementById("auth-screen");
const appScreen    = document.getElementById("app-screen");
const authForm     = document.getElementById("auth-form");
const authEmail    = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError    = document.getElementById("auth-error");
const authSubmit   = document.getElementById("auth-submit");
const authToggle   = document.getElementById("auth-toggle");
const logoutBtn    = document.getElementById("logout-btn");
const syncPill     = document.getElementById("sync-pill");
const syncStatus   = document.getElementById("sync-status");
const syncLabel    = document.getElementById("sync-label");

const newNoteBtn   = document.getElementById("new-note-btn");
const searchInput  = document.getElementById("search-input");
const notesList    = document.getElementById("notes-list");
const emptyState   = document.getElementById("empty-state");

const noteModal    = document.getElementById("note-modal");
const modalTitle   = document.getElementById("modal-title");
const modalClose   = document.getElementById("modal-close");
const modalFullscreenBtn = document.getElementById("modal-fullscreen-btn");
const noteForm     = document.getElementById("note-form");
const noteFormError = document.getElementById("note-form-error");
const noteTitle    = document.getElementById("note-title");
const noteDate     = document.getElementById("note-date");
const noteContent  = document.getElementById("note-content");
const pageIndicator = document.getElementById("page-indicator");
const pagePrevBtn  = document.getElementById("page-prev-btn");
const pageNextBtn  = document.getElementById("page-next-btn");
const addPageBtn   = document.getElementById("add-page-btn");
const deletePageBtn = document.getElementById("delete-page-btn");
const noteSaveBtn  = document.getElementById("note-save-btn");
const printBtn     = document.getElementById("print-note-btn");
const deleteBtn    = document.getElementById("delete-note-btn");
const attachBtn    = document.getElementById("attach-btn");
const attachInput  = document.getElementById("attach-input");
const attachmentsList = document.getElementById("attachments-list");

const toast        = document.getElementById("toast");

/* ---------- Estado ---------- */
let isSignUpMode = false;
let currentUser = null;
let unsubscribeNotes = null;
let allNotes = [];
let editingNoteId = null;
let pendingWritesCount = 0;
let seenNoteIds = new Set(); // ids já exibidos, para não reanimar cards a cada busca/atualização
let searchDebounceId = null;
let updateReady = false; // true quando há uma nova versão do app esperando para ser aplicada
let reloadingForUpdate = false;
let currentAttachments = []; // anexos da nota aberta no momento no modal
let attachmentsDirty = false; // true se anexos foram adicionados/removidos nesta edição
let currentPages = [""]; // páginas da nota aberta no momento no modal (uma nota pode ter várias)
let currentPageIndex = 0;
let isModalFullscreen = false; // tela cheia do modal de nota (bom para anotar reunião no tablet)

// Guardados como base64 dentro do próprio documento da nota (e não no Firebase
// Storage): assim os anexos entram no mesmo cache offline das notas e não
// exigem habilitar um serviço pago. Em troca, cada nota inteira precisa caber
// no limite de 1 MB do Firestore — por isso os limites abaixo.
//
// IMPORTANTE: base64 deixa o arquivo ~33% maior do que o tamanho original
// (3 bytes viram 4 caracteres). MAX_ATTACHMENTS_TOTAL por isso é comparado
// contra o tamanho JÁ CONVERTIDO (estimatedEncodedSize), não contra a soma
// dos arquivos originais — senão o app "aprovava" anexos, um a um, que juntos
// não cabiam de verdade na nota.
const MAX_ATTACHMENT_SIZE = 500 * 1024; // 500 KB por arquivo (antes de converter)
const MAX_ATTACHMENTS_TOTAL = 700 * 1024; // soma dos anexos JÁ EM BASE64
const MAX_ATTACHMENTS_COUNT = 5;
function estimatedEncodedSize(rawBytes) {
  return Math.ceil(rawBytes / 3) * 4; // mesma fórmula do base64
}
// O Firestore recusa documentos acima de ~1 MB. Com várias páginas de texto
// mais anexos, dá pra chegar perto disso — este limite avisa antes de tentar
// salvar, em vez de deixar o Firestore recusar com um erro genérico.
const MAX_NOTE_SIZE = 950 * 1024;

function reloadForUpdate() {
  if (reloadingForUpdate) return;
  reloadingForUpdate = true;
  window.location.reload();
}

/* ---------- Utilitários ---------- */
// Avisa o mascote (mascote.js) do que aconteceu; ele decide a reação.
function mascotEvent(evento) {
  window.dispatchEvent(new CustomEvent("grafia:mascote", { detail: { evento } }));
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  clearTimeout(showToast._h);
  showToast._t = setTimeout(() => {
    toast.classList.remove("show");
    showToast._h = setTimeout(() => (toast.hidden = true), 200);
  }, 2600);
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Junta o texto de todas as páginas de uma nota (para busca e prévia). Notas
// antigas, salvas antes de existir mais de uma página, ainda têm só "content".
function getNoteText(note) {
  if (Array.isArray(note.pages) && note.pages.length > 0) return note.pages.join("\n");
  return note.content || "";
}

function setButtonBusy(button, busy) {
  const label = button.querySelector(".btn-label");
  const spinner = button.querySelector(".btn-spinner");
  button.disabled = busy;
  if (spinner) spinner.hidden = !busy;
  if (label) label.style.opacity = busy ? "0" : "1";
}

// Data local (YYYY-MM-DD). toISOString() usa UTC e, no Brasil, devolve o dia
// seguinte a partir do fim da tarde.
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// O Firestore só resolve a Promise de escrita quando o SERVIDOR confirma; offline
// ela fica pendente (a escrita já está na fila local). Por isso não esperamos
// para sempre: erros rápidos (ex.: regra negada) ainda aparecem no formulário e,
// se demorar, tratamos como "salvo no aparelho".
function commitWrite(promise) {
  let timedOut = false;
  const timer = new Promise((resolve) =>
    setTimeout(() => { timedOut = true; resolve("queued"); }, navigator.onLine ? 4000 : 0)
  );
  promise.catch((err) => {
    if (!timedOut) return;
    console.error(err);
    showToast("Uma alteração não pôde ser sincronizada e foi desfeita.");
  });
  return Promise.race([promise.then(() => "synced"), timer]);
}

/* ---------- Estado de conexão / sincronização ---------- */
// Estados possíveis: "synced" (tudo salvo), "syncing" (enviando ou baixando
// dados), "offline" (sem rede — o Firestore guarda tudo local e envia depois).
function setSyncStatus(state) {
  syncStatus.classList.remove("sync-ok", "sync-busy", "sync-off");
  const labels = {
    synced: "Sincronizado",
    syncing: "Sincronizando…",
    offline: "Sem conexão"
  };
  const titles = {
    synced: "Tudo sincronizado",
    syncing: "Sincronizando…",
    offline: "Sem conexão — mudanças serão sincronizadas ao voltar online"
  };
  const cls = state === "synced" ? "sync-ok" : state === "syncing" ? "sync-busy" : "sync-off";
  syncStatus.classList.add(cls);
  syncLabel.textContent = labels[state] || labels.synced;
  syncPill.title = titles[state] || titles.synced;
}

function updateOfflineBanner() {
  const isOffline = !navigator.onLine;
  offlineBanner.hidden = !isOffline;
  if (isOffline) setSyncStatus("offline");
}

window.addEventListener("online", () => {
  updateOfflineBanner();
  setSyncStatus(pendingWritesCount > 0 ? "syncing" : "synced");
  showToast("Conexão restabelecida");
  mascotEvent("online");
});

window.addEventListener("offline", () => {
  updateOfflineBanner();
  mascotEvent("offline");
});

// Estado inicial: já mostra a faixa de offline se o app abrir sem conexão.
updateOfflineBanner();

/* ---------- Autenticação ---------- */
authToggle.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  authSubmit.querySelector(".btn-label").textContent = isSignUpMode ? "Criar conta" : "Entrar";
  authToggle.textContent = isSignUpMode
    ? "Já tenho conta — entrar"
    : "Ainda não tenho conta — criar acesso";
  authPassword.autocomplete = isSignUpMode ? "new-password" : "current-password";
  // Só exige 8+ caracteres para contas NOVAS — contas antigas com senha de
  // 6 caracteres continuam entrando normalmente.
  authPassword.minLength = isSignUpMode ? 8 : 6;
  authError.hidden = true;
});

document.getElementById("auth-reset").addEventListener("click", async () => {
  const email = authEmail.value.trim();
  if (!email) {
    authError.textContent = "Digite seu e-mail acima e toque de novo em “Esqueci minha senha”.";
    authError.hidden = false;
    authEmail.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    authError.hidden = true;
    showToast("Se o e-mail tiver conta, enviamos um link para redefinir a senha");
  } catch (err) {
    console.error(err);
    authError.textContent = friendlyAuthError(err.code, "reset");
    authError.hidden = false;
  }
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;

  if (!navigator.onLine) {
    authError.textContent = "Sem conexão. Conecte-se à internet para entrar ou criar sua conta.";
    authError.hidden = false;
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (isSignUpMode && password.length < 8) {
    authError.textContent = "A senha precisa ter pelo menos 8 caracteres.";
    authError.hidden = false;
    return;
  }

  setButtonBusy(authSubmit, true);
  try {
    if (isSignUpMode) {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast("Conta criada");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Login realizado");
    }
  } catch (err) {
    console.error(err);
    authError.textContent = friendlyAuthError(err.code);
    authError.hidden = false;
  } finally {
    setButtonBusy(authSubmit, false);
  }
});

// context "login": tela de entrar/criar conta (fala de senha faz sentido).
// context "reset": tela de "esqueci minha senha" (só pede e-mail — por isso
// nunca deve devolver uma frase que mencione "senha incorreta" ali).
function friendlyAuthError(code, context = "login") {
  const common = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas seguidas. Aguarde um momento e tente novamente.",
    "auth/network-request-failed": "Falha de rede. Verifique sua conexão e tente novamente.",
    "auth/user-disabled": "Esta conta foi desativada."
  };
  if (context === "reset") {
    return common[code] || "Não foi possível enviar o e-mail agora. Tente novamente em instantes.";
  }
  const loginOnly = {
    // "Conta não encontrada" e "Senha incorreta" foram unificadas de propósito:
    // mensagens diferentes para cada caso permitiriam a alguém descobrir, por
    // tentativa e erro, quais e-mails têm conta no app (enumeração de contas).
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Não foi possível concluir. Se você já tem conta, tente entrar.",
    "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres."
  };
  return common[code] || loginOnly[code] || "Não foi possível concluir. Tente novamente.";
}

logoutBtn.addEventListener("click", async () => {
  if (
    pendingWritesCount > 0 &&
    !confirm("Há notas que ainda não foram sincronizadas e seriam perdidas ao sair. Sair mesmo assim?")
  ) return;
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
    showToast("Não foi possível sair agora. Tente novamente.");
    return;
  }
  // Apaga as notas guardadas neste aparelho (importante em aparelho compartilhado).
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.error(err);
  }
  window.location.reload();
});

/* ---------- Atalhos do ícone e Compartilhar (Android) ---------- */
// Pressionar o ícone do app mostra "Nova nota" e "Buscar nas notas"
// (?acao=nova | ?acao=buscar), e o menu Compartilhar de qualquer app Android
// lista o Grafia (?title=&text=&url=), criando uma nota com o conteúdo.
// Os parâmetros são lidos já na abertura, limpos da barra de endereço (para
// um refresh não repetir a ação) e executados quando houver alguém logado.
let pendingLaunch = null;
(function readLaunchParams() {
  const q = new URLSearchParams(window.location.search);
  const acao = q.get("acao");
  const title = (q.get("title") || "").trim();
  const text = (q.get("text") || "").trim();
  const url = (q.get("url") || "").trim();
  if (title || text || url) {
    const partes = [text];
    if (url && !text.includes(url)) partes.push(url);
    const corpo = partes.filter(Boolean).join("\n\n");
    const primeiraLinha = (title || text || url).split(/\r?\n/)[0].trim();
    pendingLaunch = {
      tipo: "compartilhar",
      titulo: primeiraLinha.length > 60 ? primeiraLinha.slice(0, 57) + "…" : primeiraLinha,
      corpo
    };
  } else if (acao === "nova" || acao === "buscar") {
    pendingLaunch = { tipo: acao };
  }
  if (pendingLaunch || q.has("acao")) {
    try { history.replaceState(history.state, "", window.location.pathname); } catch (e) { /* ok */ }
  }
})();

function runPendingLaunch() {
  if (!pendingLaunch) return;
  const launch = pendingLaunch;
  pendingLaunch = null;
  if (launch.tipo === "nova") {
    openModal();
  } else if (launch.tipo === "buscar") {
    searchInput.focus();
    searchInput.scrollIntoView({ block: "center" });
  } else if (launch.tipo === "compartilhar") {
    openModal();
    // Depois do openModal, o conteúdo difere do "estado inicial" da nota: se a
    // pessoa fechar sem salvar, o app pergunta antes de descartar o que veio
    // do outro app.
    noteTitle.value = launch.titulo;
    currentPages[0] = launch.corpo;
    loadPageIntoTextarea();
    showToast("Conteúdo recebido — revise e salve");
  }
}

onAuthStateChanged(auth, (user) => {
  loadingScreen.hidden = true;
  currentUser = user;
  // Avisa o painel do Paulus (paulus-grafia.js): sem login ele não abre e, ao sair, é removido.
  window.__grafiaLogado = !!user;
  window.dispatchEvent(new CustomEvent("grafia:auth", { detail: { logado: !!user } }));
  if (user) {
    authScreen.hidden = true;
    appScreen.hidden = false;
    authForm.reset();
    listenToNotes(user.uid);
    runPendingLaunch();
  } else {
    appScreen.hidden = true;
    authScreen.hidden = false;
    if (unsubscribeNotes) { unsubscribeNotes(); unsubscribeNotes = null; }
    noteModal.hidden = true;
    document.body.classList.remove("modal-open", "kb-open");
    modalHistoryPushed = false;
    editingNoteId = null;
    searchInput.value = "";
    allNotes = [];
    seenNoteIds = new Set();
    renderNotes();
  }
});

/* ---------- Notas: leitura em tempo real ---------- */
function listenToNotes(uid) {
  if (unsubscribeNotes) unsubscribeNotes();
  setSyncStatus(navigator.onLine ? "syncing" : "offline");
  seenNoteIds = new Set();
  const notesRef = collection(db, "users", uid, "notes");
  const q = query(notesRef, orderBy("date", "desc"));

  unsubscribeNotes = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      // Mesma data: a mais recente primeiro. "estimate" evita createdAt nulo
      // enquanto a nota ainda está pendente de sincronização.
      allNotes = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort(
          (a, b) =>
            (b.date || "").localeCompare(a.date || "") ||
            (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        );
      renderNotes();

      const hadPending = pendingWritesCount > 0;
      pendingWritesCount = snapshot.docs.filter((d) => d.metadata.hasPendingWrites).length;

      if (!navigator.onLine) {
        setSyncStatus("offline");
      } else if (snapshot.metadata.fromCache || pendingWritesCount > 0) {
        setSyncStatus("syncing");
      } else {
        setSyncStatus("synced");
        // Só comemora quando havia algo esperando para subir (ex.: feito offline).
        if (hadPending && pendingWritesCount === 0 && !snapshot.metadata.fromCache) mascotEvent("sincronizado");
      }
    },
    (err) => {
      console.error(err);
      setSyncStatus("offline");
      showToast("Não foi possível atualizar as notas agora.");
    }
  );
}

function renderNotes() {
  const term = searchInput.value.trim().toLowerCase();
  // Acesso defensivo: title/content podem faltar em notas antigas ou criadas
  // manualmente no console do Firestore, sem passar pelo formulário.
  const filtered = term
    ? allNotes.filter(
        (n) =>
          (n.title || "").toLowerCase().includes(term) ||
          getNoteText(n).toLowerCase().includes(term)
      )
    : allNotes;

  notesList.innerHTML = "";
  emptyState.hidden = allNotes.length !== 0;

  if (filtered.length === 0 && allNotes.length > 0) {
    notesList.innerHTML = `<p class="no-results">Nenhuma nota encontrada para "${escapeHtml(
      searchInput.value
    )}".</p>`;
    return;
  }

  let newCardIndex = 0;
  filtered.forEach((note) => {
    const title = note.title || "";
    const content = getNoteText(note);
    const pageCount = Array.isArray(note.pages) ? note.pages.length : 1;
    const isNew = !seenNoteIds.has(note.id);

    const card = document.createElement("article");
    // A classe/animação de entrada só é aplicada a cards ainda não vistos.
    // Sem isso, toda tecla digitada na busca recriava e reanimava a lista
    // inteira, causando um efeito de "piscar" incômodo.
    card.className = isNew ? "note-card note-card-enter" : "note-card";
    if (isNew) {
      card.style.animationDelay = `${Math.min(newCardIndex, 8) * 30}ms`;
      newCardIndex += 1;
    }
    const dotsEl = document.createElement("div");
    dotsEl.className = "note-card-dots";
    dotsEl.setAttribute("aria-hidden", "true");
    dotsEl.innerHTML =
      '<span class="mini-dot mini-dot-red"></span>' +
      '<span class="mini-dot mini-dot-yellow"></span>' +
      '<span class="mini-dot mini-dot-green"></span>';
    // textContent (e não innerHTML): cortar texto já escapado quebrava
    // entidades como "&amp;" no meio da prévia.
    const dateEl = document.createElement("p");
    dateEl.className = "note-card-date";
    dateEl.textContent = formatDate(note.date);
    if (pageCount > 1) {
      const pagesSpan = document.createElement("span");
      pagesSpan.className = "note-card-attachments";
      pagesSpan.textContent = `· 📄 ${pageCount} páginas`;
      dateEl.append(" ", pagesSpan);
    }
    if (Array.isArray(note.attachments) && note.attachments.length > 0) {
      const attSpan = document.createElement("span");
      attSpan.className = "note-card-attachments";
      attSpan.textContent = `· 📎 ${note.attachments.length}`;
      dateEl.append(" ", attSpan);
    }
    const titleEl = document.createElement("h3");
    titleEl.className = "note-card-title";
    titleEl.textContent = title;
    const previewEl = document.createElement("p");
    previewEl.className = "note-card-preview";
    previewEl.textContent = content.slice(0, 140) + (content.length > 140 ? "…" : "");
    card.append(dotsEl, dateEl, titleEl, previewEl);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.addEventListener("click", () => openModal(note));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(note); }
    });
    notesList.appendChild(card);
  });

  allNotes.forEach((n) => seenNoteIds.add(n.id));
}

function escapeHtml(str = "") {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceId);
  searchDebounceId = setTimeout(renderNotes, 120);
});

/* ---------- Anexos ---------- */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Soma o tamanho REAL dos anexos já em base64 (o que de fato vai pro
// Firestore) — não o tamanho original dos arquivos, que é ~33% menor.
function attachmentsTotalSize(list) {
  return list.reduce((sum, a) => sum + (a.data ? a.data.length : 0), 0);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function downloadAttachment(att) {
  const link = document.createElement("a");
  link.href = att.data;
  link.download = att.name || "anexo";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function renderAttachments() {
  attachmentsList.innerHTML = "";
  attachmentsList.hidden = currentAttachments.length === 0;

  currentAttachments.forEach((att, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    const thumb = document.createElement("div");
    thumb.className = "attachment-thumb";
    if (att.type && att.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = att.data;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      thumb.textContent = "📄";
    }

    const info = document.createElement("div");
    info.className = "attachment-info";
    const nameEl = document.createElement("span");
    nameEl.className = "attachment-name";
    nameEl.textContent = att.name || "Arquivo";
    const sizeEl = document.createElement("span");
    sizeEl.className = "attachment-size";
    sizeEl.textContent = formatBytes(att.size || 0);
    info.append(nameEl, sizeEl);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "attachment-action";
    downloadBtn.title = "Baixar";
    downloadBtn.setAttribute("aria-label", `Baixar ${att.name || "arquivo"}`);
    downloadBtn.textContent = "⬇";
    downloadBtn.addEventListener("click", () => downloadAttachment(att));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachment-action attachment-remove";
    removeBtn.title = "Remover";
    removeBtn.setAttribute("aria-label", `Remover ${att.name || "arquivo"}`);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      currentAttachments.splice(index, 1);
      attachmentsDirty = true;
      renderAttachments();
      showToast("Anexo removido");
    });

    chip.append(thumb, info, downloadBtn, removeBtn);
    attachmentsList.appendChild(chip);
  });
}

attachBtn.addEventListener("click", () => attachInput.click());

attachInput.addEventListener("change", async () => {
  const files = Array.from(attachInput.files || []);
  attachInput.value = ""; // permite escolher de novo o mesmo arquivo depois de removê-lo
  let addedCount = 0;

  for (const file of files) {
    if (currentAttachments.length >= MAX_ATTACHMENTS_COUNT) {
      noteFormError.textContent = `Cada nota aceita no máximo ${MAX_ATTACHMENTS_COUNT} anexos.`;
      noteFormError.hidden = false;
      break;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      noteFormError.textContent = `"${file.name}" é maior que ${formatBytes(MAX_ATTACHMENT_SIZE)}. Escolha um arquivo menor.`;
      noteFormError.hidden = false;
      continue;
    }
    if (attachmentsTotalSize(currentAttachments) + estimatedEncodedSize(file.size) > MAX_ATTACHMENTS_TOTAL) {
      noteFormError.textContent = "Os anexos desta nota já somam o máximo permitido. Remova algum para adicionar outro.";
      noteFormError.hidden = false;
      continue;
    }
    try {
      const data = await fileToDataUrl(file);
      currentAttachments.push({ name: file.name, type: file.type || "", size: file.size, data });
      attachmentsDirty = true;
      addedCount += 1;
      noteFormError.hidden = true;
    } catch (err) {
      console.error(err);
      noteFormError.textContent = `Não foi possível ler "${file.name}".`;
      noteFormError.hidden = false;
    }
  }
  renderAttachments();
  if (addedCount > 0) {
    showToast(addedCount === 1 ? "Anexo adicionado" : `${addedCount} anexos adicionados`);
  }
});

/* ---------- Páginas dentro da nota ---------- */
// A textarea sempre mostra uma página por vez; o texto das outras fica
// guardado em currentPages. Atualiza a cada tecla para nunca perder nada ao
// trocar de página.
function loadPageIntoTextarea() {
  noteContent.value = currentPages[currentPageIndex] || "";
}

function updatePageNav() {
  pageIndicator.textContent = `Página ${currentPageIndex + 1} de ${currentPages.length}`;
  pagePrevBtn.disabled = currentPageIndex === 0;
  pageNextBtn.disabled = currentPageIndex === currentPages.length - 1;
  deletePageBtn.hidden = currentPages.length <= 1;
}

noteContent.addEventListener("input", () => {
  currentPages[currentPageIndex] = noteContent.value;
});

pagePrevBtn.addEventListener("click", () => {
  if (currentPageIndex === 0) return;
  currentPageIndex -= 1;
  loadPageIntoTextarea();
  updatePageNav();
});

pageNextBtn.addEventListener("click", () => {
  if (currentPageIndex === currentPages.length - 1) return;
  currentPageIndex += 1;
  loadPageIntoTextarea();
  updatePageNav();
});

addPageBtn.addEventListener("click", () => {
  currentPages.push("");
  currentPageIndex = currentPages.length - 1;
  loadPageIntoTextarea();
  updatePageNav();
  noteContent.focus();
  showToast(`Página ${currentPageIndex + 1} adicionada`);
});

deletePageBtn.addEventListener("click", () => {
  if (currentPages.length <= 1) return;
  if (!confirm(`Excluir a página ${currentPageIndex + 1}? O texto dela será perdido.`)) return;
  currentPages.splice(currentPageIndex, 1);
  currentPageIndex = Math.min(currentPageIndex, currentPages.length - 1);
  loadPageIntoTextarea();
  updatePageNav();
  showToast("Página excluída");
});

/* ---------- Modo tela cheia (anotações de reunião no tablet) ---------- */
// Além de expandir o modal via CSS (funciona em qualquer navegador), tenta
// também acionar a API de tela cheia REAL do navegador — em tablets Android
// isso esconde a barra de endereço, ganhando ainda mais espaço. No iOS
// Safari essa API não existe fora de app instalado; o modal expandido via
// CSS já garante o ganho de espaço mesmo assim.
function setModalFullscreen(on) {
  isModalFullscreen = on;
  noteModal.classList.toggle("is-fullscreen", on);
  modalFullscreenBtn.classList.toggle("is-active", on);
  modalFullscreenBtn.textContent = on ? "⤡" : "⛶";
  modalFullscreenBtn.title = on ? "Sair da tela cheia" : "Tela cheia";
  modalFullscreenBtn.setAttribute("aria-label", on ? "Sair da tela cheia" : "Tela cheia");
}

modalFullscreenBtn.addEventListener("click", async () => {
  setModalFullscreen(!isModalFullscreen);
  try {
    if (isModalFullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
      await noteModal.requestFullscreen();
    } else if (!isModalFullscreen && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (err) {
    // A API pode não existir ou ser recusada (comum no iOS) — sem problema,
    // a expansão via CSS acima já cobre a maior parte do ganho de espaço.
    console.warn("Tela cheia do navegador indisponível:", err);
  }
  noteContent.focus();
});

// Se o usuário sair da tela cheia REAL por fora do nosso botão (tecla Esc,
// gesto do sistema), mantém o app e o botão sincronizados com a realidade.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && isModalFullscreen) setModalFullscreen(false);
  // Em tela cheia real só aparece o que está DENTRO do elemento em tela cheia;
  // sem isto, avisos como "Página adicionada" ficavam invisíveis.
  (document.fullscreenElement || document.body).appendChild(toast);
});

/* ---------- Teclado virtual (tablet e celular) ---------- */
// Em iPad/Android o teclado na tela NÃO encolhe a página: ele fica por cima e
// esconde o que está embaixo (botão Salvar, campo do Paulus). A Visual
// Viewport API informa a área que realmente está visível; guardamos isso em
// variáveis CSS (--vv-h, --vv-top, --kb-inset) e numa classe no <body>
// (kb-open), e o style.css encaixa o modal e o painel do Paulus nessa área.
// Navegadores Android divergem: o Chrome por padrão só encolhe a área VISÍVEL
// (visualViewport) e deixa a página do tamanho original; Firefox e alguns
// Samsung Internet encolhem a própria página. Para os dois casos funcionarem,
// guardamos a altura "sem teclado" (baseH) e comparamos com a área visível.
let baseH = window.innerHeight;
function campoDeTextoEmFoco() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === "TEXTAREA") return true;
  return a.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "file"].includes(a.type);
}

function syncViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  // Sem campo em foco não há teclado: a altura atual é a referência (cobre
  // girar o tablet, barras do sistema aparecendo/sumindo etc.).
  baseH = campoDeTextoEmFoco() ? Math.max(baseH, window.innerHeight) : window.innerHeight;
  const hidden = window.innerHeight - vv.height - vv.offsetTop; // quanto do fim da página o teclado cobre
  const open = vv.scale <= 1.05 && baseH - vv.height > 80;       // >80px: é teclado, não barra do navegador
  if (open) {
    root.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
    root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty("--kb-inset", `${Math.max(0, Math.round(hidden))}px`);
  } else {
    root.style.removeProperty("--vv-h");
    root.style.removeProperty("--vv-top");
    root.style.removeProperty("--kb-inset");
  }
  document.body.classList.toggle("kb-open", open);
}

if (window.visualViewport) {
  let vvFrame = 0;
  const agendar = () => {
    if (vvFrame) return;
    vvFrame = requestAnimationFrame(() => { vvFrame = 0; syncViewport(); });
  };
  window.visualViewport.addEventListener("resize", agendar);
  window.visualViewport.addEventListener("scroll", agendar);
  window.addEventListener("resize", agendar);
  window.addEventListener("orientationchange", () => setTimeout(syncViewport, 300));
  // Ao fechar o teclado sem mexer no tamanho (alguns navegadores), reconfere.
  document.addEventListener("focusout", () => setTimeout(syncViewport, 250));
}

/* ---------- Botão "voltar" do Android ---------- */
// No app instalado, o "voltar" do sistema (botão ou gesto) fecha o APP INTEIRO
// se não houver histórico — com uma nota aberta, isso jogava o usuário para
// fora no meio da escrita. Ao abrir a nota guardamos uma entrada no histórico;
// assim o "voltar" só fecha a nota (com a mesma pergunta de descartar, se
// houver alterações), e uma segunda vez sai do app normalmente.
let modalHistoryPushed = false;
let ignoreNextPop = false;

function pushModalHistory() {
  if (modalHistoryPushed) return;
  try {
    history.pushState({ grafiaModal: true }, "");
    modalHistoryPushed = true;
  } catch (e) { /* sem histórico: o botão voltar age como antes */ }
}

function popModalHistory() {
  if (!modalHistoryPushed) return;
  modalHistoryPushed = false;
  ignoreNextPop = true; // o history.back() abaixo dispara popstate; não é o usuário
  setTimeout(() => { ignoreNextPop = false; }, 600); // trava de segurança
  history.back();
}

window.addEventListener("popstate", () => {
  if (ignoreNextPop) { ignoreNextPop = false; return; }
  if (noteModal.hidden) return;
  modalHistoryPushed = false; // o navegador já consumiu a entrada
  const hasChanges = formState() !== modalSnapshot || attachmentsDirty;
  if (hasChanges && !confirm("Descartar as alterações desta nota?")) {
    pushModalHistory(); // ficou na nota: recoloca a entrada para o próximo "voltar"
    return;
  }
  closeModal();
});

/* ---------- Modal: criar / editar ---------- */
function openModal(note = null) {
  editingNoteId = note ? note.id : null;
  modalTitle.textContent = note ? "Editar nota" : "Nova nota";
  noteTitle.value = note ? note.title || "" : "";
  noteDate.value = (note && note.date) || todayLocal();
  noteFormError.hidden = true;
  deleteBtn.hidden = !note;
  printBtn.hidden = !note;
  currentAttachments = note && Array.isArray(note.attachments)
    ? note.attachments.map((a) => ({ ...a }))
    : [];
  attachmentsDirty = false;
  renderAttachments();

  // Notas antigas (de antes de existir mais de uma página) só têm "content";
  // viram uma nota de página única.
  currentPages = note
    ? (Array.isArray(note.pages) && note.pages.length > 0 ? [...note.pages] : [note.content || ""])
    : [""];
  currentPageIndex = 0;
  loadPageIntoTextarea();
  updatePageNav();
  setModalFullscreen(false);

  modalSnapshot = formState();
  noteModal.hidden = false;
  document.body.classList.add("modal-open");
  pushModalHistory();
  syncViewport();
  // Em tela de toque, abrir uma nota que já existe NÃO foca o campo: o teclado
  // virtual subiria na hora e cobriria o texto que a pessoa quer ler. Nota
  // nova continua focando o título para já começar a digitar.
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  if (!note || !isTouch) setTimeout(() => noteTitle.focus(), 50);
}

let modalSnapshot = "";
const formState = () => JSON.stringify([noteTitle.value, noteDate.value, currentPages]);

function closeModal() {
  noteModal.hidden = true;
  document.body.classList.remove("modal-open");
  // Se há atualização esperando, o app vai recarregar logo abaixo; não mexe no
  // histórico agora para a volta não competir com o recarregamento.
  if (!updateReady) popModalHistory();
  if (isModalFullscreen) {
    setModalFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  editingNoteId = null;
  noteForm.reset();
  noteFormError.hidden = true;
  currentAttachments = [];
  attachmentsDirty = false;
  renderAttachments();
  currentPages = [""];
  currentPageIndex = 0;
  // Se uma nova versão do app chegou a ser instalada enquanto o usuário
  // editava uma nota, ela só é aplicada agora, ao fechar — assim nada do
  // que estava sendo digitado se perde.
  if (updateReady) reloadForUpdate();
}

newNoteBtn.addEventListener("click", () => openModal());
function requestClose() {
  const hasChanges = formState() !== modalSnapshot || attachmentsDirty;
  if (hasChanges && !confirm("Descartar as alterações desta nota?")) return;
  closeModal();
}
modalClose.addEventListener("click", requestClose);
// Só fecha se o clique COMEÇOU no fundo: selecionar texto e soltar o mouse
// fora do modal não pode descartar o que foi digitado.
let backdropPressed = false;
noteModal.addEventListener("pointerdown", (e) => { backdropPressed = e.target === noteModal; });
noteModal.addEventListener("click", (e) => {
  if (e.target === noteModal && backdropPressed) requestClose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !noteModal.hidden) {
    if (document.fullscreenElement) return; // deixa o navegador só sair da tela cheia
    requestClose();
  }
  // Ctrl/Cmd+Enter salva de qualquer campo do modal (inclusive da textarea,
  // onde Enter sozinho só quebra linha).
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !noteModal.hidden) {
    e.preventDefault();
    noteForm.requestSubmit();
  }
  // Ctrl+S (tablet com teclado, ex.: capa-teclado ou Samsung DeX).
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S") && !noteModal.hidden) {
    e.preventDefault();
    noteForm.requestSubmit();
  }
});

// No campo Título, a tecla Enter do teclado virtual (e do físico) salvaria a
// nota — com o texto ainda vazio, só dava erro. Agora ela pula para o texto.
noteTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    noteContent.focus();
  }
});

noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  noteFormError.hidden = true;
  const pages = currentPages.map((p) => p ?? "");
  const hasContent = pages.some((p) => p.trim().length > 0);
  const payload = {
    title: noteTitle.value.trim(),
    pages,
    date: noteDate.value,
    attachments: currentAttachments,
    updatedAt: serverTimestamp()
  };
  if (!payload.title || !hasContent) {
    noteFormError.textContent = "Preencha o título e o conteúdo de ao menos uma página.";
    noteFormError.hidden = false;
    return;
  }
  if (new Blob([JSON.stringify(payload)]).size > MAX_NOTE_SIZE) {
    noteFormError.textContent = "Esta nota ficou grande demais para salvar. Remova algum anexo ou reduza o texto das páginas.";
    noteFormError.hidden = false;
    return;
  }

  setButtonBusy(noteSaveBtn, true);
  try {
    const notesRef = collection(db, "users", currentUser.uid, "notes");
    const wasEditing = !!editingNoteId;
    // "content" é o campo antigo de página única; some ao editar uma nota
    // criada antes de existirem várias páginas.
    const write = wasEditing
      ? updateDoc(doc(notesRef, editingNoteId), { ...payload, content: deleteField() })
      : setDoc(doc(notesRef), { ...payload, createdAt: serverTimestamp() });
    const result = await commitWrite(write);
    showToast(
      result === "synced"
        ? (wasEditing ? "Nota atualizada" : "Nota criada")
        : "Salvo no aparelho — será sincronizado quando a internet voltar"
    );
    closeModal();
    mascotEvent(result === "synced" ? "nota-salva" : "nota-salva-offline");
  } catch (err) {
    console.error(err);
    mascotEvent("erro");
    noteFormError.textContent = "Não foi possível salvar. Verifique os dados e tente novamente.";
    noteFormError.hidden = false;
  } finally {
    setButtonBusy(noteSaveBtn, false);
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!editingNoteId || !currentUser || deleteBtn.disabled) return;
  if (!confirm("Excluir esta nota? Essa ação não pode ser desfeita.")) return;
  deleteBtn.disabled = true;
  try {
    const notesRef = collection(db, "users", currentUser.uid, "notes");
    const result = await commitWrite(deleteDoc(doc(notesRef, editingNoteId)));
    showToast(result === "synced" ? "Nota excluída" : "Exclusão salva — será sincronizada ao voltar a conexão");
    closeModal();
    mascotEvent("nota-excluida");
  } catch (err) {
    console.error(err);
    mascotEvent("erro");
    noteFormError.textContent = "Não foi possível excluir. Tente novamente.";
    noteFormError.hidden = false;
  } finally {
    deleteBtn.disabled = false;
  }
});

/* ---------- Impressão ---------- */
printBtn.addEventListener("click", () => {
  document.getElementById("print-date").textContent = formatDate(noteDate.value);
  document.getElementById("print-title").textContent = noteTitle.value;
  const printContent = document.getElementById("print-content");
  printContent.innerHTML = "";
  const totalPages = currentPages.length;
  currentPages.forEach((pageText, index) => {
    const pageBlock = document.createElement("div");
    pageBlock.className = "print-page";
    if (totalPages > 1) {
      const label = document.createElement("p");
      label.className = "print-page-label";
      label.textContent = `Página ${index + 1} de ${totalPages}`;
      pageBlock.appendChild(label);
    }
    const p = document.createElement("p");
    p.className = "print-page-text";
    p.textContent = pageText;
    pageBlock.appendChild(p);
    printContent.appendChild(pageBlock);
  });
  window.print();
});

/* ---------- Service Worker: atualização automática ---------- */
// Quando uma nova versão do app é publicada (ex.: no GitHub Pages), o
// navegador baixa o novo service-worker.js sozinho. Como o service worker já
// chama skipWaiting()/clients.claim(), ele assume o controle na hora — falta
// só recarregar a página para os arquivos novos (HTML/CSS/JS) entrarem em
// uso. É isso que o trecho abaixo faz, sem exigir nenhuma ação do usuário.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registration) => {
        // Verifica se já existe uma versão nova sempre que o app volta a
        // ficar em primeiro plano (ex.: usuário reabre depois de um tempo).
        // Os navegadores já fazem essa checagem sozinhos periodicamente;
        // isso só antecipa a verificação.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            registration.update().catch(() => {});
          }
        });
        // Também verifica a cada 15 minutos (app aberto o dia todo) e quando
        // a internet volta.
        setInterval(() => registration.update().catch(() => {}), 15 * 60 * 1000);
        window.addEventListener("online", () => registration.update().catch(() => {}));
      })
      .catch((err) => console.error("Falha ao registrar service worker:", err));
  });

  // Na primeira visita não há controller anterior: o clients.claim() do SW
  // causaria um reload desnecessário (apagando o que estivesse digitado).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    // Se o usuário estiver com o modal de nota aberto (editando ou criando),
    // adia o recarregamento até ele fechar o modal — closeModal() cuida
    // disso ao checar "updateReady". Caso contrário, recarrega na hora.
    if (!noteModal.hidden) {
      updateReady = true;
      showToast("Nova versão do app pronta — será aplicada ao fechar esta nota");
      mascotEvent("atualizacao");
      return;
    }
    reloadForUpdate();
  });
}
