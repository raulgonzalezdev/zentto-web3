import { Logger } from '@nestjs/common';

/**
 * Carga secretos desde HashiCorp Vault ANTES de que arranque Nest (para que
 * @nestjs/config los vea como variables de entorno). Autentica con AppRole
 * (VAULT_ROLE_ID + VAULT_SECRET_ID) y lee el KV v2 en VAULT_KV_PATH.
 *
 * Si Vault no está configurado o no responde, NO rompe: la app cae al valor del
 * `.env` (fallback). Así dev/local sigue funcionando y un Vault sellado no tumba
 * el arranque (aunque sin el secreto las operaciones que lo necesiten fallarán).
 *
 * Secretos mapeados Vault → env:
 *   custody_mnemonic → CUSTODY_MNEMONIC
 */
const logger = new Logger('Vault');

export async function loadVaultSecrets(): Promise<void> {
  const addr = process.env.VAULT_ADDR;
  const roleId = process.env.VAULT_ROLE_ID;
  const secretId = process.env.VAULT_SECRET_ID;
  const kvPath = process.env.VAULT_KV_PATH || 'zentto/data/web3';
  if (!addr || !roleId || !secretId) {
    logger.log('Vault no configurado (sin VAULT_ADDR/ROLE_ID/SECRET_ID); usando .env');
    return;
  }
  try {
    const login = await fetch(`${addr}/v1/auth/approle/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!login.ok) throw new Error(`AppRole login HTTP ${login.status}`);
    const lj = (await login.json()) as { auth?: { client_token?: string } };
    const token = lj.auth?.client_token;
    if (!token) throw new Error('AppRole login sin client_token');

    const read = await fetch(`${addr}/v1/${kvPath}`, {
      headers: { 'x-vault-token': token },
      signal: AbortSignal.timeout(8000),
    });
    if (!read.ok) throw new Error(`Lectura KV HTTP ${read.status}`);
    const rj = (await read.json()) as { data?: { data?: Record<string, string> } };
    const data = rj.data?.data ?? {};

    const map: Record<string, string> = { custody_mnemonic: 'CUSTODY_MNEMONIC' };
    let loaded = 0;
    for (const [vk, envKey] of Object.entries(map)) {
      if (data[vk]) {
        process.env[envKey] = data[vk];
        loaded++;
      }
    }
    logger.log(`Secretos cargados desde Vault (${loaded}).`);
  } catch (e) {
    logger.warn(`No se pudo leer Vault (${(e as Error).message}); usando .env como fallback`);
  }
}
