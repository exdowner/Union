// app.js — Lógica principal da aplicação DevCord.
import { loginUser, registerUser, logoutUser, onAuthChange, getCurrentUser } from "./auth.js";
import { renderEmojiPicker, getRecentEmojis, getFavEmojis, addRecentEmoji, toggleFavEmoji, isFavEmoji } from "./emoji.js";
import { renderGiphyPicker, searchGifs, trendingGifs, searchStickers, getRecentGifs, addRecentGif } from "./giphy.js";
import { setupImageUpload } from "./imageUpload.js";

document.addEventListener("DOMContentLoaded", () => {
  console.log("DevCord inicializado com sucesso.");

  // Gerenciamento de autenticação na UI
  onAuthChange((user) => {
    if (user) {
      console.log("Usuário logado:", user.email);
    } else {
      console.log("Nenhum usuário logado.");
    }
  });

  // Configuração inicial de componentes globais caso existam na DOM
  const emojiRoot = document.getElementById("emoji-picker-container");
  if (emojiRoot) {
    renderEmojiPicker(emojiRoot, {
      onPick: (emoji) => {
        console.log("Emoji selecionado:", emoji);
        addRecentEmoji(emoji);
      },
      onFav: (emoji) => {
        toggleFavEmoji(emoji);
      }
    });
  }

  const giphyRoot = document.getElementById("giphy-picker-container");
  if (giphyRoot) {
    renderGiphyPicker(giphyRoot, {
      onPick: (item) => {
        console.log("GIF/Sticker selecionado:", item);
        addRecentGif(item);
      },
      getFavs: () => [],
      toggleFav: (item) => console.log("Favoritar item:", item)
    });
  }

  const imageInput = document.getElementById("image-file-input");
  if (imageInput) {
    setupImageUpload(imageInput, (imageData) => {
      console.log("Imagem pronta em Base64:", imageData.name);
    });
  }
});
