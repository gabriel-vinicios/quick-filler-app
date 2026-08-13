import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { buscar } from "@/lib/store";

export const runtime = "nodejs";

// Rota auxiliar para a interface (nao faz parte do contrato obrigatorio do
// desafio) — serve os bytes do PDF original para o visualizador ao lado da
// tabela de revisao.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const t = buscar(params.id);
  if (!t) return NextResponse.json({ erro: "Transcrição não encontrada." }, { status: 404 });
  try {
    const bytes = fs.readFileSync(t.pdfPath);
    return new NextResponse(bytes, { headers: { "Content-Type": "application/pdf" } });
  } catch {
    return NextResponse.json({ erro: "PDF não encontrado no servidor." }, { status: 404 });
  }
}
