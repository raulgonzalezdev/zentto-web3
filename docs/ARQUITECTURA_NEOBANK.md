# Zentto Web3 — Arquitectura de neobanco cripto (modelo Kontigo / Meru)

Pivote: dejamos la blockchain **didáctica** (minado propio) como sandbox educativo y
construimos una **plataforma fintech cripto custodial**, donde **nosotros somos el banco**.

## Productos
| Producto | Quién lo usa | Repo |
|---|---|---|
| **Backoffice** (web) | Operadores/nosotros (el "banco"): KYC, usuarios, transacciones, liquidez, alertas AML, disputas P2P | `zentto-web3-frontend` (Next + MUI, ya existe) |
| **App móvil** | Usuarios finales: saldo en USD/USDT, enviar/recibir, P2P, pago móvil, historial | `zentto-web3-mobile` (nuevo, Ionic React + Capacitor) |
| **Core bancario** (API) | Ambos | `zentto-web3` (NestJS, ya existe) |

## Modelo de custodia
**Custodial** (como Kontigo/Meru): el usuario ve un **saldo**; nosotros custodiamos los fondos.
- El usuario NO maneja frases semilla.
- Producción: custodia con **MPC/HSM** (Fireblocks / Turnkey / AWS KMS). Nunca llaves planas en el server.
- Testnet (fase actual): derivación HD desde una semilla en `.env`/KMS para demostrar el flujo.

## Capas del core bancario (NestJS)
| Módulo | Estado | Función |
|---|---|---|
| `auth` | ✅ hecho | JWT cookies httpOnly + 2FA (sirve a backoffice y móvil) |
| `evm` | ✅ **hecho (lectura)** | Conexión REAL a Ethereum/Sepolia vía `viem`: info de cadena, balances, estado de tx |
| `tron` | ⬜ siguiente | Adapter USDT-TRC20 (el caso real venezolano) |
| `custody` | ⬜ | Generación de direcciones por usuario + firma (MPC/HSM) |
| `ledger` | ⬜ | **Doble entrada**: el saldo "del banco" es el ledger, no la cadena directamente |
| `accounts` | ⬜ | Cuentas de usuario (USD/USDT), límites, estados |
| `deposits/indexer` | ⬜ | Detectar depósitos entrantes on-chain (webhooks/polling) y acreditar en el ledger |
| `withdrawals` | ⬜ | Retiros: validación + AML + firma + broadcast + tracking |
| `ramp` (on/off) | ⬜ | Cripto ↔ **pago móvil/bolívares**: vía **P2P con escrow** o partner (Kontigo/PSP) |
| `p2p` | ⬜ | Mercado P2P con garantía (modelo Binance P2P): órdenes, escrow, disputa, reputación |
| `kyc` | ⬜ | Verificación de identidad (Sumsub/Didit) — gate para operar |
| `compliance/AML` | ✅ base hecha | Screening + alertas (ahora real: + sanciones/Chainalysis, Travel Rule) |
| `prices` | ⬜ | Tasas cripto↔USD↔VES (CoinGecko/Binance) |

## Por qué el saldo vive en el **ledger**, no en la cadena
En un neobanco custodial, el usuario tiene un **saldo interno** (ledger de doble entrada).
Los movimientos internos (entre usuarios) son **instantáneos y sin fee** (solo asientos contables).
Solo cuando alguien **deposita** o **retira** se toca la cadena real. Así funcionan Kontigo, Meru,
Binance, etc. La cadena es la "tubería" de entrada/salida; el día a día es contable.

## On/off ramp a pago móvil (lo más regulado)
No podemos tocar bolívares/pago móvil sin licencia o partner. Plan:
1. **P2P + escrow** (recomendado para empezar): los usuarios se pagan pago móvil entre sí;
   nosotros solo custodiamos el USDT en garantía y lo liberamos al confirmar. Mínima licencia.
2. **Partner ramp** (Kontigo / PSP local con pago móvil) por API.

## Roadmap por fases
| Fase | Entregable | Riesgo |
|---|---|---|
| **0. Cadena real (lectura)** ✅ | Backend lee Ethereum/Sepolia (`evm`): info, balances, tx | Cero |
| **1. Wallet en móvil + backoffice** | App móvil muestra saldo real de testnet; backoffice ve cuentas | Bajo |
| **2. Custodia + ledger + depósitos/retiros** | Dirección por usuario, acreditar depósitos, retirar (testnet) | Medio |
| **3. KYC + AML real** | Onboarding verificado, gating, alertas | Medio |
| **4. P2P escrow → pago móvil** | Comprar/vender USDT con pago móvil | Medio-alto (operacional) |
| **5. Mainnet + Tron + ramps + licencias** | Producción real (USDT-TRC20), partners, VASP | Alto |

## KYC — verificación de identidad (al registrarse)
Onboarding verificado tipo Kontigo/Meru, **vía proveedor** (no guardamos los documentos crudos):
- Proveedor: **Sumsub / Didit / Persona**. SDK en la app móvil captura **pasaporte/cédula + selfie con prueba de vida (liveness) + face-match**.
- El backend guarda solo el **estado** y el `applicantId` del proveedor; el proveedor custodia los documentos (menos riesgo y cumplimiento).
- Estados: `not_started → pending → approved → rejected → more_info`. Webhook del proveedor actualiza el estado.
- **Niveles/tiers** de KYC → definen **límites** (montos diarios, retiros). Sin KYC aprobado no se opera con dinero real (solo testnet/lectura).

## Autorización por transacción (step-up auth)
Garantizar que **el usuario autorice cada movimiento de dinero**:
- **Vinculación a la transacción (no-repudio)**: el reto a firmar incluye los datos exactos (monto, destino, asset). Así la autorización vale **solo** para esa transacción.
- **Mecanismos** (escalado por riesgo/monto):
  - Montos bajos → **OTP TOTP** (ya tenemos 2FA) o push.
  - Montos altos / retiros → **biometría** (huella/face) con **WebAuthn/passkeys** (clave ligada al dispositivo) — en móvil vía Capacitor biometric + clave device-bound.
- **Reglas**: límites por nivel KYC, cooldown, lista blanca de destinos, detección de anomalías (AML) antes de pedir la firma.

## Fiabilidad de transacciones — "que NO queden en el aire" (lo más crítico)
El problema de Kontigo/Meru (tx colgadas) se resuelve con un **lifecycle determinista** estilo Binance/Stripe:

1. **Idempotencia**: cada operación de dinero lleva una `idempotency-key` (única por intento). El server **deduplica** → reintentos del cliente/red nunca duplican ni dejan estados ambiguos.
2. **Máquina de estados explícita** por transacción:
   `created → authorized → pending_sign → broadcast → confirming → confirmed`
   con ramas `failed / expired / reversed`. Cada transición es atómica y auditable.
3. **Ledger primero (doble entrada) + outbox**: el asiento contable y el efecto on-chain se escriben en la **misma transacción de BD** junto a un registro en una tabla **outbox**; un worker lee el outbox y ejecuta el broadcast. Si el proceso se cae, **nada se pierde ni se duplica** (la intención quedó persistida).
4. **Fondos retenidos (two-phase)**: al iniciar, se **debita en `hold`**; al confirmar se **commitea**; si falla/expira se **libera** automáticamente. El usuario nunca pierde saldo por una tx colgada.
5. **Reconciliación (la cura de las colgadas)**: workers periódicos consultan la cadena por estado real y **avanzan o reparan** transacciones:
   - tx `pending` > N min → **re-broadcast** o **bump de gas** (EVM) / re-envío.
   - tx perdida → marca para revisión + alerta.
   - depósito detectado tardío → acredita.
6. **Confirmaciones** configurables por asset (ej. N bloques) antes de dar por `confirmed`.
7. **Webhooks + polling de respaldo** para detección de depósitos (nunca depender de un solo canal).
8. **Saga/compensación** para flujos multi-paso (P2P escrow): cada paso reversible con su compensación.
9. **Timeouts y expiración** explícitos: ninguna tx vive "para siempre"; expira y libera fondos.
10. **Observabilidad**: cada tx con `traceId`, estados con timestamps, panel en el **backoffice** para ver/forzar/reembolsar tx atascadas.

> Módulos nuevos que materializan esto: `payments` (state machine + idempotencia), `ledger` (doble entrada + holds), `outbox` + workers BullMQ, `reconciliation` (jobs), `kyc`, `tx-auth` (step-up). El **backoffice** gana una pantalla de **operaciones** para auditar y destrabar.

## Stack
- **Core**: NestJS + TypeScript + Postgres + Redis + `viem` (EVM) / `tronweb` (Tron).
- **Backoffice**: Next 16 + React 19 + MUI + `@zentto/datagrid` (ya montado).
- **Móvil**: Ionic React + Capacitor (estándar Zentto), auth por cookies contra el core.
- **Custodia (prod)**: Fireblocks/Turnkey/KMS. **KYC**: Sumsub/Didit. **AML on-chain**: Chainalysis/TRM.

> Nota legal: operar custodia + fiat es actividad regulada (VASP/PSAV). El diseño permite
> empezar en testnet sin riesgo y escalar con los controles (KYC/AML/licencias) antes de mainnet.
