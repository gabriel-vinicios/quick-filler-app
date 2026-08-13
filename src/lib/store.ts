import fs from "node:fs";
import path from "node:path";
import type { Transcricao } from "./types";

// Persistencia deliberadamente simples: um JSON por transcricao em disco.
// Para o volume deste desafio (uploads pontuais, avaliacao manual) isso e
// suficiente e evita a complexidade operacional de um banco externo.
// Ver PROCESSO.md / SOLUCAO.md para a discussao sobre o que quebra primeiro
// em producao com essa escolha.

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const TRANSCRICOES_DIR = path.join(DATA_DIR, "transcricoes");
const PDFS_DIR = path.join(DATA_DIR, "pdfs");
const RETENTION_HOURS = Number(process.env.RETENTION_HOURS || 24);

function ensureDirs() {
  fs.mkdirSync(TRANSCRICOES_DIR, { recursive: true });
  fs.mkdirSync(PDFS_DIR, { recursive: true });
}
ensureDirs();

function transcricaoPath(id: string): string {
  // id sempre gerado por nos (uuid), mas normalizamos mesmo assim contra
  // path traversal em qualquer uso futuro que aceite id externo.
  const safe = path.basename(id);
  return path.join(TRANSCRICOES_DIR, `${safe}.json`);
}

export function pdfPathFor(id: string): string {
  const safe = path.basename(id);
  return path.join(PDFS_DIR, `${safe}.pdf`);
}

export function salvar(t: Transcricao): void {
  fs.writeFileSync(transcricaoPath(t.id), JSON.stringify(t), "utf-8");
}

export function buscar(id: string): Transcricao | null {
  try {
    const raw = fs.readFileSync(transcricaoPath(id), "utf-8");
    return JSON.parse(raw) as Transcricao;
  } catch {
    return null;
  }
}

export function limparExpirados(): void {
  const limiteMs = RETENTION_HOURS * 60 * 60 * 1000;
  const agora = Date.now();
  for (const arquivo of fs.readdirSync(TRANSCRICOES_DIR)) {
    const fp = path.join(TRANSCRICOES_DIR, arquivo);
    const stat = fs.statSync(fp);
    if (agora - stat.mtimeMs > limiteMs) {
      const id = arquivo.replace(/\.json$/, "");
      fs.rmSync(fp, { force: true });
      fs.rmSync(pdfPathFor(id), { force: true });
    }
  }
}
