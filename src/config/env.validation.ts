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

  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  AI_MODEL: Joi.string().default('claude-opus-4-8'),
  AI_EFFORT: Joi.string().valid('low', 'medium', 'high', 'max').default('medium'),
});
