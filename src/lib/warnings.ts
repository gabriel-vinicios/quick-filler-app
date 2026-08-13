import type { Transcricao, CartaoPontoValue, HoleriteValue } from "./types";

// Os avisos nunca sao gravados junto da transcricao — sao recalculados a
// cada leitura a partir do `value` atual, inclusive depois que o usuario
// edita um campo na tela de revisao. Isso evita que um aviso fique
// "preso" depois que o problema foi corrigido.

export interface Aviso {
  nivel: "info" | "atencao";
  mensagem: string;
}

export function calcularAvisos(t: Transcricao): Aviso[] {
  if (!t.value) return [];
  return t.tipo === "cartao-ponto"
    ? avisosCartaoPonto(t.value as CartaoPontoValue)
    : avisosHolerite(t.value as HoleriteValue);
}

function contemIncerteza(...valores: string[]): boolean {
  return valores.some((v) => v.includes("?"));
}

function avisosCartaoPonto(value: CartaoPontoValue): Aviso[] {
  const avisos: Aviso[] = [];

  if (value.pages.every((p) => p.days.length === 0)) {
    avisos.push({ nivel: "atencao", mensagem: "Nenhum dia foi identificado no documento — provavelmente a leitura falhou." });
    return avisos;
  }

  for (const page of value.pages) {
    if (page.days.length === 0) {
      avisos.push({ nivel: "atencao", mensagem: `Página ${page.page} não teve nenhum dia identificado.` });
      continue;
    }
    let diaAnterior: number | null = null;
    for (const day of page.days) {
      const diaNum = parseInt(day.date_raw, 10);
      if (!Number.isNaN(diaNum) && diaAnterior !== null && diaNum !== diaAnterior + 1) {
        avisos.push({
          nivel: "info",
          mensagem: `Página ${page.page}: a data "${day.date_raw}" quebra a sequência de dias — confira se a leitura está correta.`,
        });
      }
      if (!Number.isNaN(diaNum)) diaAnterior = diaNum;

      if (day.punches.length % 2 !== 0) {
        avisos.push({
          nivel: "atencao",
          mensagem: `Página ${page.page}, dia ${day.date_raw}: número ímpar de batidas (${day.punches.length}) — falta uma entrada ou saída.`,
        });
      }
      for (const punch of day.punches) {
        if (contemIncerteza(punch.time_hhmm)) {
          avisos.push({
            nivel: "atencao",
            mensagem: `Página ${page.page}, dia ${day.date_raw}: horário "${punch.time_raw}" tem dígitos que a leitura não teve certeza — confira no PDF.`,
          });
        }
      }
    }
  }
  return avisos;
}

function avisosHolerite(value: HoleriteValue): Aviso[] {
  const avisos: Aviso[] = [];

  if (value.pages.length === 0) {
    avisos.push({ nivel: "atencao", mensagem: "Nenhuma competência foi identificada no documento." });
    return avisos;
  }

  let mesAnterior: { mes: number; ano: number } | null = null;
  for (const page of value.pages) {
    if (page.fields.length === 0 && page.bases.length === 0) {
      avisos.push({ nivel: "atencao", mensagem: `Página ${page.page} não teve nenhuma verba identificada.` });
    }
    if (!page.month || !page.year) {
      avisos.push({ nivel: "info", mensagem: `Página ${page.page}: não foi possível identificar mês/ano da competência.` });
    } else {
      const mes = Number(page.month);
      const ano = Number(page.year);
      if (mesAnterior) {
        const esperado: { mes: number; ano: number } = mesAnterior.mes === 12 ? { mes: 1, ano: mesAnterior.ano + 1 } : { mes: mesAnterior.mes + 1, ano: mesAnterior.ano };
        if (mes !== esperado.mes || ano !== esperado.ano) {
          avisos.push({
            nivel: "info",
            mensagem: `Página ${page.page}: competência ${page.month}/${page.year} quebra a sequência mensal — confira se a leitura está correta.`,
          });
        }
      }
      mesAnterior = { mes, ano };
    }
    for (const f of page.fields) {
      if (contemIncerteza(f.value, f.reference)) {
        avisos.push({
          nivel: "atencao",
          mensagem: `Página ${page.page}: verba "${f.label || f.code}" tem dígitos incertos — confira no PDF.`,
        });
      }
    }
    for (const b of page.bases) {
      if (contemIncerteza(b.value)) {
        avisos.push({
          nivel: "atencao",
          mensagem: `Página ${page.page}: "${b.label}" tem dígitos incertos — confira no PDF.`,
        });
      }
    }
  }
  return avisos;
}
