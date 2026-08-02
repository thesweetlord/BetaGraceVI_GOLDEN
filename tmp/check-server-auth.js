const fetch = globalThis.fetch;
const token = process.env.ADMIN_TOKEN || '';
const base = process.env.BASE_URL || 'http://localhost:5001';
(async () => {
  try {
    const r = await fetch(`${base}/api/health/learning`, {
      headers: { 'X-Admin-Token': token },
    });
    console.log('ADMIN_TOKEN', token ? 'set' : 'unset');
    console.log('url', `${base}/api/health/learning`);
    console.log('status', r.status);
    const text = await r.text();
    console.log('body', text);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
