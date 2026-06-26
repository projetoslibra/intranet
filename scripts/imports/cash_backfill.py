"""Backfill histórico do Caixa da empresa a partir do Google Sheets.

Lê duas abas públicas (exportadas como CSV, sem credencial):
  - "Caixa":        Data, Empresa, Conta recebimento, Conta de conciliação, Reserva, Conta pgto
  - "inputs_caixa": Data, Empresa, Usado

Mapeia Empresa -> Fund (por nome) e faz upsert idempotente em
`company_cash_daily_balances` (schema OSHER), chave (fundId, referenceDate).

Uso:
    python cash_backfill.py            # roda o backfill
    python cash_backfill.py --dry-run  # apenas mostra o que faria, sem gravar

Não cria fundos. Empresas sem fundo correspondente são logadas e puladas.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import psycopg2

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv é opcional; sem ele lemos o ambiente direto.
    load_dotenv = None


GOOGLE_SHEET_ID = "1F4ziJnyxpLr9VuksbSvL21cjmGzoV0mDPSk7XzX72iQ"
CAIXA_SHEET = "Caixa"
INPUTS_SHEET = "inputs_caixa"


@dataclass
class CashRow:
    fund_id: str
    reference_date: date
    receiving_balance: Decimal = Decimal("0")
    reconciliation_balance: Decimal = Decimal("0")
    reserve_balance: Decimal = Decimal("0")
    payment_balance: Decimal = Decimal("0")
    used_amount: Decimal = Decimal("0")
    sources: set[str] = field(default_factory=set)


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

    text = str(value).strip().replace("%", "").replace("R$", "").strip()
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
    # dayfirst=True: formatos BR primeiro.
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def stable_id(prefix: str, *parts: Any) -> str:
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:24]}"


def load_environment() -> None:
    if load_dotenv is None:
        return
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parents[1]
    for env_path in (
        root_dir / ".env",
        root_dir / "apps" / "web" / ".env",
        root_dir / "packages" / "database" / ".env",
    ):
        if env_path.exists():
            load_dotenv(env_path, override=False)


def split_schema_from_url(database_url: str) -> tuple[str, str]:
    """Remove o parâmetro `schema` (que o libpq não entende) e o devolve à parte.

    Prisma usa `?...&schema=OSHER`; o psycopg2/libpq ignora ou rejeita esse
    parâmetro, então aplicamos o schema via SET search_path.
    """
    parsed = urllib.parse.urlsplit(database_url)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    schema = query.pop("schema", ["public"])[0]
    new_query = urllib.parse.urlencode(query, doseq=True)
    cleaned = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment)
    )
    return cleaned, schema


def fetch_sheet_csv(sheet_name: str) -> list[dict[str, str]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}"
        f"/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(sheet_name)}"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "osher-cash-backfill/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(raw))
    return [row for row in reader]


def column_getter(fieldnames: list[str]):
    lookup = {normalized_key(name): name for name in fieldnames}

    def get(row: dict[str, str], *candidates: str) -> Any:
        for candidate in candidates:
            key = normalized_key(candidate)
            for normalized, original in lookup.items():
                if normalized == key or key in normalized:
                    return row.get(original)
        return None

    return get


def load_funds(cursor: Any) -> list[tuple[str, str, str]]:
    cursor.execute('SELECT id, name, "shortName" FROM funds ORDER BY name')
    return cursor.fetchall()


def match_fund(funds: list[tuple[str, str, str]], empresa: str) -> str | None:
    target = normalized_key(empresa)
    if not target:
        return None
    for fund_id, name, short_name in funds:
        if normalized_key(name) == target or normalized_key(short_name) == target:
            return fund_id
    for fund_id, name, short_name in funds:
        if target in normalized_key(name) or target in normalized_key(short_name):
            return fund_id
        if normalized_key(name).startswith(target) or normalized_key(short_name).startswith(target):
            return fund_id
    return None


def collect_rows(
    funds: list[tuple[str, str, str]]
) -> tuple[dict[tuple[str, date], CashRow], set[str]]:
    rows: dict[tuple[str, date], CashRow] = {}
    unmatched: set[str] = set()

    def row_for(empresa: str, reference_date: date) -> CashRow | None:
        fund_id = match_fund(funds, empresa)
        if fund_id is None:
            unmatched.add(empresa)
            return None
        key = (fund_id, reference_date)
        if key not in rows:
            rows[key] = CashRow(fund_id=fund_id, reference_date=reference_date)
        return rows[key]

    caixa = fetch_sheet_csv(CAIXA_SHEET)
    if caixa:
        get = column_getter(list(caixa[0].keys()))
        for raw in caixa:
            reference_date = parse_date(get(raw, "Data"))
            empresa = str(get(raw, "Empresa") or "").strip()
            if reference_date is None or not empresa:
                continue
            row = row_for(empresa, reference_date)
            if row is None:
                continue
            row.receiving_balance = parse_decimal(get(raw, "Conta recebimento")) or Decimal("0")
            row.reconciliation_balance = (
                parse_decimal(get(raw, "Conta de conciliacao", "Conta de conciliação")) or Decimal("0")
            )
            row.reserve_balance = parse_decimal(get(raw, "Reserva")) or Decimal("0")
            row.payment_balance = parse_decimal(get(raw, "Conta pgto")) or Decimal("0")
            row.sources.add(CAIXA_SHEET)

    inputs = fetch_sheet_csv(INPUTS_SHEET)
    if inputs:
        get = column_getter(list(inputs[0].keys()))
        for raw in inputs:
            reference_date = parse_date(get(raw, "Data"))
            empresa = str(get(raw, "Empresa") or "").strip()
            if reference_date is None or not empresa:
                continue
            row = row_for(empresa, reference_date)
            if row is None:
                continue
            row.used_amount = parse_decimal(get(raw, "Usado")) or Decimal("0")
            row.sources.add(INPUTS_SHEET)

    return rows, unmatched


def upsert_rows(cursor: Any, rows: dict[tuple[str, date], CashRow]) -> int:
    for (fund_id, reference_date), row in rows.items():
        cursor.execute(
            """
            INSERT INTO company_cash_daily_balances (
              id, "fundId", "referenceDate", "receivingBalance", "reconciliationBalance",
              "reserveBalance", "paymentBalance", "usedAmount", note, "createdAt", "updatedAt"
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT ("fundId", "referenceDate") DO UPDATE SET
              "receivingBalance" = EXCLUDED."receivingBalance",
              "reconciliationBalance" = EXCLUDED."reconciliationBalance",
              "reserveBalance" = EXCLUDED."reserveBalance",
              "paymentBalance" = EXCLUDED."paymentBalance",
              "usedAmount" = EXCLUDED."usedAmount",
              "updatedAt" = NOW()
            """,
            (
                stable_id("cash", fund_id, reference_date),
                fund_id,
                reference_date,
                row.receiving_balance,
                row.reconciliation_balance,
                row.reserve_balance,
                row.payment_balance,
                row.used_amount,
                "Backfill Google Sheets",
            ),
        )
    return len(rows)


def run(dry_run: bool) -> None:
    load_environment()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL não encontrada. Configure o .env antes de rodar.")

    clean_url, schema = split_schema_from_url(database_url)

    with psycopg2.connect(clean_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO "{schema}", public')
            funds = load_funds(cursor)
            if not funds:
                raise RuntimeError(f"Nenhum fundo encontrado no schema {schema}.")

            rows, unmatched = collect_rows(funds)

            for empresa in sorted(unmatched):
                print(f"Aviso: empresa sem fundo correspondente, pulada: '{empresa}'")

            print(f"Linhas a gravar: {len(rows)} (schema {schema})")
            for (fund_id, reference_date), row in sorted(
                rows.items(), key=lambda item: (item[0][1], item[0][0])
            ):
                cash = row.payment_balance - row.reserve_balance - row.used_amount
                print(
                    f"  {reference_date} fund={fund_id} "
                    f"receb={row.receiving_balance} concil={row.reconciliation_balance} "
                    f"reserva={row.reserve_balance} pgto={row.payment_balance} "
                    f"usado={row.used_amount} caixa={cash} fontes={sorted(row.sources)}"
                )

            if dry_run:
                print("--dry-run: nada foi gravado.")
                connection.rollback()
                return

            count = upsert_rows(cursor, rows)
        connection.commit()

    print(f"Backfill concluído: {count} posições inseridas/atualizadas.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill do Caixa da empresa via Google Sheets.")
    parser.add_argument("--dry-run", action="store_true", help="Não grava; só mostra o que faria.")
    args = parser.parse_args()

    try:
        run(args.dry_run)
        return 0
    except Exception as error:  # noqa: BLE001
        print(f"Erro no backfill do Caixa: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
