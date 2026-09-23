# Dashboard — prazo e taxa média das operações

## Objetivo

Adicionar ao bloco de VOP do Dashboard dois indicadores das aquisições mais
recentes de APUAMA e BRISTOL:

- prazo médio ponderado, em dias;
- taxa média ponderada, em percentual efetivo ao mês.

Os indicadores devem usar as mesmas operações e a mesma data de referência do
VOP diário. Os valores serão congelados por fundo e data para não mudarem quando
os títulos deixarem de aparecer em posições futuras.

Esta entrega mostra somente a posição mais recente. A estrutura, porém, deve
permitir consolidar snapshots por intervalo no futuro e reaproveitar a regra de
cálculo em consultas filtradas por data de aquisição, cedente e sacado.

## Escopo atual

Incluído:

- APUAMA e BRISTOL habilitados no módulo Dashboard;
- prazo médio das aquisições da data do último snapshot;
- taxa média efetiva ao mês das aquisições da mesma data;
- ponderação de ambos os indicadores por `valorAquisicao`;
- persistência dos componentes das médias, além dos resultados exibidos;
- preenchimento único dos indicadores em snapshots de VOP já existentes;
- processamento dos novos indicadores pelos crons de VOP já existentes;
- exibição junto a VOP do dia e VOP no mês.

Não incluído:

- seleção de intervalo na interface;
- filtros por cedente ou sacado;
- gráficos e comparações históricas;
- snapshots dimensionais por cedente ou sacado;
- alteração das agendas atuais de 10h00 e 15h30;
- inclusão de fundos diferentes de APUAMA e BRISTOL.

## Operações elegíveis

Para um fundo e uma data de referência `D`, entram no cálculo somente linhas de
`FIDC_ESTOQUES` que atendam simultaneamente a:

```text
nomeFundo pertence ao fundo selecionado
dataReferencia = D
dataAquisicao = D
```

É exatamente o mesmo conjunto usado pelo VOP diário. Uma linha de uma aquisição
antiga que ainda esteja no estoque de `D` não participa dos indicadores de `D`.
Também não se usa a posição mais recente para recalcular uma data histórica.

## Regras financeiras

### VOP

O VOP permanece:

```text
VOP(D) = soma(valorAquisicao_i)
```

O `amount` de um snapshot já criado nunca será recalculado ou atualizado.

### Prazo médio ponderado

O prazo utiliza `prazo` (`PRAZO` na origem) e o valor de aquisição como peso:

```text
prazoWeightedValue = soma(valorAquisicao_i * prazo_i)
prazoWeightAmount  = soma(valorAquisicao_i)

prazoMedioDias = prazoWeightedValue / prazoWeightAmount
```

O Dashboard exibirá duas casas decimais e o sufixo `dias`.

### Taxa média ponderada ao mês

`taxaCessao` (`TAXA_CESSAO` na origem) está em forma decimal anual. Cada taxa
será convertida individualmente para a taxa efetiva mensal antes da ponderação:

```text
taxaMensal_i = (1 + taxaCessao_i)^(1/12) - 1

taxaWeightedValue = soma(valorAquisicao_i * taxaMensal_i)
taxaWeightAmount  = soma(valorAquisicao_i)

taxaMediaMensal = taxaWeightedValue / taxaWeightAmount
```

Converter cada operação antes da média evita a distorção de ponderar taxas
anuais e converter somente o resultado. O Dashboard exibirá quatro casas
decimais e o sufixo `% a.m.`.

### Pesos e dados inválidos

- `valorAquisicao > 0` é um peso válido.
- `valorAquisicao = 0` participa do VOP, mas não altera as médias.
- `valorAquisicao < 0` torna os indicadores da data pendentes por erro de
  qualidade; pesos negativos não serão tratados silenciosamente.
- `taxaCessao <= -1` é inválida para a conversão efetiva e também deixa os
  indicadores pendentes por erro de qualidade.
- Se houver peso positivo e qualquer operação ponderável estiver sem `prazo` ou
  `taxaCessao`, prazo e taxa não serão congelados parcialmente. O cron reportará
  a data como incompleta e tentará novamente.
- Se não houver peso positivo, ambos os indicadores serão legitimamente
  indisponíveis e a data será marcada como processada, evitando novas tentativas
  infinitas.

Todos os valores monetários, taxas e componentes ponderados serão calculados com
`Prisma.Decimal`, inclusive potência e raiz na conversão efetiva anual para
mensal. A conversão para `number` ocorrerá somente depois de concluído o cálculo,
na fronteira de formatação da interface; nenhum valor convertido será
persistido ou reutilizado em outra fórmula financeira.

## Persistência preparada para consolidação

O modelo existente `FundVopSnapshot` será ampliado, sem criar uma segunda tabela
para a mesma combinação de fundo e data. Além de `amount`, cada snapshot terá:

- `operationCount`: quantidade de operações elegíveis;
- `termWeightedValue`: soma de `valorAquisicao * prazo`;
- `termWeightAmount`: peso total usado no prazo;
- `monthlyRateWeightedValue`: soma de `valorAquisicao * taxaMensal`;
- `monthlyRateWeightAmount`: peso total usado na taxa;
- `indicatorsCalculatedAt`: instante em que os novos componentes foram
  congelados.

Os componentes, e não apenas as médias prontas, serão armazenados. Com isso, um
intervalo futuro poderá ser consolidado corretamente:

```text
prazo do intervalo = soma(termWeightedValue) / soma(termWeightAmount)
taxa do intervalo  = soma(monthlyRateWeightedValue) / soma(monthlyRateWeightAmount)
```

Não será feita média de médias diárias.

As novas colunas serão opcionais para permitir migration aditiva e datas sem
peso positivo. `indicatorsCalculatedAt` diferencia um snapshot ainda pendente
de um snapshot processado cujo prazo e taxa são legitimamente indisponíveis.

## Imutabilidade e backfill

Para novos dias, VOP e componentes ponderados serão calculados a partir da mesma
lista de operações e inseridos juntos no snapshot.

Para snapshots existentes:

1. localizar registros com `indicatorsCalculatedAt IS NULL`;
2. carregar a posição histórica da própria `referenceDate`;
3. calcular os componentes sem recalcular `amount`;
4. preencher somente as novas colunas;
5. usar uma atualização condicional que ainda exija
   `indicatorsCalculatedAt IS NULL`.

Depois do primeiro preenchimento, nenhuma execução poderá atualizar os
componentes. A condição atômica também protege contra duas chamadas concorrentes
do cron: ambas podem calcular, mas somente uma poderá congelar o resultado.

O backfill desta entrega cobre os snapshots já existentes. Uma futura
importação de histórico anterior ao início dos snapshots será uma entrega
separada.

## Arquitetura

### Cálculo financeiro puro

Um módulo independente receberá uma lista mínima de operações:

```text
valorAquisicao
prazo
taxaCessao
```

e devolverá VOP, quantidade e componentes ponderados, além de um estado de
qualidade. Ele não conhecerá Prisma, cron, fundos ou Dashboard. Assim, a mesma
regra poderá ser reutilizada quando consultas futuras acrescentarem filtros de
período, cedente e sacado.

### Consulta e sincronização

O serviço de snapshots continuará responsável por:

- associar APUAMA e BRISTOL aos cadastros ativos;
- localizar posições e aplicar a janela de estabilidade de dez minutos;
- carregar somente aquisições da própria data;
- chamar o cálculo puro;
- criar novos snapshots ou completar, uma única vez, snapshots antigos;
- devolver resultados por fundo sem impedir o processamento do outro.

O endpoint e as agendas atuais serão preservados.

### Leitura do Dashboard

O resumo do fundo continuará localizando o snapshot de maior `referenceDate` e
somando `amount` para o VOP mensal. Prazo e taxa serão derivados dos componentes
do snapshot mais recente.

O Dashboard continuará somente leitura: abrir a página não criará, completará ou
recalculará snapshots.

## Evolução futura dos filtros

O snapshot diário de fundo resolve consolidações por data e mês. Ele não tenta
representar agora todas as dimensões possíveis.

Quando forem adicionados filtros por cedente e sacado, uma consulta separada
selecionará as linhas históricas de `FIDC_ESTOQUES` pelas dimensões desejadas e
as entregará ao mesmo módulo puro de cálculo. Caso volume ou desempenho exijam
materialização dimensional, ela poderá ser adicionada sem mudar as fórmulas nem
o contrato de apresentação.

Essa separação evita criar agora uma tabela de combinações fundo/data/cedente/
sacado que a interface atual ainda não consome.

## Interface

O bloco atual do VOP passará a ter quatro indicadores:

1. VOP do dia;
2. VOP no mês;
3. Prazo médio;
4. Taxa média a.m.

Em telas largas, os quatro indicadores poderão ocupar a mesma linha. Em telas
menores, a grade quebrará em duas colunas. A data exibida no rodapé será a data
do snapshot comum aos quatro valores.

Quando `indicatorsCalculatedAt` ainda estiver vazio ou os componentes forem
legitimamente nulos, prazo e taxa mostrarão `Indisponível`. VOP zero continuará
diferente de VOP ausente.

## Tratamento de falhas

- Posição instável: nenhum valor novo da data será congelado.
- Prazo ou taxa ausente com peso positivo: VOP existente é preservado e os novos
  indicadores permanecem pendentes.
- Peso negativo: indicadores pendentes e erro de qualidade registrado no
  resultado do cron.
- Peso total zero: indicadores processados como indisponíveis.
- Snapshot antigo já preenchido: nenhuma atualização.
- Concorrência: criação protegida pela chave única e backfill protegido pela
  condição `indicatorsCalculatedAt IS NULL`.
- Falha em um fundo: o outro continua sendo processado e a rota retorna estado
  parcial, como já ocorre no fluxo de VOP.

## Testes e critérios de aceite

Os testes automatizados comprovarão:

- prazo ponderado por valor de aquisição, diferente da média aritmética;
- conversão efetiva de cada taxa anual para mensal antes da ponderação;
- taxa ponderada por valor de aquisição;
- uso de `taxaCessao`, sem substituição por `taxaRecebivel`;
- filtro simultâneo por data de referência e data de aquisição;
- isolamento entre fundos;
- comportamento para peso zero, peso negativo e campos ausentes;
- persistência dos numeradores e denominadores;
- consolidação correta de dois snapshots sem média de médias;
- preenchimento único de snapshots existentes sem alteração do `amount`;
- idempotência e concorrência do backfill;
- formatação em dias e `% a.m.`;
- exibição de `Indisponível` sem confundir ausência com zero;
- preservação dos testes atuais de VOP, cron e módulos de fundos.

Antes da entrega serão executados os testes direcionados, validação e geração do
Prisma Client, typecheck e build de produção.

## Implantação

A ordem obrigatória será:

1. aplicar a migration aditiva no schema compartilhado `OSHER`;
2. confirmar que o schema está atualizado;
3. publicar a aplicação;
4. executar manualmente o endpoint protegido de snapshots;
5. verificar que snapshots antigos receberam apenas os novos componentes;
6. reconciliar APUAMA e BRISTOL contra uma consulta direta de
   `FIDC_ESTOQUES`;
7. validar os quatro indicadores no Dashboard.

Aplicar a migration antes do deploy evita que o novo código consulte colunas
inexistentes. Em rollback da aplicação, as colunas aditivas poderão permanecer
sem afetar a versão anterior.
