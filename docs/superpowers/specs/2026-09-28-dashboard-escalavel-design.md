# Dashboard escalável — desenho aprovado

## Objetivo

Transformar o Dashboard em uma visão comparativa que continue clara com dez ou mais fundos, sem perder o detalhamento já disponível. A tela deve priorizar leitura executiva, comparação rápida e transparência sobre data e cobertura dos dados.

## Escopo

- Substituir os cartões grandes por uma tabela compacta, pesquisável, ordenável e com detalhes expansíveis na própria linha.
- Adicionar VOP consolidado do dia e do mês ao topo.
- Manter prazo e taxa apenas por fundo; não exibi-los como KPIs consolidados.
- Tornar a apresentação genérica para qualquer quantidade de fundos habilitados no módulo Dashboard.
- Nesta rodada, manter a integração de VOP restrita a Apuama e Bristol. Fundos futuros aparecem normalmente e recebem o estado `Não integrado` nas métricas operacionais.
- Não criar migration.

## Hierarquia visual

### Resumo executivo

O topo terá quatro KPIs:

1. PL consolidado;
2. fundos ativos;
3. VOP consolidado do dia;
4. VOP consolidado do mês.

Os KPIs de VOP mostrarão a data de corte comum e a cobertura, por exemplo `Posição em 24/09/2026 · 2 de 10 fundos integrados`.

As cores terão função semântica e serão discretas:

- azul para patrimônio;
- verde para operação e resultados positivos;
- vermelho para resultados negativos;
- âmbar para defasagem ou cobertura parcial;
- tons neutros para estrutura e informação secundária.

### Visão comparativa

Abaixo do resumo haverá busca por fundo e ordenação por nome, PL, VOP diário, VOP mensal ou rentabilidade mensal.

A linha principal da tabela exibirá:

- fundo;
- atualização da posição patrimonial;
- PL;
- VOP do dia;
- VOP do mês;
- prazo médio;
- taxa média a.m.;
- rentabilidade mensal;
- controle para expandir ou recolher.

O cabeçalho permanecerá visível durante a rolagem. Em telas estreitas, a tabela continuará acessível por rolagem horizontal visível.

### Detalhes expansíveis

A expansão ocorre imediatamente abaixo da linha do fundo e agrupa:

- composição do PL: Sênior, Mezanino e Júnior, acompanhada de barra proporcional;
- rentabilidades diária, mensal e anual;
- receita média mensal, custo médio mensal, totais e quantidade de períodos.

Apenas uma linha precisa estar aberta por vez inicialmente, evitando uma tela novamente extensa. O usuário poderá recolher o detalhe aberto.

## Regras de consolidação

- PL consolidado e fundos ativos consideram todos os fundos habilitados no Dashboard.
- VOP consolidado considera somente fundos com integração de estoque.
- A data de corte do VOP é a data mais recente que possui snapshot para todos os fundos integrados e habilitados.
- VOP diário é a soma dos snapshots dos fundos nessa data.
- VOP mensal é a soma dos snapshots desde o início do mês até a mesma data de corte.
- Os valores individuais de VOP, prazo e taxa apresentados na tabela usam a mesma data de corte, permitindo comparação direta.
- Prazo e taxa continuam ponderados pelo valor de aquisição das operações do fundo; não se calcula média simples entre fundos.
- Nenhum fundo ausente ou não integrado é omitido silenciosamente da cobertura.

## Estados de dados

- `Sem operações`: existe snapshot válido com VOP zero; prazo e taxa não possuem peso para cálculo.
- `Não integrado`: o fundo não possui integração de estoque nesta rodada.
- `Sem dados`: a integração existe, mas o snapshot esperado não está disponível ou falhou.
- Cobertura parcial: o consolidado permanece visível somente quando existe uma data comum válida e informa claramente quantos fundos participaram. Se não existir data comum, os KPIs de VOP mostram `Sem dados`, sem somar datas incompatíveis.
- Uma falha em um fundo não derruba a página inteira; sua linha informa o estado e os demais fundos continuam visíveis.

## Arquitetura

O carregamento e os cálculos sairão do componente principal da página e serão separados em:

- um serviço servidor para buscar dados em lote, agrupar por fundo e produzir o modelo consolidado;
- funções puras para data comum, cobertura, totais e estados;
- uma faixa de KPIs;
- uma tabela cliente para busca, ordenação e expansão;
- componentes de detalhe sem consultas próprias.

Carteiras, caixas e snapshots serão buscados em conjuntos, evitando o padrão atual de várias consultas por fundo. O componente visual receberá dados já normalizados e não conhecerá regras do Prisma.

## Desempenho e evolução

A quantidade de consultas não deve crescer linearmente com a quantidade de fundos. A interface renderiza qualquer fundo habilitado, mesmo quando suas métricas operacionais ainda não estão integradas. A integração de novos fundos será uma evolução separada, sem exigir outro redesenho da tela.

## Validação

Testes automatizados cobrirão:

- escolha da última data comum;
- VOP diário e mensal consolidados;
- cobertura parcial e ausência de data comum;
- fundo não integrado;
- snapshot com VOP zero e estado `Sem operações`;
- prazo e taxa individuais na data comum;
- falha isolada de um fundo;
- busca, ordenação e expansão por meio de funções de estado testáveis.

A entrega também exige suíte completa, typecheck, lint e build de produção.
