import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { outputFile } from './lib/project.mjs';

const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
createServer(async (request, response) => {
  if (!['/', '/index.html'].includes(request.url.split('?')[0])) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const html = await readFile(outputFile);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  } catch {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Nejdříve spusťte npm run build.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}`));
