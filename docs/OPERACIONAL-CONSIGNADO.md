# Operacional do Consignado — arquitetura e operação

> Estado verificado na branch de entrega em 20/08/2026. Este documento registra o fluxo operacional, as regras implementadas, o rollout ainda necessário e as pendências conhecidas.

## Objetivo

Construir em `Operacional > Financeiro > Conciliação de Fundos` a operação diária do fundo Consignado, cobrindo:

1. estoque histórico importado manualmente;
2. processamento diário de baixas BMP e UY3;
3. revisão e correção de títulos não encontrados;
4. geração manual da remessa CNAB 444 para o Daycoval;
5. conciliação bancária muitos-para-muitos;
6. confirmação das baixas pelo estoque seguinte.

O desenho deve permitir que, futuramente, uma API substitua o upload manual do estoque sem alterar as regras de baixa e conciliação.

## Escopo da primeira versão

### Incluído

- Estoque do Consignado por upload `.xlsx`.
- Fluxos diários BMP e UY3.
- Originadores BMP: GIBB, JUCA e BANKERIZE.
- Baixas completas e parciais.
- Correção manual de títulos não encontrados.
- Geração e download manual de CNAB 444.
- Upload de extrato Bradesco `.csv`.
- Conciliação de várias entradas com várias remessas.
- Confirmação da baixa pela ausência do título no estoque posterior.
- Base histórica de títulos baixados por PDD e identificação de recuperações.
- Registro e relatório dos títulos que ficaram fora de cada remessa.
- Composição da diferença bancária com títulos excluídos e pendências auditáveis "Outros".
- Totais em quantidade e valor pago em cada classificação de revisão.
- Navegação estrutural por breadcrumbs entre Operacional, Financeiro, Conciliação e Consignado.

### Fora da primeira versão

- Baixa manual HBI.
- Geração de novas baixas de PDD (a base histórica é importada somente para reconhecer recuperações).
- Envio de remessa ao custodiante por API.
- Importação de arquivo de retorno do custodiante.
- QPROF como dependência obrigatória para BMP ou UY3.

## Decisões funcionais fechadas

### Estoque

- O upload é histórico: um snapshot nunca substitui fisicamente outro.
- O fundo e a data de referência são identificados pelo arquivo.
- O mesmo arquivo não pode ser processado duas vezes.
- Uma nova versão para a mesma data exige confirmação e mantém a versão anterior.
- Apenas um snapshot por fundo/data fica ativo para novos processamentos.
- A futura API deve gravar pela mesma camada de ingestão, mudando apenas a origem de `MANUAL_UPLOAD` para `API`.

### Baixas

- O lote BMP exige a seleção do originador antes do upload.
- GIBB, JUCA e BANKERIZE não são inferidos do estoque; são metadados do lote operacional.
- Código BMP `77` representa baixa completa.
- Código BMP `14`, com valor pago menor que o valor de face no estoque, representa baixa parcial.
- Código e valores incoerentes geram divergência e não entram automaticamente na remessa.
- Títulos encontrados podem gerar remessa mesmo que outras linhas do lote não sejam encontradas.
- Linhas excluídas nunca são descartadas silenciosamente: permanecem no lote com motivo e valor.
- Arquivo diário repetido gera aviso com a data do processamento anterior, mas pode ser reprocessado após confirmação.
- Lotes podem ser filtrados pela data em que foram processados no OSHER.
- Um lote sem remessa ativa pode ser cancelado e retirado da visualização; seus dados e eventos permanecem armazenados para auditoria.
- Cada filtro de classificação apresenta quantidade de títulos e soma do valor pago.
- Ocorrências `77` pagas abaixo da face são separadas por diferença de até 10%, acima de 10% com vários títulos do mesmo sacado e acima de 10% com título avulso.
- Sacados com múltiplos títulos permitem liberação agrupada; títulos avulsos acima de 10% permanecem para análise individual.
- A pesquisa de candidatos apresenta também o vencimento de cada título.

### Recuperações de PDD

- A planilha consolidada de PDD é importada de forma incremental e histórica.
- A manutenção e o upload da base histórica ficam em uma aba secundária da tela de baixas, fora do fluxo diário padrão.
- O arquivo é identificado por SHA-256; uma nova tentativa com o mesmo arquivo não duplica títulos.
- Linhas são deduplicadas pelo vínculo entre remessa, linha PDD, CPF e identificadores do título.
- O matching contra o estoque ativo sempre tem prioridade.
- Somente títulos não encontrados no estoque são pesquisados na base PDD.
- Match exato por CPF e identificador, ou por CPF + vencimento + valor, recebe `PDD_RECOVERY`.
- Mais de um título histórico possível recebe `PDD_REVIEW` e continua pendente de análise.
- Uma recuperação confirmada por PDD fica visível no lote, com valor pago, título histórico, baixa original, vencimento, valor nominal, valor PDD e remessa histórica.
- Recuperações de PDD não são incluídas na nova remessa ao custodiante.
- A importação reclassifica também itens `NOT_FOUND` de lotes abertos já existentes.
- Lotes com remessa gerada ou cancelados não são reclassificados retroativamente.

### Correção manual

- O operador pode substituir um contrato não encontrado por outro título existente no estoque.
- A remessa usa todos os dados oficiais do título substituto, não apenas o novo número.
- O valor, o título original, o substituto, o usuário, a data e a justificativa ficam auditados.
- Um título substituto não pode ser usado duas vezes no mesmo lote nem em outra remessa ativa.

### Cruzamento de títulos não encontrados

Quando o "seu número" do arquivo não existe no estoque, o título é classificado como `NOT_FOUND` e vai para a aba "Não encontrados no estoque". O botão **Cruzar títulos com IA** procura o título por chaves alternativas: mesmo sacado (CPF quando os dois lados têm documento, nome normalizado quando falta), mesmo valor nominal com tolerância de um centavo, e vencimento. Nada é gravado nessa etapa.

As sugestões saem em três grupos:

- **Chave completa** — sacado, valor e vencimento idênticos. Aceita aprovação em lote.
- **Parcela mais antiga (um mês)** — não existe vencimento igual no estoque; é indicada a parcela em aberto mais antiga, que vence exatamente um mês depois. Caso típico de pagamento atrasado cuja parcela já saiu do estoque. Aceita aprovação em lote.
- **Parcela mais antiga (intervalo maior)** — mesma regra, mas o intervalo não é de um mês. Só aceita aprovação individual.

Cada posição do estoque é alocada a um único item, e posições já aprovadas no lote ou presentes em remessa não cancelada nunca são sugeridas. Um item que tinha candidata de vencimento exato e a perdeu para outra linha não cai para a regra da parcela mais antiga: fica sem sugestão. Ao aceitar, o item vira `MANUALLY_MATCHED` com justificativa automática em `ConsignadoManualCorrection` e um `ConsignadoStatusEvent` guardando grupo, campos casados e os dois vencimentos.

A aplicação recalcula as sugestões no servidor e só aceita `itemIds` do cliente, nunca o título de destino.

**Atenção ao formato do documento:** o estoque grava `debtor_document` formatado (`NNN.NNN.NNN-NN`) e o parser de baixas grava só dígitos. Qualquer comparação de documento entre as duas bases precisa normalizar os dois lados.

### Conciliação bancária

- Somente créditos positivos do extrato entram na conciliação.
- Saldo anterior, débitos, totais, rodapés e linhas vazias são ignorados.
- Uploads bancários sobrepostos não duplicam entradas.
- Uma ou várias entradas podem conciliar uma ou várias remessas.
- Ao abrir a tela, todas as entradas pendentes ou parciais são exibidas; o operador pode filtrar pela data da movimentação e retornar a `Todas em aberto`.
- O resumo global informa quantidade de entradas não conciliadas e saldo total em aberto, independentemente do filtro aplicado.
- A alocação real nunca pode superar o saldo disponível da entrada ou da remessa.
- Quando a entrada excede a remessa, a composição deve fechar exatamente `entrada = remessa + títulos fora da remessa + Outros`.
- Títulos são usados integralmente pelo snapshot de valor pago, nunca parcialmente, e não podem explicar um excedente da remessa.
- Se a remessa excede a entrada, a diferença é explicada somente por `Outros`, na direção calculada pelo sistema.
- A composição não admite tolerância automática: qualquer centavo ainda não explicado impede a conclusão.
- Valor alocado e valor ajustado são armazenados separadamente.
- O estorno reverte alocações e ajustes, recalcula os estados dos dois lados, cancela pendências `Outros` e libera os títulos, sem apagar histórico.
- Itens conciliados continuam acessíveis no histórico.
- Cada lote recolhido exibe valor pago no arquivo, valor efetivo da remessa e estado financeiro (`sem remessa`, `não conciliado`, `parcialmente conciliado` ou `conciliado`).
- Conciliações ativas exibem no lote as entradas bancárias vinculadas, incluindo data, descrição, documento, valor da entrada, valor alocado e data da conciliação; vínculos desfeitos deixam de compor o log.

### Conciliação pelo estoque

- Remessa gerada sem estoque posterior: `AWAITING_NEXT_STOCK`.
- Título ausente no primeiro snapshot posterior válido: `CONFIRMED`.
- Título ainda presente: `STILL_IN_STOCK`.
- Divergência de identificação: `REVIEW_REQUIRED`.

## Validação do arquivo de referência

Arquivo analisado: `05.08.xlsx`.

- Fundo: `LIBRA CONSIGNADO FIDC DE RL`.
- CNPJ: `54.842.157/0001-93`.
- Data de referência: `2026-08-05` em todas as linhas.
- Total: 174.792 posições.
- BMP: 167.346 posições considerando as duas denominações encontradas.
- UY3: 5.875 posições.
- HBI: 1.561 posições.
- Libra Garantidora: 10 posições.
- O arquivo possui aproximadamente 29 MB.
- A chave lógica atual de `FIDC_ESTOQUES` colide em 408 linhas; não deve ser usada para descartar posições.
- `SEU_NUMERO` aparece como texto, inteiro e decimal. Identificadores devem ser persistidos como texto.
- Os 1.561 identificadores HBI numéricos possuem risco de perda de precisão no Excel; serão alertados, mas HBI não faz parte do primeiro fluxo.
- `NOME_ORIGINADOR` vem como `LIBRA SOLUCOES EM COBRANCA LTDA` em todas as posições e não identifica GIBB, JUCA ou BANKERIZE.

## Arquitetura de ingestão do estoque

### Base canônica

Reaproveitar `ImportBatch` e `ReceivableStockPosition`, ajustando-os para a operação. Não criar uma terceira tabela de posições e não inserir o arquivo diretamente em `FIDC_ESTOQUES` sem resolver suas colisões e ausência de lote.

O lote deve guardar, no mínimo:

- fundo;
- data de referência;
- origem;
- nome, tamanho, hash e chave privada do arquivo;
- versão e indicador de snapshot ativo;
- usuário;
- total de linhas, importadas, rejeitadas e alertas;
- status e progresso;
- datas de início e término;
- mensagem de erro.

Cada posição deve preservar:

- lote e número da linha;
- hash da linha;
- fundo, originador e cedente originais;
- sacado e documentos;
- `SEU_NUMERO` e `NU_DOCUMENTO` como texto;
- valores financeiros como `Decimal`;
- vencimentos, aquisição, emissão e referência;
- situação do recebível;
- demais campos necessários para matching e auditoria.

### Upload grande

O arquivo não deve atravessar uma Server Action ou Function como `multipart/form-data` porque excede o limite de payload da Vercel.

Fluxo planejado:

1. navegador solicita autorização de upload;
2. arquivo é enviado diretamente para armazenamento privado;
3. OSHER registra o lote pendente;
4. worker baixa o arquivo e processa em segundo plano;
5. posições são persistidas em blocos;
6. interface consulta progresso;
7. snapshot só é ativado após conclusão integral;
8. falha mantém o snapshot anterior ativo e permite retry.

O arquivo original deve permanecer privado e acessível apenas a usuários autorizados.

## Modelo funcional da operação

### Lote de baixa

Estados previstos:

`UPLOADED -> PROCESSING -> REVIEW_REQUIRED | READY -> APPROVED -> GENERATED -> RECONCILING -> RECONCILED`

Estados de falha ou cancelamento devem preservar todos os dados já auditados.

### Item de baixa

Classificações previstas:

- `FULL_MATCH`: encontrado e baixa completa;
- `PARTIAL_MATCH`: encontrado e baixa parcial;
- `NOT_FOUND`: nenhum candidato válido;
- `AMBIGUOUS`: mais de um candidato válido;
- `DIVERGENT`: título encontrado com dados incoerentes;
- `DUPLICATE`: repetido no lote ou já usado;
- `MANUALLY_MATCHED`: corrigido pelo operador;
- `EXCLUDED`: não incluído na remessa.
- `PDD_RECOVERY`: título ausente do estoque e identificado de forma exata na base histórica de PDD;
- `PDD_REVIEW`: mais de um título histórico de PDD pode corresponder ao recebimento.

### Totais do resultado

- títulos e valor recebidos;
- títulos e valor encontrados;
- baixas completas;
- baixas parciais;
- não encontrados;
- divergentes e ambíguos;
- títulos e valor incluídos na remessa;
- títulos e valor excluídos.

## Backlog executável

### Status em 20/08/2026

- ✅ OC-01 — implementada e validada em build.
- ✅ OC-02 — implementada; requer Blob privado configurado no ambiente publicado.
- ✅ OC-03 — implementada e incluída na navegação do Financeiro.
- ✅ OC-04 — modelo de lotes, itens, originadores, correções, remessas e eventos.
- ✅ OC-05 — parser BMP CNAB 444 validado com arquivo real e ocorrências 14/77.
- ✅ OC-06 — parser UY3 validado com as variações reais de cabeçalho.
- ✅ OC-07 — matching determinístico contra o snapshot ativo e proteção contra duplicidade.
- ✅ OC-08 — revisão, pesquisa, exclusão e substituição manual auditada.
- ✅ OC-09 — geração privada do CNAB 444 Daycoval em Latin-1/CRLF.
- ✅ OC-10 — importador idempotente do extrato Bradesco em cp1252.
- ✅ OC-11 — conciliação bancária muitos-para-muitos com saldos e reversão.
- ✅ OC-12 — confirmação automática pelo primeiro estoque ativo posterior.
- ✅ OC-12A — aviso e confirmação para reprocessamento de arquivo diário repetido.
- ✅ OC-12B — revisão de antecipações por faixas, recorrência do sacado e totais monetários.
- ✅ OC-12C — base histórica de PDD, importação idempotente, matching secundário e filtro de recuperações.
- ✅ OC-12D — filtros de lotes/entradas, cancelamento lógico de lotes e conciliação com diferença justificada.
- ✅ Conciliação por títulos excluídos — implementação, documentação e migration `20260820000000_add_consignado_remittance_exclusions` aplicada no schema `OSHER` em 2026-08-20; checklist pós-migration e checklist de concorrência real validados (duas conciliações `Serializable` disputando o mesmo título contra o Postgres do Railway: uma venceu, a outra foi rejeitada por conflito de escrita, título liberado após desfazer). Achado corrigido nesse teste: as transações de criar/desfazer conciliação usavam o timeout padrão do Prisma (5s), curto demais para o número de passos sequenciais da transação somado à latência real de rede — subiram para `maxWait: 5s` / `timeout: 15s`; o erro de conflito de serialização (`P2034`) agora vira mensagem amigável na API em vez do texto cru do Prisma.
- ✅ Ajustes de UX pós-homologação (2026-08-20): aba "Títulos fora da remessa" movida para o nav principal de Baixas (antes só um link no cabeçalho de "Lotes de baixa"); situação `AVAILABLE` renomeada de "Disponível" para "Pendente" (título casou com o estoque mas ainda não foi conciliado); filtros do relatório de exclusões validados um a um contra dados reais — sem bugs encontrados no backend.
- ✅ Backfill `20260820200000_backfill_consignado_legacy_other_differences`: as 4 conciliações `ACTIVE` fechadas antes desta funcionalidade existir (18-19/08, diferença só em texto livre, sem título/Outro associado) ganharam pendência `OTHER`/`OPEN` correspondente, preservando o motivo original como razão — R$ 997,58 que estavam invisíveis na aba "Diferenças e ajustes" agora aparecem como pendência de verdade. Migration idempotente: só atinge reconciliações sem nenhum título/Outro, o que o fluxo novo nunca deixa acontecer.
- ✅ Navegação estrutural — breadcrumbs e retorno entre todas as páginas internas do Operacional.
- ⏳ OC-13 e OC-14 — indicadores consolidados e homologação final ainda pendentes.

## Implementação publicada

### Rotas

- `/dashboard/operacional/financeiro/conciliacao/consignado`: entrada da operação.
- `/dashboard/operacional/financeiro/conciliacao/consignado/estoques`: upload, ativação e histórico dos snapshots.
- `/dashboard/operacional/financeiro/conciliacao/consignado/baixas`: processamento BMP/UY3, revisão, PDD e remessas.
- `/dashboard/operacional/financeiro/conciliacao/consignado/baixas/titulos-fora-remessa`: relatório e Excel dos títulos excluídos.
- `/dashboard/operacional/financeiro/conciliacao/consignado/conciliacao-bancaria`: extrato, pendências e conciliações.
- `/dashboard/operacional/financeiro/conciliacao/consignado/conciliacao-bancaria/diferencas`: acompanhamento, Excel e resolução das pendências `Outros`.

### Serviços

- `consignado-stock-service.ts`: ingestão e ativação do estoque.
- `consignado-parsers.ts`: leitura dos arquivos BMP e UY3.
- `consignado-settlement-service.ts`: matching, decisões, totais e geração de remessa.
- `consignado-remittance-exclusions.ts`: classificação determinística e snapshots dos títulos excluídos.
- `consignado-pdd-service.ts`: importação histórica e classificação das recuperações de PDD.
- `consignado-cnab.ts`: geração CNAB 444 Daycoval.
- `consignado-bank-service.ts`: extrato e conciliação bancária.
- `consignado-reconciliation.ts`: planejamento determinístico das alocações e ajustes N:N.
- `consignado-exclusion-report.ts`: filtros, agregados e workbook dos títulos fora da remessa.
- `consignado-difference-report.ts`: filtros, agregados, workbook e resolução das pendências `Outros`.
- `consignado-date.ts`: validação das datas bancárias e faixa diária de processamento em São Paulo.

### Persistência de PDD

- `consignado_pdd_imports`: auditoria de cada arquivo importado, usuário, hash e contadores.
- `consignado_pdd_titles`: títulos históricos, identificadores, valores, vencimentos e origem da baixa.
- `consignado_settlement_items.matched_pdd_title_id`: vínculo opcional entre recebimento e baixa histórica.
- Migration: `20260810150000_add_consignado_pdd_history`.
- Migration aplicada no banco compartilhado do schema `OSHER` em 10/08/2026.

### Infraestrutura de upload

- O estoque grande usa Vercel Blob privado e autorização OIDC, evitando transportar o XLSX pela Function.
- A base PDD atual tem volume compatível com upload autenticado pela rota do módulo; o limite publicado é 15 MB.
- Arquivos reais permanecem fora do Git.

### Persistência dos ajustes bancários

- `consignado_bank_allocations`: relacionamentos financeiros efetivos entre entradas e remessas.
- `consignado_bank_adjustments`: excedentes justificados associados a uma entrada ou remessa.
- `adjusted_amount`: parcela encerrada por ajuste, separada de `allocated_amount`.
- `entry_total_amount`, `remittance_total_amount`, `difference_amount` e `difference_reason`: memória auditável da conciliação.
- Migration: `20260818000000_add_consignado_bank_adjustments` aplicada no schema `OSHER`.

## Conciliação por títulos fora da remessa

### Geração e retroalimentação dos títulos excluídos

Ao gerar uma nova remessa, a mesma transação que grava o CNAB registra um snapshot para cada item do lote que não entrou na remessa. O snapshot preserva remessa, item, categoria, motivo, valor pago e valor de face; o evento `REMITTANCE` registra também quantidade e valor pago excluídos.

A classificação segue esta precedência:

1. recuperação ou revisão de PDD (`PDD_RECOVERY`);
2. título não encontrado no estoque (`NOT_FOUND_IN_STOCK`);
3. exclusão explícita pelo operador (`OPERATOR_EXCLUDED`);
4. item não aprovado (`NOT_APPROVED`);
5. outra divergência (`OTHER_DIVERGENCE`).

A migration `20260820000000_add_consignado_remittance_exclusions` cria as tabelas `consignado_remittance_exclusions`, `consignado_bank_difference_titles` e `consignado_bank_other_differences`. Ela retroalimenta, de forma idempotente, itens sem `consignado_remittance_items` em remessas e lotes não cancelados. O `ON CONFLICT` por remessa/item torna uma reaplicação lógica inofensiva. As colunas e tabelas anteriores permanecem: esta entrega é aditiva e não altera os parsers BMP/UY3, o matching do estoque nem outros fundos.

### Equação, disponibilidade e conclusão

Para excesso da entrada, a igualdade vinculante é:

```text
entrada = remessa + títulos fora da remessa + Outros
```

O servidor recalcula a igualdade em `Prisma.Decimal`, com exatidão de centavos. A interface apenas auxilia a composição; IDs, saldos, vínculos e valores dos títulos são recarregados dentro da transação `Serializable`.

Um título pode ser selecionado no compositor somente quando:

- pertence a uma das remessas selecionadas;
- a remessa está ativa em `GENERATED` ou `RECONCILING` e o lote não está cancelado;
- não existe vínculo do título com outra conciliação `ACTIVE`;
- a direção é `ENTRY_EXCESS`;
- seu valor pago integral não supera o saldo que falta explicar.

O operador seleciona entradas e remessas e abre `Explicar diferença`. A composição mostra Entradas, Remessas, Diferença, Títulos selecionados, Outros e Falta explicar. Os títulos podem ser filtrados localmente por contrato, sacado, CPF e categoria. Se outro usuário consumir um título ou alterar um saldo antes da confirmação, o servidor rejeita toda a transação; a tela recarrega o workspace e limpa a composição obsoleta antes de permitir nova tentativa.

Quando houver `REMITTANCE_EXCESS`, títulos ficam indisponíveis e `Outros` deve explicar o valor integral na direção calculada. Em qualquer direção, o botão de concluir permanece bloqueado enquanto houver excesso, centavo aberto, valor inválido ou justificativa incompleta.

### Pendências `Outros`, resolução e auditoria

Cada parcela residual exige categoria, valor positivo e justificativa de pelo menos cinco caracteres. As categorias são tarifa bancária, crédito não identificado, diferença de valor, arredondamento, diferença temporal e outros. Uma conciliação concluída cria a pendência como `OPEN`, mesmo quando os saldos bancário e de remessa ficam encerrados.

A tela `Diferenças e ajustes bancários` apresenta quantidade e valor aberto, agrupamentos por categoria e direção, idade, origem, responsável e histórico. É possível filtrar por período, status, categoria, direção, entrada, remessa ou busca geral e exportar o mesmo conjunto para Excel. Resolver uma pendência `OPEN` exige nota com pelo menos cinco caracteres e grava `RESOLVED`, usuário e horário. Registros resolvidos saem dos indicadores de aberto, mas permanecem consultáveis.

Ao desfazer uma conciliação `ACTIVE`, a transação:

- restaura valores alocados e ajustados de entradas e remessas;
- recalcula os estados dos dois lados e do lote;
- marca a conciliação como `UNDONE`;
- marca suas pendências `Outros` como `CANCELLED` com horário de cancelamento;
- preserva os vínculos com títulos no histórico e volta a considerá-los disponíveis;
- cria evento `BANK_RECONCILIATION` com a transição e os IDs envolvidos.

Criação, desfazimento e resolução usam `ConsignadoStatusEvent`. O vínculo de cada título guarda o snapshot monetário utilizado; a resolução de `Outros` cria evento `BANK_OTHER_DIFFERENCE`. Não apague conciliações, vínculos ou pendências para corrigir a operação: use desfazimento ou resolução para preservar a trilha.

### Relatórios, Excel e limites recuperáveis

O relatório `Títulos fora da remessa` aceita período de geração, fluxo BMP/UY3, originador, arquivo/ID do lote, arquivo/ID da remessa, categoria, situação e busca por contrato, sacado ou CPF. As situações são `Disponível`, `Usado em conciliação ativa` e `Histórico desfeito`; uso ativo tem precedência quando também existe histórico desfeito.

O Excel é produzido em memória, sem arquivo intermediário no servidor, e usa exatamente os filtros da tela:

- títulos excluídos: abas `Resumo` e `Titulos`, com quantidade, valores de face/pago, agrupamentos e dados de lote, remessa, título, devedor e conciliação;
- diferenças `Outros`: abas `Resumo` e `Diferencas`, com agregados, origem, responsável, idade, status e resolução.

Tela e Excel percorrem no máximo 50.000 registros candidatos por consulta. Cada exportação aceita no máximo 10.000 linhas. Esses tetos se aplicam separadamente aos títulos excluídos e às diferenças `Outros`. Ao excedê-los, a API responde `422` com orientação para restringir os filtros; a página preserva os filtros válidos, remove cursor inválido e continua utilizável. Filtros inválidos retornam `400`. Falhas inesperadas retornam mensagem genérica, registram o detalhe somente no servidor e não expõem dados internos. Respostas JSON/XLSX são privadas e sem cache.

### Permissões reais

- `operational.view`: abrir as páginas, consultar detalhes, paginar e baixar os dois arquivos Excel.
- `operational.finance.manage`: importar extrato, selecionar títulos, registrar `Outros`, concluir ou desfazer conciliações e resolver pendências.

As rotas validam a permissão no servidor. Ocultar um botão não substitui o bloqueio da API. Não existe uma permissão alternativa `operational.manage` neste fluxo.

## Rollout seguro da migration

Não execute os passos seguintes diretamente em produção sem janela aprovada, backup testado e identificação explícita do schema `OSHER`. Nunca cole `DATABASE_URL`, senha ou token em terminal compartilhado, relatório, ticket ou Git.

1. Gerar backup lógico/restaurável do schema e registrar o ponto de restauração fora do repositório.
2. Aplicar a migration primeiro em banco PostgreSQL descartável ou staging com cópia anonimizada e a mesma versão da produção.
3. Confirmar `current_schema()`/`search_path`, revisar o SQL e executar `prisma migrate deploy` a partir de `packages/database`; não usar `migrate dev`, `db push` ou `migrate reset` no ambiente publicado.
4. Executar todo o checklist pós-migration abaixo. Qualquer divergência interrompe o rollout.
5. Publicar a aplicação somente depois da migration, validar uma remessa conhecida e realizar smoke tests de consulta, Excel, conciliação exata, conciliação com `Outros`, resolução e desfazimento.
6. Monitorar respostas `409`/erros de serialização, `422` por amplitude, falhas de Excel e crescimento de pendências abertas.

### Checklist pós-migration em PostgreSQL não produtivo

- [ ] Confirmar que a conexão aponta para o banco esperado e para o schema `OSHER`, sem imprimir a URL:

```sql
SELECT current_database(), current_schema(), current_setting('search_path');
```

- [ ] Confirmar a migration concluída e sem rollback registrado:

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name = '20260820000000_add_consignado_remittance_exclusions';
```

- [ ] Confirmar as três tabelas e a unicidade remessa/item:

```sql
SELECT
  to_regclass('consignado_remittance_exclusions') AS exclusions,
  to_regclass('consignado_bank_difference_titles') AS difference_titles,
  to_regclass('consignado_bank_other_differences') AS other_differences;

SELECT remittance_id, settlement_item_id, COUNT(*)
FROM consignado_remittance_exclusions
GROUP BY remittance_id, settlement_item_id
HAVING COUNT(*) > 1;
```

- [ ] Comparar contagem, valor pago e valor de face esperados e gravados pelo backfill, por remessa. A consulta deve retornar zero linhas:

```sql
WITH expected AS (
  SELECT r.id AS remittance_id,
         COUNT(*) AS title_count,
         COALESCE(SUM(i.paid_amount), 0) AS paid_amount,
         COALESCE(SUM(i.title_amount), 0) AS title_amount
  FROM consignado_remittances r
  JOIN consignado_settlement_batches b ON b.id = r.batch_id
  JOIN consignado_settlement_items i ON i.batch_id = b.id
  LEFT JOIN consignado_remittance_items ri ON ri.settlement_item_id = i.id
  WHERE r.status::text <> 'CANCELLED'
    AND b.status::text <> 'CANCELLED'
    AND ri.id IS NULL
  GROUP BY r.id
), actual AS (
  SELECT remittance_id,
         COUNT(*) AS title_count,
         COALESCE(SUM(paid_amount), 0) AS paid_amount,
         COALESCE(SUM(title_amount), 0) AS title_amount
  FROM consignado_remittance_exclusions
  GROUP BY remittance_id
)
SELECT COALESCE(e.remittance_id, a.remittance_id) AS remittance_id,
       e.title_count AS expected_count, a.title_count AS actual_count,
       e.paid_amount AS expected_paid, a.paid_amount AS actual_paid,
       e.title_amount AS expected_face, a.title_amount AS actual_face
FROM expected e
FULL JOIN actual a USING (remittance_id)
WHERE e.title_count IS DISTINCT FROM a.title_count
   OR e.paid_amount IS DISTINCT FROM a.paid_amount
   OR e.title_amount IS DISTINCT FROM a.title_amount;
```

- [ ] Registrar os agregados de controle por categoria, sem exportar CPF ou outros dados pessoais:

```sql
SELECT category, COUNT(*) AS titles,
       COALESCE(SUM(paid_amount), 0) AS paid_amount,
       COALESCE(SUM(title_amount), 0) AS title_amount
FROM consignado_remittance_exclusions
GROUP BY category
ORDER BY category;
```

- [ ] Validar a equação de todas as conciliações novas. Após os smoke tests, a consulta deve retornar zero linhas:

```sql
WITH title_totals AS (
  SELECT reconciliation_id, SUM(amount) AS amount
  FROM consignado_bank_difference_titles
  GROUP BY reconciliation_id
), other_totals AS (
  SELECT reconciliation_id, SUM(amount) AS amount
  FROM consignado_bank_other_differences
  GROUP BY reconciliation_id
)
SELECT r.id, r.entry_total_amount, r.remittance_total_amount,
       r.difference_amount,
       COALESCE(t.amount, 0) AS titles,
       COALESCE(o.amount, 0) AS others
FROM consignado_bank_reconciliations r
LEFT JOIN title_totals t ON t.reconciliation_id = r.id
LEFT JOIN other_totals o ON o.reconciliation_id = r.id
WHERE r.created_at >= :inicio_da_validacao
  AND (
    ABS(r.entry_total_amount - r.remittance_total_amount) <> r.difference_amount
    OR r.difference_amount <> COALESCE(t.amount, 0) + COALESCE(o.amount, 0)
  );
```

Substitua `:inicio_da_validacao` por um parâmetro da ferramenta SQL; não monte a data por concatenação.

- [ ] Confirmar que nenhum título participa de duas conciliações ativas e que não existe pendência `OPEN` ligada a conciliação desfeita. Ambas as consultas devem retornar zero linhas:

```sql
SELECT dt.remittance_exclusion_id, COUNT(DISTINCT dt.reconciliation_id)
FROM consignado_bank_difference_titles dt
JOIN consignado_bank_reconciliations r ON r.id = dt.reconciliation_id
WHERE r.status::text = 'ACTIVE'
GROUP BY dt.remittance_exclusion_id
HAVING COUNT(DISTINCT dt.reconciliation_id) > 1;

SELECT od.id, od.reconciliation_id
FROM consignado_bank_other_differences od
JOIN consignado_bank_reconciliations r ON r.id = od.reconciliation_id
WHERE od.status::text = 'OPEN' AND r.status::text <> 'ACTIVE';
```

- [ ] Confirmar que saldos persistidos permanecem entre zero e o valor original:

```sql
SELECT 'entry' AS entity, id, amount, allocated_amount, adjusted_amount
FROM consignado_bank_credit_entries
WHERE allocated_amount < 0 OR adjusted_amount < 0
   OR allocated_amount + adjusted_amount > amount
UNION ALL
SELECT 'remittance', id, total_amount, allocated_amount, adjusted_amount
FROM consignado_remittances
WHERE allocated_amount < 0 OR adjusted_amount < 0
   OR allocated_amount + adjusted_amount > total_amount;
```

### Checklist de concorrência PostgreSQL real

Este teste é obrigatório em PostgreSQL real de staging/local e não deve usar produção. Prepare uma entrada, uma remessa e um título excluído descartáveis, todos disponíveis, além de dois usuários com `operational.finance.manage`.

- [ ] Abrir dois clientes independentes da aplicação, ambos apontados para o mesmo banco PostgreSQL não produtivo.
- [ ] Preparar o mesmo payload válido nos dois clientes, com os mesmos `entryIds`, `remittanceIds` e `exclusionIds`.
- [ ] Disparar os dois `POST /api/operacional/consignado/conciliacoes` simultaneamente, preservando status e corpo das respostas como evidência sem cookies/tokens.
- [ ] Confirmar que exatamente uma operação concluiu e a outra foi rejeitada por conflito/estado atualizado; nenhuma resposta pode concluir duas conciliações ativas.
- [ ] Recarregar o workspace no cliente rejeitado e confirmar que o título deixou de estar disponível e que a composição obsoleta foi limpa.
- [ ] Rodar novamente as consultas de título ativo duplicado, equação e saldos acima; todas devem retornar zero linhas.
- [ ] Contar conciliações, vínculos e eventos criados para os IDs descartáveis e confirmar uma única trilha ativa.
- [ ] Desfazer a conciliação vencedora, confirmar a liberação do título e o cancelamento de `Outros`; repetir a seleção para comprovar que o recurso voltou a ficar disponível.

Uma falha de serialização do PostgreSQL é um resultado recuperável da corrida, não autorização para repetir cegamente. O operador deve recarregar o workspace antes de tentar novamente. Se ambas as operações concluírem, interrompa o rollout e preserve os dados de staging para diagnóstico.

### Rollback

Como a migration é aditiva e as colunas legadas foram preservadas, o primeiro rollback é da aplicação para a versão anterior, mantendo as novas tabelas no banco. Isso interrompe o uso do fluxo novo sem perda de auditoria.

Não use `prisma migrate reset`, não edite `_prisma_migrations` e não remova tipos/tabelas enquanto houver aplicação nova ou registros dependentes. Se for indispensável reverter também o banco, bloqueie escritas, preserve/exporte os três conjuntos novos, restaure o backup validado ou execute um roteiro SQL revisado especificamente para o incidente e somente depois confirme que nenhuma versão da aplicação referencia os objetos. Um rollback de banco deve ser tratado como mudança separada e aprovada; este runbook não autoriza DROP em produção.

### OC-01 — Fundação do estoque do Consignado

**Dependências:** nenhuma.
**Área exclusiva:** schema Prisma/migrations.

- Definir a evolução de `ImportBatch` e `ReceivableStockPosition`.
- Preservar cedente/originador originais sem regras analíticas que substituam UY3 pelo sacado.
- Adicionar versão, snapshot ativo, linha e hash de linha.
- Criar índices para data, cedente, documento, `SEU_NUMERO`, CPF e valores.
- Definir idempotência por fundo + origem + hash do arquivo.
- Garantir ativação atômica do snapshot.

**Aceite:** migration revisada; snapshots históricos coexistem; nenhuma das 174.792 linhas é descartada por colisão.

### OC-02 — Upload privado e processamento assíncrono

**Dependência:** OC-01.

- Implementar upload direto para armazenamento privado.
- Validar autenticação, permissão, extensão e tamanho.
- Criar lote e disparar processamento durável.
- Importar posições em blocos com progresso e retry.
- Impedir arquivo duplicado.
- Tratar nova versão da mesma data.

**Aceite:** `05.08.xlsx` é enviado sem passar pela Function, processado integralmente e o navegador permanece responsivo.

### OC-03 — Tela e histórico de estoques

**Dependência:** OC-02.

- Criar `Operacional > Financeiro > Conciliação de Fundos > Consignado > Estoques`.
- Exibir progresso, fundo/data detectados, quantidades, valores e distribuição por cedente.
- Listar versões, status, usuário e snapshot ativo.
- Exibir alertas de qualidade e falhas.

**Aceite:** operador acompanha o processamento e consulta qualquer snapshot sem apagar histórico.

### OC-04 — Modelo de lotes, itens e remessas

**Dependência:** OC-01.

- Modelar lote, item, artefato, correção manual e histórico de status.
- Cadastrar GIBB, JUCA e BANKERIZE como originadores BMP válidos.
- Relacionar cada lote ao snapshot utilizado.
- Definir idempotência e proteção contra reutilização de título.

**Aceite:** o banco representa o fluxo completo sem depender da interface.

### OC-05 — Parser diário BMP

**Dependência:** OC-04.

- Ler CNAB 444 e validar header, detalhes e trailer.
- Extrair identificadores, sacado, vencimento, face, pago e ocorrência.
- Exigir originador BMP no upload.
- Classificar `77` e `14` e sinalizar incoerências.
- Preservar arquivo e linha originais.

**Aceite:** fixtures reais BMP produzem o mesmo conjunto de detalhes esperado pelos relatórios atuais.

### OC-06 — Parser diário UY3

**Dependência:** OC-04.

- Ler as variações conhecidas da planilha UY3.
- Normalizar contrato, parcela, CPF, sacado, valores, vencimento e status.
- Calcular/validar `SEU_NUMERO` sem tornar QPROF obrigatório.
- Preservar alertas de parcela anterior em aberto.

**Aceite:** fixture UY3 conhecida é processada com totais e ocorrências esperados.

### OC-07 — Motor de matching contra estoque

**Dependências:** OC-03, OC-05 e OC-06.

- Relacionar por cedente, `SEU_NUMERO`, contrato, CPF, nome, valor e vencimento.
- Aplicar desempates determinísticos.
- Classificar completo, parcial, ausente, ambíguo, divergente e duplicado.
- Impedir correspondência com snapshot de data incompatível.
- Calcular todos os totais usando `Decimal`.

**Aceite:** resultado reproduz os casos reais já identificados nos relatórios de validação.

### OC-08 — Revisão e correção manual

**Dependência:** OC-07.

- Criar resumo e lista expansível de problemas.
- Permitir pesquisa de candidato por contrato, CPF, nome, valor e vencimento.
- Comparar título original e substituto.
- Exigir confirmação e justificativa.
- Recalcular totais e manter trilha de auditoria.
- Permitir seguir apenas com títulos aptos.

**Aceite:** substituição nunca apaga o dado original e não permite usar o mesmo título duas vezes.

### OC-09 — Gerador de remessa Daycoval

**Dependência:** OC-08.

- Gerar CNAB 444 por cedente/originador conforme a regra operacional.
- Preservar ocorrências `14` e `77` aprovadas.
- Validar sequenciais, duplicidades, header, detalhes e trailer.
- Gravar em Latin-1 com CRLF.
- Gerar auditoria e relatório de excluídos.
- Disponibilizar download privado e impedir geração duplicada.

**Aceite:** arquivos passam por validador estrutural e comparação com fixtures de produção.

### OC-10 — Importador de extrato Bradesco

**Dependência:** OC-04.

- Ler metadados de agência/conta e o CSV em `cp1252` com `;`.
- Importar somente créditos positivos.
- Deduplicar por conta, data, documento, valor, descrição e fingerprint.
- Aceitar movimentações sem `Dcto.`.
- Exibir resumo de novas, repetidas e ignoradas.

**Aceite:** reimportar o mesmo extrato cria zero entradas adicionais.

### OC-11 — Conciliação bancária muitos-para-muitos

**Dependências:** OC-09 e OC-10.

- Modelar conciliação e alocações entre entradas e remessas.
- Permitir múltipla seleção nos dois lados.
- Controlar valor alocado e saldo remanescente.
- Classificar pendente, parcial e conciliado.
- Permitir desfazer com permissão e auditoria.

**Aceite:** nenhuma alocação excede o saldo e os totais permanecem consistentes após criar ou desfazer relações.

### OC-12 — Conciliação pelo estoque seguinte

**Dependências:** OC-03 e OC-09.

- Processar automaticamente remessas aguardando um snapshot posterior.
- Comparar pelos identificadores definitivos usados na remessa.
- Marcar confirmados, ainda presentes e divergentes.
- Não reprocessar resultados já finalizados sem ação auditada.

**Aceite:** novo estoque atualiza o resultado das remessas anteriores e apresenta exceções ao operador.

### OC-13 — Indicadores, permissões e auditoria

**Dependências:** OC-03, OC-09, OC-11 e OC-12.

- Criar visão dos quatro fundos e acesso detalhado ao Consignado.
- Exibir estoque vigente, lotes, valores, pendências e conciliações.
- Separar visualizador, operador e administrador.
- Auditar uploads, aprovações, correções, geração, download e conciliações.

**Aceite:** ações mutáveis são bloqueadas no servidor para usuários sem permissão.

### OC-14 — Testes, benchmark e homologação

**Dependências:** todas as anteriores conforme cada entrega.

- Testes unitários de parsing, matching, valores e CNAB.
- Testes de idempotência, concorrência e rollback.
- Fixtures anonimizadas por cedente.
- Benchmark completo com `05.08.xlsx`.
- Homologação paralela com o processo atual antes de produção.
- Documentar operação, falhas e recuperação.

**Aceite:** resultados homologados contra o processo legado, sem divergências não explicadas.

## Ordem de entrega

1. OC-01 a OC-03: estoque confiável e consultável.
2. OC-04 a OC-09: baixa diária e remessa.
3. OC-10 e OC-11: conciliação bancária.
4. OC-12: confirmação pelo estoque seguinte.
5. OC-13 e OC-14: visão consolidada e homologação final.

## Regras de coordenação

- Somente o responsável por OC-01/OC-04 altera Prisma e migrations durante essa etapa.
- João pode trabalhar em outras abas, evitando os arquivos do módulo operacional do Consignado.
- Cada task deve ter branch/PR próprios ou commits claramente separados dentro da branch do épico.
- Nenhuma migration será aplicada no banco compartilhado antes de revisão do diff SQL e backup/rollback definido.
- Dados reais de estoque e extrato não entram no Git.
