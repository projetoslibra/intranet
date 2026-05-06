# Instalacao Local — OSHER Finance App

## 1. Instalar Node.js

Se `node --version` ou `npm --version` nao funcionar no PowerShell, instale o Node.js LTS:

```powershell
winget install OpenJS.NodeJS.LTS
```

Depois feche e abra o VS Code novamente.

Valide:

```powershell
node --version
```

```powershell
npm --version
```

## 2. Abrir o projeto

```powershell
cd "G:\Drives compartilhados\13. DATA ANALYSIS\12. Osher\osher-finance-app"
code .
```

## 3. Instalar dependencias

```powershell
npm install
```

## 4. Rodar o frontend

```powershell
npm run dev
```

Abra no navegador:

```txt
http://localhost:3000
```

## Observacao

A TASK 2 vai adicionar Docker, PostgreSQL, Prisma schema, migrations e seed inicial.
