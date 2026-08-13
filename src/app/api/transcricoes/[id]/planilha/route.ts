import { NextRequest, NextResponse } from "next/server";
import { buscar } from "@/lib/store";
import { gerarPlanilhaXlsx, gerarPlanilhaCsv } from "@/lib/spreadsheet";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const t = buscar(params.id);
  if (!t) {
    return NextResponse.json({ erro: "Transcrição não encontrada." }, { status: 404 });
  }
  if (t.status !== "concluido" || !t.value) {
    return NextResponse.json({ erro: "Transcrição ainda não concluída." }, { status: 409 });
  }

  const formato = (req.nextUrl.searchParams.get("formato") || "xlsx").toLowerCase();
  const nomeBase = `transcricao-${t.id}`;

  if (formato === "json") {
    return new NextResponse(JSON.stringify(t.value, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeBase}.json"`,
      },
    });
  }

  if (formato === "csv") {
    const csv = gerarPlanilhaCsv(t);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeBase}.csv"`,
      },
    });
  }

  if (formato !== "xlsx") {
    return NextResponse.json({ erro: "Formato inválido — use xlsx, csv ou json." }, { status: 400 });
  }

  const buffer = await gerarPlanilhaXlsx(t);
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeBase}.xlsx"`,
    },
  });
}
