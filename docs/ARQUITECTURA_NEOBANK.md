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

## Stack
- **Core**: NestJS + TypeScript + Postgres + Redis + `viem` (EVM) / `tronweb` (Tron).
- **Backoffice**: Next 16 + React 19 + MUI + `@zentto/datagrid` (ya montado).
- **Móvil**: Ionic React + Capacitor (estándar Zentto), auth por cookies contra el core.
- **Custodia (prod)**: Fireblocks/Turnkey/KMS. **KYC**: Sumsub/Didit. **AML on-chain**: Chainalysis/TRM.

> Nota legal: operar custodia + fiat es actividad regulada (VASP/PSAV). El diseño permite
> empezar en testnet sin riesgo y escalar con los controles (KYC/AML/licencias) antes de mainnet.
