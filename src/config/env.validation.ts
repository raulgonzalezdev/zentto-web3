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

  P2P_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  P2P_PORT: Joi.number().default(6001),
  PEERS: Joi.string().allow('').default(''),
  NODE_NAME: Joi.string().default('node-1'),
});
