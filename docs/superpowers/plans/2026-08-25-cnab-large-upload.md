# Upload de CNABs grandes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar CNABs de até 50 MB diretamente ao Blob privado e processá-los no OSHER sem atravessar o limite de payload da Vercel.

**Architecture:** O cliente usa upload presigned e depois envia somente metadados à API. A API recupera o Blob privado, valida tamanho/hash e reutiliza integralmente o processamento atual.

**Tech Stack:** Next.js 14, TypeScript, `@vercel/blob`, Prisma, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-25-cnab-large-upload-design.md`

## Global Constraints

- Blob sempre privado.
- Tamanho máximo de 50 MB.
- Permissão obrigatória `operational.finance.manage`.
- Nenhuma alteração nas regras de baixa, matching, remessa ou conciliação.

---

### Task 1: Contrato seguro do upload privado

**Files:**
- Create: `apps/web/src/server/operational/consignado-settlement-upload.ts`
- Create: `apps/web/src/server/operational/consignado-settlement-upload.test.ts`
- Create: `apps/web/src/app/api/operacional/consignado/baixas/upload/route.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `consignadoSettlementUploadConfig`, `validateSettlementUploadMetadata(input)`.

- [ ] Escrever testes que rejeitem tamanho acima de 50 MB, hash inválido, caminho fora do prefixo e extensão incompatível com o fluxo.
- [ ] Executar o teste e confirmar falha pela ausência do contrato.
- [ ] Implementar validações puras e a emissão de token privado limitado a `put`.
- [ ] Executar os testes e confirmar aprovação.

### Task 2: Processamento a partir do Blob

**Files:**
- Modify: `apps/web/src/server/operational/consignado-settlement-service.ts`
- Modify: `apps/web/src/app/api/operacional/consignado/baixas/route.ts`
- Test: `apps/web/src/server/operational/consignado-settlement-upload.test.ts`

**Interfaces:**
- Consumes: metadados validados e `storageKey` privado.
- Produces: `importSettlementBatchFromBlob(input): Promise<{ batchId: string }>`.

- [ ] Escrever testes da validação entre metadados declarados e tamanho/hash reais.
- [ ] Executar o teste e confirmar a falha esperada.
- [ ] Recuperar o Blob privado, conferir integridade e reutilizar o núcleo atual sem segundo upload.
- [ ] Alterar o POST para JSON pequeno, resposta JSON e `maxDuration = 300`.
- [ ] Confirmar os testes operacionais.

### Task 3: Upload direto e feedback da interface

**Files:**
- Modify: `apps/web/src/features/operational/components/ConsignadoSettlementPanel.tsx`

**Interfaces:**
- Consumes: endpoint presigned e POST de metadados.
- Produces: upload com progresso, limite local de 50 MB e erro legível.

- [ ] Implementar SHA-256 local, nome seguro e `uploadPresigned` para Blob privado.
- [ ] Enviar somente metadados, fluxo e originador ao endpoint de baixas.
- [ ] Mostrar progresso e normalizar respostas não JSON sem expor detalhes internos.
- [ ] Executar testes, typecheck e lint.

### Task 4: Verificação integrada

**Files:**
- Verify: all changed files.

- [ ] Executar `corepack pnpm --dir apps/web test:operational`.
- [ ] Executar `corepack pnpm typecheck` e `corepack pnpm lint`.
- [ ] Executar build de produção com `DATABASE_URL` local carregada somente no processo.
- [ ] Revisar `git diff --check` e o diff final antes do commit.

