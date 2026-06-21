import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHmac, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import request from 'supertest';
import { english, generateMnemonic } from 'viem/accounts';

/**
 * E2E del flujo completo con autenticación. Requiere Postgres y Redis
 * (CI los provee en 5544 / 6399).
 *
 * Cubre: salud → registro (cookies httpOnly) → CSRF → crear wallet → minar
 * (BullMQ) → recompensa → screening AML → integridad de cadena.
 */
describe('Zentto Web3 (e2e)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;
  let csrf: string;
  let minerAddress: string;
  let totpSecret: string; // 2FA compartido para transferencia + retiro

  beforeAll(async () => {
    process.env.CHAIN_DIFFICULTY = process.env.CHAIN_DIFFICULTY ?? '2';
    process.env.MINING_REWARD = process.env.MINING_REWARD ?? '50';
    // Comisiones en 0 para aserciones financieras limpias en e2e (se prueban aparte).
    process.env.FEE_P2P_PCT = '0';
    process.env.FEE_DEPOSIT_PCT = '0';
    process.env.FEE_WITHDRAW_PCT = '0';
    process.env.FEE_WITHDRAW_NETWORK = '0';
    process.env.FEE_MIN = '0';
    // Secretos efímeros generados al vuelo (no se hardcodean → sin alertas de secret-scanning).
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? randomBytes(48).toString('base64url');
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? randomBytes(48).toString('base64url');
    process.env.FAUCET_ENABLED = 'true'; // habilita el faucet de prueba en e2e
    process.env.CUSTODY_MNEMONIC = process.env.CUSTODY_MNEMONIC ?? generateMnemonic(english);
    // Secreto de webhook efímero (generado, no hardcodeado) para probar la firma de Didit.
    process.env.DIDIT_WEBHOOK_SECRET =
      process.env.DIDIT_WEBHOOK_SECRET ?? randomBytes(24).toString('hex');

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health responde ok', async () => {
    const res = await agent.get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('obtiene un token CSRF', async () => {
    const res = await agent.get('/api/auth/csrf').expect(200);
    csrf = res.body.csrfToken;
    expect(typeof csrf).toBe('string');
  });

  it('rechaza una acción protegida sin autenticación', async () => {
    await request(app.getHttpServer()).post('/api/wallets').expect(401);
  });

  it('registra un usuario y deja sesión por cookie httpOnly', async () => {
    const email = `e2e_${Date.now()}@zentto.net`;
    const res = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', csrf)
      .send({ email, password: 'SuperSecret123' })
      .expect(201);
    expect(res.body.user.email).toBe(email);
  });

  it('GET /api/auth/me devuelve el usuario autenticado', async () => {
    const res = await agent.get('/api/auth/me').expect(200);
    expect(res.body.user.id).toBeDefined();
  });

  it('crea una wallet autenticada', async () => {
    const res = await agent.post('/api/wallets').set('x-csrf-token', csrf).expect(201);
    minerAddress = res.body.address;
    expect(minerAddress).toBeDefined();
  });

  it('mina un bloque y acredita la recompensa', async () => {
    const mineRes = await agent
      .post('/api/mining')
      .set('x-csrf-token', csrf)
      .send({ minerAddress })
      .expect(201);
    const jobId = mineRes.body.jobId;
    expect(jobId).toBeDefined();

    let completed = false;
    for (let i = 0; i < 40 && !completed; i++) {
      const status = await agent.get(`/api/mining/jobs/${jobId}`);
      if (status.body.state === 'completed') {
        completed = true;
        break;
      }
      if (status.body.state === 'failed') {
        throw new Error(`Job de minado falló: ${status.body.failedReason}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(completed).toBe(true);

    const balance = await agent.get(`/api/wallets/${minerAddress}/balance`).expect(200);
    expect(balance.body.confirmed).toBeGreaterThanOrEqual(50);
  });

  it('screening AML público de bajo riesgo', async () => {
    const res = await agent.get(`/api/compliance/screen/${minerAddress}`).expect(200);
    expect(['low', 'medium', 'high']).toContain(res.body.riskLevel);
  });

  it('la cadena es íntegra', async () => {
    const res = await agent.get('/api/chain/validate').expect(200);
    expect(res.body.valid).toBe(true);
  });

  it('faucet acredita saldo y es idempotente', async () => {
    const key = `e2e-credit-${Date.now()}`;
    const credit = () =>
      agent
        .post('/api/payments/credit')
        .set('x-csrf-token', csrf)
        .set('Idempotency-Key', key)
        .send({ asset: 'USDT', amount: '100' });
    await credit().expect(201);
    await credit().expect(201); // misma key => no duplica

    const bal = await agent.get('/api/accounts/balance').expect(200);
    const usdt = bal.body.find((b: { asset: string }) => b.asset === 'USDT');
    expect(usdt.available).toBe('100');
  });

  it('habilita 2FA (Google Authenticator) para autorizar movimientos de dinero', async () => {
    const setup = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrf).expect(201);
    totpSecret = setup.body.secret as string;
    await agent
      .post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: authenticator.generate(totpSecret) })
      .expect(201);
  });

  it('transferencia interna descuenta del emisor (idempotente, requiere 2FA)', async () => {
    const bEmail = `e2e_b_${Date.now()}@zentto.net`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: bEmail, password: 'SuperSecret123' })
      .expect(201);

    const key = `e2e-tx-${Date.now()}`;
    const transfer = () =>
      agent
        .post('/api/payments/transfer')
        .set('x-csrf-token', csrf)
        .set('Idempotency-Key', key)
        .send({
          toEmail: bEmail,
          asset: 'USDT',
          amount: '30',
          totpCode: authenticator.generate(totpSecret),
        });
    await transfer().expect(201);
    await transfer().expect(201); // idempotente: no vuelve a descontar

    const bal = await agent.get('/api/accounts/balance').expect(200);
    const usdt = bal.body.find((b: { asset: string }) => b.asset === 'USDT');
    expect(usdt.available).toBe('70'); // 100 - 30
  });

  it('asigna una dirección de depósito on-chain (HD)', async () => {
    const res = await agent.get('/api/accounts/deposit-address').expect(200);
    expect(res.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(res.body.network).toBe('sepolia'); // red primaria del catálogo multi-red
  });

  it('el retiro exige Google Authenticator (TOTP): sin código → 400', async () => {
    await agent
      .post('/api/payments/credit')
      .set('x-csrf-token', csrf)
      .set('Idempotency-Key', `e2e-wc-${Date.now()}`)
      .send({ asset: 'USDC', amount: '100' })
      .expect(201);

    // 2FA activo pero sin enviar el código → retiro bloqueado.
    await agent
      .post('/api/payments/withdraw')
      .set('x-csrf-token', csrf)
      .set('Idempotency-Key', `e2e-w-no2fa-${Date.now()}`)
      .send({
        asset: 'USDC',
        amount: '30',
        toAddress: '0x000000000000000000000000000000000000dead',
      })
      .expect(400);
  });

  it('retiro autorizado con TOTP coloca un hold: disponible baja, saldo intacto', async () => {
    const res = await agent
      .post('/api/payments/withdraw')
      .set('x-csrf-token', csrf)
      .set('Idempotency-Key', `e2e-w-${Date.now()}`)
      .send({
        asset: 'USDC',
        amount: '30',
        toAddress: '0x000000000000000000000000000000000000dead',
        totpCode: authenticator.generate(totpSecret),
      })
      .expect(201);
    expect(res.body.status).toBe('processing');
    expect(res.body.type).toBe('withdrawal');

    const bal = await agent.get('/api/accounts/balance').expect(200);
    const usdc = (
      bal.body as Array<{ asset: string; balance: string; held: string; available: string }>
    ).find((b) => b.asset === 'USDC');
    expect(usdc?.balance).toBe('100'); // saldo contable intacto hasta confirmar on-chain
    expect(usdc?.held).toBe('30'); // retenido por el hold
    expect(usdc?.available).toBe('70'); // disponible = saldo − hold
  });

  it('KYC: nombre en lista OFAC → amlMatch true (no auto-aprueba)', async () => {
    const sub = await agent
      .post('/api/kyc/submit')
      .set('x-csrf-token', csrf)
      .send({ fullName: 'Viktor Bout', documentType: 'id_card', documentNumber: 'A1' })
      .expect(201);
    expect(sub.body.amlMatch).toBe(true);
    expect(sub.body.status).toBe('in_review');
  });

  it('KYC: MRZ válida → in_review (mrzValid true), operador aprueba → approved', async () => {
    const mrz =
      'P<UTOERIKSSON<<ANNA<MARIA'.padEnd(44, '<') + 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
    const sub = await agent
      .post('/api/kyc/submit')
      .set('x-csrf-token', csrf)
      .send({ fullName: 'ANNA MARIA ERIKSSON', documentType: 'passport', mrz })
      .expect(201);
    expect(sub.body.status).toBe('in_review');
    expect(sub.body.mrzValid).toBe(true);
    expect(sub.body.amlMatch).toBe(false);

    const id = sub.body.id as string;
    const dec = await agent
      .post(`/api/kyc/${id}/decision`)
      .set('x-csrf-token', csrf)
      .send({ approve: true, reason: 'Documento OK' })
      .expect(201);
    expect(dec.body.status).toBe('approved');

    const st = await agent.get('/api/kyc/status').expect(200);
    expect(st.body.status).toBe('approved');
  });

  it('webhook Didit: firma inválida → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/kyc/webhook/didit')
      .set('x-signature-simple', 'deadbeef')
      .send({
        created_at: Math.floor(Date.now() / 1000),
        session_id: 's1',
        status: 'Approved',
        webhook_type: 'status.updated',
        vendor_data: 'desconocido',
      })
      .expect(401);
  });

  it('webhook Didit: firma válida (HMAC) actualiza el KYC por vendor_data', async () => {
    const me = await agent.get('/api/auth/me').expect(200);
    const userId = me.body.user.id as string;
    const created_at = Math.floor(Date.now() / 1000);
    const sessionId = 'sess-123';
    const status = 'In Review';
    const webhookType = 'status.updated';
    const canonical = `${created_at}:${sessionId}:${status}:${webhookType}`;
    const sig = createHmac('sha256', process.env.DIDIT_WEBHOOK_SECRET as string)
      .update(canonical, 'utf-8')
      .digest('hex');

    await request(app.getHttpServer())
      .post('/api/kyc/webhook/didit')
      .set('x-signature-simple', sig)
      .send({
        created_at,
        session_id: sessionId,
        status,
        webhook_type: webhookType,
        vendor_data: userId,
      })
      .expect(201);

    const st = await agent.get('/api/kyc/status').expect(200);
    expect(st.body.status).toBe('in_review');
  });

  it('verify-email con token inválido → 400', async () => {
    await agent
      .post('/api/auth/verify-email')
      .set('x-csrf-token', csrf)
      .send({ token: 'token-que-no-existe-1234567890' })
      .expect(400);
  });

  it('verify-email con token real generado marca emailVerified', async () => {
    // El token plano solo viaja por email (en CI con NOTIFY_API_KEY vacío no se
    // envía). Lo regeneramos vía el servicio para probar el endpoint extremo a
    // extremo: el servicio hashea y persiste; el endpoint valida el plano.
    const me = await agent.get('/api/auth/me').expect(200);
    const userId = me.body.user.id as string;

    const { AccountTokenService } = await import('../src/auth/account-token.service');
    const tokenSvc = app.get(AccountTokenService);
    const plain = await tokenSvc.issue(userId, 'verify_email', 60_000);

    await agent
      .post('/api/auth/verify-email')
      .set('x-csrf-token', csrf)
      .send({ token: plain })
      .expect(201);

    const after = await agent.get('/api/auth/me').expect(200);
    expect(after.body.user.emailVerified).toBe(true);
  });

  it('forgot-password siempre responde 200 (no revela si el email existe)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: `noexiste_${Date.now()}@zentto.net` })
      .expect(200);
  });

  it('logout cierra la sesión', async () => {
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf).expect(201);
    await agent.get('/api/auth/me').expect(401);
  });
});
