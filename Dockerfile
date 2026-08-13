# syntax=docker/dockerfile:1

# ---------- Stage 1: build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# poppler-utils: pdftotext/pdftoppm/pdfinfo, usados para ler a camada de
# texto do PDF e rasterizar paginas escaneadas.
# tesseract-ocr + eng: motor de OCR e o pacote de idioma ingles (que traz a
# infraestrutura de tessdata); o modelo de portugues e baixado a seguir por
# nao estar disponivel via apt em todas as distros.
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Modelo de portugues do Tesseract, baixado uma vez durante o build da
# imagem (nao em runtime), para nao depender de rede quando o container
# estiver no ar.
RUN TESSDIR=$(find / -maxdepth 6 -type d -name tessdata 2>/dev/null | head -n1) \
    && curl -sL -o "$TESSDIR/por.traineddata" \
       https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/por.traineddata

# Script de entrada: descobre o diretorio do tessdata em runtime (robusto a
# mudanca de versao/distro da imagem base) e exporta TESSDATA_PREFIX antes
# de subir o servidor.
RUN printf '#!/bin/sh\nset -e\nexport TESSDATA_PREFIX=$(find / -maxdepth 6 -type d -name tessdata 2>/dev/null | head -n1)\nexec node server.js\n' > /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh

# Saida "standalone" do Next.js: runtime minimo, sem precisar do node_modules
# completo nem do codigo-fonte.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

ENV PORT=3000
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/healthz || exit 1

CMD ["/app/entrypoint.sh"]
