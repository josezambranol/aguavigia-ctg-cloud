import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = process.env.DIST_DIR || path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 7860);
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8080);
const SMTP_PORT = Number(process.env.SMTP_PORT || 1025);

// In-memory mailbox for captured SMTP messages (replaces Mailhog in cloud with 0 extra RAM)
const capturedEmails = [];
const MAX_EMAILS = 50;

const smtpServer = net.createServer((socket) => {
  socket.write('220 aguavigia-smtp ESMTP ready\r\n');
  let inData = false;
  let currentMail = { from: '', to: [], raw: '', createdAt: new Date().toISOString() };
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      if (inData) {
        if (line === '.') {
          inData = false;
          capturedEmails.unshift({ ...currentMail });
          if (capturedEmails.length > MAX_EMAILS) capturedEmails.pop();
          currentMail = { from: '', to: [], raw: '', createdAt: new Date().toISOString() };
          socket.write('250 2.0.0 OK: queued\r\n');
        } else {
          currentMail.raw += line + '\n';
        }
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        socket.write('250-aguavigia-smtp\r\n250 SIZE 10485760\r\n');
      } else if (upper.startsWith('MAIL FROM:')) {
        currentMail.from = line.slice(10).trim();
        socket.write('250 2.1.0 OK\r\n');
      } else if (upper.startsWith('RCPT TO:')) {
        currentMail.to.push(line.slice(8).trim());
        socket.write('250 2.1.5 OK\r\n');
      } else if (upper === 'DATA') {
        inData = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (upper.startsWith('RSET')) {
        currentMail = { from: '', to: [], raw: '', createdAt: new Date().toISOString() };
        socket.write('250 2.0.0 OK\r\n');
      } else if (upper.startsWith('NOOP')) {
        socket.write('250 2.0.0 OK\r\n');
      } else if (upper.startsWith('QUIT')) {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
      } else {
        socket.write('250 OK\r\n');
      }
    }
  });

  socket.on('error', () => {});
});

smtpServer.listen(SMTP_PORT, '127.0.0.1', () => {
  console.log(`[Gateway] Built-in SMTP server listening on 127.0.0.1:${SMTP_PORT}`);
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pmtiles': 'application/vnd.pmtiles',
  '.pbf': 'application/x-protobuf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const backendAgent = new http.Agent({ keepAlive: false });

function proxyToBackend(req, res) {
  const headers = { ...req.headers };
  delete headers.origin;
  headers.host = `${BACKEND_HOST}:${BACKEND_PORT}`;

  const proxyReq = http.request(
    {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers,
      agent: backendAgent,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(503, {
        'Content-Type': 'application/problem+json; charset=utf-8',
        'Retry-After': '5',
      });
    }
    res.end(
      JSON.stringify({
        type: 'https://aguavigia.example/errores/servicio-no-disponible',
        title: 'Servidor iniciando',
        status: 503,
        detail: `El motor de AguaVigía CTG está terminando de iniciar (${err.code || err.message}). Reintentando en unos segundos...`,
      })
    );
  });

  req.pipe(proxyReq);
}

function proxyAcuacarMedia(req, res) {
  const targetPath = req.url.replace(/^\/acuacar-media\//, '/wp-content/uploads/');
  const headers = {
    'User-Agent': 'AguaVigiaCTG-Bot/1.0 (+alertas@aguavigia.com)',
    Accept: req.headers.accept || '*/*',
  };

  const proxyReq = https.request(
    {
      hostname: 'www.acuacar.com',
      port: 443,
      path: targetPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end(err.message);
  });

  req.pipe(proxyReq);
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const indexHtml = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexHtml, (readErr, content) => {
        if (readErr) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': contentType,
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'UP', service: 'aguavigia-gateway' }));
    return;
  }

  if (urlPath === '/mailhog' || urlPath === '/mailhog/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ total: capturedEmails.length, messages: capturedEmails }, null, 2));
    return;
  }

  if (
    urlPath === '/api' ||
    urlPath.startsWith('/api/') ||
    urlPath.startsWith('/actuator/') ||
    urlPath.startsWith('/swagger-ui') ||
    urlPath.startsWith('/v3/api-docs')
  ) {
    proxyToBackend(req, res);
    return;
  }

  if (urlPath.startsWith('/acuacar-media/')) {
    proxyAcuacarMedia(req, res);
    return;
  }

  const safeSuffix = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = path.join(DIST_DIR, safeSuffix);

  serveFile(req, res, candidate);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Gateway] AguaVigía CTG listening on http://0.0.0.0:${PORT} -> backend ${BACKEND_HOST}:${BACKEND_PORT}`);
});
