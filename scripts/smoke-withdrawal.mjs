// Smoke del ciclo de retiro anti-colgadas contra el contenedor :4100.
// Hot wallet sin fondos => el broadcast falla => hold liberado (reembolso).
const B = 'http://localhost:4100/api';
let cookie = '';
const jar = (res) => {
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
};
async function call(method, path, { body, csrf, idem } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (idem) headers['idempotency-key'] = idem;
  const res = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  jar(res);
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: res.status, data };
}
const usdc = (arr) => (Array.isArray(arr) ? arr.find((b) => b.asset === 'USDC') : null);

await call('GET', '/health');
const csrf = (await call('GET', '/auth/csrf')).data.csrfToken;
const email = `wdx_${Date.now()}@zentto.net`;
await call('POST', '/auth/register', { csrf, body: { email, password: 'SuperSecret123' } });

await call('POST', '/payments/credit', { csrf, idem: `c-${email}`, body: { asset: 'USDC', amount: '100' } });
const w = await call('POST', '/payments/withdraw', {
  csrf, idem: `w-${email}`,
  body: { asset: 'USDC', amount: '30', toAddress: '0x000000000000000000000000000000000000dead' },
});
console.log('1) retiro creado:', w.status, '->', JSON.stringify({ status: w.data.status, stage: w.data.metadata?.stage }));
const b1 = usdc((await call('GET', '/accounts/balance')).data);
console.log('   saldo tras hold:', JSON.stringify(b1), '(esperado balance 100 / held 30 / available 70)');

// Esperar a que el retiro llegue a estado terminal (failed por falta de fondos).
let pay, tries = 0;
do {
  await call('POST', '/payments/withdrawals/process', { csrf });
  await new Promise((r) => setTimeout(r, 1500));
  const list = (await call('GET', '/payments')).data;
  pay = Array.isArray(list) ? list.find((p) => p.type === 'withdrawal') : null;
  tries++;
} while (pay && pay.status === 'processing' && tries < 8);

console.log('2) retiro terminal:', JSON.stringify({ status: pay?.status, reason: pay?.failureReason?.slice(0, 60) }));
const b2 = usdc((await call('GET', '/accounts/balance')).data);
console.log('   saldo final:', JSON.stringify(b2), '(esperado balance 100 / held 0 / available 100 = REEMBOLSADO)');
