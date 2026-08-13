# SOLUCAO.md

## Como rodar

```
docker compose up
```

Abre em `http://localhost:3000`. Não precisa de nenhuma variável de ambiente
para rodar local — os padrões em `.env.example` já funcionam. Para mudá-los,
copie para `.env` e ajuste antes do `docker compose up`.

Sem Docker (desenvolvimento):

```
npm install
npm run dev
```

Fora do Docker, a aplicação depende de dois pacotes de sistema que o
`Dockerfile` instala sozinho dentro da imagem, mas que **você precisa
instalar manualmente na sua máquina** para rodar com `npm run dev`/`npm
start`: **poppler-utils** (fornece `pdfinfo`/`pdftotext`/`pdftoppm`, usados
em todo PDF, com ou sem OCR) e **Tesseract** com o idioma português. Sem
eles, qualquer upload falha com erro tipo `Falha ao executar pdfinfo:
comando nao encontrado no sistema`.

- macOS: `brew install poppler tesseract tesseract-lang`
- Debian/Ubuntu: `sudo apt install poppler-utils tesseract-ocr tesseract-ocr-por`
- Windows: mais simples rodar via Docker, ou usar o WSL e seguir o comando do Ubuntu acima.

## Stack

- **Next.js (App Router) + TypeScript**, um único serviço para API e
  interface — evita duplicar deploy/infra para "backend" e "frontend".
- **Extração de PDF**: `pdftotext -layout` (poppler) para a camada de texto
  nativa; `pdftoppm` + **Tesseract** (com modelo `por`) para OCR quando a
  página não tem texto extraível. Escolhi Tesseract em vez de um serviço de
  nuvem (Google Vision, AWS Textract) porque roda inteiramente offline
  dentro do container, sem depender de uma chave de API paga nem de rede em
  produção — trade-off é qualidade de OCR abaixo da de um serviço comercial
  em scans muito degradados (ver "Onde não confio", abaixo).
- **exceljs** para gerar o `.xlsx` com as cores exigidas.
- Sem banco de dados — cada transcrição é um JSON em disco
  (`DATA_DIR/transcricoes/<id>.json`) e o PDF original em
  `DATA_DIR/pdfs/<id>.pdf`. Ver "retenção" abaixo.

## Arquitetura (pipeline único, dois extratores)

Envio, fila, revisão, edição e download são o mesmo código para os dois
tipos de documento. O que muda é:

- `src/lib/extract/cartaoPonto.ts` e `src/lib/extract/holerite.ts` — leitura
- `src/lib/spreadsheet.ts` — forma da planilha (matriz por dia vs. matriz por página)
- O componente de tabela na tela de revisão (`TabelaCartaoPonto` /
  `TabelaHolerite`), que segue as mesmas colunas da planilha

`src/lib/extract/pdfSource.ts` e `textUtils.ts` são 100% compartilhados
entre os dois extratores (leitura de PDF, decisão texto-nativo-vs-OCR,
mascaramento de incerteza, parsing de células por coluna).

O processamento roda fora do ciclo de vida do request HTTP
(`src/lib/process.ts`): o `POST` grava o job como `processando` e devolve
`202` na hora; o processamento real acontece depois, no mesmo processo
Node. Isso evita o erro clássico de "processar dentro do request" que o
enunciado cita — mas veja a limitação de escala na seção "o que quebra
primeiro em produção".

## Decisões técnicas (3+)

1. **Reconstrução de "layout" a partir de posições, não parsing por
   template fixo.** Tanto para texto nativo (`pdftotext -layout`) quanto
   para OCR (reconstruo um texto em colunas a partir das coordenadas X/Y do
   Tesseract), os parsers trabalham sobre um texto com espaçamento que
   preserva colunas, e localizam campos por regex/palavras-chave a partir
   do cabeçalho — não por posição x/y fixa. Isso é o que permite o mesmo
   parser de holerite ler 3 layouts visualmente diferentes (ficha
   financeira, holerite simples, holerite com verba de ajuste) sem
   condicional por documento.

2. **Separação `fields` vs. `bases` por dicionário de palavras-chave**
   (`BASE`, `TOTAL`, `TOT`, `LÍQUID`, `FGTS`, `RECOLHER`, comparado sem
   acento/pontuação), não por posição na página. É frágil para holerites
   fora dos 4 exemplos que usem nomenclatura diferente da lista do próprio
   enunciado — documentado em "onde não confio".

3. **OCR: confiança por palavra, mascaramento por valor inteiro.** O
   Tesseract expõe confiança por palavra, não por caractere. O enunciado
   pede granularidade por caractere (`"2.3?9,77"`); eu me aproximei disso
   mascarando **o valor inteiro** quando a confiança média da página fica
   abaixo de 70 — mais conservador que o ideal (perde granularidade), mas
   nunca inventa um dígito. Documentado como corte deliberado.

4. **Sem fila externa (Redis/SQS).** Para o volume de um desafio (poucos
   uploads, um único processo), `setTimeout` dentro do próprio processo
   Node é suficiente e não exige infra extra. Não escala e não sobrevive a
   um restart do processo no meio de um job — ver próxima seção.

## O que quebra primeiro em produção

O processamento roda **dentro do mesmo processo Node**, sem fila externa.
Se o processo reiniciar (deploy, crash, OOM) enquanto um documento está
`processando`, aquele job fica preso nesse estado para sempre — não há
persistência do "trabalho pendente", só do resultado. Em produção de
verdade isso vira uma fila real (Redis/BullMQ, SQS) com um worker separado,
que sobrevive a reinícios e permite escalar horizontalmente. Também não há
limite de concorrência: uploads simultâneos demais processam tudo ao mesmo
tempo e competem por CPU (o Tesseract é pesado), sem fila de prioridade —
com uploads suficientes ao mesmo tempo, o tempo de resposta de cada um
degrada, mesmo que o servidor continue respondendo (ver nota abaixo).

**Nota**: todas as chamadas a `pdftotext`/`pdftoppm`/`tesseract` são
assíncronas (`execFile` promisificado, não `spawnSync`) — isso não é o
mesmo que ter fila/concorrência controlada, mas evita o problema mais
grave, que é o processo inteiro travar e parar de responder a *qualquer*
requisição (inclusive o healthcheck) enquanto uma página escaneada
processa. Essa era, inclusive, a versão original desta seção — o bug foi
descoberto e corrigido depois do primeiro deploy real; ver `PROCESSO.md`.

## Onde não confio

- **Holerite escaneado (`payroll-04.pdf`)**: o OCR em si tem boa confiança
  (~90%), mas a reconstrução de colunas lado a lado (Proventos | Descontos)
  a partir de coordenadas X quantizadas às vezes junta texto de colunas
  vizinhas na mesma linha reconstruída, embaralhando alguns rótulos (ex.:
  "INSS MES" virou só "MES" num teste). Também não implementei o padrão de
  competência "Referência: SETEMBRO/2019" quando o rótulo e o valor caem em
  colunas distantes na linha reconstruída — nesse documento a competência
  fica vazia e a página é sinalizada como tal.
- **Cartão de ponto muito degradado (`time-card-04.pdf`, confiança OCR
  ~39%)**: a extração honestamente não encontra nem os marcadores de dia —
  a saída fica com 5 páginas vazias, sinalizadas, em vez de inventar
  qualquer coisa. Prefiro isso a um resultado "bonito" e errado, mas é a
  entrega mais fraca dos 8 exemplos.
- **Classificação `fields` vs. `bases` por palavra-chave**: funciona bem
  nos 4 holerites de exemplo, mas rodapés com nomenclatura diferente da
  lista do enunciado (`Base INSS`, `Base IR`, `FGTS`, `Total Vencimentos`,
  `Valor Líquido`) podem cair no lado errado.
- **Mascaramento de incerteza por valor inteiro, não por caractere** (ver
  decisão 3, acima).
- Não testei com nenhum holerite/cartão de ponto fora dos 8 exemplos
  fornecidos — a extração foi desenhada olhando para eles, então
  generaliza até onde os padrões se repetem, mas não tenho garantia além
  disso.

## Assimetria entre os dois tipos

Cartão de ponto ficou com leitura mais confiável que holerite nos 4
exemplos — os 3 layouts de cartão de ponto (com e sem OCR) bateram
exatamente com o texto de origem depois de uma rodada de revisão que
encontrou e corrigiu 3 bugs reais (dia colado ao dia-da-semana pelo OCR
apagando um dia inteiro; timestamp de rodapé vazando como batida; duas
colunas de resumo preenchidas ao mesmo tempo escapando da heurística
inicial — todos detalhados no `PROCESSO.md`). Holerite tem a limitação de
coluna dupla descrita acima no único exemplo escaneado, sem correção
equivalente por falta de tempo.

Vale registrar como isso foi encontrado: não foi só reler o código, foi
reprocessar os 8 PDFs de novo e rodar uma varredura automática (sequência
de dias contínua? contagem de batida por dia plausível?) que uma simples
checagem de contrato campo a campo não pega — esse tipo de verificação
estrutural é o que vale a pena repetir a cada mudança no extrator.

## Segurança e privacidade

- **Validação de upload**: verifica os primeiros bytes do arquivo
  (`%PDF-`), não só a extensão — um `.txt` renomeado para `.pdf` é
  rejeitado com `400`, não processado como se fosse um documento válido.
- **Limite de tamanho**: `MAX_UPLOAD_BYTES` (padrão 20 MB), configurável
  por variável de ambiente; acima disso, `413`.
- **Arquivo corrompido**: se o PDF passa na checagem de magic bytes mas
  falha na extração real (`pdfinfo`/`pdftotext`/`tesseract` retornam erro),
  o job termina com `status: "erro"` e mensagem legível — não derruba o
  servidor.
- **Uploads simultâneos**: cada upload grava em um arquivo próprio
  (`uuid`), sem estado compartilhado mutável entre requests — não há
  race condition entre uploads concorrentes, ainda que não haja limite de
  quantos processam ao mesmo tempo (ver "o que quebra primeiro").
- **Retenção**: PDFs e transcrições ficam em `DATA_DIR` (volume Docker
  nomeado) por `RETENTION_HOURS` (padrão 24h). `limparExpirados()`
  (`src/lib/store.ts`) roda a cada novo upload (`POST
  /api/transcricoes`) e remove o que passou da validade — não é um cron
  dedicado, mas garante que a limpeza acontece com uso normal da aplicação
  sem depender de infra extra.
- **PII em log**: a aplicação não loga corpo de request, nome de arquivo
  enviado pelo usuário, nem conteúdo de transcrição — só erros técnicos
  (mensagem de exceção), sem dado do documento.
- **Sem segredo no repositório**: toda configuração é por variável de
  ambiente (`.env.example` documenta as disponíveis); nada de chave de API
  hardcoded (nem precisa, já que o OCR é local).

## Testes

Não escrevi testes automatizados formais neste momento — validei manualmente
com os 8 PDFs de `exemplos/`, rodando cada extrator isoladamente e depois o
pipeline completo via HTTP (`curl`) para holerite, cartão de ponto com texto
nativo e cartão de ponto escaneado, incluindo o caso degradado. Se fosse
escrever os testes que me dariam confiança para uma segunda entrega, seriam
poucos e focados nos pontos que mais quebram silenciosamente: (1) que todo
dia de 1 a N aparece no cartão de ponto mesmo sem batida — é o erro de
"perder linha em silêncio" citado no `INSTRUCOES.md`; (2) que uma verba
"Base ..." nunca cai em `fields`; (3) que editar um valor via `PUT` e depois
baixar a planilha reflete a edição.

## Bônus implementados

- **Ficha financeira**: `payroll-01.pdf` (holerite anual com várias
  competências na mesma página) já é tratado nativamente — cada mês vira
  uma entrada própria em `pages[]`, compartilhando o mesmo `page`, conforme
  descrito no enunciado.

Não implementados: rastreabilidade visual (exigiria carregar coordenadas
por todo o pipeline, que corta com a decisão de não amarrar a posições
fixas), detecção automática do tipo de documento, e um detector dedicado de
"layout desconhecido" (o comportamento mais próximo que existe é a página
vazia sinalizada quando nada é extraído, tanto para holerite quanto para
cartão de ponto).