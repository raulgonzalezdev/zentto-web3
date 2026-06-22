---
layout: default
title: Operaciones y flujos
---

# Operaciones y flujos de negocio

[← Volver al índice](./)

## Ledger de doble entrada

El saldo nunca se almacena: se **deriva** de asientos inmutables. Toda operación de dinero invoca `ledger.postJournal(...)` con ≥2 *legs* que deben cuadrar (Σ débitos = Σ créditos) o se rechaza. Cuentas de sistema: `system/issuer` (faucet), `system/custody` (respaldo on-chain) y `system/fees` (tesorería).

- `balanceOf` = Σ créditos − Σ débitos
- `heldOf` = Σ holds activos
- `availableOf` = balance − held

Los **holds** son retenciones two-phase (`active → committed | released`): al iniciar una operación que aún no es definitiva (retiro, escrow P2P) se crea un hold que baja el *available* del usuario al instante; al confirmar se *commitea* (se materializa el débito) y al fallar/expirar se libera (reembolso).

---

## Flujo: depósito on-chain

1. El usuario pide su dirección: `GET /accounts/deposit-address` (derivada HD, una por red).
2. Envía USDT/USDC a esa dirección.
3. El **indexer** la detecta por dos canales redundantes:
   - **Polling con cursor** por red (`chain_cursors`): escanea bloques nuevos buscando transferencias del token hacia direcciones de usuario.
   - **Webhook de Alchemy** (`POST /webhook/alchemy`), validado por HMAC-SHA256.
4. Espera N confirmaciones (configurable por red).
5. `creditDeposit(...)` acredita de forma **idempotente** (clave única `network + txHash + logIndex`):
   - debita `system/custody`,
   - acredita al usuario el **neto** (monto − comisión de recarga),
   - acredita a `system/fees` la comisión.
6. Crea `payment` (`type: deposit`, `status: completed`) y `chain_deposits`. El saldo del usuario sube al instante.

Un reintento (violación de unicidad) se ignora silenciosamente: nunca se duplica un depósito.

---

## Flujo: retiro on-chain (anti-colgadas)

```
request (TOTP) ─► hold(monto+fees) ─► payment: processing / pending_broadcast
                         │
   worker cada 15 s ─────┤
                         ├─ processPending(): firma + broadcast (hot wallet)
                         │     stage: broadcasting → broadcast (txHash)
                         │     si falla → failAndRefund(): libera hold, status=failed
                         │
                         └─ reconcile(): valida confirmaciones on-chain
                               success  → complete(): commit hold + asiento débito
                               reverted → failAndRefund(): reembolso automático
                               pending  → espera el próximo ciclo
```

1. `POST /payments/withdraw` valida asset/monto/dirección y exige **step-up TOTP**. Si el 2FA no está activo, o la contraseña cambió en las últimas 24 h sin 2FA, se rechaza.
2. Se crea un **hold** por `monto + comisión de plataforma + fee de red` y un `payment` en `processing/pending_broadcast`.
3. Un worker (cada 15 s, con mutex anti-solape) firma con el hot wallet y emite la transacción (`custody.sendToken`), marcando `stage: broadcast` y guardando el `txHash`.
4. La fase de **reconciliación** consulta la cadena: si el retiro confirma, hace *commit* del hold y el asiento de débito; si revierte o el broadcast falla, **libera el hold** (reembolso). Ninguna tx queda colgada.

Idempotencia por `idempotency-key`: los reintentos del cliente devuelven el pago previo, nunca duplican.

---

## Flujo: transferencia interna

`POST /payments/transfer` (con TOTP) ejecuta un único asiento atómico: debita al emisor y acredita al receptor (mismo journal, sin duplicar dinero; se crea un registro espejo `receive` para el historial del receptor). Instantáneo, sin fee de red, idempotente. No toca la cadena.

---

## Flujo: KYC híbrido

Orquestación propia; el proveedor solo aporta liveness y autenticidad del documento.

1. El usuario aporta documento + selfie por una de tres vías:
   - **Sesión hospedada** (`POST /kyc/session`): el proveedor (zentto-kyc o Didit) sirve una cámara guiada.
   - **Handoff QR** (`POST /kyc/handoff/start` en desktop → `POST /kyc/handoff/verify` en móvil): token JWT corto (15 min) para continuar en el teléfono.
   - **Upload server-to-server** (`POST /kyc/verify-documents`, multipart).
2. El core ejecuta en casa:
   - **MRZ ICAO 9303 (TD3)**: parser de 88 caracteres con dígitos de control (número de documento, fechas, dígito compuesto).
   - **Screening OFAC SDN** propio sobre el nombre normalizado.
3. El proveedor evalúa **liveness + face-match + autenticidad** del documento.
4. Decisión: si todo aprueba **y** no hay match AML → `approved`; si hay match o error del proveedor → `in_review` (degradación segura).
5. Un **operador** revisa la cola (`GET /kyc/pending`) y decide (`POST /kyc/:id/decision`). Los webhooks del proveedor (`/webhook/didit`, `/webhook/zentto`) actualizan el estado de forma asíncrona, verificados por HMAC.

El KYC aprobado es el *gate* para operar con dinero real y define límites.

---

## Flujo: mercado P2P con escrow

```
vendedor: POST /p2p/orders (sell)  ─► hold de cripto (escrow), orden: open
comprador: POST /p2p/orders/:id/take ─► trade: pending (ventana de pago 15 min)
comprador paga fiat fuera de plataforma ─► POST /p2p/trades/:id/paid ─► paid (ventana 30 min)
vendedor: POST /p2p/trades/:id/confirm (TOTP) ─► libera neto al comprador + fee a system/fees, trade: completed
```

- **Banda anti-especulación:** el precio de la orden debe caer dentro de ±N% (default 15%) respecto a la tasa USDT/VES de referencia.
- **Ventanas y extensiones:** pago 15 min, liberación 30 min, hasta 2 extensiones de +15 min. Un worker barre timeouts: sin interacción → `expired` (reembolso al vendedor); con interacción o liberación vencida → escala a disputa.
- **Disputas:** cualquier parte abre disputa (`/dispute`); un árbitro/operador resuelve `release` (libera al comprador) o `refund` (devuelve al vendedor).
- **Chat:** mensajes con texto y adjunto (data URL imagen) por trade.

---

## Flujo: recarga P2P / AirTM

1. Usuario: `POST /recharge/requests` (monto cripto + tasa VES) → `pending`.
2. Operador: `POST /operator/recharge/requests/:id/claim` reclama y comparte sus datos de pago → `claimed`.
3. Usuario paga fiat (pago móvil) y sube comprobante: `POST /recharge/requests/:id/evidence` → `paid`.
4. Operador: `POST /operator/recharge/requests/:id/confirm` (con TOTP) acredita la cripto neta: debita `system/custody`, acredita al usuario el neto y a `system/fees` la comisión → `completed` (idempotente por `recharge:{id}`).

---

## Seguridad

- **Cookies httpOnly** (`zw3_access`, `zw3_refresh`) — no accesibles desde JS. **CSRF double-submit** (`zw3_csrf` + header `x-csrf-token`) en mutaciones.
- **2FA TOTP** (Google Authenticator vía `otplib`): obligatorio como **step-up** en todo movimiento de dinero (retiro, transferencia, confirmación P2P, confirmación de recarga).
- **Anti-fuerza-bruta:** 5 logins fallidos → bloqueo 15 min. **Revocación global** incrementando `tokenVersion` (logout / reset de contraseña invalidan todos los refresh).
- **AML:** screening OFAC SDN propio + scoring de riesgo con informe por IA (Claude / OpenAI / DeepSeek) o generador determinista offline.
- **Webhooks firmados:** Alchemy (HMAC-SHA256), Didit / zentto-kyc (HMAC), Binance Pay (HMAC-SHA512).
- **Secretos:** validados con Joi (fail-fast); `CUSTODY_MNEMONIC` cargable desde HashiCorp Vault. El filtro global de errores nunca expone stack traces.

---

## Comisiones

Configurables por env y acumuladas en `system/fees`:

| Variable | Aplica a |
|----------|----------|
| `FEE_DEPOSIT_PCT` | % sobre cada depósito/recarga acreditado |
| `FEE_WITHDRAW_PCT` + `FEE_WITHDRAW_NETWORK` | % de plataforma + fee de red fijo en cada retiro |
| `FEE_P2P_PCT` | % sobre el monto liberado en cada trade P2P |
| `FEE_MIN` | Piso mínimo por operación |

---

## Despliegue

- **CI** (`.github/workflows/ci.yml`): lint → build → unit → e2e (Postgres+Redis) → build de imagen Docker, en push/PR a `main` y `developer`.
- **Producción** (Hetzner, `/opt/zentto-web3`):

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build web3-api
  ```

  `docker-compose.prod.yml` pasa todo el `.env` al contenedor (Didit/KYC/EVM/custody/fees/withdrawals viven solo ahí). Secretos sensibles cargables desde Vault.
- **Cookies en prod:** `COOKIE_SECURE=true` y `COOKIE_SAMESITE=none` si front y API están en dominios distintos.

[← Volver al índice](./)
