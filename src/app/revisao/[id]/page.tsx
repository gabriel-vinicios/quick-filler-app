"use client";

import { useEffect, useState, useCallback } from "react";
import { calcularAvisos } from "@/lib/warnings";
import type { Transcricao, CartaoPontoValue, HoleriteValue, HoleritePage } from "@/lib/types";

export default function RevisaoPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [t, setT] = useState<Transcricao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fetch(`/api/transcricoes/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.erro && !data.status) {
          setErro(data.erro);
        } else {
          setT(data);
        }
        setCarregando(false);
      })
      .catch(() => {
        setErro("Não foi possível carregar a transcrição.");
        setCarregando(false);
      });
  }, [id]);

  const salvar = useCallback(
    async (novoValue: Transcricao["value"]) => {
      setSalvando(true);
      try {
        const res = await fetch(`/api/transcricoes/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: novoValue }),
        });
        const data = await res.json();
        setT(data);
      } finally {
        setSalvando(false);
      }
    },
    [id]
  );

  if (carregando) return <div className="container">Carregando…</div>;
  if (erro || !t) return <div className="container erro">{erro || "Transcrição não encontrada."}</div>;

  if (t.status === "processando") {
    return (
      <div className="container">
        <div className="card">O documento ainda está sendo processado. Atualize a página em alguns segundos.</div>
      </div>
    );
  }
  if (t.status === "erro") {
    return (
      <div className="container">
        <div className="card erro">Falha ao processar: {t.erro}</div>
      </div>
    );
  }

  const avisos = calcularAvisos(t);

  return (
    <div className="revisao-wrap">
      <div className="painel-pdf">
        <iframe src={`/api/transcricoes/${id}/pdf`} title="PDF original" />
      </div>
      <div className="painel-tabela">
        <div className="topo-revisao">
          <h2>{t.tipo === "cartao-ponto" ? "Cartão de Ponto" : "Holerite"} — Revisão</h2>
          <div className="acoes-download">
            <a href={`/api/transcricoes/${id}/planilha?formato=xlsx`}>
              <button type="button">Baixar .xlsx</button>
            </a>
            <a href={`/api/transcricoes/${id}/planilha?formato=csv`}>
              <button type="button">.csv</button>
            </a>
            <a href={`/api/transcricoes/${id}/planilha?formato=json`}>
              <button type="button">.json</button>
            </a>
          </div>
        </div>

        {avisos.length > 0 && (
          <div className="avisos-lista">
            {avisos.map((a, i) => (
              <div key={i} className="aviso-item">
                {a.nivel === "atencao" ? "⚠️" : "ℹ️"} {a.mensagem}
              </div>
            ))}
          </div>
        )}
        {salvando && <div className="progresso">Salvando alterações…</div>}

        {t.tipo === "cartao-ponto" ? (
          <TabelaCartaoPonto t={t} onSalvar={salvar} />
        ) : (
          <TabelaHolerite t={t} onSalvar={salvar} />
        )}
      </div>
    </div>
  );
}

// ---------- Cartão de ponto ----------

function TabelaCartaoPonto({ t, onSalvar }: { t: Transcricao; onSalvar: (v: Transcricao["value"]) => void }) {
  const value = t.value as CartaoPontoValue;
  const linhas: { pageIdx: number; dayIdx: number; date_raw: string; punches: string[] }[] = [];
  let maxPares = 1;
  value.pages.forEach((page, pageIdx) => {
    page.days.forEach((day, dayIdx) => {
      maxPares = Math.max(maxPares, Math.ceil(day.punches.length / 2));
      linhas.push({ pageIdx, dayIdx, date_raw: day.date_raw, punches: day.punches.map((p) => p.time_hhmm) });
    });
  });

  function corLinha(date_raw: string, punches: string[], idx: number): "aviso-amarelo" | "aviso-vermelho" | "" {
    const diaNum = parseInt(date_raw, 10);
    const anteriorNum = idx > 0 ? parseInt(linhas[idx - 1].date_raw, 10) : null;
    if (!Number.isNaN(diaNum) && anteriorNum !== null && !Number.isNaN(anteriorNum) && diaNum !== anteriorNum + 1) {
      return "aviso-vermelho";
    }
    const impar = punches.length % 2 !== 0;
    const incerto = punches.some((p) => p.includes("?"));
    if (impar || incerto) return "aviso-amarelo";
    return "";
  }

  function editarCelula(pageIdx: number, dayIdx: number, campo: "data" | number, novoTexto: string) {
    const novo: CartaoPontoValue = JSON.parse(JSON.stringify(value));
    const day = novo.pages[pageIdx].days[dayIdx];
    if (campo === "data") {
      day.date_raw = novoTexto;
    } else {
      if (day.punches[campo]) {
        day.punches[campo].time_hhmm = novoTexto;
        day.punches[campo].time_raw = novoTexto;
      }
    }
    onSalvar(novo);
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Data</th>
          {Array.from({ length: maxPares }).map((_, i) => (
            <th key={i} colSpan={2}>
              Entrada {i + 1} / Saída {i + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((linha, idx) => (
          <tr key={idx} className={corLinha(linha.date_raw, linha.punches, idx)}>
            <td
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => editarCelula(linha.pageIdx, linha.dayIdx, "data", e.currentTarget.textContent || "")}
            >
              {linha.date_raw}
            </td>
            {Array.from({ length: maxPares * 2 }).map((_, i) => (
              <td
                key={i}
                contentEditable
                suppressContentEditableWarning
                className={linha.punches[i]?.includes("?") ? "badge-incerto" : ""}
                onBlur={(e) => editarCelula(linha.pageIdx, linha.dayIdx, i, e.currentTarget.textContent || "")}
              >
                {linha.punches[i] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Holerite ----------

function TabelaHolerite({ t, onSalvar }: { t: Transcricao; onSalvar: (v: Transcricao["value"]) => void }) {
  const value = t.value as HoleriteValue;
  const labels: string[] = [];
  const labelSet = new Set<string>();
  value.pages.forEach((p) => p.fields.forEach((f) => {
    if (!labelSet.has(f.label)) {
      labelSet.add(f.label);
      labels.push(f.label);
    }
  }));

  function corLinha(page: HoleritePage, idx: number): "aviso-amarelo" | "aviso-vermelho" | "" {
    const vazia = page.fields.length === 0 && page.bases.length === 0;
    if (page.month && page.year) {
      // Compara com a ultima pagina anterior que tinha competencia legivel,
      // pulando as que nao deu para ler — nao so a imediatamente anterior.
      let anterior: HoleritePage | null = null;
      for (let j = idx - 1; j >= 0; j--) {
        if (value.pages[j].month && value.pages[j].year) {
          anterior = value.pages[j];
          break;
        }
      }
      if (anterior) {
        const mes = Number(page.month);
        const ano = Number(page.year);
        const am = Number(anterior.month);
        const aa = Number(anterior.year);
        const espMes = am === 12 ? 1 : am + 1;
        const espAno = am === 12 ? aa + 1 : aa;
        if (mes !== espMes || ano !== espAno) return "aviso-vermelho";
      }
    }
    const incerto = page.fields.some((f) => f.value.includes("?") || f.reference.includes("?"));
    if (vazia || incerto) return "aviso-amarelo";
    return "";
  }

  function editarCelula(pageIdx: number, label: string, novoTexto: string) {
    const novo: HoleriteValue = JSON.parse(JSON.stringify(value));
    const page = novo.pages[pageIdx];
    const existente = page.fields.find((f) => f.label === label);
    if (existente) {
      existente.value = novoTexto;
    } else if (novoTexto.trim() !== "") {
      page.fields.push({ code: "", label, reference: "", value: novoTexto });
    }
    onSalvar(novo);
  }

  function editarMetaCelula(pageIdx: number, campo: "month" | "year", novoTexto: string) {
    const novo: HoleriteValue = JSON.parse(JSON.stringify(value));
    novo.pages[pageIdx][campo] = novoTexto;
    onSalvar(novo);
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Pág.</th>
          <th>Mês</th>
          <th>Ano</th>
          {labels.map((l) => (
            <th key={l}>{l}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {value.pages.map((page, idx) => (
          <tr key={idx} className={corLinha(page, idx)}>
            <td>{page.page}</td>
            <td contentEditable suppressContentEditableWarning onBlur={(e) => editarMetaCelula(idx, "month", e.currentTarget.textContent || "")}>
              {page.month}
            </td>
            <td contentEditable suppressContentEditableWarning onBlur={(e) => editarMetaCelula(idx, "year", e.currentTarget.textContent || "")}>
              {page.year}
            </td>
            {labels.map((label) => {
              const f = page.fields.find((f) => f.label === label);
              return (
                <td
                  key={label}
                  contentEditable
                  suppressContentEditableWarning
                  className={f?.value.includes("?") ? "badge-incerto" : ""}
                  onBlur={(e) => editarCelula(idx, label, e.currentTarget.textContent || "")}
                >
                  {f?.value ?? ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
