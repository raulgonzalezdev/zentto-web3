---
layout: default
title: Visión general
---

# Zentto Web3 — Documentación técnica

Core bancario (API REST en NestJS) de un **neobanco cripto custodial** estilo Kontigo / Meru / Binance. El usuario ve un **saldo en stablecoins** (USDT / USDC); la plataforma custodia los fondos. Las transferencias entre usuarios son **asientos contables instantáneos** sobre un ledger de doble entrada; la blockchain solo se toca al **depositar** o **retirar**.

- **Código fuente:** <https://github.com/raulgonzalezdev/zentto-web3>
- **Swagger / OpenAPI** (entorno levantado): `http://localhost:4100/api/docs`

## Índice

- [Arquitectura](./arquitectura) — módulos, capas, modelo de custodia, modelo de datos.
- [Referencia de API](./api) — endpoints por módulo, auth/CSRF, payloads de ejemplo.
- [Operaciones y flujos](./operaciones) — depósito, retiro, transferencia, KYC, P2P, recarga, seguridad y despliegue.

---

## Lugar en el ecosistema

| Repo | Rol |
|------|-----|
| **`zentto-web3`** (este) | Core bancario / API REST (NestJS + Postgres + Redis + viem) |
| [`zentto-web3-frontend`](https://github.com/raulgonzalezdev/zentto-web3-frontend) | Backoffice de operadores (Next.js + MUI) |
| [`zentto-web3-mobile`](https://github.com/raulgonzalezdev/zentto-web3-mobile) | App móvil de usuario final (Ionic + Capacitor) |
| [`zentto-kyc`](https://github.com/zentto-erp/zentto-kyc) | KYC self-hosted (OCR/MRZ + liveness + face-match + OFAC), en `kyc.zentto.net` |

Los dos frontends se autentican contra esta API por **cookies httpOnly + CSRF**. El core delega la prueba de vida / autenticidad del documento a `zentto-kyc` (nativo) o Didit (fallback); la **orquestación KYC, el MRZ y el screening OFAC son propios**.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20+ / 22 + TypeScript 5 |
| Framework | NestJS 10 · TypeORM |
| Base de datos | PostgreSQL 16 (propia, aislada del ERP) |
| Colas / workers | BullMQ + Redis 7 |
| EVM | `viem` (Ethereum, Polygon, BSC) — RPC enchufable (Alchemy → público de respaldo) |
| Otras cadenas | `tronweb` (TRC-20), `@solana/web3.js` + SPL, `@stellar/stellar-sdk` |
| Auth | JWT en cookies httpOnly + 2FA TOTP (`otplib`) + CSRF double-submit |
| KYC | MRZ ICAO 9303 + OFAC SDN (propios) + liveness (zentto-kyc / Didit) |
| IA (compliance) | Claude / OpenAI / DeepSeek con fallback determinista |
| Docs API | Swagger / OpenAPI |
| Tests | Jest + Supertest |

---

## Features (verificadas en código)

- Auth completa (registro, login, 2FA TOTP, refresh, verificación email, reset, setup/enable/disable 2FA), cookies httpOnly + CSRF, anti-fuerza-bruta y revocación global por `tokenVersion`.
- Ledger de doble entrada con cuentas de usuario y de sistema (`issuer`, `custody`, `fees`); holds two-phase.
- Transferencias internas instantáneas, idempotentes y con 2FA.
- Custodia HD: hot wallet + dirección de depósito por usuario (EVM/Tron/Solana/Stellar).
- Indexer de depósitos on-chain (polling con cursor + webhook Alchemy HMAC), acreditación idempotente.
- Retiros on-chain anti-colgadas (hold → broadcast → reconciliación → reembolso) con step-up TOTP.
- KYC híbrido (MRZ + OFAC propios + liveness delegado), sesión hospedada / handoff QR / upload, webhooks firmados, decisión del operador.
- Mercado P2P con escrow (órdenes, trades, ventanas, disputas, chat, árbitro) y banda anti-especulación.
- Recarga P2P/AirTM (usuario ↔ operador) y Binance Pay (C2B/B2C).
- Comisiones de plataforma configurables, acumuladas en `system/fees`.
- Compliance/AML con scoring + informe por IA (o determinista offline).
- Backoffice/admin: stats, tesorería, custodia, actividad on-chain, usuarios/roles, cola KYC, disputas.

> Los módulos `blockchain`/`mining` (PoW didáctico) y `p2p` (gossip multi-nodo) son **legado** de la versión sandbox previa al pivote a neobanco; no forman parte del core custodial.

---

## Arranque rápido

```bash
cp .env.example .env
# Define DB_PASSWORD, JWT_SECRET y JWT_REFRESH_SECRET (≥32 chars):
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
docker compose up --build
```

- API: `http://localhost:4100/api`
- Swagger: `http://localhost:4100/api/docs`
- Health: `http://localhost:4100/api/health`

Más detalle en [Operaciones y flujos](./operaciones).
