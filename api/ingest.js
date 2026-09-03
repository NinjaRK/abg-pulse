export default function handler(_req, res) {
  res.status(503).json({ error: 'runtime_bootstrap_pending' });
}
