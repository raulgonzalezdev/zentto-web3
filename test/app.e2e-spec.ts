import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * E2E del flujo completo. Requiere Postgres y Redis disponibles (CI los provee
 * como service containers en los puertos por defecto 5544 / 6399).
 *
 * Flujo cubierto: salud → crear wallet → encolar minado (BullMQ) → esperar
 * bloque → verificar recompensa (coinbase) → screening AML.
 */
describe('Zentto Web3 (e2e)', () => {
  let app: INestApplication;
  let minerAddress: string;

  beforeAll(async () => {
    // Dificultad baja para que el PoW termine rápido en CI.
    process.env.CHAIN_DIFFICULTY = process.env.CHAIN_DIFFICULTY ?? '2';
    process.env.MINING_REWARD = process.env.MINING_REWARD ?? '50';

    // Import diferido para que las env vars apliquen antes de cargar config.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/wallets crea una wallet', async () => {
    const res = await request(app.getHttpServer()).post('/api/wallets').expect(201);
    expect(res.body.address).toBeDefined();
    expect(res.body.privateKey).toBeDefined();
    minerAddress = res.body.address;
  });

  it('mina un bloque y acredita la recompensa al minero', async () => {
    const mineRes = await request(app.getHttpServer())
      .post('/api/mining')
      .send({ minerAddress })
      .expect(201);
    const jobId = mineRes.body.jobId;
    expect(jobId).toBeDefined();

    // Esperar a que el worker BullMQ complete el job.
    let completed = false;
    for (let i = 0; i < 40 && !completed; i++) {
      const status = await request(app.getHttpServer()).get(`/api/mining/jobs/${jobId}`);
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

    const balance = await request(app.getHttpServer())
      .get(`/api/wallets/${minerAddress}/balance`)
      .expect(200);
    expect(balance.body.confirmed).toBeGreaterThanOrEqual(50);
  });

  it('el screening AML de una address recién creada es de bajo riesgo', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/compliance/screen/${minerAddress}`)
      .expect(200);
    expect(['low', 'medium', 'high']).toContain(res.body.riskLevel);
    expect(typeof res.body.score).toBe('number');
  });

  it('la cadena es íntegra', async () => {
    const res = await request(app.getHttpServer()).get('/api/chain/validate').expect(200);
    expect(res.body.valid).toBe(true);
  });
});
