# TASKS — Quadro de trabalho da equipe OSHER

> **Como usar (leia antes de começar qualquer coisa):**
> 1. `git pull` na `main` para pegar a versão mais recente.
> 2. Leia este arquivo + o `CLAUDE.md`.
> 3. Ao **pegar** uma task: mova-a para **🔴 Em andamento**, ponha seu nome, a data e o nome da branch.
> 4. Trabalhe em uma **branch própria** (`feat/...`, `fix/...`), nunca direto na `main`.
> 5. Ao terminar: abra um **PR**, peça revisão do outro, faça merge. Mova a task para **🟢 Concluídas**.
> 6. **Commite este arquivo junto** com seu trabalho — ele é o nosso "quadro" compartilhado.

---

## 👥 Pessoas
- **Juan** — @projetoslibra (juan.carneiro@libracapital.com.br)
- **João** — @[handle do GitHub] ([email]) · _preencher handle/email_

---

## 🔴 Em andamento
> 1 dono por linha. Se o seu nome está aqui, ninguém mais mexe nesses arquivos/área.

| Task | Responsável | Branch | Início | Notas |
|------|-------------|--------|--------|-------|
| **TASK 10 — Caixa da empresa** | Juan | `feat/caixa` | 2026-06-25 | Migration `add_cash_daily_balances` **aplicada** no schema OSHER; seed dos 4 fundos (CNPJ placeholder) feito. **PR aberto — aguardando revisão do João.** Falta validar UI ao vivo e rodar o backfill (`cash_backfill.py --dry-run`). |

---

## 🟡 Próximas (backlog priorizado)
> Pegue de cima para baixo. Se for começar, mova para "Em andamento".

- [ ] **Módulo Usuários** (`/dashboard/usuarios`) — CRUD + atribuição de roles (placeholder)
- [ ] **Módulo Relatórios** (`/dashboard/relatorios`) — exportações (placeholder)
- [ ] **Enforcement de permissões** — hoje o middleware só checa login, não as permissões `*.view`/`*.manage`
- [ ] **Cadastrar fundos reais** (APUAMA, BRISTOL) e importar planilhas QITECH
- [ ] **Botão "Exportar Excel" da DRE** — hoje é decorativo, sem handler
- [ ] **Unificar formatters** — Dashboard e DRE redefinem formatters em vez de usar `lib/formatters.ts`

---

## 🟢 Concluídas (recentes)
- [x] **[2026-06-25]** Banco de produção configurado no schema `OSHER` (Railway compartilhado): migrations + seed — _Juan_
- [x] **[2026-06-25]** Reconhecimento do projeto → `docs/PROJECT-MAP.md` — _Juan_
- [x] TASK 1–8 (base, banco, auth, layout, fundos, DRE, caixa-dos-fundos, dashboard) — ver histórico no `CLAUDE.md`

---

## 🧱 Decisões / convenções de equipe
- **`main` é sagrada**: sempre deployável (Vercel faz deploy automático dela). Nada quebrado vai pra `main`.
- **Branch por task + PR**: `git checkout -b feat/<nome>`; ao terminar, PR e o outro revisa.
- **Banco é COMPARTILHADO** (schema `OSHER`, mesma instância do CRM): só **uma pessoa mexe no schema/migrations por vez**. Avise aqui em "Em andamento" antes de criar migration. Depois do merge, o outro roda `prisma migrate deploy` (pelo binário — ver `CLAUDE.md`) para sincronizar.
- **Segredos**: `.env` é local e gitignored — nunca commitar. Mudou alguma variável? Atualize o `.env.example` (só os nomes, sem valores) e avise aqui.
- **Sincronize sempre**: `git pull` antes de começar e antes de abrir PR.

---

## ⚠️ Bloqueios / pendências
- pnpm v11 bloqueia build scripts → o wrapper `corepack pnpm --filter ... <script>` falha. Workaround documentado no `CLAUDE.md` (rodar Prisma pelo binário). _Resolver de vez configurando `onlyBuiltDependencies`._
- Senha do Postgres circulou em chat — **rotacionar no Railway** e atualizar `.env`/Vercel.
