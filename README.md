# DevCord

Um app estilo Discord (perfis, servidores, canais de texto/voz/fórum, upload de mídia,
figurinhas, banners, chamadas de voz/vídeo) rodando 100% no navegador, com
**Firebase Authentication + Realtime Database** (grátis, sem cartão) e
**Cloudinary** para upload de arquivos (grátis, sem cartão). Pronto pra hospedar
de graça no GitHub Pages.

## 1. Configure o Firebase (uma vez só)

No [Console do Firebase](https://console.firebase.google.com/), projeto `devcord-4dcf6`:

1. **Authentication → Sign-in method** → ative **Email/senha**.
2. **Realtime Database** → se ainda não existe, crie (modo bloqueado) → aba **Regras**
   → cole o conteúdo de `database.rules.json` deste projeto → **Publicar**.
3. **Authentication → Settings → Domínios autorizados** → adicione o domínio que o
   GitHub Pages vai te dar (ex: `seu-usuario.github.io`).

Sem o passo 2, o app abre mas ninguém consegue ler/escrever nada (o Realtime
Database vem bloqueado por padrão).

> Não usamos o Firebase Storage porque ele passou a exigir o plano pago Blaze
> mesmo pra usar a cota grátis. Auth e Realtime Database continuam 100% grátis,
> sem cartão de crédito, mesmo no plano Spark.

## 2. Configure o Cloudinary (upload de imagens/vídeos, grátis, sem cartão)

1. Crie uma conta grátis em [cloudinary.com](https://cloudinary.com/users/register/free).
2. No painel, copie o **Cloud name** (aparece no topo do Dashboard).
3. Vá em **Settings → Upload → Upload presets → Add upload preset**:
   - **Signing Mode**: troque para **Unsigned**.
   - Dê um nome memorável pro preset (ex: `devcord_unsigned`) e salve.
4. Abra `cloudinary.js` neste projeto e troque:
   ```js
   const CLOUD_NAME = "TROQUE_PELO_SEU_CLOUD_NAME";
   const UPLOAD_PRESET = "TROQUE_PELO_SEU_UPLOAD_PRESET";
   ```
   pelos valores dos passos 2 e 3.

O plano grátis do Cloudinary dá 25GB de armazenamento e 25GB de banda por mês —
de sobra pra começar.

## 3. Suba pro GitHub Pages

```bash
git init
git add .
git commit -m "DevCord"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/devcord.git
git push -u origin main
```

No repositório: **Settings → Pages → Source: `main` / (root)** → salvar. Em alguns
minutos o app fica em `https://SEU-USUARIO.github.io/devcord/`.

## 4. Usando o app

- **Cadastro/login**: aba "Criar conta" ou "Entrar" na tela inicial.
- **Criar servidor**: clique no `+` na barra lateral esquerda → digite `criar`.
- **Entrar em servidor existente**: clique no `+` → cole o ID do servidor (o dono
  encontra esse ID clicando na engrenagem ⚙ ao lado do nome do servidor).
- **Criar canal**: dentro de um servidor, clique no `+` ao lado de "Canais de texto/
  voz/fóruns", ou pela engrenagem ⚙.
- **Perfil**: ✎ no cartão de usuário (canto inferior esquerdo) — foto, banner, nome,
  bio, cor de destaque, fonte do nick, e links de redes sociais.
- **Figurinhas**: no chat, botão 🩹 abre o seletor; o `+` no seletor sobe uma imagem
  como figurinha nova (fica salva no seu perfil pra sempre).
- **Voz/vídeo**: entre num canal de voz e clique em "Entrar no canal de voz". O
  navegador vai pedir permissão de câmera/microfone.

## Limitações importantes (pra você saber o que esperar)

- **Voz/vídeo** usa WebRTC em malha (cada pessoa conecta direto com as outras),
  sinalizado pelo Realtime Database — funciona bem para 2 a 4 pessoas no mesmo
  canal. Não há servidor TURN dedicado, então em redes muito restritas (Wi-Fi
  corporativo, CGNAT dupla) a chamada pode não conectar.
- Não existe "servidor" fazendo nada — tudo roda no navegador de cada pessoa, então
  esse é um app 100% estático, compatível com GitHub Pages.
- As chaves do Firebase no código são públicas por natureza (isso é normal e
  documentado pelo próprio Firebase); a segurança de verdade está nas regras do
  `database.rules.json` que você colou no passo 1.
- Sem infraestrutura de moderação, roles/permissões por cargo, notificações push ou
  DMs — dá pra evoluir a partir daqui.

## Estrutura dos arquivos

```
index.html            tela de login/cadastro + shell do app
style.css              visual (tema escuro, identidade própria)
firebase-config.js     inicialização do Firebase (Auth + Realtime Database)
cloudinary.js           upload de imagens/vídeos (avatares, banners, mídia, ícones)
auth.js                 cadastro, login, sessão
app.js                  servidores, canais, chat, upload, stickers, fórum, perfil
webrtc.js               chamadas de voz/vídeo (sinalização via Realtime Database)
database.rules.json     regras de segurança do banco (cole no console do Firebase)
```

## Estrutura dos dados no Realtime Database

```
users/{uid}                                   perfil
servers/{serverId}                            nome, ícone, dono
serverMembers/{serverId}/{uid}                índice de membros
userServers/{uid}/{serverId}                  índice inverso (servidores do usuário)
channels/{serverId}/{channelId}               canais (texto/voz/fórum)
messages/{serverId}/{channelId}/{msgId}       mensagens
posts/{serverId}/{channelId}/{postId}         tópicos de fórum
replies/{serverId}/{channelId}/{postId}/{id}  respostas de fórum
stickers/{uid}/{stickerId}                    figurinhas customizadas
voicePresence/{serverId}/{channelId}/{uid}    quem está no canal de voz agora
calls/{callKey}                               sinalização WebRTC (offer/answer/ICE)
```
