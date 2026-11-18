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

const capturedEmails = [];
const MAX_EMAILS = 50;

function decodeQuotedPrintable(str) {
  const unfolded = str.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unfolded.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeMimeWords(str) {
  if (!str) return '';
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, _charset, encoding, text) => {
    if (encoding.toUpperCase() === 'B') {
      return Buffer.from(text, 'base64').toString('utf8');
    }
    return decodeQuotedPrintable(text.replace(/_/g, ' '));
  });
}

function parseRawEmail(raw, publicOrigin) {
  const splitIdx = raw.indexOf('\n\n');
  const headerPart = splitIdx !== -1 ? raw.slice(0, splitIdx) : raw;
  let bodyPart = splitIdx !== -1 ? raw.slice(splitIdx + 2) : '';

  const unfoldedHeaders = headerPart.replace(/\r?\n[ \t]+/g, ' ');
  const subjectMatch = unfoldedHeaders.match(/^Subject:\s*(.+)$/im);
  const subject = subjectMatch ? decodeMimeWords(subjectMatch[1].trim()) : 'Aviso de AguaVigía CTG';

  let html = bodyPart;
  const htmlSectionMatch = bodyPart.match(/Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?:\n--[^\n]+|$)/i);
  if (htmlSectionMatch) {
    html = htmlSectionMatch[1];
  }
  html = decodeQuotedPrintable(html);
  const htmlStart = html.search(/<!DOCTYPE|<html|<div|<table|<p/i);
  if (htmlStart > 0) {
    html = html.slice(htmlStart);
  }
  if (publicOrigin) {
    html = html.replace(/https?:\/\/localhost:(?:8080|8081|5173|4173)/g, publicOrigin);
  }
  return { subject, html };
}

function renderMailhogHtml(emails, publicOrigin) {
  const itemsHtml =
    emails.length === 0
      ? `<article class="tarjeta vacio">
          <p class="rotulo">Bandeja vacía</p>
          <h2>Aún no han salido correos</h2>
          <p class="bajada">Cuando alguien se registre como vecino en <strong>Mi cuenta</strong> o pida alertas en <strong>Avisos</strong>, el correo con el enlace de confirmación aparecerá aquí de inmediato.</p>
          <div class="acciones-vacio">
            <a class="boton-primario" href="/vecino/registro">Registrar cuenta de vecino <span>→</span></a>
            <a class="boton-secundario" href="/avisos">Suscribirse a avisos</a>
          </div>
        </article>`
      : emails
          .map((mail, idx) => {
            const { subject, html } = parseRawEmail(mail.raw, publicOrigin);
            const toList = mail.to.join(', ').replace(/[<>]/g, '');
            const time = new Date(mail.createdAt).toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            return `
            <article class="tarjeta correo-item">
              <header class="correo-cabecera">
                <div class="correo-titular">
                  <span class="etiqueta">Mensaje ${emails.length - idx}</span>
                  <h2>${subject}</h2>
                </div>
                <div class="correo-meta">
                  <span>Destinatario: <strong>${toList}</strong></span>
                  <span class="separador">·</span>
                  <time>${time}</time>
                </div>
              </header>
              <div class="correo-cuerpo">${html}</div>
            </article>`;
          })
          .join('\n');

  return `<!doctype html>
<html lang="es-CO">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Buzón de correos · AguaVigía CTG</title>
  <style>
    @font-face {
      font-family: 'Newsreader';
      src: url('/fuentes/newsreader-latin-wght.woff2') format('woff2');
      font-weight: 300 600;
      font-style: normal;
      font-display: swap;
    }
    :root {
      color-scheme: light dark;
      --papel: #f5f5f2;
      --tarjeta: #ffffff;
      --elevada: #ffffff;
      --tinta: #15191c;
      --tinta-2: #4a5157;
      --tinta-3: #7b838a;
      --linea: #dddcd6;
      --linea-suave: #e9e8e3;
      --cardenillo: #2f5f57;
      --sobre-cardenillo: #ffffff;
      --laton: #836430;
      --fuente-marca: 'Newsreader', Georgia, 'Times New Roman', serif;
      --fuente-cuerpo: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      --margen: clamp(16px, 4vw, 48px);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --papel: #111719;
        --tarjeta: #1a1f22;
        --elevada: #242c2f;
        --tinta: #f1f4f2;
        --tinta-2: #b1bbbd;
        --tinta-3: #7e888c;
        --linea: #354044;
        --linea-suave: #283135;
        --cardenillo: #8cc8b8;
        --sobre-cardenillo: #111719;
        --laton: #c9a567;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--papel);
      color: var(--tinta);
      font-family: var(--fuente-cuerpo);
      font-size: 1rem;
      line-height: 1.5;
      min-height: 100vh;
    }
    .cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      padding: 0.875rem var(--margen);
      background: var(--papel);
      border-bottom: 1px solid var(--linea);
    }
    .marca {
      display: inline-flex;
      align-items: baseline;
      gap: 0.5rem;
      color: var(--tinta);
      text-decoration: none;
      font-family: var(--fuente-marca);
      font-size: 1.5rem;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
    .ciudad {
      font-family: var(--fuente-cuerpo);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--tinta-2);
    }
    .navegacion {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.25rem;
    }
    .navegacion a {
      color: var(--tinta-2);
      text-decoration: none;
      font-size: 0.9375rem;
      padding: 0.25rem 0;
      border-bottom: 2px solid transparent;
    }
    .navegacion a:hover {
      color: var(--tinta);
    }
    .navegacion a[aria-current="page"] {
      color: var(--tinta);
      font-weight: 600;
      border-bottom-color: var(--laton);
    }
    .contenedor {
      max-width: 960px;
      margin: 0 auto;
      padding: 2.5rem var(--margen) 4rem;
      display: grid;
      gap: 2rem;
    }
    .encabezado-pagina {
      display: grid;
      gap: 0.75rem;
      border-bottom: 1px solid var(--linea);
      padding-bottom: 1.75rem;
    }
    .filete {
      width: 56px;
      height: 3px;
      border-radius: 999px;
      background: var(--laton);
    }
    .rotulo {
      margin: 0;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--tinta-2);
    }
    h1 {
      margin: 0;
      font-family: var(--fuente-marca);
      font-weight: 400;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1.08;
      letter-spacing: -0.02em;
    }
    .bajada {
      margin: 0;
      color: var(--tinta-2);
      font-size: 1.0625rem;
      max-width: 65ch;
    }
    .barra-acciones {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      margin-top: 0.5rem;
    }
    .boton-primario, .boton-secundario {
      display: inline-flex;
      align-items: center;
      gap: 0.625rem;
      min-height: 44px;
      padding: 0 1.25rem;
      border-radius: 999px;
      font-size: 0.9375rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .boton-primario {
      background: var(--cardenillo);
      color: var(--sobre-cardenillo);
      border: 1px solid var(--cardenillo);
    }
    .boton-secundario {
      background: transparent;
      color: var(--tinta);
      border: 1px solid var(--linea);
    }
    .boton-secundario:hover {
      border-color: var(--laton);
    }
    .tarjeta {
      background: var(--tarjeta);
      border: 1px solid var(--linea);
      border-radius: 12px;
      overflow: hidden;
    }
    .vacio {
      padding: 2.5rem;
      display: grid;
      gap: 0.75rem;
    }
    .vacio h2 {
      margin: 0;
      font-family: var(--fuente-marca);
      font-weight: 400;
      font-size: 1.75rem;
    }
    .acciones-vacio {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .correo-cabecera {
      padding: 1.25rem 1.5rem;
      background: color-mix(in srgb, var(--cardenillo) 7%, var(--tarjeta));
      border-bottom: 1px solid var(--linea);
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .correo-titular {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .correo-titular h2 {
      margin: 0;
      font-family: var(--fuente-marca);
      font-weight: 500;
      font-size: 1.35rem;
    }
    .etiqueta {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.2rem 0.65rem;
      border-radius: 999px;
      border: 1px solid var(--linea);
      color: var(--tinta-2);
    }
    .correo-meta {
      font-size: 0.875rem;
      color: var(--tinta-2);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .correo-cuerpo {
      padding: 1.5rem;
      background: var(--papel);
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <header class="cabecera">
    <a class="marca" href="/">AguaVigía <span class="ciudad">Cartagena</span></a>
    <nav class="navegacion" aria-label="Principal">
      <a href="/">Mapa</a>
      <a href="/cumplimiento">Cumplimiento</a>
      <a href="/bitacora">Bitácora</a>
      <a href="/estadisticas">Estadísticas</a>
      <a href="/avisos">Avisos</a>
      <a href="/mailhog" aria-current="page">Buzón SMTP (${emails.length})</a>
      <a href="/vecino/ingreso">Mi cuenta</a>
      <a href="/panel/ingreso">Acceso al panel</a>
    </nav>
  </header>
  <main class="contenedor">
    <section class="encabezado-pagina">
      <div class="filete"></div>
      <p class="rotulo">Buzón de verificación · Entorno académico (Mailhog)</p>
      <h1>Correos enviados por la plataforma</h1>
      <p class="bajada">Aquí llegan al instante los enlaces de activación de cuentas de vecino, restablecimiento de clave y confirmación de suscripciones sin depender de proveedores de correo externos.</p>
      <div class="barra-acciones">
        <span class="rotulo">${emails.length} mensaje${emails.length === 1 ? '' : 's'} en bandeja</span>
        <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
          <a class="boton-secundario" href="/mailhog">Actualizar bandeja</a>
          <a class="boton-primario" href="/">Volver al mapa <span>→</span></a>
        </div>
      </div>
    </section>
    ${itemsHtml}
  </main>
</body>
</html>`;
}

const HELPER_SCRIPT = `<script>
(function(){
  const observer = new MutationObserver(() => {
    if (document.getElementById('aguavigia-mailhog-cta')) return;
    const text = document.body ? document.body.innerText : '';
    if (text.includes('Revisa tu correo') || text.includes('Te enviamos un enlace')) {
      const main = document.querySelector('main') || document.body;
      const box = document.createElement('div');
      box.id = 'aguavigia-mailhog-cta';
      box.style.cssText = 'margin: 1.25rem auto; max-width: 420px; padding: 1rem 1.25rem; border: 1px solid #354044; border-radius: 12px; background: rgba(140,200,184,0.08); display: grid; gap: 0.65rem;';
      box.innerHTML = '<span style="font-size:0.75rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">Buzón integrado del servidor</span>' +
        '<span style="font-size:0.9375rem;">Abre aquí mismo el correo que acaba de enviarte AguaVigía para hacer clic en el botón de validación:</span>' +
        '<a href="/mailhog" style="display:inline-flex;align-items:center;justify-content:space-between;min-height:46px;padding:0 1.25rem;border-radius:999px;background:#8cc8b8;color:#111719;font-weight:600;text-decoration:none;">Abrir buzón para validar mi correo <span>→</span></a>';
      const target = main.querySelector('form, article, section, div') || main;
      target.appendChild(box);
    }
  });
  window.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));
})();
</script>`;

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

function serveIndexHtml(res) {
  const indexHtml = path.join(DIST_DIR, 'index.html');
  fs.readFile(indexHtml, 'utf8', (readErr, content) => {
    if (readErr) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const injected = content.replace('</body>', `${HELPER_SCRIPT}</body>`);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(injected);
  });
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      serveIndexHtml(res);
      return;
    }
    if (path.basename(filePath) === 'index.html') {
      serveIndexHtml(res);
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
  const rawUrl = req.url || '/';
  const [urlPath, queryString = ''] = rawUrl.split('?');

  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'UP', service: 'aguavigia-gateway' }));
    return;
  }

  if (urlPath === '/mailhog' || urlPath === '/mailhog/') {
    const wantsJson =
      queryString.includes('format=json') ||
      (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html'));
    if (wantsJson) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ total: capturedEmails.length, messages: capturedEmails }, null, 2));
      return;
    }
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'aguavigia-ctg.onrender.com';
    const publicOrigin = `${proto}://${host}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(renderMailhogHtml(capturedEmails, publicOrigin));
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

  const publicUrl =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.APP_URL_PUBLICA ||
    (process.env.SPACE_HOST ? `https://${process.env.SPACE_HOST}` : null);

  if (publicUrl && publicUrl.startsWith('http')) {
    console.log(`[Gateway] Auto keep-alive enabled for ${publicUrl}/healthz (every 9 min)`);
    setInterval(() => {
      const client = publicUrl.startsWith('https') ? https : http;
      client.get(`${publicUrl.replace(/\/$/, '')}/healthz`, (res) => res.resume()).on('error', () => {});
    }, 9 * 60 * 1000);
  }
});
