---
layout: default
title: Referencia de API
---

# Referencia de API

[← Volver al índice](./)

Base URL: `http://localhost:4100/api` (prefijo `/api` configurable con `API_PREFIX`). Los webhooks `/webhook/didit` y `/webhook/kyc` se sirven **sin** prefijo, para coincidir con la URL registrada en el proveedor. La referencia interactiva está en Swagger: `/api/docs`.

## Autenticación y CSRF

- La sesión vive en **cookies httpOnly**: `zw3_access` (access JWT) y `zw3_refresh` (refresh JWT). El frontend no las lee; el navegador las envía automáticamente.
- El **CSRF** usa double-submit: el servidor siembra la cookie legible `zw3_csrf`; en cada mutación (POST/PUT/PATCH/DELETE) el cliente debe enviar su valor en el header `x-csrf-token`. Obtén el valor con `GET /auth/csrf`.
- Las rutas `@Public()` (login, register, refresh, webhooks) no requieren cookie ni CSRF.

### Flujo de sesión

```http
GET /api/auth/csrf
→ 200 { "csrfToken": "..." }   # también setea la cookie zw3_csrf

POST /api/auth/register
Content-Type: application/json
x-csrf-token: <csrfToken>

{ "email": "ana@example.com", "password": "S3cret-pass-123", "displayName": "Ana" }
→ 200 { user, mfaRequired: false }   # setea cookies zw3_access / zw3_refresh

POST /api/auth/login
{ "email": "ana@example.com", "password": "S3cret-pass-123" }
→ 200 { mfaRequired: false }                      # si no tiene 2FA → sesión emitida
→ 200 { mfaRequired: true, mfaToken: "<ticket>" } # si tiene 2FA

POST /api/auth/login/2fa
{ "mfaToken": "<ticket>", "code": "123456" }
→ 200 { user }   # emite la sesión

POST /api/auth/refresh   # usa la cookie zw3_refresh
→ 200 { user }           # rota access + refresh
```

## auth

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/auth/csrf` | público | Devuelve y siembra el token CSRF |
| POST | `/auth/register` | público | Registra usuario y emite sesión |
| POST | `/auth/login` | público | Login (devuelve sesión o ticket MFA) |
| POST | `/auth/login/2fa` | público | Completa login con código TOTP |
| POST | `/auth/refresh` | público | Rota la sesión desde la cookie refresh |
| POST | `/auth/verify-email` | público | Verifica email con token (24 h) |
| POST | `/auth/resend-verification` | sí | Reenvía email de verificación |
| POST | `/auth/forgot-password` | público | Inicia reset (responde 200 siempre) |
| POST | `/auth/reset-password` | público | Aplica nueva contraseña con token (1 h) |
| GET | `/auth/me` | sí | Usuario actual |
| POST | `/auth/logout` | sí | Logout global (revoca tokens) |
| POST | `/auth/2fa/setup` | sí | Genera secreto TOTP + QR |
| POST | `/auth/2fa/enable` | sí | Activa 2FA tras verificar código |
| POST | `/auth/2fa/disable` | sí | Desactiva 2FA |

## payments

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/accounts/balance` | Balances por asset (`balance`, `held`, `available`) |
| GET | `/payments` | Historial (últimos 100) |
| GET | `/payments/:id` | Detalle de un pago |
| POST | `/payments/transfer` | Transferencia interna instantánea (requiere TOTP) |
| POST | `/payments/credit` | Faucet de dev (solo con `FAUCET_ENABLED=true`) |

```http
POST /api/payments/transfer
x-csrf-token: <csrf>
Idempotency-Key: 7f3c...   # única por intento

{ "toEmail": "bob@example.com", "asset": "USDT", "amount": "25.00", "totpCode": "123456" }
→ 200 { id, type: "transfer", status: "completed", ... }
```

## custody / indexer (depósitos)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/networks` | Redes disponibles para depósito |
| GET | `/accounts/deposit-address` | Dirección de depósito HD del usuario (por red) |
| GET | `/accounts/deposits` | Depósitos on-chain acreditados al usuario |
| POST | `/accounts/deposits/sync` | Fuerza un escaneo de depósitos |
| POST | `/webhook/alchemy` | Webhook Address Activity (HMAC-SHA256) |

## withdrawals (retiros)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/payments/withdraw` | Solicita un retiro on-chain (requiere TOTP) |
| POST | `/payments/withdrawals/process` | Dispara manualmente el ciclo de broadcast/reconciliación |
| GET | `/me/withdraw-addresses` | Lista direcciones favoritas |
| POST | `/me/withdraw-addresses` | Añade favorita |
| DELETE | `/me/withdraw-addresses/:id` | Elimina favorita |

```http
POST /api/payments/withdraw
x-csrf-token: <csrf>

{ "asset": "USDT", "amount": "50.00", "toAddress": "0xAbc...", "network": "bsc-mainnet", "totpCode": "123456" }
→ 200 { id, type: "withdrawal", status: "processing",
        metadata: { stage: "pending_broadcast", fee, networkFee, totalDebit, holdId } }
```

## kyc

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/kyc/status` | sí | Estado KYC del usuario |
| POST | `/kyc/submit` | sí | Envía datos + MRZ |
| POST | `/kyc/session` | sí | Inicia sesión hospedada del proveedor |
| POST | `/kyc/verify-documents` | sí (multipart) | Sube documento + selfie (server-to-server) |
| POST | `/kyc/handoff/start` | sí | Emite token corto para continuar en móvil (QR) |
| POST | `/kyc/handoff/verify` | público (multipart) | Sube doc + selfie desde el QR |
| GET | `/kyc/pending` | operador | Cola de revisión |
| POST | `/kyc/:id/decision` | operador | Aprueba / rechaza |
| POST | `/webhook/didit` · `/webhook/zentto` | público | Webhooks firmados del proveedor |

Estados: `not_started → pending → in_review → approved | rejected | needs_more_info`.

## marketplace (P2P)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/p2p/market` | Tasa USDT/VES + banda anti-especulación |
| GET | `/p2p/orders` | Order book público |
| GET | `/p2p/orders/mine` | Mis órdenes |
| POST | `/p2p/orders` | Crear orden (venta → escrowa cripto) |
| POST | `/p2p/orders/:id/cancel` | Cancelar orden (libera hold) |
| POST | `/p2p/orders/:id/take` | Tomar orden → crea trade |
| GET | `/p2p/trades` · `/p2p/trades/:id` | Mis trades / detalle |
| POST | `/p2p/trades/:id/paid` | Comprador marca fiat pagado |
| POST | `/p2p/trades/:id/confirm` | Vendedor libera cripto (requiere TOTP) |
| POST | `/p2p/trades/:id/extend` | Extiende la ventana (+15 min, máx. 2) |
| POST | `/p2p/trades/:id/dispute` | Abre disputa |
| POST | `/p2p/trades/:id/cancel` | Cancela trade |
| GET/POST | `/p2p/trades/:id/messages` | Chat del trade (texto / adjunto) |

## recharge

| Método | Ruta | Rol | Descripción |
|--------|------|-----|-------------|
| POST | `/recharge/requests` | usuario | Crea solicitud (monto cripto + tasa VES) |
| GET | `/recharge/requests` | usuario | Mis solicitudes |
| POST | `/recharge/requests/:id/evidence` | usuario | Sube comprobante |
| POST | `/recharge/requests/:id/cancel` | usuario | Cancela |
| GET | `/operator/recharge/requests` | operador | Cola pendiente |
| POST | `/operator/recharge/requests/:id/claim` | operador | Reclama y comparte sus datos de pago |
| POST | `/operator/recharge/requests/:id/confirm` | operador | Acredita cripto (requiere TOTP) |

## binance / fees / compliance

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/binance/status` | Estado del módulo Binance Pay |
| POST | `/binance/link` · `/binance/recharge` · `/binance/withdraw` | Vincular / cobrar (C2B) / pagar (B2C) |
| POST | `/webhook/binance` | Webhook firmado (HMAC-SHA512) |
| GET | `/fees` | Tarifas vigentes de la plataforma |
| GET | `/compliance/status` | ¿IA habilitada? |
| POST | `/compliance/screen` · `/compliance/report` | Scoring AML / informe narrativo |
| GET | `/compliance/screen/:address` | Scoring por address |

## admin (backoffice)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET/PUT | `/admin/settings` | Configuración runtime |
| GET | `/admin/stats` · `/treasury` · `/custody` · `/onchain-activity` | Métricas y tesorería |
| GET | `/admin/users` · `/operators` · `/kyc` · `/payments` | Listados operativos |
| PATCH | `/admin/users/:id` | Edita usuario |
| POST | `/admin/users/:id/role` · `/admin/users/:id/reset-password` | Rol / reset |
| POST | `/admin/sweep` | Barrido de polvo del custody |
| GET/POST | `/admin/p2p/disputes` · `/admin/p2p/trades/:id` · `/admin/p2p/trades/:id/resolve` | Gestión de disputas |

## evm / health

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/evm/info` | Info de la cadena EVM configurada |
| GET | `/evm/address/:address` | Balance nativo |
| GET | `/evm/token/:token/:address` | Balance de un ERC-20 |
| GET | `/evm/tx/:hash` | Estado de una transacción |
| GET | `/health` | Liveness / readiness (BD + memoria) |

[Siguiente: Operaciones y flujos →](./operaciones)
