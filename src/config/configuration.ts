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
  /** Proveedor de liveness/autenticidad: 'manual' (revisión a mano) | 'didit'. */
  provider: 'manual' | 'didit';
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
  usdcAddress: string;
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
 * Catálogo de redes. La PRIMARIA (sepolia) se toma de las EVM_* existentes. Las
 * adicionales EVM (Polygon Amoy, BSC testnet) se habilitan con MULTI_NETWORK_ENABLED
 * (default true en testnet) y tienen RPC públicos por defecto, overridables por env.
 * Tron/Stellar quedan declaradas pero `available:false` (pendiente SDK).
 */
function buildNetworks(): NetworkConfig[] {
  const extrasEnabled = (process.env.MULTI_NETWORK_ENABLED ?? 'true') === 'true';
  const confirmations = parseInt(process.env.EVM_CONFIRMATIONS ?? '3', 10);
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  // Alchemy da getLogs de archivo (lo necesita el indexer de depósitos) y rate
  // limits altos. Si hay key, se usa para todas las redes EVM soportadas.
  const alchemyRpc = (subdomain: string) =>
    alchemyKey ? `https://${subdomain}.g.alchemy.com/v2/${alchemyKey}` : null;

  const primaryRpc =
    process.env.EVM_RPC_URL || alchemyRpc('eth-sepolia') || 'https://sepolia.drpc.org';

  const primary: NetworkConfig = {
    key: process.env.EVM_NETWORK_KEY ?? 'sepolia',
    family: 'evm',
    chainId: parseInt(process.env.EVM_CHAIN_ID ?? '11155111', 10),
    name: process.env.EVM_CHAIN_NAME ?? 'Sepolia',
    rpcUrl: primaryRpc,
    fallbackRpcUrl: 'https://sepolia.drpc.org', // respaldo público si Alchemy falla
    explorerUrl: process.env.EVM_EXPLORER_URL ?? 'https://sepolia.etherscan.io',
    nativeSymbol: process.env.EVM_NATIVE_SYMBOL ?? 'ETH',
    usdcAddress: process.env.EVM_USDC_ADDRESS ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    confirmations,
    isTestnet: true,
    enabled: true,
    available: true,
  };

  const polygonAmoy: NetworkConfig = {
    key: 'polygon-amoy',
    family: 'evm',
    chainId: 80002,
    name: 'Polygon Amoy',
    rpcUrl:
      process.env.POLYGON_AMOY_RPC_URL ||
      alchemyRpc('polygon-amoy') ||
      'https://rpc-amoy.polygon.technology',
    fallbackRpcUrl: 'https://rpc-amoy.polygon.technology',
    explorerUrl: 'https://amoy.polygonscan.com',
    nativeSymbol: 'POL',
    // USDC de Circle en Amoy.
    usdcAddress:
      process.env.POLYGON_AMOY_USDC_ADDRESS || '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    confirmations: 5,
    isTestnet: true,
    enabled: extrasEnabled,
    available: true,
  };

  const bscTestnet: NetworkConfig = {
    key: 'bsc-testnet',
    family: 'evm',
    chainId: 97,
    name: 'BSC Testnet',
    rpcUrl:
      process.env.BSC_TESTNET_RPC_URL ||
      alchemyRpc('bnb-testnet') ||
      'https://bsc-testnet-rpc.publicnode.com',
    fallbackRpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    explorerUrl: 'https://testnet.bscscan.com',
    nativeSymbol: 'tBNB',
    // USDC de testnet en BSC.
    usdcAddress:
      process.env.BSC_TESTNET_USDC_ADDRESS || '0x64544969ed7EBf5f083679233325356EbE738930',
    confirmations: 6,
    isTestnet: true,
    enabled: extrasEnabled,
    available: true,
  };

  // Tron Nile testnet (USDT-TRC20: el rail de stablecoin más usado en Venezuela).
  const tron: NetworkConfig = {
    key: 'tron-nile',
    family: 'tron',
    chainId: 0,
    name: 'Tron Nile',
    rpcUrl: process.env.TRON_RPC_URL || 'https://nile.trongrid.io',
    explorerUrl: 'https://nile.tronscan.org',
    nativeSymbol: 'TRX',
    // USDT TRC-20 en Nile testnet.
    usdcAddress: process.env.TRON_USDT_ADDRESS || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    confirmations: 19,
    isTestnet: true,
    enabled: extrasEnabled,
    available: true,
  };

  // Stellar testnet (USDC de Circle; depósito por cuenta-plataforma + memo por usuario).
  const stellar: NetworkConfig = {
    key: 'stellar-testnet',
    family: 'stellar',
    chainId: 0,
    name: 'Stellar Testnet',
    rpcUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    nativeSymbol: 'XLM',
    // Issuer de USDC de Circle en testnet (asset code USDC).
    usdcAddress:
      process.env.STELLAR_USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    confirmations: 1,
    isTestnet: true,
    enabled: extrasEnabled,
    available: true,
  };

  return [primary, polygonAmoy, bscTestnet, tron, stellar];
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
    provider: (process.env.KYC_PROVIDER ?? 'manual') as KycConfig['provider'],
    diditApiKey: process.env.DIDIT_API_KEY ?? '',
    diditBaseUrl: process.env.DIDIT_BASE_URL ?? 'https://verification.didit.me',
    diditWorkflowId: process.env.DIDIT_WORKFLOW_ID ?? '',
    diditWebhookSecret: process.env.DIDIT_WEBHOOK_SECRET ?? '',
    diditCallbackUrl: process.env.DIDIT_CALLBACK_URL ?? '',
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
