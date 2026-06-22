# Zentto Web3 — Core bancario de un neobanco cripto custodial

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![viem](https://img.shields.io/badge/viem-EVM-1a1a2e)
![License](https://img.shields.io/badge/license-MIT-green)

Backend (API REST) **independiente** que implementa el núcleo bancario de un **neobanco cripto custodial** al estilo Kontigo / Meru / Binance: el usuario ve un **saldo en stablecoins** (USDT / USDC) y nosotros custodiamos los fondos. El día a día (transferencias entre usuarios) es **contable e instantáneo** sobre un ledger de doble entrada; la blockchain solo se toca al **depositar** o **retirar**.

> Documentación técnica completa y referencia de API: **https://raulgonzalezdev.github.io/zentto-web3/**

No comparte código ni base de datos con el ERP Zentto. Es un servicio autónomo con su propia Postgres, Redis y ciclo de despliegue.

---

## 1. Lugar en el ecosistema

Zentto Web3 es el **core bancario** consumido por dos clientes y apoyado en un servicio de identidad:

| Repo | Rol | Stack |
|------|-----|-------|
| **`zentto-web3`** (este) | Core bancario / API REST | NestJS + Postgres + Redis + viem |
| [`zentto-web3-frontend`](https://github.com/raulgonzalezdev/zentto-web3-frontend) | Backoffice de operadores (KYC, usuarios, tesorería, disputas P2P) | Next.js + MUI |
| [`zentto-web3-mobile`](https://github.com/raulgonzalezdev/zentto-web3-mobile) | App móvil de usuario final (saldo, enviar/recibir, P2P, recarga) | Ionic React + Capacitor |
| [`zentto-kyc`](https://github.com/zentto-erp/zentto-kyc) | KYC self-hosted (OCR/MRZ + liveness + face-match + OFAC) — desplegado en `kyc.zentto.net` | Express + Python FastAPI |

Ambos frontends se autentican contra esta API por **cookies httpOnly + CSRF**. El core delega la prueba de vida / autenticidad del documento a `zentto-kyc` (proveedor nativo) o a Didit (fallback), pero la **orquestación, MRZ y screening OFAC son propios**.

---

## 2. Arquitectura

```
                     Backoffice (Next)            App móvil (Ionic)
                            │                            │
                            └──────────── cookies httpOnly + CSRF ──────────┐
                                                                            ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │                           NestJS API (helmet · validación · Swagger)             │
   │   Guards globales:  JwtAuthGuard  →  CsrfGuard      Filtro global de errores     │
   ├────────────────────────────────────────────────────────────────────────────────┤
   │  auth · users · kyc · ledger · payments · custody · indexer · withdrawals        │
   │  marketplace(P2P) · recharge · binance · fees · compliance · admin · settings    │
   └───────┬─────────────────────────┬─────────────────────────┬────────────────────┘
           │                         │                         │
   ┌───────▼────────┐        ┌───────▼────────┐        ┌───────▼─────────┐
   │  PostgreSQL 16 │        │   Redis (BullMQ)│        │  Blockchains    │
   │  ledger,       │        │   colas + workers│       │  EVM (viem):    │
   │  payments,     │        │   indexer/retiro │       │  ETH·Polygon·BSC│
   │  holds, KYC,   │        │   reconciliación │       │  Tron · Solana  │
   │  P2P, usuarios │        └─────────────────┘        │  Stellar        │
   └────────────────┘                                   └─────────────────┘
                                                                │
                              zentto-kyc (kyc.zentto.net) · zentto-notify (emails) · Alchemy RPC/webhooks
```

### Por qué el saldo vive en el ledger y no en la cadena

En un neobanco custodial el usuario tiene un **saldo interno** (ledger de doble entrada). Los movimientos entre usuarios son **asientos contables instantáneos y sin fee**. Solo el **depósito** (entrada de cripto on-chain) y el **retiro** (salida on-chain) tocan la blockchain. La cadena es la tubería de entrada/salida; el día a día es contable. Cada operación de dinero genera ≥2 asientos que **siempre cuadran** (Σ débitos = Σ créditos) o se rechaza.

---

## 3. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20+ / 22 + TypeScript 5 |
| Framework | NestJS 10 |
| Base de datos | PostgreSQL 16 (contenedor propio, aislado del ERP) · TypeORM |
| Colas / workers | BullMQ + Redis 7 (indexer, broadcast de retiros, reconciliación) |
| EVM | `viem` (Ethereum, Polygon, BSC) · RPC enchufable (Alchemy → público de respaldo) |
| Otras cadenas | `tronweb` (Tron/TRC-20), `@solana/web3.js` + `@solana/spl-token` (SPL), `@stellar/stellar-sdk` |
| Auth | JWT (`@nestjs/jwt`) en cookies httpOnly + 2FA TOTP (`otplib`, Google Authenticator) + CSRF double-submit |
| Cripto / HD | `viem/accounts`, `bip39`, `ed25519-hd-key`, `bcryptjs` |
| KYC | MRZ ICAO 9303 (propio) + OFAC SDN (propio) + proveedor de liveness (zentto-kyc / Didit) |
| IA (compliance) | `@anthropic-ai/sdk` (Claude) / `openai` (OpenAI o DeepSeek), con *fallback* determinista |
| Secretos | HashiCorp Vault opcional (`CUSTODY_MNEMONIC`), fallback a `.env` |
| Docs API | Swagger / OpenAPI en `/api/docs` |
| Tests | Jest (unit) + Supertest (e2e) |
| CI | GitHub Actions (lint · build · unit · e2e · docker build) |

---

## 4. Features implementadas (verificadas en código)

- **Autenticación completa**: registro, login, login con 2FA (TOTP), refresh, verificación de email, reset de contraseña, setup/enable/disable de 2FA. Cookies httpOnly (`zw3_access`, `zw3_refresh`) + CSRF (`zw3_csrf` + header `x-csrf-token`). Bloqueo anti-fuerza-bruta (5 intentos → 15 min) y revocación global por `tokenVersion`.
- **Ledger de doble entrada**: cuentas `user/*` y de sistema (`system/issuer`, `system/custody`, `system/fees`). Saldos derivados de asientos inmutables. Holds en dos fases (`active → committed | released`).
- **Transferencias internas instantáneas** entre usuarios (sin tocar cadena), con idempotencia y 2FA.
- **Custodia HD**: hot wallet de tesorería (cuenta 0) + dirección de depósito derivada por usuario (cuenta 1). EVM comparte dirección entre Ethereum/Polygon/BSC; Tron, Solana y Stellar tienen su propia derivación. En producción, firma vía KMS/HSM/MPC.
- **Indexer de depósitos on-chain**: detecta transferencias ERC-20 / TRC-20 / SPL hacia direcciones de usuario por **polling con cursor** + **webhook de Alchemy** (HMAC verificado). Acredita al ledger de forma idempotente (única por `network + txHash + logIndex`), descontando comisión de recarga.
- **Retiros on-chain anti-colgadas**: lifecycle determinista `hold → broadcast → reconciliación → completado | reembolso`. Worker periódico (15 s) que firma+emite y luego reconcilia contra confirmaciones on-chain; si falla o revierte, **libera el hold automáticamente** (el usuario nunca pierde saldo por una tx colgada). Step-up TOTP obligatorio + protección por cambio reciente de contraseña.
- **KYC híbrido**: orquestación propia con MRZ ICAO 9303 (TD3, dígitos de control) + screening OFAC SDN propio, y liveness/face-match delegado a `zentto-kyc` o Didit. Estados `not_started → pending → in_review → approved | rejected | needs_more_info`. Soporta sesión hospedada, handoff desktop↔móvil por QR y upload server-to-server. Webhooks firmados (HMAC). Decisión manual del operador.
- **Mercado P2P con escrow**: órdenes compra/venta con banda anti-especulación (tasa USDT/VES), trades con ventanas de pago (15 min) y liberación (30 min), extensiones, escrow vía holds, chat con adjuntos, disputas y resolución por árbitro (`release` / `refund`), barrido automático de timeouts.
- **Recarga estilo P2P/AirTM**: el usuario solicita recarga, un operador la reclama y comparte sus datos de pago, el usuario sube comprobante y el operador acredita la cripto (2FA).
- **Binance Pay**: integración C2B (cobro) y B2C (payout) con firma HMAC-SHA512 y verificación de webhook.
- **Comisiones de plataforma**: % configurable por depósito, retiro y P2P + fee de red fijo, acumuladas en `system/fees`.
- **Compliance/AML con IA**: scoring de riesgo + informe narrativo (Claude / OpenAI / DeepSeek o generador determinista offline).
- **Backoffice/admin**: settings runtime, estadísticas, tesorería, custodia, actividad on-chain, gestión de usuarios/roles, cola KYC, disputas P2P.
- **Multi-red mainnet**: catálogo de redes con BSC por defecto (rail más barato), Ethereum, Polygon activas; Tron/Solana/Stellar enchufables por env; testnets opcionales con `TESTNETS_ENABLED=true`.

> El módulo `blockchain`/`mining` (PoW didáctico) y la red `p2p` (gossip multi-nodo) son **legado de la versión sandbox** previa al pivote a neobanco; siguen presentes pero no forman parte del core custodial.

---

## 5. Requisitos

- Node.js 20+ (probado en 22)
- Docker + Docker Compose (para Postgres y Redis aislados)
- `jq` (solo para `scripts/demo.sh`)
- Opcional: clave de Alchemy (RPC EVM con archive `getLogs` + webhooks), credenciales de Didit / zentto-kyc, key de IA (Anthropic / OpenAI / DeepSeek)

---

## 6. Puesta en marcha (local)

### Opción A — Docker (todo aislado, recomendado)

```bash
cp .env.example .env
# Edita .env: define al menos DB_PASSWORD, JWT_SECRET y JWT_REFRESH_SECRET (mín. 32 chars).
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
docker compose up --build
```

Levanta tres contenedores propios: API (`:4100`), Postgres (`:5544`) y Redis (`:6399`).

- API: <http://localhost:4100/api>
- Swagger: <http://localhost:4100/api/docs>
- Health: <http://localhost:4100/api/health>

### Opción B — Local (solo BD + Redis en Docker)

```bash
docker compose up -d web3-db web3-redis
cp .env.example .env       # define DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npm run start:dev
```

### Variables de entorno clave (`.env.example`)

| Grupo | Variables | Notas |
|-------|-----------|-------|
| App | `PORT` (4100), `API_PREFIX` (api), `CORS_ORIGIN`, `APP_URL`, `OPERATOR_EMAILS` | `OPERATOR_EMAILS` define quién es admin |
| Base de datos | `DB_HOST/PORT/USER/PASSWORD/NAME`, `DB_SYNCHRONIZE` | Postgres propia (5544 por defecto) |
| Redis | `REDIS_HOST/PORT` | BullMQ |
| Auth | `JWT_SECRET`, `JWT_REFRESH_SECRET` (**obligatorios**, ≥32 chars), `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BCRYPT_ROUNDS`, `TOTP_ISSUER`, `COOKIE_SECURE/SAMESITE/DOMAIN` | Cookies seguras en prod |
| Custodia | `CUSTODY_MNEMONIC` | Solo DEV/testnet; en prod via Vault/KMS |
| Indexer | `DEPOSIT_INDEXER_ENABLED`, `EVM_CONFIRMATIONS`, `DEPOSIT_SCAN_RANGE`, `ALCHEMY_API_KEY`, `ALCHEMY_WEBHOOK_SIGNING_KEY` | |
| Retiros | `WITHDRAWALS_ENABLED`, `EVM_CONFIRMATIONS` | |
| Redes | `ETH_MAINNET_*`, `POLYGON_MAINNET_*`, `BSC_MAINNET_*`, `TRON_ENABLED`, `SOLANA_ENABLED`, `STELLAR_ENABLED`, `TESTNETS_ENABLED` | BSC es la red por defecto |
| Ledger | `LEDGER_ASSETS` (USDT,USDC), `FAUCET_ENABLED`, `FAUCET_MAX` | Faucet solo en dev |
| Comisiones | `FEE_P2P_PCT`, `FEE_DEPOSIT_PCT`, `FEE_WITHDRAW_PCT`, `FEE_WITHDRAW_NETWORK`, `FEE_MIN` | |
| KYC | `KYC_PROVIDER` (manual/didit/zentto-kyc), `DIDIT_*`, `ZENTTO_KYC_*` | |
| IA | `AI_PROVIDER` (auto/anthropic/openai/deepseek/none), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AI_MODEL`, `AI_EFFORT` | Sin key → generador determinista |
| Emails | `NOTIFY_BASE_URL`, `NOTIFY_API_KEY` | Sin key → dry-run en consola |
| Binance Pay | `BINANCE_PAY_BASE_URL/MERCHANT_ID/API_KEY/API_SECRET` | Vacío → módulo deshabilitado |

---

## 7. Estructura de carpetas

```
src/
├── auth/            JWT + cookies httpOnly + 2FA TOTP + CSRF (guards/middleware)
├── users/           perfil, búsqueda por email/teléfono
├── kyc/             orquestación KYC, MRZ, OFAC, providers (manual/didit/zentto-kyc), webhooks
├── ledger/          doble entrada: cuentas, asientos, holds
├── payments/        balances, transferencias internas, faucet, idempotencia
├── custody/         derivación HD, hot wallet, firma EVM/Tron/Solana/Stellar, sweep
├── indexer/         detección de depósitos on-chain (polling + webhook Alchemy)
├── withdrawals/     retiros on-chain (hold → broadcast → reconciliación → reembolso)
├── marketplace/     mercado P2P con escrow, trades, disputas, chat
├── recharge/        recarga P2P/AirTM (usuario ↔ operador)
├── binance/         Binance Pay (C2B / B2C + webhook)
├── fees/            comisiones de plataforma
├── compliance/      scoring AML + informe con IA
├── evm/             lectura de cadena EVM (info, balances, tx)
├── admin/           backoffice: stats, tesorería, usuarios, roles, KYC, disputas
├── settings/        configuración runtime (overrides de fees, etc.)
├── analytics/       grafo de transferencias, hubs, trazado (legado)
├── blockchain/      blockchain didáctica PoW (legado sandbox)
├── mining/          worker PoW BullMQ (legado sandbox)
├── p2p/             red gossip multi-nodo (legado sandbox)
├── notifications/   emails transaccionales vía zentto-notify
├── health/          liveness/readiness
├── database/entities/  entidades TypeORM
└── config/          configuration.ts, env.validation.ts (Joi), vault.ts
```

---

## 8. Resumen de la API

Todas las rutas cuelgan del prefijo `/api` (salvo los webhooks `/webhook/didit` y `/webhook/kyc`, sin prefijo, para coincidir con la URL registrada en el proveedor). Las rutas protegidas requieren cookie `zw3_access`; las mutaciones requieren el header CSRF.

| Módulo | Endpoints principales |
|--------|----------------------|
| **auth** | `POST /auth/register` · `POST /auth/login` · `POST /auth/login/2fa` · `POST /auth/refresh` · `GET /auth/me` · `POST /auth/logout` · `POST /auth/verify-email` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `POST /auth/2fa/{setup,enable,disable}` · `GET /auth/csrf` |
| **payments** | `GET /accounts/balance` · `GET /payments` · `GET /payments/:id` · `POST /payments/transfer` · `POST /payments/credit` (faucet) |
| **custody** | `GET /networks` · `GET /accounts/deposit-address` |
| **indexer** | `GET /accounts/deposits` · `POST /accounts/deposits/sync` · `POST /webhook/alchemy` |
| **withdrawals** | `POST /payments/withdraw` · `POST /payments/withdrawals/process` · `GET/POST/DELETE /me/withdraw-addresses` |
| **kyc** | `GET /kyc/status` · `POST /kyc/session` · `POST /kyc/verify-documents` · `POST /kyc/handoff/{start,verify}` · `GET /kyc/pending` · `POST /kyc/:id/decision` · webhooks Didit/Zentto |
| **marketplace (P2P)** | `GET /p2p/market` · `GET /p2p/orders` · `POST /p2p/orders` · `POST /p2p/orders/:id/{take,cancel}` · `GET /p2p/trades` · `POST /p2p/trades/:id/{paid,confirm,extend,dispute,cancel}` · `GET/POST /p2p/trades/:id/messages` |
| **recharge** | `POST /recharge/requests` · `GET /recharge/requests` · `POST /recharge/requests/:id/{evidence,cancel}` · operador: `POST /operator/recharge/requests/:id/{claim,confirm}` |
| **binance** | `GET /binance/status` · `POST /binance/{link,recharge,withdraw}` · `POST /webhook/binance` |
| **fees / compliance** | `GET /fees` · `GET /compliance/status` · `POST /compliance/{screen,report}` |
| **admin** | `GET/PUT /admin/settings` · `GET /admin/{stats,treasury,custody,onchain-activity,users,operators,kyc,payments}` · `PATCH /admin/users/:id` · `POST /admin/users/:id/role` · `POST /admin/sweep` · `GET/POST /admin/p2p/...` |
| **evm / health** | `GET /evm/{info,address/:a,token/:t/:a,tx/:h}` · `GET /health` |

Referencia interactiva en **Swagger** (`/api/docs`). Detalle completo con payloads de ejemplo en la [documentación técnica](https://raulgonzalezdev.github.io/zentto-web3/) → [API](https://raulgonzalezdev.github.io/zentto-web3/api).

---

## 9. Modelo de datos clave

| Entidad / tabla | Propósito |
|-----------------|-----------|
| `users` | usuario, rol (`user`/`operator`/`admin`), `passwordHash`, TOTP, `tokenVersion`, bloqueo anti-bruteforce |
| `ledger_accounts` | cuenta del ledger: `ownerType` (`user`/`system`) + `ownerId` + `asset` |
| `ledger_entries` | asiento inmutable: `paymentId`, `accountId`, `direction` (`debit`/`credit`), `amount` |
| `holds` | retención two-phase: `active` → `committed` / `released` |
| `payments` | operación de dinero: `type` (transfer/deposit/withdrawal/recharge/...), `status`, `metadata` con el lifecycle |
| `deposit_addresses` | dirección HD por usuario y red (`derivationIndex`) |
| `chain_deposits` | depósito on-chain acreditado (único por `network + txHash + logIndex`) |
| `chain_cursors` | cursor de escaneo del indexer por red |
| `withdraw_addresses` | direcciones de retiro favoritas del usuario |
| `kyc_verifications` | estado KYC, proveedor, MRZ, match AML, decisión del revisor |
| `p2p_orders` / `p2p_trades` / `p2p_messages` | mercado P2P con escrow |
| `recharge_requests` | solicitudes de recarga P2P/AirTM |
| `payment_methods` / `binance_links` / `app_settings` / `account_tokens` | métodos de pago, vínculos Binance, settings runtime, tokens de verificación/reset |

---

## 10. Flujos críticos

**Depósito on-chain** — el usuario obtiene su dirección (`GET /accounts/deposit-address`) y envía USDT/USDC. El indexer detecta la transferencia (polling con cursor + webhook Alchemy), espera N confirmaciones y acredita de forma idempotente: debita `system/custody`, acredita al usuario el neto y a `system/fees` la comisión. El saldo sube al instante.

**Retiro on-chain** — `POST /payments/withdraw` con TOTP crea un *hold* por `monto + comisiones` y un payment en `processing/pending_broadcast`. Un worker (15 s) firma y emite desde el hot wallet (`broadcasting → broadcast`), luego reconcilia: si hay éxito hace *commit* del hold y el asiento de débito; si revierte o falla, **libera el hold** (reembolso). Ninguna tx queda colgada.

**Transferencia interna** — `POST /payments/transfer` (con TOTP) hace un único asiento atómico: debita al emisor, acredita al receptor; instantáneo, sin fee de red, idempotente.

**KYC** — el usuario sube documento + selfie (sesión hospedada, QR handoff o upload directo). El core ejecuta MRZ ICAO 9303 + OFAC propios y delega liveness/face-match a `zentto-kyc` o Didit. Si todo aprueba y no hay match AML → `approved`; si hay match o error → `in_review` para decisión del operador (`POST /kyc/:id/decision`).

**Step-up (TOTP)** — toda operación de dinero sensible (retiro, transferencia, confirmación P2P, confirmación de recarga) exige código TOTP. Si el 2FA no está activo, o la contraseña cambió en las últimas 24 h sin 2FA, la operación se rechaza.

**P2P con escrow** — el vendedor publica una orden (escrowa cripto vía hold), el comprador la toma (trade `pending`), paga fiat fuera de plataforma y marca `paid`; el vendedor confirma con TOTP y el core libera el neto al comprador y la comisión a `system/fees`. Timeouts y disputas se resuelven por un árbitro (`release`/`refund`).

---

## 11. Testing

```bash
npm test            # unitarios (dominio + cripto), sin infraestructura
npm run test:e2e    # flujo completo (requiere Postgres + Redis)
npm run test:cov    # cobertura
```

Scripts de verificación on-chain en `scripts/`: `evm-check.mjs`, `indexer-check.mjs`, `rpc-getlogs-check.mjs`, `smoke-withdrawal.mjs`. Demo end-to-end: `bash scripts/demo.sh`.

---

## 12. Deployment

- **CI** (`.github/workflows/ci.yml`): lint → build → tests unitarios → e2e (Postgres+Redis) → build de imagen Docker, en push/PR a `main` y `developer`.
- **Producción** (server Hetzner, `/opt/zentto-web3`): se despliega con `docker-compose.yml` + `docker-compose.prod.yml` (este último pasa todo el `.env` al contenedor):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build web3-api
```

  Secretos sensibles (`CUSTODY_MNEMONIC`) pueden cargarse desde **HashiCorp Vault** al arranque (`src/config/vault.ts`), con fallback a `.env`.

- **Cookies en producción**: `COOKIE_SECURE=true` y `COOKIE_SAMESITE=none` si front y API están en dominios distintos.

---

## 13. Decisiones de diseño

- **Ledger primero, doble entrada.** El saldo del banco es el ledger, no la cadena. Cada peso movido es un asiento que cuadra o se rechaza.
- **Holds two-phase + reconciliación.** Los retiros nunca dejan saldo colgado: el hold se *commitea* al confirmar o se libera al fallar.
- **Idempotencia en todo movimiento de dinero.** `idempotency-key` única por intento; los reintentos no duplican.
- **Lógica en servicios, no en controladores.** Los controladores solo orquestan.
- **Custodia desacoplada del proveedor.** En dev, derivación HD desde mnemónico; en prod, KMS/HSM/MPC sin tocar el resto del código.
- **KYC/AML propios + proveedor para liveness.** No guardamos documentos crudos; orquestamos y decidimos en casa.
- **Sin secretos en el repo.** Configuración por entorno validada con Joi (fail-fast); secretos sensibles vía Vault.
- **Errores sin fugas.** El filtro global nunca expone stack traces.

> **Nota legal:** operar custodia + fiat es actividad regulada (VASP/PSAV). El diseño permite empezar en testnet sin riesgo y escalar con los controles (KYC/AML/licencias) antes de mainnet real.

---

## Licencia

MIT — ver `package.json`.
