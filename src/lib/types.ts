// Tipos que espelham literalmente o contrato descrito no README do desafio.
// Qualquer mudanca aqui deve ser espelhada no contrato HTTP.

export type TipoDocumento = "cartao-ponto" | "holerite";
export type StatusTranscricao = "processando" | "concluido" | "erro";

export interface Punch {
  kind: "IN" | "OUT";
  time_raw: string;
  time_hhmm: string;
}

export interface Day {
  date_raw: string;
  punches: Punch[];
}

export interface CartaoPontoPage {
  page: number;
  days: Day[];
}

export interface CartaoPontoValue {
  pages: CartaoPontoPage[];
}

export interface HoleriteField {
  code: string;
  label: string;
  reference: string;
  value: string;
}

export interface HoleriteBase {
  label: string;
  value: string;
}

export interface HoleritePage {
  page: number;
  year: string;
  month: string;
  fields: HoleriteField[];
  bases: HoleriteBase[];
}

export interface HoleriteValue {
  pages: HoleritePage[];
}

export type TranscricaoValue = CartaoPontoValue | HoleriteValue;

export interface Transcricao {
  id: string;
  tipo: TipoDocumento;
  status: StatusTranscricao;
  erro: string | null;
  value: TranscricaoValue | null;
  criadoEm: string;
  pdfPath: string;
}
