const fetch = globalThis.fetch;
const token = process.env.ADMIN_TOKEN || '';
const base = process.env.BASE_URL || 'http://localhost:5001';
(async () => {
  try {
    const resp = await fetch(`${base}/api/synthesis/test-retrieval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': token,
      },
      body: JSON.stringify({ userMessage: 'Hello debugging retrieval', ownerScope: 'session_test', mode: 'standard', k: 1 }),
    });
    console.log('status', resp.status);
    console.log(await resp.text());
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
