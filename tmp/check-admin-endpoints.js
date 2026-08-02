const fetch = globalThis.fetch;
const token = process.env.ADMIN_TOKEN || '';
const base = process.env.BASE_URL || 'http://localhost:5001';
(async () => {
  try {
    const routes = [
      { path: '/api/health/learning', method: 'GET' },
      { path: '/api/synthesis/test-retrieval', method: 'POST', body: { userMessage: 'test', ownerScope: 'session_test' } },
    ];
    for (const route of routes) {
      const options = {
        method: route.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
      };
      if (route.method === 'POST') options.body = JSON.stringify(route.body);
      const resp = await fetch(`${base}${route.path}`, options);
      console.log('---', route.path, 'status=', resp.status);
      const text = await resp.text();
      console.log(text);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
