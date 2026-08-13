import type { HoleriteBase, HoleriteField, HoleritePage, HoleriteValue } from "../types";
import { readPage, getPageCount, maskUncertainDigits } from "./pdfSource";
import {
  splitCells,
  extractGroups,
  extractColonPairs,
  isBaseLabel,
  monthAbbrevToNumber,
  isValidMonth,
} from "./textUtils";

interface MonthMarker {
  lineIndex: number;
  month: string;
  year: string;
}

const RE_MES_ABBREV = /M[êe]s\s*:\s*([a-zçãéóíA-ZÇÃÉÓÍ]{3})[-\/](\d{2,4})/;
const RE_MES_ANO = /M[êe]s\s*\/\s*Ano\s*:\s*(\d{1,2})\s*\/\s*(\d{4})/i;
const RE_PERIODO = /Per[íi]odo\s*:\s*(\d{1,2})\s*\/\s*(\d{4})/i;
const RE_REFERENCIA_EXTENSO = /Refer[êe]ncia\s+([A-ZÇÃÕa-zçãõ]{3,10})\s*\/\s*(\d{4})/i;

const MONTH_NAME_PT: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  marco: "03",
  março: "03",
  abril: "04",
  maio: "05",
  junho: "06",
  julho: "07",
  agosto: "08",
  setembro: "09",
  outubro: "10",
  novembro: "11",
  dezembro: "12",
};

function findMonthMarkers(lines: string[]): MonthMarker[] {
  const markers: MonthMarker[] = [];
  lines.forEach((line, idx) => {
    let m = line.match(RE_MES_ABBREV);
    if (m) {
      const month = monthAbbrevToNumber(m[1]);
      let year = m[2];
      if (year.length === 2) year = `20${year}`;
      if (month && isValidMonth(month)) {
        markers.push({ lineIndex: idx, month, year });
        return;
      }
    }
    m = line.match(RE_MES_ANO);
    if (m) {
      const month = m[1].padStart(2, "0");
      if (isValidMonth(month)) {
        markers.push({ lineIndex: idx, month, year: m[2] });
        return;
      }
    }
    m = line.match(RE_PERIODO);
    if (m) {
      const month = m[1].padStart(2, "0");
      if (isValidMonth(month)) {
        markers.push({ lineIndex: idx, month, year: m[2] });
        return;
      }
    }
    m = line.match(RE_REFERENCIA_EXTENSO);
    if (m) {
      const month = MONTH_NAME_PT[m[1].toLowerCase()];
      if (month && isValidMonth(month)) {
        markers.push({ lineIndex: idx, month, year: m[2] });
      }
    }
  });
  return markers;
}

function parseBlock(lines: string[], confidence: number | null): { fields: HoleriteField[]; bases: HoleriteBase[] } {
  const fields: HoleriteField[] = [];
  const bases: HoleriteBase[] = [];

  for (const rawLine of lines) {
    let line = rawLine;
    const colonPairs = extractColonPairs(line);
    for (const pair of colonPairs) {
      line = line.replace(pair.match, " ".repeat(pair.match.length));
      const value = maskUncertainDigits(pair.value, confidence);
      if (isBaseLabel(pair.label)) {
        bases.push({ label: pair.label, value });
      } else {
        fields.push({ code: "", label: pair.label, reference: "", value });
      }
    }

    const cells = splitCells(line);
    const groups = extractGroups(cells);
    for (const g of groups) {
      const value = maskUncertainDigits(g.value, confidence);
      const reference = g.reference ? maskUncertainDigits(g.reference, confidence) : "";
      if (isBaseLabel(g.label)) {
        bases.push({ label: g.label, value });
      } else {
        fields.push({ code: g.code, label: g.label, reference, value });
      }
    }
  }
  return { fields, bases };
}

export function parseHoleritePage(pageText: string, pageNum: number, confidence: number | null): HoleritePage[] {
  const lines = pageText.split("\n");
  const markers = findMonthMarkers(lines);

  if (markers.length === 0) {
    const { fields, bases } = parseBlock(lines, confidence);
    return [{ page: pageNum, year: "", month: "", fields, bases }];
  }

  const pages: HoleritePage[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].lineIndex;
    const end = i + 1 < markers.length ? markers[i + 1].lineIndex : lines.length;
    const blockLines = lines.slice(start, end);
    const { fields, bases } = parseBlock(blockLines, confidence);
    pages.push({ page: pageNum, year: markers[i].year, month: markers[i].month, fields, bases });
  }
  return pages;
}

export function extractHolerite(pdfPath: string): HoleriteValue {
  const pageCount = getPageCount(pdfPath);
  const pages: HoleritePage[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const { text, ocrConfidence } = readPage(pdfPath, p);
    pages.push(...parseHoleritePage(text, p, ocrConfidence));
  }
  return { pages };
}
