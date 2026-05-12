# OSHER — Contexto do Projeto

## O que é este projeto
Aplicação web financeira interna da OSHER para gestão de fundos de investimento.
Acesso restrito à diretoria e equipe financeira.

## Stack definida
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui + lucide-react
- Prisma ORM
- PostgreSQL (Docker local / Neon em produção)
- Auth.js (NextAuth v5) com e-mail e senha
- Recharts (gráficos)
- TanStack Table (tabelas)
- Zod (validação)

## Estrutura de pastas
```txt
osher-finance-app/
  apps/web/src/
    app/          -> rotas, páginas, layouts
    components/   -> componentes reutilizáveis
    features/     -> módulos de negócio
    lib/          -> prisma, auth, formatadores, utils
    server/       -> regras server-side
  packages/database/ -> schema Prisma, migrations, seeds
  scripts/imports/   -> scripts Python para CSV/Excel
  docs/
```

## Identidade visual
- Nome exibido: OSHER
- Tom: executivo, limpo, profissional
- Cores: a definir (dark sidebar + conteúdo claro)

## Perfis de usuário
ADMIN | DIRETOR | SOCIO | FINANCEIRO | LEITURA

## Permissões granulares
- dashboard.view
- funds.view
- funds.manage
- quotes.view
- quotes.import
- dre.view
- dre.import
- cash.view
- cash.manage
- users.manage
- reports.export

## Módulos planejados (roadmap)
1. Base do projeto
2. Banco de dados
3. Autenticação + login
4. Layout executivo (sidebar + topbar)
5. Usuários e permissões
6. Cadastro de fundos
7. Cotas e rentabilidade
8. Dashboard financeiro
9. DRE dos fundos
10. Caixa da empresa
11. Importação de dados (CSV/Excel)
12. Relatórios gerenciais
13. Auditoria e segurança
14. Deploy (Vercel + Neon)

## Status atual
- [x] TASK 0 — CLAUDE.md criado
- [ ] TASK 1 — Estrutura do projeto + Next.js iniciado (estrutura criada; validação pendente de Node.js/npm no PATH)
- [x] TASK 2 — Docker + PostgreSQL + Prisma configurado
- [x] TASK 3 — Auth.js + login funcionando
- [x] TASK 4 — Layout executivo (sidebar + topbar + dashboard vazio)
- [x] TASK 5 — Módulo de Fundos + Script de Importação QITECH
- [x] TASK 6 — DRE dos fundos com dados reais

## Convenções
- Valores financeiros: Decimal (nunca float)
- Formatação de moeda: `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`
- Formatação de datas: `Intl.DateTimeFormat("pt-BR")`
- Idioma do código: inglês (variáveis, funções, schema)
- Idioma da interface: português brasileiro
- Para rodar scripts do database, sempre usar `corepack pnpm --filter @osher/database <script>` e não `corepack pnpm <script>` na raiz.
- O banco de dados está no Railway em `metro.proxy.rlwy.net:20041`, schema `public`, banco `railway`.

## Observações importantes
- Caminho atual do projeto: `C:\PROGRAMAS-JP\osher-finance-app`.
- Cada TASK deve ser executada e validada antes de iniciar a próxima.
- Após cada TASK concluída, atualizar o status neste arquivo.
- Scripts de importação serão em Python separado do Next.js.
- Credenciais de desenvolvimento do PostgreSQL local: banco `osher_db`, usuário `osher`, senha `osher123`, porta `5432`.
- Credenciais do usuário admin seed: email `admin@osher.com.br`, senha `Admin@2024`.
- Script de importação QITECH: `scripts/imports/qitech_importer.py`.
- Dependências Python do importador: `scripts/imports/requirements.txt`.
- Contas DRE padrão seedadas no banco para despesas, PDD e receitas.
- Repositório GitHub: `https://github.com/projetoslibra/intranet.git`.
- Deploy: Vercel conectado ao repositório GitHub.
- Variáveis de ambiente necessárias na Vercel: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.

## Atualizacoes recentes
- [x] TASK 7 - DRE com abas Carteira e DRE/Variacao + fluxos de caixa dos fundos.
- Nova tabela `FundCashFlow` (`fund_cash_flows`) armazena aplicacoes/resgates dos fundos importados do demonstrativo de caixa QITECH.
- Tela DRE possui duas abas: `Carteira` para valores absolutos e `DRE / Variacao` para delta diario ajustado por aplicacoes/resgates.
