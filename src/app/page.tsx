"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tipo = "cartao-ponto" | "holerite";

export default function HomePage() {
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo>("holerite");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aguardarProcessamento(id: string) {
    setProgresso("Processando o documento — isso pode levar alguns segundos...");
    for (let tentativa = 0; tentativa < 60; tentativa++) {
      const res = await fetch(`/api/transcricoes/${id}`);
      const data = await res.json();
      if (data.status === "concluido") {
        router.push(`/revisao/${id}`);
        return;
      }
      if (data.status === "erro") {
        setErro(data.erro || "Falha ao processar o documento.");
        setEnviando(false);
        setProgresso(null);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setErro("O processamento está demorando mais que o esperado. Tente novamente em instantes.");
    setEnviando(false);
    setProgresso(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!arquivo) {
      setErro("Escolha um arquivo PDF.");
      return;
    }
    setEnviando(true);
    setProgresso("Enviando arquivo...");
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("tipo", tipo);
      const res = await fetch("/api/transcricoes", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.erro || "Falha ao enviar o arquivo.");
        setEnviando(false);
        setProgresso(null);
        return;
      }
      await aguardarProcessamento(data.id);
    } catch {
      setErro("Não foi possível conectar ao servidor.");
      setEnviando(false);
      setProgresso(null);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Quick Filler — Transcrição de documentos</h1>
        <p>Envie um holerite ou cartão de ponto em PDF. Depois de processado, você poderá revisar e corrigir a transcrição antes de baixar a planilha.</p>

        <form onSubmit={enviar}>
          <label htmlFor="tipo">Tipo de documento</label>
          <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} disabled={enviando}>
            <option value="holerite">Holerite</option>
            <option value="cartao-ponto">Cartão de ponto</option>
          </select>

          <label htmlFor="arquivo">Arquivo PDF</label>
          <input
            id="arquivo"
            type="file"
            accept="application/pdf"
            disabled={enviando}
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />

          <button type="submit" disabled={enviando}>
            {enviando ? "Processando..." : "Enviar e processar"}
          </button>
        </form>

        {progresso && <div className="progresso">{progresso}</div>}
        {erro && <div className="erro">{erro}</div>}
      </div>
    </div>
  );
}
