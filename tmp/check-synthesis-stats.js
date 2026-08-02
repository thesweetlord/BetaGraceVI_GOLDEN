const fetch = globalThis.fetch;
const url = 'http://localhost:5000/api/synthesis/stats';
(async () => {
  try {
    const r1 = await fetch(url);
    console.log('no header', r1.status, await r1.text());
    const r2 = await fetch(url, { headers: { 'x-admin-token': process.env.ADMIN_TOKEN || '' } });
    console.log('with header', r2.status, await r2.text());
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
