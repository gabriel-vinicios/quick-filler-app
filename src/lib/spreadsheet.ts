import ExcelJS from "exceljs";
import type { Transcricao, CartaoPontoValue, HoleriteValue, Day } from "./types";

// Formato exigido literalmente pelo README (secao "As planilhas"):
// - Cartao de ponto: coluna Data + pares Entrada N/Saida N (tantos quantos
//   o dia com mais batidas exigir), uma linha por dia, na ordem do documento.
// - Holerite: colunas fixas Pag./Mes/Ano + uma coluna por verba distinta
//   (uniao dos labels de fields, na ordem de 1a aparicao) — SOMENTE fields,
//   bases nao entram na matriz. Uma linha por pagina (ou por entrada, no
//   caso de ficha financeira com varias competencias na mesma pagina).
// Destaques: amarelo (#FFF3CD) para batidas impares / pagina vazia / algum
// "?"; vermelho (#F8D7DA) + borda esquerda (#DC3545) para data/mes nao
// sequencial. Quando os dois valem, vermelho vence.

const AMARELO = "FFFFF3CD";
const VERMELHO = "FFF8D7DA";
const BORDA_VERMELHA = "FFDC3545";
const CABECALHO_BG = "FF173772";

function temIncerteza(...valores: string[]): boolean {
  return valores.some((v) => v.includes("?"));
}

function estilarCabecalho(sheet: ExcelJS.Worksheet, nCols: number) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (let i = 1; i <= nCols; i++) {
    row.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CABECALHO_BG } };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function pintarLinha(row: ExcelJS.Row, nCols: number, cor: "amarelo" | "vermelho" | null) {
  if (!cor) return;
  const fill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor === "vermelho" ? VERMELHO : AMARELO } };
  for (let i = 1; i <= nCols; i++) row.getCell(i).fill = fill;
  if (cor === "vermelho") {
    row.getCell(1).border = { left: { style: "thick", color: { argb: BORDA_VERMELHA } } };
  }
}

// ---------- Cartao de ponto ----------

interface DayRow {
  day: Day;
  corDia: "amarelo" | "vermelho" | null;
}

function calcularLinhasCartaoPonto(value: CartaoPontoValue): DayRow[] {
  const rows: DayRow[] = [];
  let diaAnterior: number | null = null;
  for (const page of value.pages) {
    for (const day of page.days) {
      const diaNum = parseInt(day.date_raw, 10);
      let cor: "amarelo" | "vermelho" | null = null;
      if (!Number.isNaN(diaNum) && diaAnterior !== null && diaNum !== diaAnterior + 1) {
        cor = "vermelho";
      }
      if (!Number.isNaN(diaNum)) diaAnterior = diaNum;
      if (cor !== "vermelho") {
        const impar = day.punches.length % 2 !== 0;
        const incerto = day.punches.some((p) => temIncerteza(p.time_hhmm));
        if (impar || incerto) cor = "amarelo";
      }
      rows.push({ day, corDia: cor });
    }
  }
  return rows;
}

function montarCartaoPonto(wb: ExcelJS.Workbook, value: CartaoPontoValue) {
  const sheet = wb.addWorksheet("Cartão de Ponto");
  const linhas = calcularLinhasCartaoPonto(value);
  const maxPunches = linhas.reduce((m, r) => Math.max(m, r.day.punches.length), 0);
  const maxPares = Math.max(1, Math.ceil(maxPunches / 2));

  const header = ["Data"];
  for (let i = 1; i <= maxPares; i++) header.push(`Entrada ${i}`, `Saída ${i}`);
  sheet.addRow(header);

  for (const { day, corDia } of linhas) {
    const rowValues: (string | null)[] = [day.date_raw];
    for (let i = 0; i < maxPares * 2; i++) {
      rowValues.push(day.punches[i] ? day.punches[i].time_hhmm : "");
    }
    const row = sheet.addRow(rowValues);
    pintarLinha(row, header.length, corDia);
  }
  sheet.getColumn(1).width = 14;
  for (let i = 2; i <= header.length; i++) sheet.getColumn(i).width = 11;
  estilarCabecalho(sheet, header.length);
}

// ---------- Holerite ----------

interface PageRow {
  page: number;
  month: string;
  year: string;
  valoresPorLabel: Map<string, string>;
  cor: "amarelo" | "vermelho" | null;
}

function calcularLinhasHolerite(value: HoleriteValue): { labels: string[]; rows: PageRow[] } {
  const labels: string[] = [];
  const labelSet = new Set<string>();
  for (const page of value.pages) {
    for (const f of page.fields) {
      if (!labelSet.has(f.label)) {
        labelSet.add(f.label);
        labels.push(f.label);
      }
    }
  }

  const rows: PageRow[] = [];
  let anterior: { mes: number; ano: number } | null = null;
  for (const page of value.pages) {
    const vazia = page.fields.length === 0 && page.bases.length === 0;
    let cor: "amarelo" | "vermelho" | null = null;

    if (page.month && page.year) {
      const mes = Number(page.month);
      const ano = Number(page.year);
      if (anterior) {
        const esperado: { mes: number; ano: number } = anterior.mes === 12 ? { mes: 1, ano: anterior.ano + 1 } : { mes: anterior.mes + 1, ano: anterior.ano };
        if (mes !== esperado.mes || ano !== esperado.ano) cor = "vermelho";
      }
      anterior = { mes, ano };
    }

    if (cor !== "vermelho") {
      const incerto = page.fields.some((f) => temIncerteza(f.value, f.reference));
      if (vazia || incerto) cor = "amarelo";
    }

    const valoresPorLabel = new Map<string, string>();
    for (const f of page.fields) valoresPorLabel.set(f.label, f.value);

    rows.push({ page: page.page, month: page.month, year: page.year, valoresPorLabel, cor });
  }
  return { labels, rows };
}

function montarHolerite(wb: ExcelJS.Workbook, value: HoleriteValue) {
  const sheet = wb.addWorksheet("Holerite");
  const { labels, rows } = calcularLinhasHolerite(value);

  const header = ["Pág.", "Mês", "Ano", ...labels];
  sheet.addRow(header);

  for (const r of rows) {
    const rowValues: string[] = [String(r.page), r.month, r.year];
    for (const label of labels) rowValues.push(r.valoresPorLabel.get(label) ?? "");
    const row = sheet.addRow(rowValues);
    pintarLinha(row, header.length, r.cor);
  }

  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 8;
  sheet.getColumn(3).width = 8;
  for (let i = 4; i <= header.length; i++) sheet.getColumn(i).width = 20;
  estilarCabecalho(sheet, header.length);
}

export async function gerarPlanilhaXlsx(t: Transcricao): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quick Filler — desafio";
  wb.created = new Date();
  if (t.tipo === "cartao-ponto") montarCartaoPonto(wb, t.value as CartaoPontoValue);
  else montarHolerite(wb, t.value as HoleriteValue);
  return wb.xlsx.writeBuffer();
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function gerarPlanilhaCsv(t: Transcricao): string {
  const linhas: string[][] = [];
  if (t.tipo === "cartao-ponto") {
    const value = t.value as CartaoPontoValue;
    const rowsData = calcularLinhasCartaoPonto(value);
    const maxPunches = rowsData.reduce((m, r) => Math.max(m, r.day.punches.length), 0);
    const maxPares = Math.max(1, Math.ceil(maxPunches / 2));
    const header = ["Data"];
    for (let i = 1; i <= maxPares; i++) header.push(`Entrada ${i}`, `Saída ${i}`);
    linhas.push(header);
    for (const { day } of rowsData) {
      const row = [day.date_raw];
      for (let i = 0; i < maxPares * 2; i++) row.push(day.punches[i]?.time_hhmm ?? "");
      linhas.push(row);
    }
  } else {
    const value = t.value as HoleriteValue;
    const { labels, rows } = calcularLinhasHolerite(value);
    linhas.push(["Pág.", "Mês", "Ano", ...labels]);
    for (const r of rows) {
      const row = [String(r.page), r.month, r.year];
      for (const label of labels) row.push(r.valoresPorLabel.get(label) ?? "");
      linhas.push(row);
    }
  }
  return linhas.map((l) => l.map(csvEscape).join(",")).join("\n");
}
