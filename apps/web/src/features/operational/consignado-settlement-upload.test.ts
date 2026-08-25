import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSettlementBlobIntegrity,
  buildSettlementUploadPath,
  consignadoSettlementUploadConfig,
  readSettlementApiResponse,
  validateSettlementUploadMetadata,
  validateSettlementUploadPath,
} from "./consignado-settlement-upload";

const hash = "a".repeat(64);

test("aceita CNAB BMP privado de até 50 MB e normaliza o hash", () => {
  const input = validateSettlementUploadMetadata({
    source: "BMP",
    originator: "GIBB",
    fileName: "CB280701ECO.REM",
    fileHash: hash.toUpperCase(),
    fileSize: 50 * 1024 * 1024,
    storageKey: "operacional/consignado/baixas/uploads/bmp/123-CB280701ECO.REM",
  });

  assert.equal(input.fileHash, hash);
  assert.equal(input.fileSize, consignadoSettlementUploadConfig.maxFileSize);
});

test("rejeita tamanho acima de 50 MB, hash inválido e caminho fora do módulo", () => {
  const valid = {
    source: "BMP" as const,
    originator: "GIBB",
    fileName: "CB280701ECO.REM",
    fileHash: hash,
    fileSize: 7 * 1024 * 1024,
    storageKey: "operacional/consignado/baixas/uploads/bmp/123-CB280701ECO.REM",
  };

  assert.throws(() => validateSettlementUploadMetadata({ ...valid, fileSize: 50 * 1024 * 1024 + 1 }), /50 MB/);
  assert.throws(() => validateSettlementUploadMetadata({ ...valid, fileHash: "abc" }), /hash/i);
  assert.throws(() => validateSettlementUploadMetadata({ ...valid, storageKey: "operacional/consignado/estoques/file.rem" }), /armazenamento/i);
});

test("rejeita extensão incompatível com BMP ou UY3", () => {
  assert.throws(() => validateSettlementUploadMetadata({
    source: "BMP",
    originator: "GIBB",
    fileName: "baixa.xlsx",
    fileHash: hash,
    fileSize: 1024,
    storageKey: "operacional/consignado/baixas/uploads/bmp/123-baixa.xlsx",
  }), /BMP.*REM ou TXT/i);
  assert.throws(() => validateSettlementUploadMetadata({
    source: "UY3",
    originator: "UY3",
    fileName: "baixa.rem",
    fileHash: hash,
    fileSize: 1024,
    storageKey: "operacional/consignado/baixas/uploads/uy3/123-baixa.rem",
  }), /UY3.*XLSX/i);
});

test("gera chave segura, vinculada ao fluxo e sem caracteres de caminho", () => {
  assert.equal(
    buildSettlementUploadPath({ source: "BMP", fileName: "Liquidação ../ 25.REM", timestamp: 123 }),
    "operacional/consignado/baixas/uploads/bmp/123-Liquidacao-..--25.REM",
  );
});

test("confere tamanho e hash reais do Blob antes do processamento", () => {
  assert.doesNotThrow(() => assertSettlementBlobIntegrity({ declaredSize: 7_208_000, declaredHash: hash, actualSize: 7_208_000, actualHash: hash }));
  assert.throws(() => assertSettlementBlobIntegrity({ declaredSize: 7_208_000, declaredHash: hash, actualSize: 7_207_999, actualHash: hash }), /tamanho/i);
  assert.throws(() => assertSettlementBlobIntegrity({ declaredSize: 7_208_000, declaredHash: hash, actualSize: 7_208_000, actualHash: "b".repeat(64) }), /conteúdo/i);
});

test("autoriza somente caminhos de upload compatíveis com o fluxo", () => {
  assert.equal(validateSettlementUploadPath("operacional/consignado/baixas/uploads/bmp/123-baixa.rem"), "BMP");
  assert.equal(validateSettlementUploadPath("operacional/consignado/baixas/uploads/uy3/123-baixa.xlsx"), "UY3");
  assert.throws(() => validateSettlementUploadPath("operacional/consignado/baixas/uploads/bmp/123-baixa.xlsx"), /caminho/i);
  assert.throws(() => validateSettlementUploadPath("operacional/consignado/estoques/123-baixa.rem"), /caminho/i);
});

test("transforma resposta textual da infraestrutura em erro legível", async () => {
  const payload = await readSettlementApiResponse(new Response("Request Entity Too Large", { status: 413 }));
  assert.deepEqual(payload, { ok: false, message: "Request Entity Too Large" });
});

test("preserva a resposta JSON do processamento", async () => {
  const payload = await readSettlementApiResponse(new Response(JSON.stringify({ ok: true, message: "Processado" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  assert.deepEqual(payload, { ok: true, message: "Processado" });
});
