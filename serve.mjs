import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8',
}

export function serve(root, port = 0) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (path.endsWith('/')) path += 'index.html'
    else if (!extname(path)) { res.writeHead(301, { location: path + '/' }); res.end(); return }
    const file = join(root, normalize(path))
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { port } = await serve(process.cwd(), Number(process.env.PORT) || 8080)
  console.log(`PeruBank at http://localhost:${port}/bank/, Meridian at http://localhost:${port}/meridian/, the page with no attributes at http://localhost:${port}/test/plain.html`)
}
