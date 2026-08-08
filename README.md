DevCord

Um app estilo Discord com perfis, servidores, canais de texto, voz e fórum, figurinhas, banners e chamadas de voz/vídeo.

O projeto roda diretamente no navegador usando:

Firebase Authentication
Firebase Realtime Database
WebRTC
Base64 para imagens

Não utiliza Cloudinary, Firebase Storage ou qualquer serviço externo de armazenamento de arquivos.

1. Configure o Firebase

No Console do Firebase, abra o projeto devcord-4dcf6.

Authentication

Acesse:

Authentication → Sign-in method

Ative:

Email/senha

Realtime Database

Acesse:

Realtime Database → Regras

Cole o conteúdo de:

database.rules.json

Depois clique em:

Publicar

Sem as regras corretas, o app poderá abrir normalmente, mas operações no banco poderão retornar:

PERMISSION_DENIED
Domínios autorizados

Em:

Authentication → Settings → Authorized domains

adicione o domínio onde o DevCord será hospedado.

Por exemplo:

seu-usuario.github.io
2. Sistema de imagens

O DevCord não utiliza Cloudinary.

Também não utiliza:

Firebase Storage
Cloudinary
APIs externas de upload
serviços pagos de armazenamento

As imagens são processadas localmente pelo navegador.

Fluxo:

Imagem selecionada
        ↓
image.js
        ↓
Canvas
        ↓
Redimensionamento
        ↓
Compressão WebP
        ↓
Base64
        ↓
Firebase Realtime Database

O arquivo:

image.js

é responsável por converter e comprimir as imagens.

Ele é utilizado para:

avatar;
banner;
ícone de servidor;
imagens enviadas no chat;
figurinhas.
Importante

Como as imagens são armazenadas diretamente no Realtime Database, imagens grandes podem consumir bastante espaço e atingir os limites do banco.

Por isso o image.js redimensiona e comprime as imagens antes de salvá-las.

3. Suba para o GitHub Pages
git init
git add .
git commit -m "DevCord"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/devcord.git
git push -u origin main

No GitHub:

Settings → Pages → Source

Selecione:

main / (root)

Depois de alguns minutos o aplicativo estará disponível no endereço do GitHub Pages.

4. Usando o app
Cadastro

Na tela inicial:

Criar conta

Informe:

nome;
email;
senha.
Login

Use o email e a senha cadastrados.

Criar servidor

Clique no:

+

na barra lateral.

Depois escolha:

criar

O servidor receberá um ID que pode ser compartilhado para outras pessoas entrarem.

Entrar em um servidor

Clique no:

+

e cole o ID do servidor.

Criar canal

Dentro de um servidor, use o botão + ao lado das categorias de canais.

É possível criar:

Texto
Voz
Fórum
Perfil

No cartão do usuário é possível editar:

foto;
banner;
nome;
bio;
cor;
fonte;
redes sociais.

As imagens são convertidas para Base64 antes de serem salvas.

Chat

O chat suporta:

mensagens de texto;
imagens;
emojis;
figurinhas personalizadas.

As imagens são processadas pelo image.js e armazenadas no Firebase Realtime Database.

Figurinhas

Abra o seletor de figurinhas pelo botão correspondente.

O botão + permite selecionar uma imagem.

A imagem é:

selecionada
→ comprimida
→ convertida para Base64
→ salva no Firebase
Voz e vídeo

O sistema utiliza WebRTC.

O Realtime Database é usado apenas para sinalização.

A mídia é transmitida diretamente entre os navegadores.

O sistema funciona melhor com poucas pessoas no mesmo canal.

Não existe servidor TURN dedicado neste projeto.

5. Limitações

Como as imagens ficam dentro do Realtime Database, recomenda-se utilizar imagens pequenas e comprimidas.

O sistema não utiliza infraestrutura própria de armazenamento.

Também não possui atualmente:

moderação avançada;
cargos/permissões;
notificações push;
mensagens privadas;
servidor dedicado de voz;
servidor TURN dedicado.
6. Estrutura dos arquivos
index.html
style.css
firebase-config.js
auth.js
app.js
image.js
webrtc.js
database.rules.json
README.md
index.html

Interface principal do aplicativo.

style.css

Estilos e identidade visual.

firebase-config.js

Inicialização do Firebase Authentication e Realtime Database.

auth.js

Cadastro, login, logout e criação do perfil.

app.js

Núcleo do aplicativo:

servidores;
canais;
mensagens;
imagens;
figurinhas;
fórum;
perfil;
chamadas.
image.js

Processamento local das imagens:

validação;
redimensionamento;
compressão;
conversão para Base64.
webrtc.js

Sistema de voz/vídeo usando WebRTC.

database.rules.json

Regras de segurança do Firebase Realtime Database.

7. Estrutura do Realtime Database
users/{uid}

servers/{serverId}

serverMembers/{serverId}/{uid}

userServers/{uid}/{serverId}

channels/{serverId}/{channelId}

messages/{serverId}/{channelId}/{msgId}

posts/{serverId}/{channelId}/{postId}

replies/{serverId}/{channelId}/{postId}/{id}

stickers/{uid}/{stickerId}

voicePresence/{serverId}/{channelId}/{uid}

calls/{callKey}
8. Cloudinary

O DevCord não utiliza Cloudinary.

O arquivo:

cloudinary.js

foi removido do projeto.

Nenhuma configuração do Cloudinary é necessária.

O upload de imagens é feito pelo próprio navegador através do image.js.