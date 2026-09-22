# Dashboard — snapshots de VOP

## Objetivo

Adicionar ao Dashboard da OSHER dois indicadores para os fundos ativos APUAMA e BRISTOL:

- **VOP do dia:** soma do valor de aquisição das operações adquiridas na data da posição mais recente congelada.
- **VOP no mês:** soma dos VOPs diários congelados no mesmo mês da posição mais recente.

VOP significa Valor de Operação. O valor de uma data deve ser preservado mesmo quando os títulos daquela aquisição deixarem de aparecer em estoques futuros por liquidação ou baixa.

## Regra financeira

Para um fundo e uma data de referência `D`:

```text
VOP(D) = soma(FIDC_ESTOQUES.valorAquisicao)
         onde FIDC_ESTOQUES.dataReferencia = D
           e FIDC_ESTOQUES.dataAquisicao = D
           e FIDC_ESTOQUES.nomeFundo pertence ao fundo selecionado
```

O cálculo sempre usa a posição histórica da própria data `D`. Nunca se calcula o VOP de uma data antiga filtrando o estoque mais recente.

O acumulado mensal é:

```text
VOP_MES(D) = soma dos snapshots diários do fundo
             cujo ano e mês são iguais ao ano e mês de D
```

O “mês atual” do indicador é, portanto, o mês do snapshot mais recente disponível para o fundo, e não necessariamente o mês do relógio do servidor.

## Escopo

Incluído:

- APUAMA e BRISTOL ativos no cadastro `Fund` da OSHER.
- Persistência imutável de um VOP por fundo e data.
- Backfill do mês da posição mais recente de cada fundo.
- Duas execuções automáticas diárias.
- Exibição do VOP diário e mensal nos cards dos fundos no Dashboard.
- Data de referência explícita no indicador.

Não incluído:

- Outros fundos presentes em `FIDC_ESTOQUES`.
- Edição manual ou recálculo de snapshots já criados.
- Comparação percentual com o dia anterior.
- Backfill de meses anteriores ao mês da posição mais recente.

## Modelo de dados

Criar um modelo Prisma `FundVopSnapshot`, mapeado para uma nova tabela no schema `OSHER`, com:

- `id`: identificador do registro.
- `fundId`: referência ao cadastro `Fund` ativo.
- `referenceDate`: data da posição usada no cálculo, armazenada como `date`.
- `amount`: VOP congelado, com precisão decimal compatível com os valores de aquisição.
- `createdAt`: instante em que o snapshot foi criado.
- Relação com `Fund`.
- Restrição única em `(fundId, referenceDate)`.
- Índice por `referenceDate` para as consultas do Dashboard.

A aplicação não terá fluxo de atualização ou exclusão desses registros. A rotina utilizará criação com tratamento de conflito pela chave única; se o snapshot já existir, será mantido sem alteração.

## Associação dos fundos

Somente fundos com `status = ACTIVE` serão elegíveis. A associação seguirá os nomes usados atualmente no projeto:

- cadastro cujo nome ou nome curto contenha `APUAMA` ↔ registros de estoque cujo `nomeFundo` represente APUAMA;
- cadastro cujo nome ou nome curto contenha `BRISTOL` ↔ registros de estoque cujo `nomeFundo` represente BRISTOL.

A normalização será insensível a caixa e acentuação. A consulta continuará limitada a esses dois identificadores; sem correspondência inequívoca, o fundo será reportado como erro de configuração e nenhum snapshot será criado para ele.

## Serviço de snapshots

Um módulo de servidor concentrará a regra de negócio e será reutilizado pelo cron e pelos testes.

Para cada fundo elegível, o serviço:

1. Localiza a maior `dataReferencia` disponível em `FIDC_ESTOQUES`.
2. Define o primeiro e o último dia do mês dessa posição.
3. Localiza todas as datas de referência do fundo dentro desse mês.
4. Remove da lista as datas que já possuem snapshot.
5. Verifica se cada posição candidata está estável.
6. Calcula o VOP usando somente as linhas da própria data de referência.
7. Insere os snapshots ausentes em uma transação, sem atualizar conflitos existentes.

Esse comportamento faz o backfill inicial do mês mais recente e também recupera automaticamente dias perdidos por falha ou atraso de carga.

Um resultado igual a zero é um valor financeiro válido e deve gerar snapshot quando existir uma posição estável para a data. Ausência de posição não deve gerar snapshot zero.

## Proteção contra carga parcial

Uma posição só estará apta a ser congelada quando a maior `createdAt` de suas linhas for anterior ou igual ao instante da execução menos dez minutos.

Se houver inserções nos dez minutos anteriores:

- a data será ignorada nessa execução;
- nenhum snapshot parcial será gravado;
- a resposta da rotina indicará que a posição está aguardando estabilização;
- a execução seguinte tentará novamente.

Essa janela protege especialmente a execução das 15h30, que ocorre trinta minutos após o horário esperado da carga externa.

## Agendamento e endpoint

Criar um endpoint de cron protegido pelo mesmo padrão de `CRON_SECRET` já usado na importação automática da Singulare.

O `vercel.json` terá duas agendas para a rotina de VOP:

- `0 13 * * *`: 10h00 em Brasília;
- `30 18 * * *`: 15h30 em Brasília.

Os horários do Vercel são expressos em UTC. O projeto considera o fuso `America/Sao_Paulo`, atualmente UTC−3.

A execução das 10h recupera posições atrasadas e snapshots ausentes. A execução das 15h30 tenta capturar a posição carregada às 15h. Se essa carga ainda não estiver estável, a posição ficará para a execução seguinte.

O endpoint responderá por fundo com as datas criadas, já existentes, sem posição ou aguardando estabilização. Uma falha em um fundo não impedirá o processamento do outro; a resposta usará estado parcial quando necessário e os erros serão registrados no log da aplicação.

## Dashboard

O carregamento do Dashboard consultará, para cada APUAMA e BRISTOL:

1. o snapshot de maior `referenceDate`;
2. a soma de `amount` desde o primeiro dia do mês desse snapshot até sua data de referência.

Os cards atuais dos fundos receberão:

- rótulo **VOP do dia** com o valor do último snapshot;
- rótulo **VOP no mês** com o acumulado do mês desse snapshot;
- texto **Posição em DD/MM/AAAA**.

Se o fundo ainda não tiver snapshot, ambos os valores aparecerão como **Indisponível**. A interface não mostrará `R$ 0,00` para ausência de dados. Quando existir um snapshot legítimo de valor zero, mostrará `R$ 0,00` normalmente.

O Dashboard será somente leitura: abrir a página não cria nem recalcula snapshots.

## Tratamento de falhas

- Fundo ativo sem associação com o estoque: reportar erro de configuração e não gravar.
- Estoque inexistente: reportar ausência de posição e não gravar zero.
- Posição ainda recebendo linhas: adiar sem tratar como falha financeira.
- Concorrência entre as duas execuções ou chamada manual: a chave única e a inserção sem atualização tornam a operação idempotente.
- Falha ao processar um fundo: continuar o outro e devolver resposta parcial.
- Snapshot já criado: jamais recalcular ou substituir, mesmo que o estoque histórico seja alterado posteriormente.

## Testes e validação

Os testes automatizados devem comprovar:

- soma apenas de `valorAquisicao` cuja aquisição e referência sejam a mesma data;
- exclusão de aquisições de outros dias;
- isolamento entre APUAMA e BRISTOL;
- rejeição de fundos fora do escopo;
- uso da posição histórica correspondente, sem consultar o estoque futuro para uma data antiga;
- backfill de todas as datas ausentes do mês mais recente;
- ausência de backfill de meses anteriores;
- espera de dez minutos para uma posição instável;
- criação de snapshot legítimo com valor zero;
- reexecução idempotente e preservação do valor já congelado;
- acumulado mensal baseado no mês do snapshot mais recente;
- diferenciação visual entre indisponível e zero;
- autorização do endpoint de cron.

Antes da entrega serão executados os testes direcionados, a validação do schema Prisma, a checagem de tipos e o build aplicável ao projeto.

## Implantação

1. Aplicar a migration no schema compartilhado `OSHER` conforme a coordenação registrada em `docs/TASKS.md`.
2. Publicar o serviço e o endpoint de cron.
3. Executar manualmente o endpoint uma vez para gerar o backfill do mês mais recente de APUAMA e BRISTOL.
4. Conferir os valores do dia e do mês contra consultas diretas de `FIDC_ESTOQUES`.
5. Confirmar as duas agendas no ambiente da Vercel.
6. Verificar os cards do Dashboard e suas datas de posição.

