// Utilitarios de baixo nivel para transformar texto "em layout" (colunas
// preservadas por espacos, como o `pdftotext -layout` ou a saida do OCR)
// em celulas e tokens que os parsers de cartao-ponto/holerite conseguem
// interpretar.

/** Quebra uma linha em "celulas" por runs de 2+ espacos — aproxima colunas
 * visuais do documento original. */
export function splitCells(line: string): string[] {
  return line
    .split(/ {2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

const MONEY_RE = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const PLAIN_NUM_RE = /^-?\d+(?:,\d+)?$/;
const DATE_TOKEN_RE = /^[A-ZÇÁÉÍÓÚÂÊÔÃÕ.]{2,15}\/\d{2,4}$/i;

/** Uma celula "parece" um valor de referencia/quantidade ou monetario —
 * ou seja, faz parte dos dados de uma verba, nao o inicio de um novo rotulo. */
export function isNumericish(cell: string): boolean {
  return MONEY_RE.test(cell) || PLAIN_NUM_RE.test(cell) || DATE_TOKEN_RE.test(cell);
}

export function looksLikeMoney(cell: string): boolean {
  return MONEY_RE.test(cell);
}

/** Uma celula que comeca com um codigo de verba: "290 VA Funcionario",
 * "/314 Contr. INSS", "0105 Dias Trabalhados". */
const CODE_LABEL_RE = /^\/?([0-9][0-9A-Za-z]{0,5}|[A-Za-z]\d[0-9A-Za-z]{0,4})\s+(\S.*)$/;

export interface LineGroup {
  code: string;
  label: string;
  reference: string;
  value: string;
}

/** Extrai grupos "codigo/rotulo + referencia? + valor" de uma linha ja
 * dividida em celulas, usando um lookahead de ate 2 celulas por rotulo. */
export function extractGroups(cells: string[]): LineGroup[] {
  const groups: LineGroup[] = [];
  let i = 0;
  while (i < cells.length) {
    const cell = cells[i];
    if (isNumericish(cell)) {
      // Celula numerica orfa (nao consumida por um rotulo anterior) — ruido, ignora.
      i++;
      continue;
    }
    const codeMatch = cell.match(CODE_LABEL_RE);
    const code = codeMatch ? codeMatch[1] : "";
    const label = codeMatch ? codeMatch[2] : cell;

    const next1 = cells[i + 1];
    const next2 = cells[i + 2];
    let reference = "";
    let value = "";
    if (next1 !== undefined && isNumericish(next1) && next2 !== undefined && isNumericish(next2)) {
      reference = next1;
      value = next2;
      i += 3;
    } else if (next1 !== undefined && isNumericish(next1)) {
      value = next1;
      i += 2;
    } else {
      i += 1;
    }
    if (value !== "") {
      groups.push({ code, label, reference, value });
    }
  }
  return groups;
}

/** Extrai pares "Rotulo: valor" separados por dois pontos, mesmo quando
 * varios pares aparecem colados na mesma linha (comum em rodapes de
 * holerite). Usado como pre-passo antes da divisao em celulas. */
const COLON_PAIR_RE = /([A-Za-zÀ-ÿ0-9.\/()% ]{3,50}?)\s*:\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;

export function extractColonPairs(line: string): { label: string; value: string; match: string }[] {
  const out: { label: string; value: string; match: string }[] = [];
  let m: RegExpExecArray | null;
  COLON_PAIR_RE.lastIndex = 0;
  while ((m = COLON_PAIR_RE.exec(line)) !== null) {
    out.push({ label: m[1].trim(), value: m[2], match: m[0] });
  }
  return out;
}

const BASE_KEYWORDS = /BASE|TOTAL|TOT|LIQUID|LIQU|FGTS|RECOLHER/;

/** Remove acentos e pontuacao para comparacao robusta de palavras-chave —
 * "Líqüido" e "F.G.T.S." precisam bater com "LIQUID"/"FGTS" mesmo com
 * diacriticos ou pontos no meio. */
function normalizeForMatch(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

export function isBaseLabel(label: string): boolean {
  return BASE_KEYWORDS.test(normalizeForMatch(label));
}

/** Normaliza "abr", "ABR", "abril" etc para numero do mes (01-12).
 * Retorna null quando nao reconhece — nunca inventa um mes. */
const MONTH_PT: Record<string, string> = {
  jan: "01",
  fev: "02",
  mar: "03",
  abr: "04",
  mai: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  set: "09",
  out: "10",
  nov: "11",
  dez: "12",
};

export function monthAbbrevToNumber(abbrev: string): string | null {
  const key = abbrev.trim().slice(0, 3).toLowerCase();
  return MONTH_PT[key] ?? null;
}

export function isValidMonth(month: string): boolean {
  const n = Number(month);
  return Number.isInteger(n) && n >= 1 && n <= 12;
}
