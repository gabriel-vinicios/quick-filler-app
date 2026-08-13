import type { CartaoPontoValue, CartaoPontoPage, Day, Punch } from "../types";
import { readPage, getPageCount, maskUncertainDigits } from "./pdfSource";
import { isValidMonth } from "./textUtils";

// Os 4 exemplos do desafio trazem 3 layouts distintos de cartao de ponto:
//
// A) "Dia Semana Jornada Entrada Saida Ocorrencia Qtde" (time-card-01):
//    dia+semana com traco ("2 - SEG"), 1a hora = jornada prevista (nao e
//    batida), pares Entrada/Saida no meio, Qtde final quando ha ocorrencia
//    com texto (tambem nao e batida). Um dia pode se estender por 2 linhas
//    (1 por turno).
// B) "Dia Semana Entrada Saida Intervalo1 Intervalo2 Intervalo3 ..."
//    (time-card-02, escaneado): dia+semana sem traco, todas as horas da
//    linha sao batidas reais (sem jornada/qtde a descartar).
// C) "Data Semana Ent1 Sai1 Ent2 Sai2 Ent3 Sai3 Ent4 Sai4 ..." (time-card-03,
//    escaneado): a data completa (DD/MM/AAAA) ja vem impressa na propria
//    linha — nao precisa combinar com o cabecalho.
//
// Em qualquer um dos 3 casos, a regra geral e a mesma: identificamos a data
// da linha (ou do dia+cabecalho) e tratamos os horarios restantes como
// batidas alternando IN/OUT na ordem em que aparecem — a unica diferenca
// entre os layouts e QUAIS horarios da linha contam como batida.

const RE_MES_ANO = /M[êe]s\s*\/\s*Ano\s*:?\s*(\d{1,2})\s*\/\s*(\d{4})/i;
// O espaco entre numero/mes/dia e o dia-da-semana e opcional (\s*, nao
// \s+): o OCR as vezes cola os dois sem espaco (ex.: "14QUA" em vez de
// "14 QUA"). Com \s+ obrigatorio essa linha inteira deixava de bater no
// "inicio de dia" e virava, silenciosamente, uma "continuacao" do dia
// anterior — juntando as batidas dos dois dias num so e apagando um dia
// inteiro do resultado. Ver PROCESSO.md.
const RE_FULL_DATE_START = /^\s*(\d{2}\/\d{2}\/\d{4})\s*([A-ZÇÁÉ]{2,4})?\b(.*)$/;
const RE_DAY_START = /^\s*(\d{1,2})\s*-?\s*([A-ZÇÁÉ]{3,4})\b(.*)$/;
// Tolera um caractere de ruido de OCR colado ao horario (ex.: "07:00d").
const TIME_RE = /\b(\d{1,2}:\d{2}|0?\?:\d{2}|\d{1,2}:\?\?|\?\?:\?\?)[a-zA-Z]?\b/g;

function extractHeaderMonthYear(fullText: string): { month: string; year: string } {
  const m = fullText.match(RE_MES_ANO);
  if (!m) return { month: "", year: "" };
  const month = m[1].padStart(2, "0");
  if (!isValidMonth(month)) return { month: "", year: "" };
  return { month, year: m[2] };
}

/** Layout A tem colunas "Jornada" (horario previsto) e "Ocorrencia" —
 * exige descartar a 1a e, as vezes, a ultima hora da linha. Nos demais
 * layouts, todo horario encontrado e uma batida real. */
function isLayoutWithJornadaEOcorrencia(fullText: string): boolean {
  return /Jornada/i.test(fullText) && /Ocorr[êe]ncia/i.test(fullText);
}

interface RawLine {
  date_raw: string | null; // data completa (layout C) ou numero do dia (A/B); null = continuacao
  isFullDate: boolean;
  times: string[];
  hasOcorrencia: boolean;
}

function parseLine(line: string, colunaCorteResumo: number | null): RawLine | null {
  const fullDateMatch = line.match(RE_FULL_DATE_START);
  const dayMatch = !fullDateMatch ? line.match(RE_DAY_START) : null;
  const isStart = !!fullDateMatch || !!dayMatch;
  let matches = Array.from(line.matchAll(TIME_RE));
  // Colunas de RESUMO (H.Ext, Atraso, Falta, Ad.Not, Abono) ficam DEPOIS das
  // colunas de Entrada/Saida na mesma linha e tambem tem formato HH:MM. Se
  // sabemos em que coluna de texto elas comecam (calculado a partir do
  // cabecalho da tabela), descartamos qualquer horario que caia a partir
  // dali — e nao so "o ultimo", que falha quando 2+ colunas de resumo estao
  // preenchidas ao mesmo tempo (total par, a heuristica de paridade nao
  // pega). Ver PROCESSO.md.
  if (colunaCorteResumo !== null) {
    matches = matches.filter((m) => m.index === undefined || m.index < colunaCorteResumo);
  }
  const times = matches.map((m) => m[0]);
  if (times.length === 0 && !isStart) return null;

  const restOfLine = fullDateMatch ? fullDateMatch[3] ?? "" : dayMatch ? dayMatch[3] ?? "" : line;
  const hasOcorrencia = /[A-Za-zÀ-ÿ]{3,}/.test(restOfLine.replace(TIME_RE, ""));

  return {
    date_raw: fullDateMatch ? fullDateMatch[1] : dayMatch ? dayMatch[1] : null,
    isFullDate: !!fullDateMatch,
    times,
    hasOcorrencia,
  };
}

// Nomes das colunas de RESUMO, na ordem em que aparecem depois das colunas
// de batida — usamos a primeira que aparecer no cabecalho para achar a
// coluna de corte. "H.Ext" e "Ad.Not" tem ponto que o OCR as vezes perde,
// entao a busca tolera isso.
const RE_HEADER_COLUNA_RESUMO = /H\.?\s?Ext|Atraso|Ad\.?\s?Not|Abono/i;

/** Acha, no cabecalho da tabela, a partir de qual coluna de texto comecam
 * as colunas de resumo (duracao) — para descartar horarios que aparecam a
 * partir dali nas linhas de dado. Retorna null quando nao acha um
 * cabecalho reconhecivel (layout sem colunas de resumo, ex.: layout A/B). */
function acharColunaCorteResumo(lines: string[]): number | null {
  for (const line of lines) {
    const m = line.match(RE_HEADER_COLUNA_RESUMO);
    if (m && m.index !== undefined) return m.index;
  }
  return null;
}

// No layout C (data completa por linha), colunas de RESUMO (H.Ext, Atraso,
// Falta, Ad.Not, Abono) aparecem DEPOIS das colunas de Entrada/Saida na
// mesma linha e tambem tem formato HH:MM. Quando NAO conseguimos achar a
// coluna de corte pelo cabecalho (acharColunaCorteResumo retornou null),
// caimos para a heuristica mais fraca: batidas reais sempre vem em pares;
// um total IMPAR de horarios na linha indica 1 valor de resumo vazando no
// final. Nao pega o caso de 2 colunas de resumo preenchidas ao mesmo tempo
// (total par) — por isso a coluna de corte acima e preferida sempre que
// disponivel.
function descartarResumoVazado(times: string[]): string[] {
  if (times.length % 2 === 0) return times;
  return times.slice(0, -1);
}

function timesToPunchStrings(
  times: string[],
  isStartLine: boolean,
  hasOcorrencia: boolean,
  applyLayoutARules: boolean,
  isFullDate: boolean,
  corteJaAplicadoPelaColuna: boolean
): string[] {
  if (!applyLayoutARules) {
    if (!isFullDate || corteJaAplicadoPelaColuna) return times;
    return descartarResumoVazado(times); // fallback: cabecalho de resumo nao encontrado
  }
  let t = [...times];
  if (isStartLine && t.length > 0) t = t.slice(1); // descarta a Jornada prevista
  if (hasOcorrencia && t.length > 0) t = t.slice(0, -1); // descarta a Qtde da ocorrencia
  return t;
}

function toPunches(times: string[], confidence: number | null): Punch[] {
  return times.map((raw, idx) => {
    const kind: "IN" | "OUT" = idx % 2 === 0 ? "IN" : "OUT";
    const masked = maskUncertainDigits(raw, confidence);
    return { kind, time_raw: raw, time_hhmm: normalizeTime(masked) };
  });
}

/** Normaliza para HH:MM. Mantem "?" onde o digito nao foi lido com
 * seguranca — nunca inventa um valor. */
function normalizeTime(raw: string): string {
  const m = raw.match(/^(\d{1,2}|\?{1,2})[:h](\d{2}|\?{1,2})$/);
  if (!m) return raw.replace(/[^\d:?]/g, "");
  let [, hh, mm] = m;
  if (hh.length === 1) hh = `0${hh}`;
  return `${hh}:${mm}`;
}

// Depois que a tabela de dias termina, o rodape do relatorio costuma trazer
// linhas como "Impresso por: ... em 31 de outubro de 2025 - 14:53:48" ou
// "Documento assinado eletronicamente ... às 17:21:32" — que tem formato
// HH:MM:SS e batem no mesmo regex de horario. Sem parar nessas linhas, elas
// eram tratadas como "continuacao" do ULTIMO dia da pagina, inflando-o com
// batidas falsas que na verdade sao metadado de geracao do documento, nao
// horario de ponto. Ver PROCESSO.md.
const RE_FIM_DE_TABELA = /Impresso\s+por|Documento\s+assinado\s+eletronicamente|Assinado\s+eletronicamente\s+por|Total\s+de\s+horas|Folgas\s+geradas/i;

export function parseCartaoPontoPage(pageText: string, pageNum: number, confidence: number | null): CartaoPontoPage {
  const { month, year } = extractHeaderMonthYear(pageText);
  const applyLayoutARules = isLayoutWithJornadaEOcorrencia(pageText);
  const lines = pageText.split("\n");
  const colunaCorteResumo = applyLayoutARules ? null : acharColunaCorteResumo(lines);

  const days: Day[] = [];
  let currentDay: Day | null = null;

  for (const line of lines) {
    if (RE_FIM_DE_TABELA.test(line)) break;

    const parsed = parseLine(line, colunaCorteResumo);
    if (!parsed) continue;

    const isStart = parsed.date_raw !== null;
    const punchStrings = timesToPunchStrings(
      parsed.times,
      isStart,
      parsed.hasOcorrencia,
      applyLayoutARules,
      parsed.isFullDate,
      colunaCorteResumo !== null
    );
    const punches = toPunches(punchStrings, confidence);

    if (isStart) {
      const date_raw = parsed.isFullDate
        ? parsed.date_raw!
        : month && year
        ? `${parsed.date_raw!.padStart(2, "0")}/${month}/${year}`
        : parsed.date_raw!.padStart(2, "0");

      // Mesmo dia da linha anterior (ex.: "17 - TER" duas vezes seguidas,
      // um turno por linha em vez de linha de continuacao) = mesmo dia.
      if (currentDay && currentDay.date_raw === date_raw) {
        currentDay.punches.push(...punches);
      } else {
        currentDay = { date_raw, punches };
        days.push(currentDay);
      }
    } else if (currentDay) {
      currentDay.punches.push(...punches);
    }
  }

  return { page: pageNum, days };
}

export function extractCartaoPonto(pdfPath: string): CartaoPontoValue {
  const pageCount = getPageCount(pdfPath);
  const pages: CartaoPontoPage[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const { text, ocrConfidence } = readPage(pdfPath, p);
    pages.push(parseCartaoPontoPage(text, p, ocrConfidence));
  }
  return { pages };
}
