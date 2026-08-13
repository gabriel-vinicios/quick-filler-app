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
  const [idPendente, setIdPendente] = useState<string | null>(null);

  // O processamento roda no servidor e continua mesmo se o usuario parar
  // de esperar aqui — em CPU compartilhada (planos gratuitos de deploy),
  // OCR de paginas escaneadas pode demorar bem mais que num ambiente de
  // desenvolvimento. Por isso a espera e longa (ate ~8 minutos) e, se
  // mesmo assim nao terminar, oferecemos o link para checar depois em vez
  // de so mostrar um erro.
  async function aguardarProcessamento(id: string) {
    setProgresso("Processando o documento — em documentos escaneados isso pode levar alguns minutos...");
    const inicio = Date.now();
    const LIMITE_MS = 8 * 60 * 1000;
    while (Date.now() - inicio < LIMITE_MS) {
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
      const decorridoS = Math.round((Date.now() - inicio) / 1000);
      setProgresso(`Processando o documento — ${decorridoS}s decorridos. Documentos escaneados podem levar alguns minutos.`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    setIdPendente(id);
    setErro(
      "Ainda está processando — está demorando mais que o normal, mas continua rodando no servidor. Você pode aguardar mais um pouco e verificar o link abaixo."
    );
    setEnviando(false);
    setProgresso(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setIdPendente(null);
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
        {idPendente && (
          <div className="progresso">
            Quando terminar, a revisão vai estar em{" "}
            <a href={`/revisao/${idPendente}`}>/revisao/{idPendente}</a> — pode salvar esse link e voltar depois.
          </div>
        )}
      </div>
    </div>
  );
}