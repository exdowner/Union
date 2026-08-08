// cloudinary.js — upload de imagens/vídeos sem precisar de cartão de crédito.
// Troque os dois valores abaixo pelos seus (veja o README, seção "Cloudinary").
const CLOUD_NAME = "TROQUE_PELO_SEU_CLOUD_NAME";
const UPLOAD_PRESET = "TROQUE_PELO_SEU_UPLOAD_PRESET";

export async function uploadFile(file) {
  if (CLOUD_NAME.startsWith("TROQUE") || UPLOAD_PRESET.startsWith("TROQUE")) {
    throw new Error("Configure o Cloudinary em cloudinary.js antes de enviar arquivos (veja o README).");
  }
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Falha no upload.");
  }
  const data = await res.json();
  return { url: data.secure_url, isVideo: data.resource_type === "video" };
}
