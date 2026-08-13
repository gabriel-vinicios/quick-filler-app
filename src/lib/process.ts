import { extractCartaoPonto } from "./extract/cartaoPonto";
import { extractHolerite } from "./extract/holerite";
import { buscar, salvar } from "./store";
import type { Transcricao } from "./types";

// Processamento roda "em segundo plano" dentro do mesmo processo Node —
// suficiente para o volume deste desafio (um servidor, poucos uploads
// simultaneos). Ver PROCESSO.md para a discussao sobre o que isso quebra
// em producao (reinicio do processo no meio de um processamento perde o
// job; a fila deveria ser externa — Redis/SQS — antes de escalar).
export function processarEmSegundoPlano(id: string): void {
  setTimeout(() => {
    const t = buscar(id);
    if (!t) return;
    try {
      const value = t.tipo === "cartao-ponto" ? extractCartaoPonto(t.pdfPath) : extractHolerite(t.pdfPath);
      const atualizado: Transcricao = { ...t, status: "concluido", value, erro: null };
      salvar(atualizado);
    } catch (e) {
      const atualizado: Transcricao = {
        ...t,
        status: "erro",
        erro: e instanceof Error ? e.message : "Falha desconhecida ao processar o documento.",
      };
      salvar(atualizado);
    }
  }, 0);
}
