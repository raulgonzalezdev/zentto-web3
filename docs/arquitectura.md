---
layout: default
title: Arquitectura
---

# Arquitectura

[← Volver al índice](./)

## Visión de capas

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
   │  PostgreSQL 16 │        │ Redis (BullMQ) │        │  Blockchains    │
   │  ledger,       │        │ colas + workers│        │  EVM (viem):    │
   │  payments,     │        │ indexer/retiro │        │  ETH·Polygon·BSC│
   │  holds, KYC,   │        │ reconciliación │        │  Tron · Solana  │
   │  P2P, usuarios │        └────────────────┘        │  Stellar        │
   └────────────────┘                                  └─────────────────┘
                                                                │
              zentto-kyc (kyc.zentto.net) · zentto-notify (emails) · Alchemy RPC/webhooks
```

Toda petición pasa por `JwtAuthGuard` (lee la cookie `zw3_access`) y, si es mutación, por `CsrfGuard` (compara header `x-csrf-token` con la cookie `zw3_csrf`). Las rutas marcadas `@Public()` (login, register, refresh, webhooks) se saltan ambos. Un filtro global de excepciones evita exponer stack traces.

## Por qué el saldo vive en el ledger

En un neobanco custodial el usuario tiene un **saldo interno** (ledger de doble entrada). Los movimientos entre usuarios son **asientos contables instantáneos y sin fee**. Solo el **depósito** y el **retiro** tocan la cadena. La blockchain es la tubería de entrada/salida; el día a día es contable. Cada operación genera ≥2 asientos balanceados (Σ débitos = Σ créditos) o se rechaza.

## Modelo de custodia

**Custodial** (como Kontigo/Meru): el usuario no maneja frases semilla; ve un saldo.

- **Dev / testnet:** derivación HD desde `CUSTODY_MNEMONIC`.
  - Cuenta HD 0 → **hot wallet** de tesorería (firma retiros).
  - Cuenta HD 1 → **dirección de depósito por usuario** (índice incremental).
  - La familia EVM comparte dirección entre Ethereum / Polygon / BSC; Tron, Solana y Stellar derivan aparte.
- **Producción:** firma vía **KMS / HSM / MPC** (AWS KMS, Fireblocks, Turnkey). El servicio `custody` abstrae la firma, de modo que cambiar de backend no toca el resto del código. El mnemónico puede cargarse desde HashiCorp Vault al arranque (`src/config/vault.ts`).

## Módulos NestJS

| Módulo | Función |
|--------|---------|
| `auth` | Registro, login, 2FA TOTP, refresh, verificación email, reset, cookies httpOnly + CSRF, roles |
| `users` | Perfil, búsqueda por email/teléfono |
| `kyc` | Orquestación KYC, MRZ ICAO 9303, OFAC, providers (manual/didit/zentto-kyc), webhooks |
| `ledger` | Doble entrada: cuentas, asientos inmutables, holds two-phase |
| `payments` | Balances, transferencias internas, faucet (dev), idempotencia |
| `custody` | Derivación HD, hot wallet, firma EVM/Tron/Solana/Stellar, sweep |
| `indexer` | Detección de depósitos on-chain (polling con cursor + webhook Alchemy) |
| `withdrawals` | Retiros on-chain (hold → broadcast → reconciliación → reembolso) |
| `marketplace` | Mercado P2P con escrow, trades, disputas, chat |
| `recharge` | Recarga P2P/AirTM (usuario ↔ operador) |
| `binance` | Binance Pay (C2B / B2C + webhook) |
| `fees` | Comisiones de plataforma |
| `compliance` | Scoring AML + informe con IA |
| `evm` | Lectura de cadena EVM (info, balances, tx) |
| `admin` | Backoffice: stats, tesorería, custodia, usuarios, roles, KYC, disputas |
| `settings` | Configuración runtime (overrides de fees, etc.) |
| `notifications` | Emails transaccionales vía zentto-notify |
| `health` | Liveness / readiness |
| `analytics`, `blockchain`, `mining`, `p2p` | Legado de la versión sandbox (no parte del core custodial) |

## Modelo de datos

| Entidad / tabla | Campos clave | Propósito |
|-----------------|--------------|-----------|
| `users` | `role` (user/operator/admin), `passwordHash`, `totpSecret`, `totpEnabled`, `tokenVersion`, `failedLoginCount`, `lockedUntil` | Usuario y seguridad |
| `ledger_accounts` | `ownerType` (user/system), `ownerId`, `asset` | Cuenta del ledger |
| `ledger_entries` | `paymentId`, `accountId`, `direction` (debit/credit), `amount` | Asiento inmutable |
| `holds` | `accountId`, `amount`, `status` (active/committed/released) | Retención two-phase |
| `payments` | `type`, `status`, `metadata` (lifecycle) | Operación de dinero |
| `deposit_addresses` | `userId`, `network`, `address`, `derivationIndex` | Dirección HD por usuario |
| `chain_deposits` | `network`, `txHash`, `logIndex` (único) | Depósito acreditado |
| `chain_cursors` | `network`, `lastBlock` | Cursor del indexer |
| `withdraw_addresses` | `userId`, `label`, `network`, `address` | Favoritos de retiro |
| `kyc_verifications` | `status`, `provider`, MRZ, match AML, `reviewedBy` | Estado KYC |
| `p2p_orders` / `p2p_trades` / `p2p_messages` | side, status, ventanas, escrow, chat | Mercado P2P |
| `recharge_requests` | `status`, `amount`, `rateVes`, evidencia | Recarga P2P/AirTM |
| `payment_methods` / `binance_links` / `app_settings` / `account_tokens` | — | Métodos de pago, vínculos Binance, settings, tokens de verificación/reset |

### Cuentas de sistema del ledger

- `system/issuer` — faucet de prueba (dev).
- `system/custody` — respaldo on-chain del hot wallet (activos en custodia).
- `system/fees` — tesorería donde se acumulan las comisiones.

`balance = Σ créditos − Σ débitos` · `held = Σ holds activos` · `available = balance − held`.

## Redes soportadas

Catálogo en `src/config/configuration.ts`. Por defecto activas (mainnet): **BSC** (red por defecto, rail más barato), **Ethereum** y **Polygon**, cada una vigilando USDT y USDC. **Tron**, **Solana** y **Stellar** están declaradas y se activan por env (`TRON_ENABLED`, `SOLANA_ENABLED`, `STELLAR_ENABLED`). Las **testnets** (p. ej. Sepolia) solo se cargan con `TESTNETS_ENABLED=true`. Cada red EVM puede tener RPC primario (Alchemy) y un `fallbackRpcUrl` público para failover.

[Siguiente: Referencia de API →](./api)
