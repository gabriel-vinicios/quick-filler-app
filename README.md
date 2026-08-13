## Stack

- **Next.js 14 (App Router) + TypeScript** — API e interface no mesmo serviço
- **poppler-utils** (`pdftotext`/`pdftoppm`/`pdfinfo`) para leitura de PDF com texto nativo
- **Tesseract OCR** (com modelo de português) para páginas escaneadas
- **exceljs** para gerar as planilhas `.xlsx`
- Sem banco de dados — cada transcrição é um JSON em disco (ver `SOLUCAO.md`)

## Como rodar

### Com Docker (recomendado)

```bash
docker compose up
```

Abre em `http://localhost:3000`. Não precisa de nenhuma configuração adicional — todas as dependências (Node, poppler, Tesseract) já vêm na imagem.

### Sem Docker

```bash
npm install
npm run dev
```

Fora do Docker, você precisa instalar **poppler-utils** e **Tesseract** (com o idioma português) manualmente:

```bash
# macOS
brew install poppler tesseract tesseract-lang

# Debian/Ubuntu
sudo apt install poppler-utils tesseract-ocr tesseract-ocr-por
```

## Configuração

Variáveis de ambiente (ver `.env.example`):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DATA_DIR` | `.data` | Onde ficam os PDFs e transcrições |
| `MAX_UPLOAD_BYTES` | `20971520` (20 MB) | Limite de tamanho de upload |
| `RETENTION_HOURS` | `24` | Por quanto tempo os dados ficam guardados |

## API

| Rota | Descrição |
|---|---|
| `POST /api/transcricoes` | Envia um PDF (`multipart/form-data`: `arquivo` + `tipo`) |
| `GET /api/transcricoes/:id` | Status e resultado da transcrição |
| `PUT /api/transcricoes/:id` | Salva correções feitas na revisão |
| `GET /api/transcricoes/:id/planilha?formato=xlsx\|csv\|json` | Baixa a planilha |
| `GET /healthz` | Health check |

Contrato completo dos formatos de dados no [enunciado do desafio](https://github.com/quick-filler/desafio-programador).

## Documentação

- [`SOLUCAO.md`](./SOLUCAO.md) — arquitetura, decisões técnicas, o que ficou de fora, segurança
- [`PROCESSO.md`](./PROCESSO.md) — uso de IA no desenvolvimento, erros encontrados e corrigidos, respostas às perguntas do desafio

## Estrutura
src/
app/ # rotas (páginas + API)
api/transcricoes/ # POST, GET, PUT, /planilha, /pdf
healthz/
page.tsx # upload
revisao/[id]/page.tsx # revisão (PDF + tabela editável)
lib/
extract/
cartaoPonto.ts # extrator de cartão de ponto
holerite.ts # extrator de holerite
pdfSource.ts # leitura de PDF + fallback de OCR
textUtils.ts # parsing de colunas/valores
spreadsheet.ts # geração de .xlsx/.csv
warnings.ts # avisos derivados (nunca armazenados)
store.ts # persistência em arquivo
process.ts # processamento assíncrono
exemplos/ # PDFs de exemplo do desafio
