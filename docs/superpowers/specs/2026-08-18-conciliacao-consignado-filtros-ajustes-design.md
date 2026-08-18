# Conciliação do Consignado: filtros, cancelamento e diferenças justificadas

## Objetivo

Melhorar as telas de baixas/remessas e conciliação bancária do Consignado sem alterar os fluxos de processamento, geração de remessas e conciliações já validados em produção.

## Escopo

1. Filtrar lotes de baixa pela data em que o arquivo foi processado no OSHER.
2. Permitir que um lote duplicado seja retirado da visualização sem apagar seu histórico.
3. Filtrar entradas bancárias em aberto pela data da movimentação.
4. Exibir indicadores globais das entradas ainda não conciliadas.
5. Permitir encerrar conciliações com diferença, exigindo justificativa e mantendo auditoria e estorno corretos.

## Decisões

### Lotes de baixa

- A data do filtro é `ConsignadoSettlementBatch.createdAt`, convertida segundo o fuso `America/Sao_Paulo`.
- Sem data selecionada, a tela mantém a lista de lotes recentes.
- Um atalho limpa a data e retorna à lista recente.
- A ação apresentada ao operador será `Excluir da visualização`, mas sua implementação será um cancelamento lógico.
- O lote recebe status `CANCELLED` e deixa de ser retornado na listagem padrão.
- O registro, os itens, o arquivo e os eventos permanecem armazenados para auditoria.
- Somente usuários com `operational.finance.manage` podem cancelar.
- O cancelamento é bloqueado quando o lote possui remessa diferente de `CANCELLED`, evitando apagar da operação algo já gerado ou conciliado.
- A ação exige confirmação e gera um `ConsignadoStatusEvent` com usuário, status anterior, novo status e motivo de cancelamento da visualização.

### Entradas bancárias

- Ao abrir a página, são retornadas todas as entradas com status `PENDING` ou `PARTIAL`.
- O filtro opcional usa `ConsignadoBankCreditEntry.transactionDate`.
- O botão `Todas em aberto` remove o filtro.
- A consulta deve continuar retornando todas as remessas pendentes, independentemente da data aplicada às entradas.
- A seleção de entradas é limpa quando o filtro muda para impedir seleção invisível.
- O resumo global é calculado sem considerar o filtro de data e contém:
  - quantidade total de entradas em aberto;
  - saldo total em aberto, calculado por `amount - allocatedAmount - adjustedAmount`.

## Diferenças justificadas

### Regra operacional

Quando o saldo total das entradas selecionadas for diferente do saldo total das remessas selecionadas:

1. A interface apresenta o valor da diferença antes de concluir.
2. O operador precisa informar uma justificativa não vazia.
3. O valor comum entre os lados é registrado como alocação bancária normal.
4. O saldo excedente do lado maior é registrado como ajuste justificado.
5. Todas as entradas e remessas selecionadas são encerradas como conciliadas.
6. O histórico apresenta os totais dos dois lados, valor alocado, diferença, justificativa, usuário e data.

Quando os totais forem iguais, o fluxo continua sem exigir justificativa.

### Persistência

Adicionar à conciliação:

- `entryTotalAmount`: saldo total das entradas selecionadas;
- `remittanceTotalAmount`: saldo total das remessas selecionadas;
- `differenceAmount`: diferença absoluta aceita;
- `differenceReason`: justificativa obrigatória quando a diferença for maior que zero.

Adicionar `adjustedAmount` às entradas bancárias e remessas. Esse campo representa somente valores encerrados por ajuste, enquanto `allocatedAmount` continua representando relacionamento financeiro real.

Adicionar uma tabela de ajustes vinculada à conciliação, contendo:

- conciliação;
- entrada bancária ou remessa afetada;
- valor ajustado;
- data de criação.

Cada ajuste pertence a exatamente um lado. A soma dos ajustes corresponde à diferença registrada na conciliação.

### Distribuição e estados

- As alocações continuam usando a distribuição determinística atual: entradas e remessas ordenadas por data e identificador.
- Depois das alocações, o saldo restante do lado maior é distribuído como ajustes entre os itens selecionados que ainda possuem saldo.
- Uma entrada está conciliada quando `allocatedAmount + adjustedAmount >= amount`.
- Uma remessa está conciliada quando `allocatedAmount + adjustedAmount >= totalAmount`.
- Comparações monetárias usam `Prisma.Decimal`; a interface pode exibir valores arredondados em centavos, mas a regra não usa aritmética de ponto flutuante.

### Estorno

Ao desfazer uma conciliação:

- as alocações são subtraídas de `allocatedAmount`;
- os ajustes são subtraídos de `adjustedAmount`;
- os estados das entradas, remessas e lotes são recalculados;
- a conciliação passa a `UNDONE` e mantém todo o histórico.

## APIs e interface

### Baixas

- `GET /api/operacional/consignado/baixas?createdDate=YYYY-MM-DD` aplica o filtro opcional.
- `DELETE /api/operacional/consignado/baixas/:batchId` cancela logicamente um lote elegível.
- A tela inclui campo de data, ação para limpar e botão de exclusão por lote.

### Conciliação bancária

- `GET /api/operacional/consignado/conciliacao-bancaria?transactionDate=YYYY-MM-DD` aplica o filtro às entradas e retorna o resumo global.
- A tela inclui filtro de data, atalho `Todas em aberto` e cartões discretos de quantidade e saldo.
- O painel de seleção mostra a diferença entre os totais.
- Ao conciliar com diferença, a interface abre uma confirmação com campo obrigatório de justificativa.
- `POST /api/operacional/consignado/conciliacoes` valida novamente os saldos no servidor e rejeita divergência sem justificativa.

## Compatibilidade e implantação

- Campos monetários novos terão valor padrão zero, preservando os registros existentes.
- Conciliações antigas permanecem válidas; seus novos totais podem ser preenchidos com o `totalAmount` atual e diferença zero durante a migração.
- A migração será aditiva e não removerá colunas ou registros.
- Lotes já existentes com status diferente de `CANCELLED` continuam visíveis.
- Permissões existentes são reutilizadas; não será criada nova permissão.

## Validação

- Testar filtragem de lotes pela data de processamento e retorno à lista recente.
- Testar cancelamento de lote sem remessa e bloqueio de lote com remessa ativa.
- Testar resumo global e filtro por data das entradas abertas.
- Testar conciliação com totais iguais.
- Testar rejeição de diferença sem justificativa.
- Testar conciliações 1:N, N:1 e N:N com diferença justificada.
- Testar estorno restaurando alocações, ajustes, saldos e estados.
- Executar geração do Prisma Client, typecheck e build do projeto web.
