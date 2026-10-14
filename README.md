# Bloco de Notas · Paulo Xavier, CRP-20/09816

Bloco de notas pessoal, instalável como app (PWA), com sincronização automática
entre todos os dispositivos onde você fizer login — e funciona também sem
internet.

## 1. Firebase (já configurado)

O projeto `bloco-notas-paulo-xavier` já está configurado em `firebase-config.js`.
No console do Firebase, confirme que:

1. Em **Authentication → Sign-in method**, o provedor **E-mail/senha** está ativado.
2. Em **Firestore Database**, o banco foi criado (região `southamerica-east1`,
   se disponível).
3. Em **Firestore Database → Regras**, o conteúdo de `firestore.rules` deste
   projeto foi colado e publicado — isso garante que cada pessoa só enxerga
   as próprias notas.

## 2. Publicar no GitHub Pages

1. Suba **todos os arquivos desta pasta, direto na raiz do repositório**
   `PaulusXavier/Bloco-de-Notas-PX-` (sem subpastas `css/`, `js/` ou `icons/`).
2. Vá em **Settings → Pages**, selecione a branch `main` e a pasta raiz (`/`).
3. Aguarde alguns minutos — o site fica disponível em
   `https://paulusxavier.github.io/Bloco-de-Notas-PX-/`.

## 3. Instalar nos aparelhos

Abra o link gerado pelo GitHub Pages no celular ou computador e use a opção
"Adicionar à tela inicial" (Android/celular) ou o ícone de instalação na
barra de endereço (computador). Faça login com o mesmo e-mail e senha em
cada aparelho — as notas aparecem sincronizadas automaticamente.

## Funciona offline

- As notas ficam guardadas também no aparelho (cache local do Firestore).
  Se a internet cair, você continua vendo, criando, editando e excluindo
  notas normalmente.
- Uma faixa amarela avisa quando o app está sem conexão.
- O indicador no topo mostra três estados: **Sincronizado**, **Sincronizando…**
  e **Sem conexão**.
- Assim que a internet voltar, tudo o que foi feito offline é enviado
  automaticamente — não é preciso fazer nada manualmente.

## Atualiza sozinho

Sempre que você publicar uma versão nova destes arquivos no GitHub Pages, o
app já instalado nos aparelhos detecta a mudança sozinho (o navegador
verifica isso quando o app é reaberto ou volta ao primeiro plano) e recarrega
automaticamente para usar a versão nova — sem precisar desinstalar, limpar
cache ou clicar em nada. Se isso acontecer bem no momento em que uma nota
está aberta para edição, o app espera você fechá-la antes de recarregar, para
não perder o que ainda não foi salvo.

## Estrutura do projeto

Todos os arquivos ficam soltos na raiz do repositório (sem subpastas):

```
index.html              → tela de login + tela principal do app
style.css                → todo o visual (paleta linho/sálvia/ocre)
firebase-config.js       → chaves do projeto Firebase (já preenchidas)
app.js                   → autenticação, CRUD de notas e sincronização
manifest.json            → configuração de instalação (PWA)
service-worker.js        → cache do app para funcionar offline
firestore.rules          → regras de segurança do banco de dados
icon-192.png, icon-192-maskable.png,
icon-512.png, icon-512-maskable.png → ícones do app
```

## Celular e tablet

Como o uso principal é pelo celular e tablet instalados como app, o visual
tem alguns ajustes pensados especificamente para toque:

- Os campos de texto usam letra de pelo menos 16px — abaixo disso o Safari
  do iPhone dá zoom sozinho ao tocar no campo, o que já foi corrigido aqui.
- O cabeçalho do app quebra a linha em vez de estourar a tela em celulares
  mais estreitos.
- Botões pequenos (fechar nota, baixar/remover anexo, navegar entre
  páginas) ficam maiores especificamente em telas de toque, sem mudar o
  visual no computador.
- Em tablets (e telas a partir de ~700px de largura), a lista de notas usa
  mais de uma coluna para aproveitar o espaço, em vez de ficar esticada
  numa coluna só.

## Melhorias visuais e de uso

- Cada nota (nos cartões da lista e na janela de edição) tem uma pequena
  barra com três bolinhas coloridas, no estilo das janelas do macOS.
  No modal, a bolinha vermelha fecha a nota.
- Dentro do modal, **Ctrl+Enter** (ou **Cmd+Enter** no Mac) salva a nota na
  hora, sem precisar tirar a mão do teclado.
- Se uma nota (texto de todas as páginas + anexos) ficar grande demais para
  o Firestore, o app avisa antes de tentar salvar, em vez de dar um erro
  confuso.

## Páginas

Cada nota pode ter **mais de uma página**. Ao abrir uma nota (nova ou
existente), acima do campo de texto aparece o indicador "Página 1 de 1"; os
botões abaixo do campo permitem:

- **+ Nova página** — adiciona uma página em branco e já muda para ela.
- **◀ Anterior / Próxima ▶** — navega entre as páginas já criadas.
- **Excluir página** — remove a página atual (só aparece quando a nota tem
  mais de uma página).

O texto de cada página fica guardado separadamente; trocar de página nunca
apaga o que foi escrito nas outras. Ao salvar, todas as páginas são gravadas
juntas na nota. Na lista de notas, o cartão mostra "📄 N páginas" quando a
nota tem mais de uma. Ao imprimir (🖨️), cada página sai numa folha separada.

Notas criadas antes desta função continuam funcionando normalmente, como
notas de uma página só.

## Anexos

Cada nota aceita até **5 arquivos, de até 500 KB cada** (imagens, PDF, Word,
texto), somando no máximo ~700 KB. Ao abrir uma nota, toque em "📎 Anexar
arquivo" para escolher um ou mais arquivos; eles aparecem numa lista com
nome, tamanho, botão de baixar (⬇) e de remover (✕) antes mesmo de salvar a
nota.

Os anexos são guardados **dentro do próprio documento da nota no Firestore**
(convertidos para texto/base64), e não no Firebase Storage. Isso foi proposital:

- Funcionam offline pelo mesmo cache local das notas — sem precisar de mais
  nenhuma configuração no Firebase.
- Não exigem habilitar o Firebase Storage, que hoje pede um plano pago
  (Blaze) mesmo para uso pequeno.
- Em troca, o Firestore limita cada nota (texto + anexos somados) a 1 MB.
  A conversão para base64 deixa cada arquivo ~33% maior do que o tamanho
  original — os limites de 500 KB por arquivo e ~700 KB no total já contam
  com essa margem, para o app nunca "aceitar" um anexo que depois não coube
  de verdade na nota. Esses limites estão no topo do arquivo `app.js`, nas
  constantes `MAX_ATTACHMENT_SIZE`, `MAX_ATTACHMENTS_TOTAL` e
  `MAX_ATTACHMENTS_COUNT`, caso queira ajustá-los.

Se no futuro os anexos precisarem ser maiores (fotos em alta resolução,
vídeos etc.), o caminho é migrar para o **Firebase Storage**, guardando ali
os arquivos e salvando na nota apenas o link — isso exigiria habilitar o
plano Blaze no projeto.

## Corretor

Dentro da nota, o botão **✓ Corretor** (ao lado da navegação de páginas) confere
a página aberta e lista cada ponto com botões de correção: ortografia (com
sugestões), palavra repetida, espaço duplicado, espaço antes/depois de
pontuação, frase iniciada com minúscula e erros comuns (“afim de”, “a nível
de”, “houveram”…). Também há **Ignorar** e **Adicionar ao dicionário** (guardado
só neste aparelho).

- **Automático:** o corretor confere sozinho ao abrir a nota, ao trocar de página
  e quando você faz uma pausa na digitação. Se achar algo, o painel abre com as
  correções e o botão mostra a quantidade (“✓ Corretor · 3”). Dá para desligar na
  caixa “Verificar sozinho enquanto escrevo” do painel; o ✕ esconde o painel só
  nesta nota.
- **Privacidade:** tudo roda no aparelho, o texto da nota não é enviado a lugar
  nenhum.
- **Dicionário:** `dicionario-pt.aff` e `dicionario-pt.dic` (Hunspell, pt-BR). O
  workflow `auto-versao.yml` baixa os dois na primeira publicação e os grava no
  repositório (precisa do *Read and write permissions*, já pedido acima). Se
  preferir, coloque você mesmo esses dois arquivos na raiz. Sem eles, o corretor
  funciona só com as regras de escrita e avisa isso no painel.
- Arquivos: `corretor.js` (motor + painel), estilos no fim de `style.css`.

## Grafi, o mascote

Estados (atributo `data-estado`): `repouso`, `pensando`, `escrevendo`, `atento`,
`duvida`, `ouvindo`, `dormindo` (com "zzz") e `feliz` (com estrelinhas). Além
disso, em `mascote.js`:

- os olhos seguem o dedo/cursor;
- toque no mascote da tela de entrada: pulinho e uma frase;
- balão de fala reage a eventos: nota salva, salva offline, excluída, tudo
  sincronizado, internet voltou/caiu, erro, versão nova pronta;
- saudação por hora do dia ao abrir e ao entrar;
- cochila após 2 min sem uso e acorda ao mexer;
- fica "ouvindo" enquanto você digita uma nota;
- respeita `prefers-reduced-motion` e nunca interrompe o Paulus trabalhando.

Para disparar uma reação de outro ponto do app:
`window.dispatchEvent(new CustomEvent('grafia:mascote', {detail:{evento:'nota-salva'}}))`.

## Publicar uma nova versão

Basta enviar (commit/push ou upload) os arquivos alterados para a branch `main`.
O workflow `.github/workflows/auto-versao.yml` atualiza sozinho o `CACHE_NAME`
em `service-worker.js`, e os aparelhos detectam e aplicam a atualização. Não é
mais preciso mexer em número de versão. (No GitHub, em Settings → Actions →
General → Workflow permissions, deixe **Read and write permissions**.)

## Paulus (assistente de IA)

Ao tocar no mascote do topo (com a conta logada) abre o painel do **Paulus**, o copiloto compartilhado
pelos apps (Argo SUAS, Anona, Toth, Umbrella). Ele explica o app, abre uma nota em branco, vai para a busca e
tira dúvidas do SUAS e da prática da psicologia, citando a norma quando usa uma.

- **Não lê as notas.** Não vê títulos, textos, páginas nem anexos, e não busca dentro delas. Pergunta com nome,
  documento, telefone ou endereço é bloqueada no aparelho, antes de qualquer envio.
- Arquivos: `paulus.v1.js` e `conhecimento.json` (cópias do Paulus, pacote *geral*) e `paulus-grafia.js` (a ligação).
- O endereço do Worker fica em `ENDPOINT`, no topo de `paulus-grafia.js`. O Worker precisa estar publicado com o
  app `grafia` (veja `docs/INTEGRACAO.md` do Paulus).
- Para atualizar o Paulus: `npm run build` no projeto dele e copie `dist/paulus.v1.js` e
  `dist/conhecimento-geral.json` (como `conhecimento.json`). Depois aumente o `CACHE_NAME` do service worker.

## Segurança

Reforços já aplicados no código:

- **Regras do Firestore** (`firestore.rules`) agora, além de checar se a nota
  pertence a quem está gravando, validam o formato dos dados (título, data,
  quantidade de páginas e de anexos) — antes, qualquer campo em qualquer
  formato era aceito, desde que fosse na pasta do próprio usuário.
- **Mensagens de login** não revelam mais se um e-mail tem conta ou não
  ("E-mail ou senha incorretos" em vez de "conta não encontrada" / "senha
  incorreta" separadas) — evita que alguém descubra, por tentativa e erro,
  quem usa o app.
- **Senha mínima de 8 caracteres** para contas novas (contas já existentes
  com 6 caracteres continuam funcionando normalmente).
- **Content-Security-Policy** no `index.html`: o navegador só executa
  scripts deste site e do Firebase, e só conecta aos domínios do próprio
  Firebase — uma camada extra de proteção contra injeção de código, mesmo
  que não haja nenhuma brecha conhecida hoje.

Depois de publicar estes arquivos, ainda vale fazer no **Console do
Firebase** (não é algo que se resolve por código):

1. **Cole as novas regras**: em Firestore Database → Regras, substitua pelo
   conteúdo atualizado de `firestore.rules` e publique.
2. **Desative novos cadastros**: em Authentication → Settings → User
   actions, desmarque "Enable create (sign-up)" depois de criar seu próprio
   acesso. Assim ninguém mais cria conta pelo link público.
3. **Ative o App Check** (Authentication/App Check no menu lateral), com
   reCAPTCHA v3 para Web. Isso impede que alguém use as chaves do projeto
   (que ficam visíveis em `firebase-config.js`, como em qualquer app Firebase)
   fora do seu site para tentar login em massa ou gastar sua cota.
4. Em Authentication → Settings → Segurança, se disponível para o seu
   plano, ative **"Proteção contra enumeração de e-mail"** — reforça no lado
   do próprio Firebase o mesmo cuidado já feito nas mensagens de erro do app.

Sobre a chave em `firebase-config.js`: ela **não é um segredo** (toda
aplicação Firebase expõe essa chave no navegador) — quem protege os dados
de verdade são as regras do Firestore e o login, por isso os passos acima
importam mais do que "esconder" a chave.

- Ao sair (⏻), as notas guardadas no aparelho são apagadas — isso protege
  aparelhos compartilhados.
