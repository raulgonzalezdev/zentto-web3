/**
 * Configuración centralizada y tipada. Se carga vía @nestjs/config.
 * Los valores se validan con Joi en env.validation.ts antes de exponerse.
 */
export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  /** Emails de operadores del backoffice. Vacío = cualquier autenticado (dev). */
  operatorEmails: string[];
  /** URL pública del frontend (links de verificación/reset enviados por email). */
  url: string;
}

export interface NotifyConfig {
  /** Base URL del microservicio zentto-notify (envío de emails transaccionales). */
  baseUrl: string;
  /** API key (header x-api-key). Vacío => modo dry-run: se loguea el email en consola. */
  apiKey: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  synchronize: boolean;
  logging: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface ChainConfig {
  difficulty: number;
  miningReward: number;
  genesisPremineAddress: string;
}

export interface AmlConfig {
  highRiskThreshold: number;
  structuringAmount: number;
}

export type AiProvider = 'auto' | 'anthropic' | 'openai' | 'deepseek' | 'none';

export interface AiConfig {
  /** Proveedor de IA. 'auto' elige según las keys presentes; 'none' fuerza el generador determinista. */
  provider: AiProvider;
  /** Clave Anthropic (Claude). */
  anthropicApiKey: string;
  /** Clave para el proveedor compatible OpenAI (OpenAI o DeepSeek). */
  openaiApiKey: string;
  /** Base URL compatible OpenAI (OpenAI: api.openai.com/v1 · DeepSeek: api.deepseek.com/v1). */
  openaiBaseUrl: string;
  /** Override de modelo. Vacío => default por proveedor. */
  model: string;
  /** Esfuerzo de razonamiento (solo Anthropic). */
  effort: 'low' | 'medium' | 'high' | 'max';
}

export interface IndexerConfig {
  /** Escaneo automático periódico de depósitos. */
  enabled: boolean;
  /** Confirmaciones requeridas antes de acreditar un depósito. */
  confirmations: number;
  /** Máximo de bloques por escaneo (límite de los RPC). */
  scanRange: number;
}

export interface CustodyConfig {
  /** Mnemónico maestro para derivar direcciones de depósito (DEV/testnet; en prod: KMS/MPC). */
  mnemonic: string;
}

export interface KycConfig {
  /** Proveedor de liveness/autenticidad. 'zentto-kyc' es el NATIVO (default); Didit es fallback. */
  provider: 'manual' | 'didit' | 'zentto-kyc';
  /** API key de Didit (vacío => cae a revisión manual). */
  diditApiKey: string;
  /** Base URL de la API de verificación de Didit. */
  diditBaseUrl: string;
  /** Workflow ID creado en el dashboard de Didit (define qué se verifica). */
  diditWorkflowId: string;
  /** Secreto para verificar la firma HMAC de los webhooks de Didit. */
  diditWebhookSecret: string;
  /** URL a la que Didit redirige al usuario tras completar la verificación. */
  diditCallbackUrl: string;
  /** Zentto KYC (servicio propio). API key `zkyc_...`. */
  zenttoKycApiKey: string;
  zenttoKycBaseUrl: string;
  zenttoKycCallbackUrl: string;
  zenttoKycWebhookSecret: string;
  /** Workflow del dashboard de zentto-kyc (define qué features pide). Opcional. */
  zenttoKycWorkflowId: string;
}

export interface WithdrawalsConfig {
  /** Habilita los workers de broadcast + reconciliación de retiros on-chain. */
  enabled: boolean;
  /** Confirmaciones requeridas para dar un retiro por completado. */
  confirmations: number;
}

export interface LedgerConfig {
  /** Assets soportados por el ledger (ej. USDT, USDC). */
  assets: string[];
  /** Faucet de desarrollo (acreditar saldo de prueba). NUNCA true en producción. */
  faucetEnabled: boolean;
  /** Tope por acreditación del faucet. */
  faucetMax: number;
}

/**
 * Comisiones de plataforma (modelo de negocio, estilo Binance). Un pequeño % por
 * operación se acumula en la cuenta maestra de tesorería (`system/fees`), respaldada
 * por el hot wallet de custodia. Se muestran de forma transparente al usuario.
 */
export interface FeesConfig {
  /** % sobre el monto liberado en cada trade P2P (ej. 0.005 = 0.5%). */
  p2pPct: number;
  /** % sobre cada recarga/depósito on-chain acreditado. */
  depositPct: number;
  /** % de plataforma sobre cada retiro on-chain. */
  withdrawPct: number;
  /** Comisión de red fija (gas) que se cobra en cada retiro, en el asset. */
  withdrawNetworkFee: number;
  /** Mínimo de comisión por operación (evita fees de 0 en montos chicos). */
  minFee: number;
}

export interface EvmConfig {
  rpcUrl: string;
  chainId: number;
  chainName: string;
  explorerUrl: string;
  nativeSymbol: string;
  /** Token ERC-20 a mostrar por defecto (ej. USDC en la testnet). */
  usdcAddress: string;
}

/**
 * Una red soportada por el neobanco. La familia `evm` comparte código (viem) y la
 * MISMA dirección de depósito por usuario (misma clave HD). Tron/Stellar quedan
 * declaradas como `available:false` (próximamente, requieren SDK propio).
 */
export interface NetworkConfig {
  key: string; // id estable usado en BD/indexer/retiros: 'sepolia', 'polygon-amoy', ...
  family: 'evm' | 'tron' | 'stellar';
  chainId: number;
  name: string;
  rpcUrl: string;
  /** RPC público de respaldo (failover) si el primario (Alchemy) falla. */
  fallbackRpcUrl?: string;
  explorerUrl: string;
  nativeSymbol: string;
  /** Token principal a mostrar (compat); el indexer vigila TODOS los de `tokens`. */
  usdcAddress: string;
  /** Símbolo del asset principal de la red (compat). */
  asset: string;
  /** Stablecoins a indexar en esta red (USDT + USDC). Decimales se leen on-chain. */
  tokens: { address: string; asset: string }[];
  confirmations: number;
  isTestnet: boolean;
  /** El indexer escanea y los retiros operan en esta red. */
  enabled: boolean;
  /** false = aún no operativa (Tron/Stellar): se muestra como "próximamente". */
  available: boolean;
}

export interface NetworksConfig {
  list: NetworkConfig[];
}

export interface P2pConfig {
  enabled: boolean;
  port: number;
  peers: string[]; // URLs ws:// de los nodos peer iniciales
  nodeName: string;
}

/** Binance Pay (comerciante entidad). Vacío => módulo deshabilitado. */
export interface BinancePayConfig {
  baseUrl: string;
  merchantId: string;
  apiKey: string; // certSn / BinancePay-Certificate-SN
  apiSecret: string; // para la firma HMAC-SHA512
}

export interface AuthConfig {
  jwtSecret: string;
  jwtRefreshSecret: string;
  accessTtl: string; // p.ej. '15m'
  refreshTtl: string; // p.ej. '7d'
  bcryptRounds: number;
  totpIssuer: string;
  cookieDomain: string; // '' => host actual
  cookieSecure: boolean; // true en producción (HTTPS)
  cookieSameSite: 'lax' | 'strict' | 'none';
}

/**
 * Catálogo de redes — MAINNET (dinero real). Solo se marcan `available:true` (y
 * `enabled:true` para el indexer) las redes que REALMENTE podemos indexar, para que
 * nadie deposite donde no acreditamos. EVM (Ethereum/Polygon/BSC) tienen indexer y
 * RPC; Tron/Stellar quedan `available:false` hasta tener su indexer de depósitos.
 * Cada red EVM vigila USDT **y** USDC (decimales se leen on-chain).
 * Las testnets solo se incluyen si TESTNETS_ENABLED=true (QA).
 */
function buildNetworks(): NetworkConfig[] {
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const alchemyRpc = (subdomain: string) =>
    alchemyKey ? `https://${subdomain}.g.alchemy.com/v2/${alchemyKey}` : null;
  const testnetsEnabled = (process.env.TESTNETS_ENABLED ?? 'false') === 'true';

  // ─── Ethereum mainnet ───
  const ethereum: NetworkConfig = {
    key: 'ethereum',
    family: 'evm',
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: process.env.ETH_MAINNET_RPC_URL || alchemyRpc('eth-mainnet') || 'https://eth.llamarpc.com',
    fallbackRpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    nativeSymbol: 'ETH',
    usdcAddress: '0xa0b86991C6218B266C64bb69aA14f0094C9B0eE9',
    asset: 'USDC',
    tokens: [
      { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', asset: 'USDT' },
      { address: '0xa0b86991C6218B266C64bb69aA14f0094C9B0eE9', asset: 'USDC' },
    ],
    confirmations: parseInt(process.env.ETH_MAINNET_CONFIRMATIONS ?? '12', 10),
    isTestnet: false,
    enabled: (process.env.ETH_MAINNET_ENABLED ?? 'true') === 'true',
    available: true,
  };

  // ─── Polygon mainnet ───
  const polygon: NetworkConfig = {
    key: 'polygon',
    family: 'evm',
    chainId: 137,
    name: 'Polygon',
    rpcUrl: process.env.POLYGON_MAINNET_RPC_URL || alchemyRpc('polygon-mainnet') || 'https://polygon-rpc.com',
    fallbackRpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeSymbol: 'POL',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    asset: 'USDC',
    tokens: [
      { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', asset: 'USDT' },
      { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', asset: 'USDC' },
    ],
    confirmations: parseInt(process.env.POLYGON_MAINNET_CONFIRMATIONS ?? '30', 10),
    isTestnet: false,
    enabled: (process.env.POLYGON_MAINNET_ENABLED ?? 'true') === 'true',
    available: true,
  };

  // ─── BSC mainnet (rail principal de Binance) ───
  const bsc: NetworkConfig = {
    key: 'bsc-mainnet',
    family: 'evm',
    chainId: 56,
    name: 'BSC',
    rpcUrl: process.env.BSC_MAINNET_RPC_URL || alchemyRpc('bnb-mainnet') || 'https://bsc-dataseed.binance.org',
    fallbackRpcUrl: 'https://bsc-rpc.publicnode.com',
    explorerUrl: 'https://bscscan.com',
    nativeSymbol: 'BNB',
    usdcAddress: '0x55d398326f99059fF775485246999027B3197955',
    asset: 'USDT',
    tokens: [
      { address: '0x55d398326f99059fF775485246999027B3197955', asset: 'USDT' }, // 18 dec
      { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', asset: 'USDC' }, // 18 dec
    ],
    confirmations: parseInt(process.env.BSC_MAINNET_CONFIRMATIONS ?? '6', 10),
    isTestnet: false,
    enabled: (process.env.BSC_MAINNET_ENABLED ?? 'true') === 'true',
    available: true,
  };

  // ─── Tron mainnet (USDT-TRC20) — direcciones sí, indexer auto PENDIENTE ───
  // available:false → no se ofrece para depósito hasta cablear su indexer (no perder fondos).
  const tron: NetworkConfig = {
    key: 'tron',
    family: 'tron',
    chainId: 0,
    name: 'Tron',
    rpcUrl: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    explorerUrl: 'https://tronscan.org',
    nativeSymbol: 'TRX',
    usdcAddress: process.env.TRON_USDT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    asset: 'USDT',
    tokens: [{ address: process.env.TRON_USDT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', asset: 'USDT' }],
    confirmations: 19,
    isTestnet: false,
    // Tron ya tiene indexer de depósitos (USDT-TRC20). Se activa con TRON_ENABLED=true.
    enabled: (process.env.TRON_ENABLED ?? 'false') === 'true',
    available: (process.env.TRON_ENABLED ?? 'false') === 'true',
  };

  // ─── Stellar mainnet (USDC Circle) — indexer auto PENDIENTE ───
  const stellar: NetworkConfig = {
    key: 'stellar',
    family: 'stellar',
    chainId: 0,
    name: 'Stellar',
    rpcUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/public',
    nativeSymbol: 'XLM',
    usdcAddress: process.env.STELLAR_USDC_ISSUER || 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    asset: 'USDC',
    tokens: [
      { address: process.env.STELLAR_USDC_ISSUER || 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', asset: 'USDC' },
    ],
    confirmations: 1,
    isTestnet: false,
    enabled: false,
    available: (process.env.STELLAR_ENABLED ?? 'false') === 'true',
  };

  const nets: NetworkConfig[] = [ethereum, polygon, bsc, tron, stellar];

  // Testnets opcionales (QA) — solo con TESTNETS_ENABLED=true.
  if (testnetsEnabled) {
    nets.push({
      key: 'sepolia',
      family: 'evm',
      chainId: 11155111,
      name: 'Sepolia',
      rpcUrl: process.env.EVM_RPC_URL || alchemyRpc('eth-sepolia') || 'https://sepolia.drpc.org',
      fallbackRpcUrl: 'https://sepolia.drpc.org',
      explorerUrl: 'https://sepolia.etherscan.io',
      nativeSymbol: 'ETH',
      usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      asset: 'USDC',
      tokens: [{ address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', asset: 'USDC' }],
      confirmations: 3,
      isTestnet: true,
      enabled: true,
      available: true,
    });
  }

  return nets;
}

export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '4100', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    operatorEmails: (process.env.OPERATOR_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    url: process.env.APP_URL ?? 'https://neo.zentto.net',
  } satisfies AppConfig,
  notify: {
    baseUrl: process.env.NOTIFY_BASE_URL ?? 'https://notify.zentto.net',
    apiKey: process.env.NOTIFY_API_KEY ?? '',
  } satisfies NotifyConfig,
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5544', 10),
    user: process.env.DB_USER ?? 'web3',
    password: process.env.DB_PASSWORD ?? '',
    name: process.env.DB_NAME ?? 'zentto_web3',
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'true') === 'true',
    logging: (process.env.DB_LOGGING ?? 'false') === 'true',
  } satisfies DatabaseConfig,
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6399', 10),
  } satisfies RedisConfig,
  chain: {
    difficulty: parseInt(process.env.CHAIN_DIFFICULTY ?? '3', 10),
    miningReward: parseInt(process.env.MINING_REWARD ?? '50', 10),
    genesisPremineAddress: process.env.GENESIS_PREMINE_ADDRESS ?? '',
  } satisfies ChainConfig,
  aml: {
    highRiskThreshold: parseInt(process.env.AML_HIGH_RISK_THRESHOLD ?? '70', 10),
    structuringAmount: parseInt(process.env.AML_STRUCTURING_AMOUNT ?? '9000', 10),
  } satisfies AmlConfig,
  ai: {
    provider: (process.env.AI_PROVIDER ?? 'auto') as AiProvider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model: process.env.AI_MODEL ?? '',
    effort: (process.env.AI_EFFORT ?? 'medium') as AiConfig['effort'],
  } satisfies AiConfig,
  custody: {
    mnemonic: process.env.CUSTODY_MNEMONIC ?? '',
  } satisfies CustodyConfig,
  kyc: {
    provider: (process.env.KYC_PROVIDER ?? 'zentto-kyc') as KycConfig['provider'],
    diditApiKey: process.env.DIDIT_API_KEY ?? '',
    diditBaseUrl: process.env.DIDIT_BASE_URL ?? 'https://verification.didit.me',
    diditWorkflowId: process.env.DIDIT_WORKFLOW_ID ?? '',
    diditWebhookSecret: process.env.DIDIT_WEBHOOK_SECRET ?? '',
    diditCallbackUrl: process.env.DIDIT_CALLBACK_URL ?? '',
    zenttoKycApiKey: process.env.ZENTTO_KYC_API_KEY ?? '',
    zenttoKycBaseUrl: process.env.ZENTTO_KYC_BASE_URL ?? 'https://kyc.zentto.net',
    zenttoKycCallbackUrl: process.env.ZENTTO_KYC_CALLBACK_URL ?? '',
    zenttoKycWebhookSecret: process.env.ZENTTO_KYC_WEBHOOK_SECRET ?? '',
    zenttoKycWorkflowId: process.env.ZENTTO_KYC_WORKFLOW_ID ?? '',
  } satisfies KycConfig,
  indexer: {
    enabled: (process.env.DEPOSIT_INDEXER_ENABLED ?? 'false') === 'true',
    confirmations: parseInt(process.env.EVM_CONFIRMATIONS ?? '3', 10),
    scanRange: parseInt(process.env.DEPOSIT_SCAN_RANGE ?? '2000', 10),
  } satisfies IndexerConfig,
  withdrawals: {
    enabled: (process.env.WITHDRAWALS_ENABLED ?? 'false') === 'true',
    confirmations: parseInt(process.env.EVM_CONFIRMATIONS ?? '3', 10),
  } satisfies WithdrawalsConfig,
  ledger: {
    assets: (process.env.LEDGER_ASSETS ?? 'USDT,USDC')
      .split(',')
      .map((a) => a.trim().toUpperCase())
      .filter(Boolean),
    faucetEnabled: (process.env.FAUCET_ENABLED ?? 'false') === 'true',
    faucetMax: parseInt(process.env.FAUCET_MAX ?? '1000', 10),
  } satisfies LedgerConfig,
  evm: {
    // RPC: si hay ALCHEMY_API_KEY usa Alchemy (archive getLogs, rate limits altos,
    // base para webhooks de depósito). Si se fija EVM_RPC_URL, manda ese. Si no,
    // cae al público de Sepolia (drpc, soporta eth_getLogs sin API key).
    rpcUrl:
      process.env.EVM_RPC_URL ||
      (process.env.ALCHEMY_API_KEY
        ? `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
        : 'https://sepolia.drpc.org'),
    chainId: parseInt(process.env.EVM_CHAIN_ID ?? '11155111', 10),
    chainName: process.env.EVM_CHAIN_NAME ?? 'Sepolia',
    explorerUrl: process.env.EVM_EXPLORER_URL ?? 'https://sepolia.etherscan.io',
    nativeSymbol: process.env.EVM_NATIVE_SYMBOL ?? 'ETH',
    // USDC oficial de Circle en Sepolia.
    usdcAddress: process.env.EVM_USDC_ADDRESS ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  } satisfies EvmConfig,
  fees: {
    p2pPct: parseFloat(process.env.FEE_P2P_PCT ?? '0.005'),
    depositPct: parseFloat(process.env.FEE_DEPOSIT_PCT ?? '0.01'),
    withdrawPct: parseFloat(process.env.FEE_WITHDRAW_PCT ?? '0.01'),
    withdrawNetworkFee: parseFloat(process.env.FEE_WITHDRAW_NETWORK ?? '0.5'),
    minFee: parseFloat(process.env.FEE_MIN ?? '0.01'),
  } satisfies FeesConfig,
  networks: { list: buildNetworks() } satisfies NetworksConfig,
  binancePay: {
    baseUrl: process.env.BINANCE_PAY_BASE_URL ?? 'https://bpay.binanceapi.com',
    merchantId: process.env.BINANCE_PAY_MERCHANT_ID ?? '',
    apiKey: process.env.BINANCE_PAY_API_KEY ?? '',
    apiSecret: process.env.BINANCE_PAY_API_SECRET ?? '',
  } satisfies BinancePayConfig,
  p2p: {
    enabled: (process.env.P2P_ENABLED ?? 'false') === 'true',
    port: parseInt(process.env.P2P_PORT ?? '6001', 10),
    peers: (process.env.PEERS ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    nodeName: process.env.NODE_NAME ?? 'node-1',
  } satisfies P2pConfig,
  auth: {
    // Sin default: la validación Joi los exige (mín. 32 chars). Genéralos con
    // `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
    totpIssuer: process.env.TOTP_ISSUER ?? 'Zentto Web3',
    cookieDomain: process.env.COOKIE_DOMAIN ?? '',
    cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',
    cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as AuthConfig['cookieSameSite'],
  } satisfies AuthConfig,
});
