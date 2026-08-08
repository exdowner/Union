import { rtdb, serverTimestamp } from "./firebase-config.js";
import { ref, get, update, remove, set } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Migra favoritos antigos em gifFavs/{uid} para users/{uid}/favorites/gifs
// Roda automaticamente no evento devcord:signed-in

window.addEventListener("devcord:signed-in", async (e) => {
  const user = e.detail;
  if (!user) return;
  const uid = user.uid;
  try {
    const migrated = await get(ref(rtdb, `users/${uid}/meta/migratedGifFavs`));
    if (migrated.exists()) return; // já migrado

    const oldSnap = await get(ref(rtdb, `gifFavs/${uid}`));
    if (!oldSnap.exists()) {
      // marca como migrado para não tentar novamente
      await set(ref(rtdb, `users/${uid}/meta/migratedGifFavs`), true);
      return;
    }

    const old = oldSnap.val();
    const updates = {};
    Object.entries(old).forEach(([id, it]) => {
      updates[`users/${uid}/favorites/gifs/${id}`] = {
        id: it.id || id,
        url: it.url || "",
        preview: it.url || "",
        title: it.title || "",
        provider: it.kind ? (it.kind === 'sticker' ? 'giphy' : 'giphy') : 'giphy',
        at: serverTimestamp(),
      };
    });

    if (Object.keys(updates).length) {
      await update(ref(rtdb, `/`), updates);
      // remover antigos
      await remove(ref(rtdb, `gifFavs/${uid}`));
    }

    await set(ref(rtdb, `users/${uid}/meta/migratedGifFavs`), true);
    console.log("Migrated gifFavs to users/{uid}/favorites/gifs");
  } catch (err) {
    console.error("Favorites migration failed:", err);
  }
});
