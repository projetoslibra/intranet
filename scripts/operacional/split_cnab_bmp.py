"""Fatia um CNAB 444 da BMP em arquivos menores, cada um com header, detalhes e trailer.

Uso:
    python split_cnab_bmp.py "C:\\caminho\\Liquidacao.REM" [linhas_por_arquivo]

O padrao e 1000 linhas de detalhe por arquivo. Os arquivos saem na mesma pasta do
original, com sufixo _parte01, _parte02, etc.

O OSHER exige apenas que a primeira linha comece com 0, a ultima com 9 e que todas
tenham 444 caracteres. O total declarado no trailer nao e conferido, entao cada
pedaco e aceito normalmente.
"""
import sys
from pathlib import Path

RECORD_LENGTH = 444
ENCODING = "cp1252"
DEFAULT_CHUNK = 1000


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    source = Path(sys.argv[1])
    chunk_size = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_CHUNK

    if not source.is_file():
        print(f"ERRO: arquivo nao encontrado: {source}")
        return 1

    payload = source.read_bytes().decode(ENCODING)
    terminator = "\r\n" if "\r\n" in payload else "\n"
    lines = [line for line in payload.replace("\r\n", "\n").split("\n") if line]

    problems = [
        f"  linha {index + 1}: {len(line)} caracteres"
        for index, line in enumerate(lines)
        if len(line) != RECORD_LENGTH
    ]
    if problems:
        print(f"ERRO: {len(problems)} linha(s) fora dos {RECORD_LENGTH} caracteres:")
        print("\n".join(problems[:10]))
        return 1

    if not lines or lines[0][0] != "0" or lines[-1][0] != "9":
        print("ERRO: o arquivo precisa comecar com header 0 e terminar com trailer 9.")
        return 1

    header, trailer = lines[0], lines[-1]
    details = [line for line in lines[1:-1] if line[0] == "1"]
    ignored = len(lines) - 2 - len(details)

    print(f"Arquivo:   {source.name}")
    print(f"Total:     {len(lines)} linhas")
    print(f"Detalhes:  {len(details)} titulos")
    if ignored:
        print(f"Ignoradas: {ignored} linha(s) que nao sao detalhe tipo 1")

    if len(details) <= chunk_size:
        print(f"\nO arquivo ja cabe em um pedaco de {chunk_size}. Nada a fatiar.")
        return 0

    parts = [details[start:start + chunk_size] for start in range(0, len(details), chunk_size)]
    print(f"\nGerando {len(parts)} arquivos de ate {chunk_size} titulos:\n")

    for index, part in enumerate(parts, start=1):
        target = source.with_name(f"{source.stem}_parte{index:02d}{source.suffix}")
        content = terminator.join([header, *part, trailer]) + terminator
        target.write_bytes(content.encode(ENCODING))
        print(f"  {target.name}  ->  {len(part)} titulos")

    print("\nSuba um pedaco de cada vez pela tela de baixas.")
    print("Cada pedaco vira um lote proprio, e a conciliacao bancaria ja sabe")
    print("casar varias remessas com uma unica entrada do extrato.")
    print("\nATENCAO: o total declarado no trailer segue sendo o do arquivo inteiro.")
    print("O OSHER nao confere esse campo, mas nao use estes pedacos fora dele.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
