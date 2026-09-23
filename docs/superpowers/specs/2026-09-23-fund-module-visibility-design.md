# Visibilidade de fundos por módulo

## Objetivo

Separar o ciclo de vida global de um fundo da sua disponibilidade nas telas da OSHER. Um fundo ativo poderá aparecer em apenas alguns módulos, permitindo manter ANTENA exclusivamente no Caixa sem exibi-lo no Dashboard, DRE, Previsões ou PDD.

## Problema atual

Dashboard, Caixa, DRE, Previsões e PDD consultam fundos usando apenas `Fund.status = ACTIVE`. A mesma chave global controla todas as telas. Como consequência, tornar ANTENA inativo para removê-lo dos relatórios também o remove do Caixa.

`Fund.status` deve continuar representando o ciclo de vida do cadastro. A visibilidade e a operação em cada tela serão controladas separadamente.

## Escopo

Módulos configuráveis nesta entrega:

- Dashboard;
- Caixa;
- DRE;
- Previsões;
- PDD.

Incluído:

- persistência normalizada das habilitações por fundo e módulo;
- backfill da configuração atual e da matriz aprovada;
- chaves administrativas na tela Fundos;
- criação de novos fundos com todos os módulos desligados;
- filtro central reutilizado pelas cinco telas;
- validação de leitura e gravação do Caixa;
- comportamento seguro para URLs com um `fundId` desabilitado.

Não incluído:

- controle de permissões de usuários por fundo;
- alteração das permissões `*.view` e `*.manage` existentes;
- exclusão de dados históricos;
- configuração por módulo para rotinas de importação ou serviços operacionais internos;
- novos módulos além dos cinco listados.

## Matriz inicial aprovada

| Fundo | Dashboard | Caixa | DRE | Previsões | PDD | Status global |
|---|---:|---:|---:|---:|---:|---|
| APUAMA | ligado | ligado | ligado | ligado | ligado | `ACTIVE` |
| BRISTOL | ligado | ligado | ligado | ligado | ligado | `ACTIVE` |
| ANTENA | desligado | ligado | desligado | desligado | desligado | `ACTIVE` |
| CONSIGNADO | desligado | desligado | desligado | desligado | desligado | `INACTIVE` |

## Modelo de dados

Adicionar o enum Prisma `FundModule`:

```text
DASHBOARD
CASH
DRE
FORECASTS
PDD
```

Adicionar `FundModuleVisibility` com:

- `fundId`: relação com `Fund`;
- `module`: valor de `FundModule`;
- `enabled`: booleano, padrão `false`;
- `updatedAt`: data da última alteração;
- `updatedByUserId`: usuário da última alteração, opcional para permitir o backfill da migration;
- chave composta `(fundId, module)`;
- relações com `Fund` e `User`.

A tabela mantém uma linha explícita para cada combinação fundo/módulo. O estado desligado não será representado pela ausência de linha, evitando ambiguidades entre “desligado” e “configuração ainda não criada”.

## Migration e backfill

A migration criará o enum, a tabela, os índices e as chaves estrangeiras. O backfill será executado dentro da própria migration:

1. Criar os cinco registros para cada fundo existente.
2. Para fundos atualmente `ACTIVE`, habilitar inicialmente os cinco módulos para preservar o comportamento anterior.
3. Para fundos atualmente não ativos, manter todos desligados.
4. Localizar os fundos pela combinação normalizada de `name` e `shortName`.
5. Sobrescrever a matriz de APUAMA, BRISTOL, ANTENA e CONSIGNADO conforme a tabela aprovada.
6. Alterar ANTENA para `ACTIVE` e CONSIGNADO para `INACTIVE`.

O SQL será idempotente quanto aos registros de configuração por meio da chave composta e `ON CONFLICT`. Se um dos quatro fundos nomeados não existir, a migration continuará válida para os demais; a ausência será detectável na tela administrativa e nos testes de verificação do ambiente.

Fundos criados depois da migration receberão os cinco registros desligados na mesma transação que cria o cadastro.

## Regra central de seleção

Criar um módulo de domínio para centralizar:

- a lista e os rótulos dos módulos configuráveis;
- validação de valores recebidos pela server action;
- construção do filtro Prisma para fundos habilitados;
- normalização da configuração devolvida para a interface.

Uma tela só poderá listar um fundo quando ambas as condições forem verdadeiras:

```text
Fund.status = ACTIVE
e
Fund.moduleVisibilities contém { module: módulo_da_tela, enabled: true }
```

As páginas não deverão reconstruir esse filtro manualmente.

## Aplicação por tela

### Dashboard

- Consultar somente fundos habilitados para `DASHBOARD`.
- Calcular os cards e o contador “Fundos ativos” somente sobre esse conjunto.
- O VOP continuará sendo carregado apenas para APUAMA e BRISTOL dentro do conjunto visível.

### Caixa

- Listar somente fundos habilitados para `CASH`.
- Filtrar os saldos diários pela mesma regra, evitando que registros históricos de fundos ocultos reapareçam na interface.
- Validar `fundId` nas ações individual e em lote antes do `upsert`.
- Rejeitar payload adulterado para fundo inativo ou sem Caixa habilitado.
- ANTENA permanecerá disponível para leitura e gravação.

### DRE, Previsões e PDD

- Consultar respectivamente `DRE`, `FORECASTS` e `PDD`.
- `findDefaultFund` continuará escolhendo APUAMA quando disponível.
- Um `fundId` informado na URL será ignorado se não pertencer ao conjunto habilitado; a tela abrirá o primeiro fundo permitido.
- Mensagens de estado vazio passarão a indicar ausência de fundo habilitado para o módulo, não apenas ausência de fundo ativo.

### Fundos

- Continuar mostrando todos os fundos, independentemente de status ou módulo.
- Carregar as cinco habilitações de cada fundo.
- Exibir uma coluna “Módulos” com cinco chaves identificadas.
- Usuários sem `funds.manage` verão o estado das chaves sem poder alterá-las.

## Alteração administrativa

Criar uma server action que recebe:

```text
fundId
module
enabled
```

O fluxo será:

1. Exigir `funds.manage`.
2. Validar o payload com Zod e o enum compartilhado.
3. Confirmar que o fundo existe.
4. Fazer `upsert` da combinação `(fundId, module)`, gravando `updatedByUserId`.
5. Revalidar Dashboard, Caixa, DRE, Previsões, PDD e Fundos.
6. Retornar o estado persistido e uma mensagem pública.

A interface poderá refletir a alteração imediatamente, mas deverá restaurar o valor anterior se a action falhar. Cada chave terá estado pendente próprio, impedindo cliques concorrentes sobre a mesma combinação sem bloquear as demais.

## Status global e exclusão

O botão atual “Excluir” continuará alterando `Fund.status` para `INACTIVE`, o que desabilita globalmente o fundo mesmo que alguma chave permaneça ligada. A cópia da interface será alterada para explicar esse efeito.

Reativar um fundo no futuro não ligará módulos automaticamente. As configurações persistidas continuarão independentes e deverão ser habilitadas explicitamente.

## Cadastro de fundo

A criação do fundo e das cinco linhas `enabled = false` ocorrerá em uma única transação. Se a criação das habilitações falhar, o cadastro inteiro será revertido.

O formulário não precisa ganhar as cinco chaves nesta entrega: após criar o fundo, o administrador fará a habilitação na tabela Fundos. Isso preserva a recomendação aprovada de começar com tudo desligado.

## Rotinas internas

Importações, matching, conciliações e outras rotinas de domínio continuarão usando `Fund.status` quando esse for o critério atual. As chaves desta entrega controlam somente exposição e operação nas cinco telas declaradas.

O sincronizador de VOP continuará procurando APUAMA e BRISTOL ativos e não dependerá das habilitações por módulo.

## Tratamento de erros

- Configuração ausente para um fundo equivale a módulo desligado.
- Fundo inativo nunca aparece nos cinco módulos, mesmo que uma chave esteja ligada.
- Payload administrativo inválido não altera dados.
- Falta de permissão não revela detalhes do fundo nem altera a interface definitivamente.
- Falha de banco durante toggle restaura o estado visual anterior.
- Falha ao criar as habilitações de um fundo novo reverte a criação do próprio fundo.
- Caixa rejeita gravação para fundo não habilitado com mensagem pública específica.

## Testes

Os testes automatizados devem cobrir:

- filtro central combinando status global e módulo habilitado;
- configuração ausente tratada como desligada;
- normalização das cinco habilitações para a interface;
- backfill da matriz aprovada e preservação de fundos ativos desconhecidos;
- novos fundos com cinco módulos desligados em transação;
- autorização, validação, auditoria e `upsert` da server action;
- reversão visual do toggle quando a action falha;
- Dashboard listando e contando apenas `DASHBOARD`;
- Caixa listando saldos e aceitando gravações apenas para `CASH`;
- DRE, Previsões e PDD ignorando um `fundId` desabilitado;
- ANTENA somente no Caixa;
- CONSIGNADO ausente dos cinco módulos;
- regressão dos testes existentes, typecheck e build de produção.

## Estratégia de branch e implantação

A branch `feat/fund-module-visibility` parte da branch de produção `feat/dashboard-vop-snapshots` e incorpora `origin/main`, preservando o VOP e os ajustes mais recentes do Dashboard.

Ordem de implantação:

1. Aplicar a nova migration no schema `OSHER`.
2. Conferir a matriz persistida dos quatro fundos.
3. Publicar o novo código.
4. Validar as cinco telas com uma sessão autorizada.
5. Confirmar que ANTENA aceita leitura e gravação no Caixa e não aparece nas demais telas.
6. Confirmar que CONSIGNADO não aparece em nenhuma das cinco telas.

