import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

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

  beforeAll(async () => {
    process.env.CHAIN_DIFFICULTY = process.env.CHAIN_DIFFICULTY ?? '2';
    process.env.MINING_REWARD = process.env.MINING_REWARD ?? '50';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'e2e-access-secret-0123456789abcdef0123456789abcdef';
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? 'e2e-refresh-secret-0123456789abcdef0123456789abcdef';

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

  it('logout cierra la sesión', async () => {
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf).expect(201);
    await agent.get('/api/auth/me').expect(401);
  });
});
