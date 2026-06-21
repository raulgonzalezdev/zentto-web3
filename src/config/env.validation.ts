import * as Joi from 'joi';

/**
 * Esquema de validación de variables de entorno. Si falta una crítica o tiene
 * un tipo inválido, la app no arranca (fail-fast) en lugar de fallar en runtime.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(4100),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGIN: Joi.string().default('*'),
  // Emails de operadores del backoffice (coma). Vacío = cualquier autenticado (dev).
  OPERATOR_EMAILS: Joi.string().allow('').default(''),
  // URL pública del frontend (links de verificación de email / reset de contraseña).
  APP_URL: Joi.string().default('https://neo.zentto.net'),

  // zentto-notify (envío de emails transaccionales). Sin API key => dry-run (log a consola).
  NOTIFY_BASE_URL: Joi.string().default('https://notify.zentto.net'),
  NOTIFY_API_KEY: Joi.string().allow('').default(''),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5544),
  DB_USER: Joi.string().default('web3'),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_NAME: Joi.string().default('zentto_web3'),
  DB_SYNCHRONIZE: Joi.boolean().truthy('true').falsy('false').default(true),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6399),

  CHAIN_DIFFICULTY: Joi.number().min(1).max(6).default(3),
  MINING_REWARD: Joi.number().min(0).default(50),
  GENESIS_PREMINE_ADDRESS: Joi.string().allow('').default(''),

  AML_HIGH_RISK_THRESHOLD: Joi.number().min(0).max(100).default(70),
  AML_STRUCTURING_AMOUNT: Joi.number().min(0).default(9000),

  AI_PROVIDER: Joi.string()
    .valid('auto', 'anthropic', 'openai', 'deepseek', 'none')
    .default('auto'),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  OPENAI_BASE_URL: Joi.string().default('https://api.openai.com/v1'),
  AI_MODEL: Joi.string().allow('').default(''),
  AI_EFFORT: Joi.string().valid('low', 'medium', 'high', 'max').default('medium'),

  // Secretos obligatorios y fuertes (sin default usable). Genéralos con:
  //   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  BCRYPT_ROUNDS: Joi.number().min(8).max(15).default(12),
  TOTP_ISSUER: Joi.string().default('Zentto Web3'),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  COOKIE_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),

  CUSTODY_MNEMONIC: Joi.string().allow('').default(''),
  KYC_PROVIDER: Joi.string().valid('manual', 'didit').default('manual'),
  DIDIT_API_KEY: Joi.string().allow('').default(''),
  DIDIT_BASE_URL: Joi.string().default('https://verification.didit.me'),
  DIDIT_WORKFLOW_ID: Joi.string().allow('').default(''),
  DIDIT_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  DIDIT_CALLBACK_URL: Joi.string().allow('').default(''),
  DEPOSIT_INDEXER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  WITHDRAWALS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  EVM_CONFIRMATIONS: Joi.number().min(0).default(3),
  DEPOSIT_SCAN_RANGE: Joi.number().min(1).default(2000),
  LEDGER_ASSETS: Joi.string().default('USDT,USDC'),
  FAUCET_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  FAUCET_MAX: Joi.number().min(0).default(1000),

  // Comisiones de plataforma (modelo de negocio). Porcentajes en fracción (0.005 = 0.5%).
  FEE_P2P_PCT: Joi.number().min(0).max(0.2).default(0.005),
  FEE_DEPOSIT_PCT: Joi.number().min(0).max(0.2).default(0.01),
  FEE_WITHDRAW_PCT: Joi.number().min(0).max(0.2).default(0.01),
  FEE_WITHDRAW_NETWORK: Joi.number().min(0).default(0.5),
  FEE_MIN: Joi.number().min(0).default(0.01),

  // Si se define, EVM + indexer usan Alchemy (https://eth-sepolia.g.alchemy.com/v2/<key>).
  ALCHEMY_API_KEY: Joi.string().allow('').default(''),
  // Signing key del webhook de Alchemy (valida la firma HMAC del payload entrante).
  ALCHEMY_WEBHOOK_SIGNING_KEY: Joi.string().allow('').default(''),
  // Override directo del RPC; tiene prioridad sobre ALCHEMY_API_KEY.
  EVM_RPC_URL: Joi.string().allow('').optional(),
  EVM_CHAIN_ID: Joi.number().default(11155111),
  EVM_CHAIN_NAME: Joi.string().default('Sepolia'),
  EVM_EXPLORER_URL: Joi.string().default('https://sepolia.etherscan.io'),
  EVM_NATIVE_SYMBOL: Joi.string().default('ETH'),
  EVM_USDC_ADDRESS: Joi.string().default('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  EVM_NETWORK_KEY: Joi.string().default('sepolia'),

  // Multi-red: habilita redes EVM adicionales (Polygon Amoy, BSC testnet).
  MULTI_NETWORK_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  POLYGON_AMOY_RPC_URL: Joi.string().allow('').optional(),
  POLYGON_AMOY_USDC_ADDRESS: Joi.string().allow('').optional(),
  BSC_TESTNET_RPC_URL: Joi.string().allow('').optional(),
  BSC_TESTNET_USDC_ADDRESS: Joi.string().allow('').optional(),

  P2P_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  P2P_PORT: Joi.number().default(6001),
  PEERS: Joi.string().allow('').default(''),
  NODE_NAME: Joi.string().default('node-1'),
});
