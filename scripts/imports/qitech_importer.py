from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

import psycopg2
from dotenv import load_dotenv
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet


POSITION_SECTIONS = {"SRP", "DIR", "MEZAN", "NTN-B", "OUTROSFUNDOS"}

DRE_CATEGORIES = {
    "taxa_gestao": "Taxa de Gestao",
    "taxa_administracao": "Taxa de Administracao",
    "taxa_custodia": "Taxa de Custodia",
    "auditoria": "Auditoria",
    "servicos_cobranca": "Servicos de Cobranca",
    "iof": "IOF",
    "cetip": "CETIP",
    "selic": "SELIC",
    "consultoria": "Consultoria",
    "rating": "Rating",
    "outras_despesas": "Outras Despesas",
    "pdd": "PDD - Provisao para Devedores Duvidosos",
}


@dataclass
class FundQuoteData:
    fund_name: str
    position_date: date
    net_asset_value: Decimal
    quota_value: Decimal
    shares_quantity: Decimal
    daily_return: Decimal
    month_return: Decimal
    year_return: Decimal


@dataclass
class FinancialPositionData:
    asset_class: str
    position_date: date
    code: str
    asset_name: str
    quantity: Decimal
    market_unit_price: Decimal
    gross_value: Decimal
    net_value: Decimal
    indexer: str | None
    maturity_date: date | None


@dataclass
class DreEntryData:
    reference_date: date
    description: str
    amount: Decimal
    translated_history: str
    category: str


@dataclass
class CashImportData:
    header_date: date | None
    entries: list[DreEntryData]


def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip().lower()


def normalized_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize_text(value))


def parse_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))

    text = str(value).strip()
    if not text:
        return None
    text = text.replace("%", "").replace("R$", "").strip()
    text = re.sub(r"[^0-9,.\-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None

    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")

    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def first_decimal(values: Iterable[Any]) -> Decimal | None:
    for value in values:
        number = parse_decimal(value)
        if number is not None:
            return number
    return None


def find_header(headers: list[Any], *candidates: str) -> int | None:
    normalized_headers = [normalized_key(header) for header in headers]
    normalized_candidates = [normalized_key(candidate) for candidate in candidates]
    for candidate in normalized_candidates:
        for index, header in enumerate(normalized_headers):
            if candidate == header or candidate in header:
                return index
    return None


def row_value(row: tuple[Any, ...], headers: list[Any], *candidates: str) -> Any:
    index = find_header(headers, *candidates)
    if index is None or index >= len(row):
        return None
    return row[index]


def iter_rows(ws: Worksheet) -> list[tuple[Any, ...]]:
    return [tuple(row) for row in ws.iter_rows(values_only=True)]


def extract_header_data(workbook: Any) -> tuple[str, date]:
    fund_name = ""
    position_date = None

    for max_rows in (10, 20):
        for worksheet in workbook.worksheets:
            for row in worksheet.iter_rows(max_row=max_rows):
                for cell in row:
                    if cell.value is None:
                        continue
                    text = str(cell.value)
                    normalized = normalize_text(text)

                    if "cliente:" in normalized and not fund_name:
                        fund_name = text.split(":", 1)[1].strip()

                    if "data de posicao" in normalized:
                        match = re.search(r"\d{2}/\d{2}/\d{4}", text)
                        if match:
                            position_date = parse_date(match.group(0))
                            print(
                                "Data de posicao encontrada "
                                f"na aba '{worksheet.title}', celula {cell.coordinate}: {text}"
                            )
                            break
                if position_date is not None:
                    break
            if position_date is not None:
                break
        if position_date is not None:
            break

    if not fund_name:
        raise ValueError("Nao foi possivel encontrar o cabecalho CLIENTE no arquivo de carteira.")
    if position_date is None:
        raise ValueError("Nao foi possivel encontrar a Data de posicao no arquivo de carteira.")

    return fund_name, position_date


def extract_rentability(rows: list[tuple[Any, ...]], fund_name: str, position_date: date) -> FundQuoteData:
    header_index = None
    headers: list[Any] = []

    for index, row in enumerate(rows):
        if any(normalized_key(cell) == "codindexador" for cell in row):
            header_index = index
            headers = list(row)
            break

    if header_index is None:
        raise ValueError("Secao Rentabilidade nao encontrada: coluna 'Cod. Indexador' ausente.")

    code_index = find_header(headers, "Cod. Indexador")
    if code_index is None:
        raise ValueError("Coluna 'Cod. Indexador' nao encontrada na secao Rentabilidade.")

    rentability_rows: dict[str, tuple[Any, ...]] = {}
    for row in rows[header_index + 1 :]:
        code = normalize_text(row[code_index] if code_index < len(row) else None)
        if code in {"patrimon", "cota", "vlr cota", "qtd cota"}:
            rentability_rows[code] = row
        if len(rentability_rows) == 4:
            break

    try:
        patrimon = rentability_rows["patrimon"]
        cota = rentability_rows["cota"]
        vlr_cota = rentability_rows["vlr cota"]
        qtd_cota = rentability_rows["qtd cota"]
    except KeyError as error:
        raise ValueError(f"Linha obrigatoria ausente na secao Rentabilidade: {error.args[0]}") from error

    net_asset_value = parse_decimal(row_value(patrimon, headers, "Valor Patrimonio", "Valor Patrimônio"))
    quota_value = first_decimal(vlr_cota[code_index + 1 :])
    shares_quantity = first_decimal(qtd_cota[code_index + 1 :])
    daily_return = parse_decimal(row_value(cota, headers, "(%) Variacao Diaria", "(%) Variação Diaria"))
    month_return = parse_decimal(row_value(cota, headers, "(%) Variacao Mensal", "(%) Variação Mensal"))
    year_return = parse_decimal(row_value(cota, headers, "(%) Variacao Anual", "(%) Variação Anual"))

    required = {
        "Valor Patrimonio": net_asset_value,
        "Vlr Cota": quota_value,
        "Qtd Cota": shares_quantity,
        "Variacao Diaria": daily_return,
        "Variacao Mensal": month_return,
        "Variacao Anual": year_return,
    }
    missing = [name for name, value in required.items() if value is None]
    if missing:
        raise ValueError(f"Campos ausentes na Rentabilidade: {', '.join(missing)}")

    return FundQuoteData(
        fund_name=fund_name,
        position_date=position_date,
        net_asset_value=net_asset_value,
        quota_value=quota_value,
        shares_quantity=shares_quantity,
        daily_return=daily_return,
        month_return=month_return,
        year_return=year_return,
    )


def extract_positions(rows: list[tuple[Any, ...]], default_position_date: date) -> list[FinancialPositionData]:
    positions: list[FinancialPositionData] = []

    for index, row in enumerate(rows):
        section = None
        for cell in row:
            key = normalized_key(cell)
            if key in {normalized_key(item) for item in POSITION_SECTIONS}:
                section = str(cell).strip()
                break
        if section is None:
            continue

        header_index = None
        for candidate_index in range(index + 1, min(index + 6, len(rows))):
            candidate = rows[candidate_index]
            if find_header(list(candidate), "Nome Papel", "Valor Bruto", "Valor Liquido") is not None:
                header_index = candidate_index
                break
        if header_index is None:
            continue

        headers = list(rows[header_index])
        for data_row in rows[header_index + 1 :]:
            if all(cell is None or str(cell).strip() == "" for cell in data_row):
                break
            first_cell = normalize_text(data_row[0] if data_row else None)
            if normalized_key(first_cell) in {normalized_key(item) for item in POSITION_SECTIONS}:
                break

            asset_name = row_value(data_row, headers, "Nome Papel", "Papel", "Ativo")
            gross_value = parse_decimal(row_value(data_row, headers, "Valor Bruto"))
            net_value = parse_decimal(row_value(data_row, headers, "Valor Liquido", "Valor Líquido"))
            if not asset_name or (gross_value is None and net_value is None):
                continue

            quantity = parse_decimal(row_value(data_row, headers, "Quantidade", "Qtd")) or Decimal("0")
            market_unit_price = parse_decimal(row_value(data_row, headers, "PU Mercado", "PU")) or Decimal("0")
            position_date = parse_date(row_value(data_row, headers, "Data Posicao", "Data Posição")) or default_position_date

            positions.append(
                FinancialPositionData(
                    asset_class=section,
                    position_date=position_date,
                    code=str(row_value(data_row, headers, "Codigo", "Código", "Cod.") or "").strip(),
                    asset_name=str(asset_name).strip(),
                    quantity=quantity,
                    market_unit_price=market_unit_price,
                    gross_value=gross_value or Decimal("0"),
                    net_value=net_value or gross_value or Decimal("0"),
                    indexer=(str(row_value(data_row, headers, "Indexador") or "").strip() or None),
                    maturity_date=parse_date(row_value(data_row, headers, "Vencimento")),
                )
            )

    return positions


def categorize_expense(history: str) -> str:
    normalized = normalize_text(history)
    if "gestao" in normalized:
        return "taxa_gestao"
    if "administracao" in normalized:
        return "taxa_administracao"
    if "custodia" in normalized:
        return "taxa_custodia"
    if "auditoria" in normalized:
        return "auditoria"
    if "cobranca" in normalized:
        return "servicos_cobranca"
    if "iof" in normalized:
        return "iof"
    if "cetip" in normalized:
        return "cetip"
    if "selic" in normalized:
        return "selic"
    if "consultoria" in normalized:
        return "consultoria"
    if "rating" in normalized:
        return "rating"
    return "outras_despesas"


def extract_cpr_rows(rows: list[tuple[Any, ...]], reference_date: date | None) -> list[DreEntryData]:
    entries: list[DreEntryData] = []

    for index, row in enumerate(rows):
        if not any(normalize_text(cell) == "cpr" for cell in row):
            continue

        print(f"Secao CPR encontrada na linha {index + 1}.")
        start_index = index + 2

        for row_index, data_row in enumerate(rows[start_index:], start=start_index + 1):
            first_cell = normalize_text(data_row[0] if data_row else None)
            if first_cell.startswith("totais"):
                print(f"Fim da secao CPR encontrado na linha {row_index}: {data_row[0]}")
                break
            if all(cell is None or str(cell).strip() == "" for cell in data_row):
                print(f"Fim da secao CPR por linha vazia na linha {row_index}.")
                break

            row_date = parse_date(data_row[0] if len(data_row) > 0 else None)
            description = str(data_row[1] if len(data_row) > 1 and data_row[1] is not None else "").strip()
            amount = parse_decimal(data_row[2] if len(data_row) > 2 else None)
            translated_history = str(
                data_row[5] if len(data_row) > 5 and data_row[5] is not None else description
            ).strip()

            if amount is None or amount == Decimal("0"):
                continue

            entry_date = reference_date or row_date
            if entry_date is None:
                print(f"Aviso: linha CPR ignorada sem data de referencia: {data_row}")
                continue

            category = categorize_expense(translated_history)
            print(
                "CPR linha encontrada: "
                f"linha={row_index}, data={row_date}, descricao='{description}', "
                f"valor={amount}, historico='{translated_history}', categoria={category}"
            )

            entries.append(
                DreEntryData(
                    reference_date=entry_date,
                    description=description or translated_history,
                    amount=amount,
                    translated_history=translated_history,
                    category=category,
                )
            )

        break

    if not entries:
        print("Aviso: nenhuma linha de despesa encontrada na secao CPR.")

    return entries


def extract_section_rows(rows: list[tuple[Any, ...]], section_name: str) -> list[DreEntryData]:
    section_key = normalized_key(section_name)
    entries: list[DreEntryData] = []

    for index, row in enumerate(rows):
        if not any(normalized_key(cell) == section_key for cell in row):
            continue

        header_index = None
        for candidate_index in range(index + 1, min(index + 8, len(rows))):
            candidate = rows[candidate_index]
            if find_header(list(candidate), "Data", "Valor") is not None:
                header_index = candidate_index
                break
        if header_index is None:
            continue

        headers = list(rows[header_index])
        for data_row in rows[header_index + 1 :]:
            if all(cell is None or str(cell).strip() == "" for cell in data_row):
                break
            if data_row and normalized_key(data_row[0]) in {"cpr", "outrosativos"}:
                break

            reference_date = parse_date(row_value(data_row, headers, "Data", "Dt. Movimento", "Data Movimento"))
            amount = parse_decimal(row_value(data_row, headers, "Valor", "Valor Financeiro"))
            description = str(row_value(data_row, headers, "Descricao", "Descrição", "Historico", "Histórico") or "").strip()
            translated_history = str(
                row_value(data_row, headers, "Historico Traduzido", "Histórico Traduzido") or description
            ).strip()

            if reference_date is None or amount is None:
                continue

            category = "pdd" if section_key == "outrosativos" else categorize_expense(translated_history)
            if section_key == "outrosativos" and "pdd" not in normalize_text(translated_history + " " + description):
                continue

            entries.append(
                DreEntryData(
                    reference_date=reference_date,
                    description=description or translated_history,
                    amount=amount,
                    translated_history=translated_history,
                    category=category,
                )
            )

    return entries


def load_carteira(path: Path) -> tuple[FundQuoteData, list[FinancialPositionData]]:
    workbook = load_workbook(path, data_only=True)
    worksheet = workbook.active
    rows = iter_rows(worksheet)
    fund_name, position_date = extract_header_data(workbook)
    quote = extract_rentability(rows, fund_name, position_date)
    positions = extract_positions(rows, position_date)
    return quote, positions


def load_caixa(path: Path, reference_date: date | None = None) -> CashImportData:
    workbook = load_workbook(path, data_only=True)
    worksheet = workbook["número1"] if "número1" in workbook.sheetnames else workbook.active
    rows = iter_rows(worksheet)
    header_date = reference_date
    entries = extract_cpr_rows(rows, header_date) + extract_section_rows(rows, "OutrosAtivos")
    return CashImportData(header_date=header_date, entries=entries)


def stable_id(prefix: str, *parts: Any) -> str:
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:24]}"


def load_environment() -> None:
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parents[1]
    for env_path in (
        root_dir / ".env",
        root_dir / "apps" / "web" / ".env",
        root_dir / "packages" / "database" / ".env",
    ):
        if env_path.exists():
            load_dotenv(env_path, override=False)


def find_fund_id(cursor: Any, fund_name: str) -> str:
    cursor.execute(
        """
        SELECT id, name
        FROM funds
        WHERE name = %s OR "shortName" = %s
        ORDER BY name
        LIMIT 1
        """,
        (fund_name, fund_name),
    )
    row = cursor.fetchone()
    if row:
        print(f"Fundo encontrado por correspondencia exata: {row[1]} ({row[0]})")
        return row[0]

    cursor.execute(
        """
        SELECT id, name
        FROM funds
        WHERE name ILIKE %s OR "shortName" ILIKE %s
        ORDER BY name
        LIMIT 1
        """,
        (f"%{fund_name}%", f"%{fund_name}%"),
    )
    row = cursor.fetchone()
    if row:
        print(f"Fundo encontrado por busca parcial: {row[1]} ({row[0]})")
        return row[0]

    normalized_name = normalize_text(fund_name)
    words = [word for word in re.split(r"\W+", normalized_name) if len(word) >= 3]
    for word in words:
        cursor.execute(
            """
            SELECT id, name
            FROM funds
            WHERE name ILIKE %s OR "shortName" ILIKE %s
            ORDER BY name
            LIMIT 1
            """,
            (f"%{word}%", f"%{word}%"),
        )
        row = cursor.fetchone()
        if row:
            print(f"Fundo encontrado por palavra-chave '{word}': {row[1]} ({row[0]})")
            return row[0]

    raise ValueError(f"Fundo nao encontrado no banco para o nome extraido: {fund_name}")


def dre_account_ids(cursor: Any) -> dict[str, str]:
    cursor.execute("SELECT id, code FROM dre_accounts")
    rows = cursor.fetchall()
    return {code: account_id for account_id, code in rows}


def upsert_quote(cursor: Any, fund_id: str, quote: FundQuoteData) -> None:
    cursor.execute(
        """
        INSERT INTO fund_quotes (
          id, "fundId", "quoteDate", "quotaValue", "netAssetValue",
          "sharesQuantity", "dailyReturn", "monthReturn", "yearReturn", "createdAt"
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ("fundId", "quoteDate") DO UPDATE SET
          "quotaValue" = EXCLUDED."quotaValue",
          "netAssetValue" = EXCLUDED."netAssetValue",
          "sharesQuantity" = EXCLUDED."sharesQuantity",
          "dailyReturn" = EXCLUDED."dailyReturn",
          "monthReturn" = EXCLUDED."monthReturn",
          "yearReturn" = EXCLUDED."yearReturn"
        """,
        (
            stable_id("quote", fund_id, quote.position_date),
            fund_id,
            quote.position_date,
            quote.quota_value,
            quote.net_asset_value,
            quote.shares_quantity,
            quote.daily_return,
            quote.month_return,
            quote.year_return,
        ),
    )


def upsert_dre_entries(cursor: Any, fund_id: str, accounts: dict[str, str], entries: list[DreEntryData]) -> int:
    imported_count = 0

    for entry in entries:
        account_id = accounts.get(entry.category)
        if account_id is None:
            print(
                f"Aviso: conta DRE '{entry.category}' nao encontrada. "
                "Usando fallback 'outras_despesas'."
            )
            account_id = accounts.get("outras_despesas")

        if account_id is None:
            print(
                "Aviso: conta DRE fallback 'outras_despesas' nao existe. "
                f"Registro ignorado: {entry.description}"
            )
            continue

        entry_id = stable_id(
            "dre",
            fund_id,
            entry.category,
            entry.reference_date,
            entry.amount,
            entry.description,
            "QITECH",
        )
        cursor.execute(
            """
            INSERT INTO dre_entries (
              id, "fundId", "accountId", "referenceDate", amount, description, source
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'QITECH')
            ON CONFLICT (id) DO UPDATE SET
              "accountId" = EXCLUDED."accountId",
              "referenceDate" = EXCLUDED."referenceDate",
              amount = EXCLUDED.amount,
              description = EXCLUDED.description,
              source = EXCLUDED.source
            """,
            (
                entry_id,
                fund_id,
                account_id,
                entry.reference_date,
                entry.amount,
                entry.description,
            ),
        )
        imported_count += 1

    return imported_count


def upsert_positions(cursor: Any, fund_id: str, positions: list[FinancialPositionData]) -> int:
    for position in positions:
        position_id = stable_id(
            "pos",
            fund_id,
            position.position_date,
            position.asset_class,
            position.code,
            position.asset_name,
        )
        cursor.execute(
            """
            INSERT INTO financial_positions (
              id, "fundId", "positionDate", "assetClass", "assetName",
              quantity, "grossValue", "netValue"
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              "positionDate" = EXCLUDED."positionDate",
              "assetClass" = EXCLUDED."assetClass",
              "assetName" = EXCLUDED."assetName",
              quantity = EXCLUDED.quantity,
              "grossValue" = EXCLUDED."grossValue",
              "netValue" = EXCLUDED."netValue"
            """,
            (
                position_id,
                fund_id,
                position.position_date,
                position.asset_class,
                position.asset_name,
                position.quantity,
                position.gross_value,
                position.net_value,
            ),
        )
    return len(positions)


def run_import(carteira_path: Path, caixa_path: Path) -> None:
    if not carteira_path.exists():
        raise FileNotFoundError(f"Arquivo de carteira nao encontrado: {carteira_path}")
    if not caixa_path.exists():
        raise FileNotFoundError(f"Arquivo de demonstrativo de caixa nao encontrado: {caixa_path}")

    load_environment()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL nao encontrada. Configure o arquivo .env antes de importar.")

    quote, positions = load_carteira(carteira_path)
    cash_import = load_caixa(caixa_path, quote.position_date)

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            fund_id = find_fund_id(cursor, quote.fund_name)
            accounts = dre_account_ids(cursor)
            upsert_quote(cursor, fund_id, quote)
            dre_count = upsert_dre_entries(cursor, fund_id, accounts, cash_import.entries)
            position_count = upsert_positions(cursor, fund_id, positions)
        connection.commit()

    print("Importacao QITECH concluida.")
    print(f"Fundo: {quote.fund_name}")
    print(f"Data de posicao: {quote.position_date.strftime('%d/%m/%Y')}")
    print("fund_quotes: 1 registro inserido/atualizado")
    print(f"dre_entries: {dre_count} registros inseridos/atualizados")
    print(f"financial_positions: {position_count} registros inseridos/atualizados")


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa arquivos XLSX QITECH para o banco OSHER.")
    parser.add_argument("carteira", help="Caminho do arquivo ATIVO_CARTEIRA_DIARIA_*.xlsx")
    parser.add_argument("caixa", help="Caminho do arquivo ATIVO_DEMONSTRATIVO_CAIXA_*.xlsx")
    args = parser.parse_args()

    try:
        run_import(Path(args.carteira), Path(args.caixa))
        return 0
    except Exception as error:
        print(f"Erro na importacao QITECH: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
