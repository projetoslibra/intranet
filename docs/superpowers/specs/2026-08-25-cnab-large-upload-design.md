# Upload de CNABs grandes — desenho

## Objetivo

Permitir que arquivos BMP/UY3 maiores que o limite de 4,5 MB das Vercel Functions sejam processados pelo OSHER sem alterar as regras atuais de matching, duplicidade, remessa ou conciliação.

## Arquitetura aprovada

- O navegador calcula o SHA-256 e envia o arquivo diretamente ao Vercel Blob privado por token assinado.
- A Function de autorização aceita somente usuários com `operational.finance.manage`, caminhos do módulo de baixas, extensões BMP/UY3 e arquivos de até 50 MB.
- Depois do upload, o navegador envia à API somente nome, hash, tamanho, chave privada, fluxo e originador.
- O servidor confere caminho, tamanho e hash do Blob, processa o buffer pelas rotinas atuais e mantém o Blob como arquivo original auditável do lote.
- Uploads inválidos, duplicados ou que falhem antes da persistência são removidos do Blob.
- A rota de processamento terá até 300 segundos e retornará sempre JSON; a interface mostrará progresso de upload e mensagens legíveis.

## Restrições

- Não alterar a interpretação dos CNABs, o matching nem as regras financeiras.
- Não tornar o Blob público.
- Não confiar apenas no hash ou tamanho informado pelo navegador.
- Manter o bloqueio definitivo de arquivo duplicado.

