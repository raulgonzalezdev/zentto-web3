# Zentto Web3 — Backend de cumplimiento normativo Web3

Backend **independiente** (no comparte código ni base de datos con el ERP) que implementa una **blockchain básica** y un módulo de **cumplimiento normativo (AML/CFT)** sobre ella, con generación de informes asistida por IA.

Construido como proyecto de referencia para un puesto de **Ingeniero/a de Backend Senior (Node.js)** en una plataforma en la intersección de **Web3 + compliance**. Cubre los puntos del cargo: API REST bien diseñada, código limpio y testeable, **pipelines asíncronos de alta demanda**, análisis de **relaciones entre cuentas e intercambios**, y **soluciones basadas en IA para informes de cumplimiento**.

---

## 1. Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 22 + TypeScript |
| Framework | **NestJS 10** (deseable en el cargo) |
| Base de datos | **PostgreSQL 16** (contenedor propio, aislado del ERP) |
| ORM | TypeORM |
| Cola asíncrona | **BullMQ + Redis** (pipeline de minado) |
| Criptografía | `secp256k1` (curva de Bitcoin/Ethereum) + SHA-256 |
| IA | `@anthropic-ai/sdk` (Claude `claude-opus-4-8`) con *fallback* determinista |
| Docs API | Swagger / OpenAPI |
| Tests | Jest (unit) + Supertest (e2e) |
| CI/CD | GitHub Actions (lint · build · unit · e2e · docker) |

---

## 2. Arquitectura

```
                 ┌──────────────────────────────────────────────┐
   HTTP REST ───▶│  NestJS API  (Swagger, validación, helmet)   │
                 └───────┬───────────────┬───────────────┬──────┘
                         │               │               │
                 ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼───────┐
                 │  blockchain  │ │  compliance │ │  analytics   │
                 │  (PoW, mem-  │ │  (AML score │ │ (grafo cross-│
                 │   pool, bal.)│ │   + IA)     │ │  chain, hubs)│
                 └───────┬──────┘ └─────────────┘ └──────────────┘
                         │
          ┌──────────────┴───────────────┐
          ▼                              ▼
   ┌─────────────┐   encola job   ┌─────────────────────┐
   │ PostgreSQL  │◀───────────────│  mining (BullMQ)    │
   │  (propia)   │   persiste     │  worker PoW async   │──▶ Redis
   └─────────────┘   bloque       └─────────────────────┘
```

Módulos (`src/`):

- **blockchain** — dominio puro (`Block`, `Transaction`), servicio con génesis, mempool, balances, minado transaccional y validación de cadena.
- **wallets** — generación de claves, consulta de saldo, firma (helper de demo).
- **mining** — pipeline asíncrono: encola el Proof of Work en BullMQ y lo ejecuta fuera del ciclo request/response.
- **compliance** — scoring AML explicable (structuring, pass-through, velocidad, fan-out) + informe narrativo con Claude (o plantilla determinista sin API key).
- **analytics** — grafo dirigido de transferencias, detección de hubs tipo exchange, trazado de rutas de fondos (BFS).
- **health** — liveness/readiness (BD + memoria).

---

## 3. Puesta en marcha

### Opción A — Docker (todo aislado, recomendado)

```bash
cp .env.example .env          # opcional: ajustar puertos / API key de IA
docker compose up --build
```

Levanta tres contenedores propios: API (`:4100`), Postgres (`:5544`) y Redis (`:6399`).

- API: <http://localhost:4100/api>
- Swagger: <http://localhost:4100/api/docs>
- Health: <http://localhost:4100/api/health>

### Opción B — Local (solo BD + Redis en Docker)

```bash
docker compose up -d web3-db web3-redis
cp .env.example .env
npm install
npm run start:dev
```

---

## 4. Flujo de demostración (end-to-end)

```bash
bash scripts/demo.sh          # requiere el stack levantado y `jq`
```

Pasos que ejecuta:

1. Crea wallet del **minero** y dos wallets de usuario.
2. Mina un bloque → el minero recibe la recompensa (coinbase).
3. El minero firma y envía una transacción a un usuario.
4. Mina de nuevo → confirma la transacción.
5. Consulta balances, valida la cadena, corre screening AML y genera el informe de cumplimiento.

---

## 5. Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/wallets` | Crear wallet (par de claves) |
| `GET`  | `/api/wallets/:address/balance` | Saldo confirmado y disponible |
| `POST` | `/api/wallets/sign` | Firmar tx (helper de demo) |
| `POST` | `/api/transactions` | Enviar tx firmada al mempool |
| `GET`  | `/api/transactions/pending` | Mempool |
| `POST` | `/api/mining` | Encolar minado (async) → `jobId` |
| `GET`  | `/api/mining/jobs/:jobId` | Estado del minado |
| `GET`  | `/api/chain` | Cadena completa |
| `GET`  | `/api/chain/validate` | Validar integridad de la cadena |
| `GET`  | `/api/blocks/:index` | Bloque por índice |
| `POST` | `/api/compliance/screen` | Scoring AML de una address |
| `POST` | `/api/compliance/report` | Informe completo (scoring + IA) |
| `GET`  | `/api/analytics/graph` | Grafo de transferencias |
| `GET`  | `/api/analytics/hubs` | Hubs tipo exchange |
| `GET`  | `/api/analytics/address/:address/relations` | Relaciones de una address |
| `GET`  | `/api/analytics/trace?from=&to=` | Trazar ruta de fondos |
| `GET`  | `/api/health` | Healthcheck |

Especificación completa e interactiva en **Swagger** (`/api/docs`). Ejemplos crudos en [`requests.http`](./requests.http).

---

## 6. IA para informes de cumplimiento

`POST /api/compliance/report` genera un informe narrativo (Resumen · Recomendación · Análisis).

- Con `ANTHROPIC_API_KEY` configurada → usa **Claude `claude-opus-4-8`** (adaptive thinking + streaming).
- Sin API key → usa un **generador determinista** basado en plantillas.

En ambos casos el endpoint responde igual; el campo `report.generatedBy` indica `anthropic` o `deterministic`. Así el servicio es **100% funcional sin clave** (CI, demos, entornos air-gapped).

---

## 7. Tests

```bash
npm test            # unitarios (dominio + cripto), sin infraestructura
npm run test:e2e    # flujo completo (requiere Postgres + Redis)
npm run test:cov    # cobertura
```

---

## 8. Decisiones de diseño

- **Lógica en servicios, no en controladores.** Los controladores solo orquestan.
- **Dominio desacoplado de la persistencia.** `Block`/`Transaction` son clases puras testeables sin BD.
- **Pipeline asíncrono real.** El PoW (intensivo en CPU) se ejecuta en un worker BullMQ, no en el event loop de la API.
- **Scoring AML explicable.** Cada punto del score proviene de una señal auditable — requisito para informes de cumplimiento.
- **Sin secretos en el repo.** Toda configuración por variables de entorno, validadas con Joi (fail-fast).
- **Errores sin fugas.** El filtro global nunca expone stack traces al cliente.

> Implementación **didáctica**: el consenso es de un solo nodo (sin red P2P) y la *address* es la clave pública (en una cadena real sería un hash de ella). El foco es demostrar arquitectura backend senior + compliance, no producir una L1 de producción.
