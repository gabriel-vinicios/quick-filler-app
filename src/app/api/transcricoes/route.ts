import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import fs from "node:fs";
import { pdfPathFor, salvar, limparExpirados } from "@/lib/store";
import { processarEmSegundoPlano } from "@/lib/process";
import type { Transcricao, TipoDocumento } from "@/lib/types";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
const TIPOS_VALIDOS: TipoDocumento[] = ["cartao-ponto", "holerite"];

function isPdfMagicBytes(buf: Buffer): boolean {
  // Um PDF valido comeca com "%PDF-". Checagem de conteudo, nao so extensao,
  // para o requisito de "validar que o arquivo e mesmo um PDF".
  return buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function POST(req: NextRequest) {
  try {
    limparExpirados();
  } catch {
    // limpeza e best-effort — uma falha aqui nao pode bloquear o upload
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ erro: "Corpo da requisição inválido — esperado multipart/form-data." }, { status: 400 });
  }

  const arquivo = form.get("arquivo");
  const tipo = form.get("tipo");

  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "Campo 'arquivo' é obrigatório e deve ser um PDF." }, { status: 400 });
  }
  if (typeof tipo !== "string" || !TIPOS_VALIDOS.includes(tipo as TipoDocumento)) {
    return NextResponse.json({ erro: "Campo 'tipo' deve ser 'cartao-ponto' ou 'holerite'." }, { status: 400 });
  }
  if (arquivo.size === 0) {
    return NextResponse.json({ erro: "Arquivo vazio." }, { status: 400 });
  }
  if (arquivo.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ erro: `Arquivo excede o limite de ${MAX_UPLOAD_BYTES} bytes.` }, { status: 413 });
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  if (!isPdfMagicBytes(bytes)) {
    return NextResponse.json({ erro: "O arquivo enviado não é um PDF válido." }, { status: 400 });
  }

  const id = uuidv4();
  try {
    fs.writeFileSync(pdfPathFor(id), bytes);
  } catch {
    return NextResponse.json({ erro: "Falha ao salvar o arquivo no servidor." }, { status: 500 });
  }

  const transcricao: Transcricao = {
    id,
    tipo: tipo as TipoDocumento,
    status: "processando",
    erro: null,
    value: null,
    criadoEm: new Date().toISOString(),
    pdfPath: pdfPathFor(id),
  };
  salvar(transcricao);
  processarEmSegundoPlano(id);

  return NextResponse.json({ id }, { status: 202 });
}
