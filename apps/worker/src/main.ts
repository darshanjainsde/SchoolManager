import http from 'node:http';
import pino from 'pino';
import { loadEnv } from '@skoolos/config';

const env = loadEnv();
const logger = pino({
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
});

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(env.WORKER_PORT, () =>
  logger.info({ port: env.WORKER_PORT }, 'worker health listening'),
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
