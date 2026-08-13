import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Le PDFs usando os utilitarios do poppler (pdftotext/pdftoppm/pdfinfo) e,
// quando a pagina nao tem camada de texto, cai para OCR via Tesseract.
// Escolha deliberada: poppler + Tesseract sao livres, rodam offline dentro
// do container (sem depender de uma API paga) e cobrem os dois casos que o
// desafio pede (texto nativo e escaneado). Ver SOLUCAO.md.
//
// IMPORTANTE: todas as chamadas a esses binarios sao ASSINCRONAS
// (execFile + promisify, nao spawnSync). Uma pagina escaneada pode levar
// varios segundos de OCR; se essa chamada fosse sincrona, ela travaria o
// event loop do Node inteiro — o processo ficaria incapaz de responder a
// QUALQUER outra requisicao (nem o proprio healthcheck) ate o OCR
// terminar. Isso ja causou uma queda em producao (ver PROCESSO.md): a
// plataforma de deploy, sem resposta do healthcheck durante o OCR,
// reiniciou o container e a transcricao em andamento se perdeu.

const execFileAsync = promisify(execFile);

// TESSDATA_PREFIX deve apontar diretamente para a pasta que contem os
// arquivos .traineddata (eng.traineddata, por.traineddata). No Docker essa
// pasta e a do proprio Tesseract do sistema, onde a imagem copia o modelo
// de portugues durante o build (ver Dockerfile).
const TESSDATA_DIR = process.env.TESSDATA_PREFIX || "/usr/share/tesseract-ocr/5/tessdata";

export interface PageResult {
  text: string;
  scanned: boolean;
  ocrConfidence: number | null; // confianca media (0-100) quando veio de OCR
}

// Timeout de seguranca por comando: em CPU muito fraca/compartilhada
// (planos gratuitos de deploy) o OCR pode ser bem mais lento que num
// ambiente de desenvolvimento normal, mas nunca deve ficar pendurado para
// sempre — apos esse tempo o comando e encerrado e o erro sobe como
// "erro" na transcricao, em vez de travar o job silenciosamente.
const TIMEOUT_MS = 120_000;

async function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 64,
      env: env ?? process.env,
      timeout: TIMEOUT_MS,
    });
    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string };
    if (err.code === "ENOENT") {
      throw new Error(`Falha ao executar ${cmd}: comando nao encontrado no sistema.`);
    }
    if (err.killed && err.signal === "SIGTERM") {
      throw new Error(`Falha ao executar ${cmd}: excedeu o tempo limite de ${TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`Falha ao executar ${cmd}: ${err.stderr || err.message}`);
  }
}

export async function getPageCount(pdfPath: string): Promise<number> {
  const stdout = await run("pdfinfo", [pdfPath]);
  const m = stdout.match(/^Pages:\s*(\d+)/m);
  if (!m) throw new Error("Nao foi possivel ler o numero de paginas do PDF");
  return Number(m[1]);
}

async function getLayoutText(pdfPath: string, page: number): Promise<string> {
  return run("pdftotext", ["-layout", "-f", String(page), "-l", String(page), pdfPath, "-"]);
}

/** Um "texto" e considerado presente se sobrarem caracteres alfanumericos
 * suficientes depois de remover espacos e ruido tipico de rodape/cabecalho. */
function hasMeaningfulText(text: string): boolean {
  const stripped = text.replace(/\s/g, "");
  if (stripped.length < 25) return false;
  // Algumas paginas escaneadas trazem so um carimbo/assinatura como texto
  // real (o resto e imagem). Exigimos ao menos um valor no formato
  // monetario/horario para considerar que ha dado tabular extraivel.
  const hasMoneyOrTime = /\d{1,3}(?:\.\d{3})*,\d{2}|(?<!:)\b\d{1,2}:\d{2}\b(?!:\d)/.test(text);
  return hasMoneyOrTime;
}

async function ocrPage(pdfPath: string, page: number): Promise<{ text: string; confidence: number }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qf-ocr-"));
  try {
    const imgBase = path.join(tmpDir, "page");
    // 300 DPI: testado contra 200 DPI e a diferenca de qualidade e real —
    // com 200 DPI, o OCR do cartao de ponto voltou a errar a leitura do
    // dia-da-semana colado ao numero do dia e de colunas de resumo (bugs
    // ja corrigidos, ver PROCESSO.md). Mantendo 300 DPI e confiando no
    // timeout de seguranca acima + no tempo de espera maior do frontend
    // para lidar com CPU mais lenta, em vez de trocar precisao por
    // velocidade.
    await run("pdftoppm", ["-png", "-r", "300", "-f", String(page), "-l", String(page), pdfPath, imgBase]);
    const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("page"));
    if (files.length === 0) throw new Error(`Falha ao rasterizar pagina ${page} para OCR`);
    const imgPath = path.join(tmpDir, files[0]);

    const outBase = path.join(tmpDir, "out");
    const env = { ...process.env, TESSDATA_PREFIX: TESSDATA_DIR };
    await run("tesseract", [imgPath, outBase, "-l", "por+eng", "--psm", "6", "tsv"], env);

    const tsv = fs.readFileSync(`${outBase}.tsv`, "utf-8");
    return tsvToLayoutText(tsv);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Reconstroi um texto "em layout" a partir do TSV do Tesseract, agrupando
 * palavras por linha (block/par/line) e posicionando por coordenada X
 * aproximada, para que os mesmos parsers baseados em colunas funcionem
 * tanto em texto nativo quanto em OCR. Tambem calcula a confianca media,
 * usada para decidir onde marcar caracteres incertos com "?". */
function tsvToLayoutText(tsv: string): { text: string; confidence: number } {
  const lines = tsv.split("\n").slice(1); // pula cabecalho
  // Colunas oficiais do TSV do Tesseract, nesta ordem:
  // level, page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text
  type Word = { line: string; left: number; top: number; text: string; conf: number };
  const words: Word[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const cols = l.split("\t");
    if (cols.length < 12) continue;
    const blockNum = cols[2];
    const parNum = cols[3];
    const lineNum = cols[4];
    const left = cols[6];
    const top = cols[7];
    const conf = cols[10];
    const text = cols[11];
    if (!text || !text.trim()) continue;
    const confNum = Number(conf);
    if (confNum < 0) continue; // -1 = linha/bloco, nao palavra
    words.push({
      line: `${blockNum}.${parNum}.${lineNum}`,
      left: Number(left),
      top: Number(top),
      text,
      conf: confNum,
    });
  }
  if (words.length === 0) return { text: "", confidence: 0 };

  const byLine = new Map<string, Word[]>();
  for (const w of words) {
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line)!.push(w);
  }

  // Cada ~8px de X vira uma "coluna" de caracter — aproxima o espacamento
  // de um terminal monoespacado o suficiente para o splitCells() por
  // runs de 2+ espacos continuar funcionando. As linhas sao ordenadas pela
  // posicao vertical media (top), nao pela ordem em que o Tesseract emitiu
  // os blocos, que nem sempre e de cima para baixo.
  const PX_PER_CHAR = 8;
  const lineGroups = Array.from(byLine.values());
  lineGroups.sort((a, b) => {
    const topA = a.reduce((s, w) => s + w.top, 0) / a.length;
    const topB = b.reduce((s, w) => s + w.top, 0) / b.length;
    return topA - topB;
  });
  const textLines: string[] = [];
  for (const wordsInLine of lineGroups) {
    wordsInLine.sort((a, b) => a.left - b.left);
    let line = "";
    for (const w of wordsInLine) {
      const col = Math.round(w.left / PX_PER_CHAR);
      if (col > line.length) line = line.padEnd(col, " ");
      line += (line.length > 0 && !line.endsWith(" ") ? " " : "") + w.text;
    }
    textLines.push(line);
  }

  const totalConf = words.reduce((s, w) => s + w.conf, 0);
  return { text: textLines.join("\n"), confidence: totalConf / words.length };
}

/** Substitui digitos por "?" nas celulas numericas quando a confianca do
 * OCR para a pagina esta abaixo do limiar — nunca inventamos um valor
 * que a maquina nao leu com seguranca. */
export function maskUncertainDigits(value: string, confidence: number | null): string {
  if (confidence === null) return value;
  const LOW_CONF = 70;
  if (confidence >= LOW_CONF) return value;
  // Confianca baixa mas nao "sem leitura": marcamos o valor inteiro como
  // suspeito trocando cada digito por "?", preservando pontuacao/separadores.
  return value.replace(/\d/g, "?");
}

export async function readPage(pdfPath: string, page: number): Promise<PageResult> {
  const nativeText = await getLayoutText(pdfPath, page);
  if (hasMeaningfulText(nativeText)) {
    return { text: nativeText, scanned: false, ocrConfidence: null };
  }
  const { text, confidence } = await ocrPage(pdfPath, page);
  return { text, scanned: true, ocrConfidence: confidence };
}