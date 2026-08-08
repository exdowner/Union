// image.js
// Sistema próprio de imagens.
// Não usa Cloudinary, API externa ou serviço pago.
// Converte e comprime imagens para Base64.

export function imageToBase64(file, options = {}) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error("Nenhuma imagem foi selecionada."));
            return;
        }

        if (!file.type || !file.type.startsWith("image/")) {
            reject(new Error("Apenas imagens são permitidas."));
            return;
        }

        const maxSizeMB = options.maxSizeMB ?? 5;
        const maxSize = maxSizeMB * 1024 * 1024;

        if (file.size > maxSize) {
            reject(
                new Error(
                    `A imagem original é muito grande. Máximo: ${maxSizeMB} MB.`
                )
            );
            return;
        }

        const reader = new FileReader();

        reader.onerror = () => {
            reject(new Error("Não foi possível ler a imagem."));
        };

        reader.onload = () => {
            const originalData = reader.result;

            const img = new Image();

            img.onerror = () => {
                // Se não conseguir processar, usa o Base64 original
                resolve(originalData);
            };

            img.onload = () => {
                try {
                    const maxWidth = options.maxWidth ?? 1280;
                    const maxHeight = options.maxHeight ?? 1280;
                    const quality = options.quality ?? 0.78;

                    let width = img.width;
                    let height = img.height;

                    if (!width || !height) {
                        resolve(originalData);
                        return;
                    }

                    const ratio = Math.min(
                        maxWidth / width,
                        maxHeight / height,
                        1
                    );

                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);

                    const canvas = document.createElement("canvas");

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext("2d");

                    if (!ctx) {
                        resolve(originalData);
                        return;
                    }

                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = "high";

                    ctx.drawImage(
                        img,
                        0,
                        0,
                        width,
                        height
                    );

                    // WebP normalmente gera arquivos bem menores
                    // e também suporta transparência.
                    let base64 = canvas.toDataURL(
                        "image/webp",
                        quality
                    );

                    // Fallback caso o navegador não suporte WebP.
                    if (
                        !base64 ||
                        base64 === "data:image/webp;base64,UklGR"
                    ) {
                        base64 = canvas.toDataURL(
                            "image/png"
                        );
                    }

                    // Segurança extra:
                    // se o resultado comprimido ficou maior que
                    // o original, usa o original.
                    if (
                        typeof originalData === "string" &&
                        base64.length >= originalData.length
                    ) {
                        resolve(originalData);
                    } else {
                        resolve(base64);
                    }

                } catch (error) {
                    console.warn(
                        "Não foi possível comprimir a imagem:",
                        error
                    );

                    resolve(originalData);
                }
            };

            img.src = originalData;
        };

        reader.readAsDataURL(file);
    });
}