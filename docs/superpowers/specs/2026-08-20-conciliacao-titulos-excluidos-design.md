# Conciliação de títulos excluídos e diferenças bancárias

## Objetivo

Transformar os títulos que ficaram fora de uma remessa do Consignado em registros operacionais explícitos, pesquisáveis, exportáveis e utilizáveis para explicar a diferença entre entradas bancárias e remessas durante a conciliação.

A conciliação deve obedecer, em centavos, à igualdade:

`total das entradas = total das remessas + títulos excluídos selecionados + outros ajustes`

Quando ainda existir saldo depois da seleção dos títulos, o operador poderá registrar um ou mais ajustes do tipo "Outro". Esses ajustes concluem a conciliação bancária, mas permanecem como pendências operacionais mensuráveis até serem resolvidos.

## Escopo

Esta entrega inclui:

- registro explícito dos títulos não incluídos quando uma remessa é gerada;
- retroalimentação idempotente das remessas históricas existentes;
- consulta consolidada com filtros e exportação Excel;
- seleção dos títulos excluídos dentro da conciliação bancária;
- registro separado do saldo residual em "Outros";
- página de diferenças e ajustes com resolução e histórico;
- suporte ao desfazimento da conciliação;
- testes automatizados das regras monetárias e operacionais;
- atualização da documentação operacional.

Não faz parte desta entrega:

- envio automático da remessa ao custodiante;
- alteração dos parsers BMP/UY3;
- mudanças no matching dos títulos contra o estoque;
- conciliação automática baseada em sugestões probabilísticas;
- alteração nos fluxos dos outros fundos.

## Conceitos e regras

### Título não encontrado

É um item do arquivo de baixa que não encontrou uma posição correspondente no estoque ativo durante o matching. Ele pode ser corrigido, aprovado ou excluído antes da geração da remessa.

### Título fora da remessa

É qualquer item do lote que não originou uma linha em `consignado_remittance_items` quando a remessa foi gerada. O registro é um snapshot auditável da decisão naquele momento e aponta explicitamente para a remessa e para o item de baixa.

"Não encontrado" e "fora da remessa" não são sinônimos: o primeiro descreve o resultado do matching; o segundo descreve o resultado final da geração. A tela deve permitir filtrar ambos sem perder essa distinção.

### Valor explicativo

O valor usado para explicar a diferença bancária é `paidAmount`, congelado no registro de exclusão. O valor de face continua disponível para consulta e Excel, mas não entra na igualdade da conciliação.

### Igualdade monetária

Todos os cálculos usam `Prisma.Decimal` e precisão de centavos. Não existe tolerância automática.

- Se entradas e remessas forem iguais, não há títulos nem ajustes.
- Se entradas forem maiores, o operador pode selecionar títulos excluídos das remessas escolhidas.
- O total dos títulos não pode superar a diferença.
- O saldo restante deve ser zero ou ser integralmente explicado por ajustes do tipo "Outro".
- Se remessas forem maiores que entradas, títulos excluídos não podem ser usados; toda a diferença precisa ser explicada por "Outro".
- Um título é selecionado sempre pelo seu valor integral. Não há uso parcial de um título.
- O botão de concluir fica desabilitado enquanto a soma não fechar exatamente.

### Disponibilidade de um título

Um título excluído está disponível quando:

- pertence a uma das remessas selecionadas;
- a remessa e o lote não estão cancelados;
- não está vinculado a outra conciliação ativa.

Uma mesma exclusão pode aparecer em mais de uma conciliação histórica somente quando as anteriores estiverem desfeitas. A validação deve ocorrer novamente dentro da transação de criação para impedir duplo uso concorrente.

## Modelo de dados

### `ConsignadoRemittanceExclusion`

Novo registro explícito para cada título que ficou fora de uma remessa:

- `id`
- `remittanceId`
- `settlementItemId`
- `category`
- `reason`
- `paidAmount`
- `titleAmount`
- `createdAt`

Restrições e índices:

- unicidade de `(remittanceId, settlementItemId)`;
- índice por `remittanceId` e `category`;
- índice por `settlementItemId`.

Categorias iniciais:

- `NOT_FOUND_IN_STOCK`
- `OPERATOR_EXCLUDED`
- `NOT_APPROVED`
- `PDD_RECOVERY`
- `OTHER_DIVERGENCE`

Os campos monetários são snapshots. Dados como contrato, sacado, CPF e vencimento continuam vindo do `ConsignadoSettlementItem`, preservado por relação restritiva.

### `ConsignadoBankDifferenceTitle`

Associação auditável entre a conciliação e a exclusão escolhida:

- `id`
- `reconciliationId`
- `remittanceExclusionId`
- `amount`
- `createdAt`

Restrições e índices:

- unicidade de `(reconciliationId, remittanceExclusionId)`;
- índice por `remittanceExclusionId`;
- `amount` copia o valor pago usado na conciliação.

Não haverá unicidade global da exclusão, pois uma conciliação desfeita deve liberar o título. O serviço impede vínculo simultâneo com mais de uma conciliação `ACTIVE`.

### `ConsignadoBankOtherDifference`

Pendência operacional para a parte não explicada por títulos:

- `id`
- `reconciliationId`
- `category`
- `direction`
- `amount`
- `reason`
- `status`
- `createdAt`
- `createdByUserId`
- `resolvedAt`
- `resolvedByUserId`
- `resolutionNote`
- `cancelledAt`

Categorias iniciais:

- `BANK_FEE`
- `UNIDENTIFIED_CREDIT`
- `VALUE_DIFFERENCE`
- `ROUNDING`
- `TIMING_DIFFERENCE`
- `OTHER`

Direções:

- `ENTRY_EXCESS`
- `REMITTANCE_EXCESS`

Status:

- `OPEN`
- `RESOLVED`
- `CANCELLED`

O modelo permite mais de um ajuste por conciliação, embora a primeira interface ofereça um único formulário e o botão "Adicionar outro ajuste" somente quando necessário.

### Relações existentes

`ConsignadoBankReconciliation` passa a expor `differenceTitles` e `otherDifferences`. `ConsignadoRemittance` e `ConsignadoSettlementItem` passam a expor suas exclusões.

Os campos atuais `differenceAmount` e `differenceReason` são mantidos por compatibilidade e auditoria. Novas conciliações gravam em `differenceAmount` a diferença bruta e usam `differenceReason` somente como resumo derivado; os detalhes vinculantes ficam nas novas tabelas.

## Retroalimentação histórica

A migration deve criar as estruturas e executar um `INSERT ... SELECT` idempotente para remessas existentes:

- selecionar itens do lote sem correspondente em `consignado_remittance_items`;
- excluir lotes e remessas cancelados;
- copiar `paid_amount` e `title_amount`;
- classificar por precedência: PDD, não encontrado no estoque, exclusão explícita do operador, não aprovado, outra divergência;
- preservar `status_reason` e `exclusion_reason` no campo `reason`;
- ignorar conflitos de `(remittance_id, settlement_item_id)`.

A aplicação também deve criar as exclusões dentro da mesma transação que gera novas remessas. Não deve depender apenas da retroalimentação da migration.

## Serviço de conciliação

O planejador puro de conciliação passa a receber:

- saldos das entradas selecionadas;
- saldos das remessas selecionadas;
- exclusões selecionadas com valor e remessa;
- outros ajustes com categoria, direção, valor e motivo.

Ele retorna:

- total de entradas;
- total de remessas;
- diferença bruta assinada e absoluta;
- total explicado por títulos;
- total explicado por outros ajustes;
- saldo ainda não explicado;
- alocações existentes entre entradas e remessas;
- ajustes contábeis necessários para encerrar os saldos.

O serviço transacional deve:

1. recarregar entradas, remessas e exclusões;
2. validar fundo, status, relacionamento e disponibilidade;
3. recalcular todos os totais no servidor;
4. rejeitar qualquer divergência entre payload e banco;
5. criar a conciliação, alocações, ajustes, vínculos de títulos e pendências "Outros";
6. atualizar os saldos e status existentes;
7. registrar evento de auditoria com IDs e totais.

Ao desfazer:

- restaurar os saldos de entradas e remessas;
- marcar a conciliação como `UNDONE`;
- marcar as pendências "Outros" como `CANCELLED`;
- preservar os vínculos de títulos no histórico, mas desconsiderá-los na consulta de disponibilidade;
- registrar o evento de auditoria.

## Experiência na conciliação bancária

Depois que entradas e remessas forem selecionadas, a interface exibe uma composição:

- Entradas
- Remessas
- Diferença bruta
- Títulos selecionados
- Outros ajustes
- Falta explicar

Quando a diferença tiver direção `ENTRY_EXCESS`, haverá uma seção expansível "Explicar com títulos fora da remessa". Ela mostra somente exclusões elegíveis das remessas selecionadas, com:

- arquivo original e remessa;
- contrato;
- sacado e CPF;
- vencimento;
- valor de face;
- valor pago;
- categoria e motivo;
- checkbox de seleção.

Filtros locais por contrato, sacado, CPF e categoria ajudam em listas grandes. A seleção recalcula o saldo imediatamente.

Se restar saldo, a seção "Outro" exige categoria, valor e justificativa com pelo menos cinco caracteres. A direção é calculada, não escolhida. O valor não pode superar o saldo restante.

## Tela e Excel de títulos fora da remessa

Uma página dedicada, acessível a partir de "Baixas e remessas", reúne os títulos excluídos. Os filtros são:

- período de geração da remessa;
- fluxo;
- originador;
- arquivo do lote;
- arquivo da remessa;
- categoria;
- situação: disponível, usado em conciliação ativa ou histórico desfeito;
- busca por contrato, sacado ou CPF.

Cada lote continua oferecendo um atalho filtrado para seus títulos e um botão de exportação.

O Excel usa a biblioteca `xlsx` já instalada e contém:

- aba `Resumo`: filtros aplicados, quantidade, valor de face, valor pago e totais por categoria/situação;
- aba `Titulos`: datas, originador, lote, remessa, linha, contrato, documento, sacado, CPF, vencimento, valor de face, valor pago, categoria, motivo, situação da conciliação, entrada bancária e data da conciliação.

O endpoint aplica os mesmos filtros e permissões da visualização. Nenhum arquivo intermediário fica salvo no servidor.

## Tela de diferenças e ajustes

Uma página dentro de "Conciliação bancária" apresenta:

- quantidade e valor total em aberto;
- totais por categoria e direção;
- filtros por período, status, categoria, entrada e remessa;
- tabela com valor, motivo, origem, responsável e idade da pendência;
- exportação Excel;
- ação de resolução para operadores.

Resolver exige uma nota com pelo menos cinco caracteres. A resolução grava usuário e horário. Registros resolvidos continuam no histórico e podem ser filtrados, mas não retornam aos indicadores de aberto.

## Permissões e auditoria

- `operational.view`: visualizar relatórios, detalhes e baixar Excel.
- `operational.finance.manage`: selecionar títulos, registrar outros ajustes, concluir/desfazer conciliações e resolver pendências.

Toda criação, desfazimento e resolução relevante gera `ConsignadoStatusEvent` com os IDs envolvidos, valores e transições. CPF aparece apenas nas telas e exports já protegidos por `operational.view`.

## Tratamento de erros

- Conciliação alterada por outro usuário: retornar conflito e recarregar a área de trabalho.
- Título já usado em conciliação ativa: rejeitar toda a operação transacional.
- Título de remessa não selecionada: rejeitar.
- Total de títulos acima da diferença: rejeitar.
- Saldo não explicado: rejeitar.
- Categoria ou justificativa ausente para "Outro": rejeitar.
- Tentativa de resolver pendência cancelada ou já resolvida: rejeitar.
- Falha no Excel: retornar erro sem criar registros ou alterar status.

## Estratégia de testes

Os testes seguem TDD e cobrem, no mínimo:

- diferença exatamente explicada por títulos;
- diferença parcialmente explicada por títulos e completada por "Outro";
- rejeição quando os totais não fecham;
- rejeição de título acima da diferença;
- proibição de títulos quando a remessa excede a entrada;
- indisponibilidade de título usado em conciliação ativa;
- liberação após desfazimento;
- criação idempotente das exclusões;
- filtros e totais do relatório;
- workbook com abas e colunas exigidas;
- abertura, resolução e cancelamento das pendências;
- permissões das novas rotas;
- lint, typecheck, testes operacionais e build de produção.

## Implantação

1. Publicar código e migration na mesma branch.
2. Aplicar a migration antes de liberar a interface em produção.
3. Conferir a retroalimentação por quantidade e soma de `paidAmount` contra a consulta histórica atual.
4. Validar uma remessa JUCA conhecida com títulos excluídos.
5. Validar conciliação exata, conciliação com saldo "Outro" e desfazimento.
6. Monitorar erros de conflito e exportação após o deploy.

Não haverá alteração destrutiva nem remoção das colunas antigas nesta entrega.
