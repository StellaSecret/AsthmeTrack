// Serveur HTTP minimal pour servir www/ pendant les tests Playwright
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const ROOT = path.resolve(__dirname, 'www');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  // Reject URLs with null bytes or other suspicious characters early
  if (req.url.includes('%00') || req.url.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  const decodedUrl = decodeURIComponent(req.url);
  // Remove query parameters
  const urlPath = decodedUrl === '/' ? '/index.html' : decodedUrl.split('?')[0];

  // Whitelist allowed characters: alphanumeric, hyphen, underscore, dot, forward slash
  if (!/^[a-zA-Z0-9\-\_\.\/]+$/.test(urlPath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden: Invalid characters in path');
    return;
  }

  // Prevent suspicious patterns like '..' or '//'
  if (urlPath.includes('..') || urlPath.includes('//')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden: Suspicious path pattern');
    return;
  }

  // Resolve absolute path
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ''));

  // Double-check using path.relative to ensure we are within ROOT
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Ensure file exists and is not a directory
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}).listen(PORT, () => {
  console.log(`AsthmeTrack test server running on http://localhost:${PORT}`);
});
