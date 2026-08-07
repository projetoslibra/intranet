# Operacional do Consignado — plano de implementação

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

### Fora da primeira versão

- Baixa manual HBI.
- Baixa de PDD.
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

### Correção manual

- O operador pode substituir um contrato não encontrado por outro título existente no estoque.
- A remessa usa todos os dados oficiais do título substituto, não apenas o novo número.
- O valor, o título original, o substituto, o usuário, a data e a justificativa ficam auditados.
- Um título substituto não pode ser usado duas vezes no mesmo lote nem em outra remessa ativa.

### Conciliação bancária

- Somente créditos positivos do extrato entram na conciliação.
- Saldo anterior, débitos, totais, rodapés e linhas vazias são ignorados.
- Uploads bancários sobrepostos não duplicam entradas.
- Uma ou várias entradas podem conciliar uma ou várias remessas.
- A alocação nunca pode superar o saldo disponível da entrada ou da remessa.
- Um item só sai das pendências quando seu saldo chega a zero.
- Itens conciliados continuam acessíveis no histórico.

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

### Status em 06/08/2026

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
- ⏳ OC-13 e OC-14 — indicadores consolidados e homologação final ainda pendentes.

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
