// imageUpload.js — Manipula a seleção e conversão de arquivos para Base64

export function setupImageUpload(inputElement, onImageReady) {
  if (!inputElement) return;

  inputElement.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Valida se é uma imagem
    if (!file.type.startsWith("image/")) {
      alert("Por favor, selecione um arquivo de imagem válido.");
      return;
    }

    // Opcional: limitar o tamanho (ex: máximo 2MB para não estourar o banco de dados)
    if (file.size > 2 * 1024 * 1024) {
      alert("A imagem é muito grande. Escolha uma com menos de 2MB.");
      return;
    }

    const reader = new FileReader();
    
    // Quando terminar de ler, retorna a string Base64
    reader.onload = (uploadEvent) => {
      const base64String = uploadEvent.target.result;
      onImageReady({
        base64: base64String,
        name: file.name,
        size: file.size,
        type: file.type
      });
    };

    reader.onerror = () => {
      console.error("Erro ao ler o arquivo.");
    };

    // Lê o arquivo como Data URL (Base64)
    reader.readAsDataURL(file);
    
    // Limpa o input para permitir enviar a mesma imagem novamente se precisar
    inputElement.value = "";
  });
}