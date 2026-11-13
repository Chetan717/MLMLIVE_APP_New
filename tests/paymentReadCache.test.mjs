import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const pending = [], auth = { currentUser: { uid: 'buyer_a' } };
  const context = vm.createContext({ auth, app: {}, env: {}, getFunctions: () => ({}),
    window: { dispatchEvent() {} }, CustomEvent: class {},
    httpsCallable: (_functions, name) => async data => ({ data: await new Promise(resolve => pending.push({ name, data, resolve })) }),
  });
  const source = fs.readFileSync(new URL('../src/services/paymentService.js', import.meta.url), 'utf8')
    .replace(/^import[^;]+;\s*/gm, '').replaceAll('import.meta.env', 'env').replace(/\bexport\s+/g, '');
  vm.runInContext(source + '\nglobalThis.api = { getPaymentCatalog, getPaymentHistory, clearPaymentCache };', context);
  return { pending, auth, api: context.api };
}
test('plan reads coalesce and cache by authenticated buyer and company', async () => {
  const { api, pending, auth } = setup();
  const first = api.getPaymentCatalog('company_a'), duplicate = api.getPaymentCatalog('company_a');
  assert.equal(pending.length, 1); pending[0].resolve({ version: 1 });
  await Promise.all([first, duplicate]); await api.getPaymentCatalog('company_a'); assert.equal(pending.length, 1);
  const other = api.getPaymentCatalog('company_b'); assert.equal(pending.length, 2); pending[1].resolve({}); await other;
  auth.currentUser = { uid: 'buyer_b' };
  const differentBuyer = api.getPaymentCatalog('company_a'); assert.equal(pending.length, 3); pending[2].resolve({}); await differentBuyer;
});
test('payment confirmation invalidates an older in-flight history request', async () => {
  const { api, pending } = setup();
  const old = api.getPaymentHistory('company_a'); api.clearPaymentCache();
  const fresh = api.getPaymentHistory('company_a', { force: true });
  assert.equal(pending.length, 2); pending[1].resolve({ paid: true }); await fresh;
  pending[0].resolve({ paid: false }); await old;
  assert.equal((await api.getPaymentHistory('company_a')).paid, true);
});
test('a manual refresh cannot be overwritten by the slower previous request', async () => {
  const { api, pending } = setup();
  const old = api.getPaymentCatalog('company_a'); const fresh = api.getPaymentCatalog('company_a', true);
  assert.equal(pending.length, 2); pending[1].resolve({ version: 2 }); await fresh;
  pending[0].resolve({ version: 1 }); await old;
  assert.equal((await api.getPaymentCatalog('company_a')).version, 2);
});
