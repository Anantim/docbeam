// Stops a run early, with a clear message, when the local stack is not up and seeded.
export default async function globalSetup(): Promise<void> {
  const services = { auth: 3001, platform: 3002, 'docbeam-api': 3003, 'ws-local': 3004 };
  const down: string[] = [];
  for (const [name, port] of Object.entries(services)) {
    const ok = await fetch(`http://localhost:${port}/health`).then((r) => r.ok, () => false);
    if (!ok) down.push(`${name} (port ${port})`);
  }
  if (down.length > 0) {
    throw new Error(`The local stack is not up: ${down.join(', ')}. Run: docker compose up -d --build --wait && docker compose run --rm seed`);
  }
}
