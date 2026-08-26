# Cruzamento de títulos não encontrados no estoque — desenho

## Objetivo

Recuperar, por chaves alternativas ao "seu número", títulos do arquivo de baixa que o matching automático classificou como `NOT_FOUND`, apresentando-os como sugestões auditáveis que o operador revisa e aceita — sem alterar o processamento do arquivo nem as regras de remessa e conciliação.

## Diagnóstico que motiva o desenho

Medições feitas no schema `OSHER` (somente leitura) em 2026-08-26:

- **A causa raiz é normalização de documento, não o "seu número".** O parser de baixas grava `debtorDocument` somente com dígitos (`consignado-parsers.ts`), enquanto o estoque grava `DOC_SACADO` como veio da origem (`consignado-stock-service.ts`, apenas `trim()`). Das 740.087 posições do estoque ativo, **740.087 têm CPF com pontuação e nenhuma tem somente dígitos**. A cláusula `debtorDocument: { contains: digits(...) }` do `loadCandidates` portanto nunca casa, e o matching depende exclusivamente de `yourNumber`/`documentNumber`.
- **Não existe vínculo estrutural de contrato entre arquivo e estoque.** A hipótese de o contrato do arquivo (11 dígitos, ex. `97031061001`) ser prefixo do `your_number` do estoque foi testada e casa em **1 de 80** itens não encontrados. O originador renumera os títulos no estoque (ex.: as 8 parcelas de um sacado aparecem como `463283`…`463291`).
- **A chave viável é sacado + valor nominal + vencimento.** Recuperação medida em dois lotes reais:

  | Lote | `NOT_FOUND` | Vencimento exato | Só sacado + valor | Sem candidato |
  |---|---|---|---|---|
  | `Liquidacao__20_08_2026` | 80 | 62 | 1 | 17 |
  | `Liquidacao__06_08_2026` | 95 | 41 | 28 | 26 |

- **Quando o vencimento não bate, o padrão é estável:** o vencimento do arquivo é anterior a tudo que restou no estoque, e a parcela em aberto mais antiga vence exatamente um mês depois, preservando o dia (`23/07 → 23/08`, `23/04 → 23/05`, `21/04 → 21/05`). Em 20 casos inspecionados, 19 seguiam esse padrão e 1 estava a dois meses.
- **Relaxar o valor não compensa.** Dos 17 itens sem candidato do lote de 20/08, apenas 5 encontram algo pelo par CPF + vencimento, e com valor materialmente diferente (`R$ 24,53` contra `R$ 27,60`; `R$ 195,35` contra `R$ 168,98`). Esses itens permanecem não encontrados.
- **Ambiguidade existe e é resolvível.** No lote de 20/08 duas linhas de `R$ 41,80` vencendo em 23/08 do mesmo sacado casam com dois títulos do estoque — duas linhas para dois títulos, pareáveis um a um.

## Arquitetura aprovada

### Motor puro

`apps/web/src/server/operational/consignado-cross-match.ts` expõe uma função sem acesso a banco:

```
buildCrossMatchSuggestions({ source, items, candidates, blockedPositionIds })
  -> { suggestions, unmatched }
```

- Normaliza documento (somente dígitos) e nome (NFD sem acentuação, maiúsculo, espaços colapsados) **nos dois lados** da comparação.
- Monta o pool de cada item com as posições que satisfazem, simultaneamente: mesmo sacado por documento **ou** por nome normalizado; diferença de valor nominal menor que `0,01`; posição não bloqueada; e cedente compatível com o fluxo do arquivo, reutilizando a regra de `sourceMatches` para que um arquivo BMP nunca case com título UY3.
- Classifica cada sugestão em um grupo:

  | Grupo | Regra | Aceite em lote |
  |---|---|---|
  | `FULL_KEY` | vencimento do estoque igual ao do arquivo | sim |
  | `OLDEST_NEXT_MONTH` | sem vencimento exato; menor vencimento em aberto, exatamente um mês após o do arquivo | sim |
  | `OLDEST_WIDE_GAP` | sem vencimento exato; menor vencimento em aberto, intervalo diferente de um mês | não |

  "Exatamente um mês" significa o mês civil seguinte preservando o dia: `23/07/2026 → 23/08/2026`, `21/04/2026 → 21/05/2026`. Quando o dia não existe no mês seguinte, vale o último dia do mês (`31/01 → 28/02`). Qualquer outro intervalo, incluindo vencimento do estoque anterior ao do arquivo, cai em `OLDEST_WIDE_GAP`.

- Itens com pool vazio retornam em `unmatched` e seguem como `NOT_FOUND`.
- **Alocação um-para-um:** os itens são percorridos em ordem determinística (grupo `FULL_KEY` antes dos demais, depois `sourceRow` crescente) e cada item consome sua posição, que é removida do pool de todos os outros. Quando o pool de um item esvazia por consumo, ele volta para `unmatched`.
- Dentro de um mesmo pool o desempate é determinístico: menor `documentNumber` (parcela), depois menor `yourNumber`, depois `id`.

### Serviço e API

`apps/web/src/server/operational/consignado-cross-match-service.ts` concentra o acesso a dados, para não ampliar o `consignado-settlement-service.ts`, que já passa de 40 KB.

- `GET /api/operacional/consignado/baixas/[batchId]/cruzamento` devolve as sugestões e **não grava nada**. Carrega os itens `NOT_FOUND` do lote, monta o pool do estoque e aplica o motor, enriquecendo o retorno com os dados do título sugerido.

O pool é carregado por igualdade exata em `debtorDocument`, gerando para cada item as variantes possíveis do documento: os dígitos puros, a máscara de CPF (`NNN.NNN.NNN-NN`, para 11 dígitos) e a máscara de CNPJ (`NN.NNN.NNN/NNNN-NN`, para 14 dígitos). Isso aproveita o índice `@@index([batchId, debtorDocument])` e dispensa SQL cru, ao custo de tolerar apenas esses formatos — que cobrem 100% do estoque medido. Itens sem documento são buscados por `debtorName` com comparação insensível a caixa, e a normalização completa do nome é aplicada depois, já no motor.
- `POST` na mesma rota, recebendo `{ itemIds }`, aplica as sugestões.

O `POST` aceita **somente `itemIds`, nunca `positionIds`**: o servidor recalcula as sugestões no momento da aplicação e usa o resultado recomputado. Uma tela desatualizada não consegue, portanto, baixar um título diferente do que o motor indica no instante da gravação.

Ambas as rotas exigem `operational.finance.manage`, como as demais rotas de baixas.

### Persistência

A aplicação reutiliza o caminho já existente de correção manual, dentro de uma transação por lote de aceite:

- `ConsignadoSettlementItem` passa a `MANUALLY_MATCHED`, com `matchedStockPositionId` preenchido e `approved = true`.
- `ConsignadoManualCorrection` recebe a justificativa automática descrevendo a chave que casou e a confiança.
- `ConsignadoStatusEvent` registra o evento com `metadata` contendo grupo, campos casados, vencimento do arquivo, vencimento do estoque e distância em meses.
- `refreshBatchTotals` é chamado ao final, como nas demais decisões de item.

**Nenhuma migration é necessária.** O enum `SettlementItemStatus` permanece inalterado.

### Bloqueio de reutilização

Uma posição é considerada bloqueada, e nunca sugerida, quando já está vinculada a um item aprovado do próprio lote ou quando aparece em `ConsignadoRemittanceItem` de remessa não cancelada — as mesmas duas guardas que `correctSettlementItem` aplica hoje. A verificação é refeita dentro da transação de aplicação.

### Interface

`apps/web/src/features/operational/components/ConsignadoCrossMatchPanel.tsx` passa a renderizar o conteúdo da aba "Não encontrados no estoque", que hoje vive dentro do já denso `ConsignadoSettlementPanel.tsx`.

O painel oferece o botão "Cruzar títulos com IA", que dispara o `GET` e apresenta quatro blocos com contagem e valor somado: chave completa, parcela mais antiga com um mês de intervalo, parcela mais antiga com intervalo maior, e sem sugestão. Os dois primeiros blocos têm botão de aceite em lote. Todos os itens mantêm o botão "Usar este" individual, a busca manual por candidatos e o "Seguir sem este título" que já existem.

## Restrições

- Não alterar `chooseCandidate`, `loadCandidates` nem qualquer regra do processamento do arquivo. Um título continua chegando como `NOT_FOUND` e só o cruzamento explícito o recupera. A soma dos pesos de documento, nome, valor e vencimento no scorer atual dá exatamente 60, o limiar de aceite — corrigir a normalização no import mudaria silenciosamente a classificação de todos os títulos, não apenas destes.
- Não alterar regras de remessa, conciliação bancária, PDD ou diferenças.
- Não criar migration nem alterar o enum de status.
- Não sugerir posição bloqueada, nem a mesma posição para dois itens.
- Não cruzar títulos entre fluxos diferentes (BMP contra UY3).
- Não gravar nada na etapa de sugestão.
- Não aceitar alvo escolhido pelo cliente na aplicação.

## Decisão de negócio registrada

Nos grupos `OLDEST_NEXT_MONTH` e `OLDEST_WIDE_GAP` o pagamento refere-se a uma parcela atrasada que já saiu do estoque, e a baixa recai sobre uma parcela ainda não vencida. O recurso entrou e precisa ser baixado contra algum título, mas o efeito é reduzir o estoque de um título ainda em aberto. A regra foi proposta e confirmada pela área em 2026-08-26; a separação do grupo de intervalo maior existe para que esses casos sejam sempre revisados individualmente.

## Testes

`apps/web/src/server/operational/consignado-cross-match.test.ts`, com `node:test` sobre a função pura, incluído no script `test:operational`:

- documento formatado no estoque casa com documento sem pontuação do arquivo;
- nome com acentuação e espaço duplicado casa após normalização;
- vencimento idêntico produz `FULL_KEY`;
- sem vencimento exato, a parcela mais antiga é escolhida; um mês de intervalo produz `OLDEST_NEXT_MONTH` e intervalo maior produz `OLDEST_WIDE_GAP`;
- posição bloqueada nunca é sugerida;
- arquivo BMP não recebe sugestão de título de cedente UY3;
- duas linhas equivalentes disputando duas posições equivalentes recebem uma posição cada;
- item cuja única posição foi consumida por outro item retorna em `unmatched`;
- item sem candidato retorna em `unmatched`;
- a mesma entrada produz sempre a mesma saída.
