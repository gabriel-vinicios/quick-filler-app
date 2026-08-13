import { NextRequest, NextResponse } from "next/server";
import { buscar, salvar } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const t = buscar(params.id);
  if (!t) {
    return NextResponse.json({ erro: "Transcrição não encontrada." }, { status: 404 });
  }
  return NextResponse.json({
    id: t.id,
    tipo: t.tipo,
    status: t.status,
    erro: t.erro,
    value: t.value,
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const t = buscar(params.id);
  if (!t) {
    return NextResponse.json({ erro: "Transcrição não encontrada." }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "Corpo da requisição precisa ser JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("value" in body)) {
    return NextResponse.json({ erro: "Corpo deve conter o campo 'value'." }, { status: 400 });
  }
  const atualizado = { ...t, value: (body as { value: typeof t.value }).value };
  salvar(atualizado);
  return NextResponse.json({
    id: atualizado.id,
    tipo: atualizado.tipo,
    status: atualizado.status,
    erro: atualizado.erro,
    value: atualizado.value,
  });
}
