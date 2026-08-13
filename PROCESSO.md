# PROCESSO.md

## Ferramentas usadas

A solução inteira — extração, API, interface, Docker, documentação — foi
construída em conversa com o **Claude** (Anthropic), rodando com acesso a um
ambiente Linux sandboxed (shell, Node, leitura/escrita de arquivo), sem
outro assistente de código no meio. O fluxo foi: eu descrevia o objetivo ou
apontava um problema, o agente lia o `README.md`/`INSTRUCOES.md` do
repositório, escrevia o código, e **testava contra os PDFs reais de
`exemplos/`** antes de seguir — não só escreveu código, rodou e conferiu
saída real linha a linha em vários pontos.

## Pontos em que o agente errou ou pegou o caminho errado

1. **Índices trocados no TSV do Tesseract.** Na primeira versão da
   reconstrução de layout a partir do OCR, os índices das colunas
   `block_num`/`par_num`/`line_num`/`top` do TSV do Tesseract estavam
   deslocados (pegando `level` no lugar de `block_num`, por exemplo). O
   sintoma não foi um erro — foi uma saída visualmente plausível mas
   embaralhada, com palavras de linhas diferentes misturadas fora de
   ordem. Só ficou óbvio comparando o texto reconstruído contra a imagem
   renderizada da página lado a lado. Corrigido reindexando conforme a
   especificação oficial das colunas do TSV.

2. **Falso positivo na detecção de "página escaneada".** A primeira
   heurística considerava uma página como "tem texto nativo" só pelo
   número de caracteres extraídos. Isso falhou num holerite escaneado
   (`payroll-04.pdf`) cuja única camada de texto real era um carimbo de
   assinatura eletrônica ("Assinado eletronicamente por... Juntado em
   20/10/2022 10:07:11") — tinha caracteres suficientes para passar no
   limiar, então a página nunca caía para OCR e voltava vazia. Percebi
   isso porque o resultado da extração vinha vazio para uma página que,
   olhando a imagem renderizada, claramente tinha uma tabela de valores.
   A correção também teve uma segunda rodada de erro: a regex adicionada
   para detectar "tem horário" (`\d{1,2}:\d{2}`) inicialmente dava falso
   positivo no *próprio* timestamp do carimbo (`10:07:11` batia como
   `10:07`) — precisou de negative lookahead/lookbehind para não contar
   pares `HH:MM` que fazem parte de um `HH:MM:SS`.

3. **Planilha do holerite na forma errada na primeira versão.** O
   `README.md` foi lido no começo da sessão, mas o conteúdo saiu do
   contexto da conversa antes da etapa de gerar a planilha, e o agente
   implementou uma tabela "uma linha por verba" em vez da matriz exigida
   (colunas fixas `Pág./Mês/Ano` + uma coluna por verba distinta, uma
   linha por página). Percebido ao reler o `README.md` de propósito antes
   de seguir para o Docker — comparação lado a lado mostrou a divergência,
   e a planilha (e a tabela de revisão, que segue as mesmas colunas) foram
   reescritas.

4. **Zumbi de processo ocupando a porta durante os testes.** Não é um erro
   de leitura de documento, mas vale registrar: ao testar o servidor
   repetidas vezes, um processo `node` de uma tentativa anterior continuou
   vivo em segundo plano e respondia na porta 3000 com uma versão antiga
   do build (sem as páginas do frontend, por isso `404` em `/` e
   `/revisao/:id`). Diagnosticado inspecionando `/proc` diretamente para
   achar o PID real (o `pkill` por nome de comando não estava encontrando
   o processo) e matando por PID.

## Revisão pós-entrega: 3 bugs reais encontrados e corrigidos

Depois da primeira entrega, pedi para o agente revisar tudo de novo antes
de eu enviar. Em vez de só reabrir os arquivos, ele reprocessou os 8 PDFs
de novo, escreveu um script que varre a saída em busca de sequências de
dia quebradas e contagens de batida suspeitas, e usou isso para achar 3
bugs que não tinham aparecido nos testes anteriores (que validavam campo a
campo, mas não essa varredura sistemática):

5. **Dia colado ao dia-da-semana pelo OCR apagava um dia inteiro.** No
   `time-card-02.pdf`, o OCR às vezes funde o número do dia com a
   abreviação do dia da semana sem espaço (`"14QUA"` em vez de
   `"14 QUA"`). A regex de início de dia exigia espaço ali, então a linha
   inteira deixava de ser reconhecida como "início de dia" e virava,
   silenciosamente, uma "continuação" do dia anterior — juntando as
   batidas dos dois dias num só e apagando o outro dia do resultado (dias
   14 e 21 de julho/2010 sumiam, dia 13 e 20 apareciam com 8 batidas em
   vez de 4). Achado ao rodar um script que confere se a sequência de dias
   de cada página é contínua. Corrigido tornando o espaço opcional na
   regex.
6. **Timestamp de rodapé (impressão/assinatura) vazando como batida do
   último dia da página.** Linhas de rodapé como `"Impresso por: ... em 31
   de outubro de 2025 - 14:53:48"` ou `"Documento assinado eletronicamente
   ... às 17:21:32"` têm formato `HH:MM:SS`, que bate no mesmo regex de
   horário. Como essas linhas não começam com um marcador de dia, caíam na
   mesma lógica de "linha de continuação" e eram anexadas ao último dia da
   página, inflando-o com 2 batidas falsas. Corrigido parando de processar
   linhas assim que um marcador de rodapé conhecido aparece.
7. **Duas colunas de resumo preenchidas ao mesmo tempo escapavam da
   heurística de paridade.** Uma correção anterior (ainda dentro da mesma
   sessão de desenvolvimento) já tinha corrigido o caso de uma coluna de
   resumo (H.Ext, Atraso, Ad.Not, Abono) vazando como batida extra, usando
   "se o total de horários da linha é ímpar, descarta o último". Mas
   quando duas colunas de resumo vêm preenchidas juntas (comum em dias de
   hora extra noturna, que preenchem H.Ext *e* Ad.Not), o total vira par e
   a heurística não pega — 16 dias do `time-card-03.pdf` tinham 6 batidas
   em vez de 4. Corrigido de forma mais robusta: em vez de contar
   paridade, o agente localiza a coluna de texto onde os títulos de
   resumo (`H.Ext`, `Atraso`, `Ad.Not`, `Abono`) começam no cabeçalho da
   própria tabela, e descarta qualquer horário que apareça a partir
   dali — não importa quantos sejam.

Todos os 3 foram encontrados comparando a saída contra o texto/imagem
original do PDF, não só olhando se o JSON "parecia" razoável — e os 3
tinham passado batido na bateria de testes da entrega original, que
conferia campo a campo mas não essa característica estrutural (sequência
contínua de dias, contagem de batida por dia). As planilhas em
`entregaveis/planilhas/` já refletem essas correções.

## Deploy: 2 bugs que só apareceram num Docker/Git de verdade

O sandbox onde a solução foi construída não tinha Docker disponível, então
o `Dockerfile` nunca tinha sido buildado de verdade, nem o repositório
clonado de um Git remoto, antes do deploy na Render:

8. **`ca-certificates` faltando na imagem `node:20-bookworm-slim`.** A
   imagem "slim" não vem com o bundle de certificados raiz — sem isso, o
   `curl` não consegue validar o certificado HTTPS do GitHub e falha com
   `exit code 77` (`Problem with the SSL CA cert`). Diagnosticado direto
   pelo código de saída do erro nos logs da Render; a correção foi
   adicionar `ca-certificates` à lista de pacotes instalados via
   `apt-get`, e trocar as flags do `curl` de `-sL` para `-fsSL` (o `-f`
   faz o build falhar alto se o download retornar erro HTTP, em vez de
   silenciosamente salvar uma página de erro como se fosse o arquivo do
   modelo — outra forma do mesmo princípio de "nunca aceitar dado ruim
   calado").
9. **Pasta `public/` vazia não foi versionada pelo Git, quebrando o
   `COPY` no Dockerfile.** O projeto nunca teve nenhum arquivo estático
   dentro de `public/` — a pasta existia localmente, mas o Git não
   versiona diretórios vazios. Ao dar `git push`, a pasta simplesmente não
   foi para o repositório remoto, e a Render, ao clonar o código, falhava
   o build com `"/app/public": not found` na etapa `COPY --from=build
   /app/public ./public`. Corrigido colocando um `robots.txt` mínimo
   dentro de `public/`, garantindo que a pasta sempre tenha conteúdo e o
   Git a rastreie.

Vale registrar a lição comum aos dois: testar `npm run build`, os
extratores e a API localmente (o que foi feito extensivamente) não
substitui buildar a imagem a partir de um clone Git real pelo menos uma
vez — são ambientes diferentes (`node:20-bookworm-slim` minimalista e um
`git clone` limpo vs. o sistema do sandbox de desenvolvimento, que já
tinha tudo instalado e nunca passou por um `git add`) e só um deploy real
expõe esse tipo de lacuna.

## Bug em produção: OCR síncrono travava o servidor inteiro

Com o app já publicado e no ar, ao enviar o `payroll-04.pdf` (o holerite
escaneado, que precisa de OCR em 5 páginas), a aplicação passou a dar
"Não foi possível conectar ao servidor" e a Render começou a devolver
`502`. Depois de reiniciar, a transcrição que tinha sido criada não era
mais encontrada.

10. **`spawnSync` no pipeline de OCR bloqueava o event loop inteiro do
    Node.** `pdfSource.ts` chamava `pdftoppm`/`tesseract` de forma
    **síncrona** (`spawnSync`). Enquanto uma página escaneada processava
    (o que pode levar vários segundos), o processo Node ficava incapaz de
    responder a **qualquer** outra requisição — inclusive o próprio
    healthcheck da plataforma de deploy. A Render, sem resposta do
    healthcheck, reiniciava o container; como o disco não é persistente
    no free tier, a transcrição em andamento se perdia. Esse não era um
    problema só do arquivo maior — era um bug de arquitetura que travaria
    o servidor para *qualquer* usuário simultâneo, não só para quem
    enviou o PDF pesado. Corrigido trocando todas as chamadas de
    `spawnSync` por `execFile` assíncrono (via `util.promisify`), e
    propagando `async`/`await` pelos dois extratores e pelo processamento
    em segundo plano.

    Validado de forma objetiva, não só "parece ter funcionado": subi o
    servidor localmente, disparei o processamento do `payroll-04.pdf` e,
    enquanto ele ainda estava rodando (confirmado pelo status
    `"processando"`), bombardeei `/healthz` 25 vezes em sequência — todas
    voltaram `200` em menos de 60ms cada. Antes da correção, essas
    chamadas ficariam penduradas até o OCR terminar.

## "Está demorando mais que o esperado": lentidão em CPU fraca, não bug

Depois da correção anterior, o usuário relatou que o frontend passou a
mostrar "O processamento está demorando mais que o esperado" ao enviar
`payroll-04.pdf` e `time-card-02.pdf` — os dois documentos que precisam de
OCR. Isso não era mais o servidor travado (já corrigido): era o frontend
desistindo de esperar cedo demais, porque o processamento em si estava
demorando mais do que no ambiente de desenvolvimento — plausivelmente por
causa da CPU bem mais fraca/compartilhada do plano gratuito de deploy
(Tesseract e um trabalho pesado de CPU).

Duas mudanças, uma delas revertida:

11. **Tempo de espera do frontend aumentado de 90s para 8 minutos**, com
    mensagem de progresso mostrando o tempo decorrido, e — se mesmo assim
    estourar — um link para a página de revisão em vez de um beco sem
    saída (o processamento continua rodando no servidor mesmo depois que o
    frontend desiste de esperar; o job nao é cancelado).
12. **Tentativa de reduzir a resolução do OCR de 300 para 200 DPI para
    acelerar o processamento — testada e revertida.** A hipótese fazia
    sentido (menos pixels = Tesseract mais rápido), e de fato reduziu o
    tempo do `payroll-04.pdf` de volta a poucos segundos. Mas testar contra
    o `time-card-02.pdf` mostrou uma regressão real: com 200 DPI, 3 dias
    que antes liam perfeitamente voltaram a ter contagens de batida
    erradas — a resolução mais baixa piorou o OCR o suficiente para
    reintroduzir os bugs de "dia colado ao dia da semana" e "coluna de
    resumo vazando" descritos mais acima (a leitura do cabeçalho da tabela,
    de que a correção da coluna de resumo depende, ficou pior). Como
    precisão dos dados pesa mais que velocidade aqui, revertido para 300
    DPI. Em vez disso, foi adicionado um **timeout de 120s por comando**
    (`pdftotext`/`pdftoppm`/`tesseract`) — não acelera nada, mas garante
    que um comando nunca fica pendurado indefinidamente; se estourar, vira
    um erro claro na transcrição em vez de um travamento silencioso.

Vale o registro: a correção óbvia/rápida (baixar a resolução) tinha um
custo real que só apareceu testando contra um documento diferente do que
motivou a mudança — testar só o caso que gerou a reclamação não seria
suficiente aqui.

## O que reescrevi/ajustei manualmente (fora do agente)

Nada foi editado por mim fora da conversa — toda a solução, incluindo as
correções acima, foi feita através do agente. Onde eu intervim foi na
**direção**: pedi revisão explícita em dois pontos antes de deixar seguir
(depois da leitura de PDF/OCR, e depois do parser de holerite), e dei a
instrução de cortar escopo do frontend caso o enunciado não pedisse — o
agente então apontou que a interface era, na verdade, requisito obrigatório
do `README.md` (seção "A interface"), e eu decidi manter.

---

## As 3 perguntas do enunciado

### 1. Três decisões em que havia mais de uma resposta razoável

- **Confiança do OCR: mascarar o valor inteiro, não por caractere.** O
  Tesseract só expõe confiança por palavra. Dava para (a) ignorar
  confiança e nunca mascarar, (b) mascarar o valor inteiro quando a
  confiança da página cai abaixo de um limiar, ou (c) tentar inferir
  confiança por caractere a partir de heurísticas indiretas (ex. caixa
  delimitadora do caractere dentro da palavra). Escolhi (b): é mais
  conservador que o ideal do enunciado, mas nunca inventa dígito e é
  simples o suficiente para confiar no comportamento sob prazo.

- **Classificar `fields` vs. `bases` por palavra-chave, não por posição na
  página.** Alternativas: (a) assumir que bases sempre vêm depois de uma
  certa posição Y na página (frágil — quebra entre os 3 layouts de
  holerite diferentes que os exemplos têm), ou (b) um dicionário de
  palavras-chave (`BASE`, `TOTAL`, `FGTS`, `LÍQUIDO`, `RECOLHER`) aplicado
  ao rótulo, comparado sem acento/pontuação. Escolhi (b) porque generaliza
  entre layouts sem hardcodar coordenadas — trade-off documentado em
  `SOLUCAO.md`.

- **Ficha financeira: várias competências na mesma página do PDF viram
  várias entradas com o mesmo `page`.** O enunciado descreve isso como
  bônus, mas um dos 4 exemplos de holerite (`payroll-01.pdf`) É uma ficha
  financeira — sem tratar esse caso, o exemplo inteiro sairia como uma
  bagunça de 30 meses achatados numa única entrada. Decidi tratar como
  parte do "core" em vez de bônus à parte, porque sem isso um dos quatro
  documentos de holerite simplesmente não funciona.

### 2. O que na solução quebra primeiro em produção

O processamento assíncrono roda dentro do mesmo processo Node, sem fila
externa (Redis/SQS) e sem persistência de "trabalho pendente" — só do
resultado. Um restart do processo no meio de um job perde aquele job (ele
fica preso em `processando` para sempre). Isso também limita concorrência:
não há fila nem limite de quantos documentos processam ao mesmo tempo, e o
Tesseract é pesado o suficiente para competir por CPU sob carga.

### 3. Onde não confio no que entreguei

- A separação de colunas do OCR em documentos escaneados com layout de
  duas colunas lado a lado (Proventos | Descontos) — a reconstrução por
  coordenada X quantizada pode juntar texto de colunas vizinhas na mesma
  linha reconstruída, como aconteceu em `payroll-04.pdf`.
- O cartão de ponto mais degradado da amostra (`time-card-04.pdf`,
  confiança de OCR ~39%) não produz nenhum dado — nem os marcadores de dia
  são reconhecidos. É honesto (não inventa nada), mas é a entrega mais
  fraca dos 8 exemplos.
- O dicionário de palavras-chave para `bases` foi calibrado nos 4 exemplos
  de holerite fornecidos; não tenho garantia de que generaliza para
  holerites com nomenclatura de rodapé diferente.
- Não escrevi testes automatizados formais — validei manualmente contra os
  8 exemplos (extratores isolados + pipeline completo via HTTP). Ver
  `SOLUCAO.md`, seção "Testes", para quais eu escreveria com mais tempo.