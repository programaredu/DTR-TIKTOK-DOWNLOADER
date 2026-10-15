fetch("https://TU-SERVIDOR.onrender.com/api")
  .then(res => res.json())
  .then(data => console.log(data));
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP || 'yt-dlp';
const HOSTS = [
  'tiktok.com', 
  'www.tiktok.com', 
  'm.tiktok.com', 
  'vm.tiktok.com', 
  'vt.tiktok.com'];

const SHORT_HOSTS = [
  'tt.site', 
  'www.tt.site'];

function validar(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol))
    return null;
    const h = u.hostname.toLowerCase();
    if (!HOSTS.includes(h) && !SHORT_HOSTS.includes(h)) 
    return null;
    return u.href;
  } catch { return null; }
}
async function resolver(url) {
  let actual = url;
  for (let i = 0; i < 6; i++) {
    const host = new URL(actual).hostname.toLowerCase();
    if (HOSTS.includes(host) && /\/(video|photo)\/\d+/.test(actual)) return actual;
    const r = await fetch(actual, { redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
      signal: AbortSignal.timeout(15000) });
    const loc = r.headers.get('location');
    if (!loc) {
      if (HOSTS.includes(host)) return actual; 
      throw new Error('El enlace corto no redirige a un video de TikTok.');
    }
    const sig = validar(new URL(loc, actual).href);
    if (!sig) throw new Error('El enlace corto redirige fuera de TikTok.');
    actual = sig;
  }
  throw new Error('Demasiadas redirecciones al resolver el enlace.');
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

function ytdlpInfo(url) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, ['--no-warnings', '--no-playlist', '--dump-single-json', '--', url],
      { timeout: 45000, maxBuffer: 20 * 1024 * 1024 }, (err, out, stderr) => {
        if (err) return reject(new Error(err.code === 'ENOENT'
          ? 'yt-dlp no está instalado en el servidor (pip install -U yt-dlp).'
          : (stderr || err.message).trim().split('\n').pop()));
        try {
          const d = JSON.parse(out);
          resolve({ title: d.title || d.description || 'Sin título', user: d.uploader || d.channel || '',
            duration: d.duration || null, thumbnail: d.thumbnail || '', source: 'yt-dlp' });
        } catch { reject(new Error('Respuesta de yt-dlp no válida.')); }
      });
  });
}

async function oembedInfo(url) {
  const r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url));
  if (!r.ok) throw new Error('TikTok no devolvió datos (video privado, eliminado o enlace inválido).');
  const d = await r.json();
  return { title: d.title || 'Sin título', user: d.author_name || '', duration: null,
    thumbnail: d.thumbnail_url || '', source: 'oEmbed' };
}

async function info(url) {
  try { return await ytdlpInfo(url); }
  catch (e) {
    try { return await oembedInfo(url); }
    catch (e2) { throw new Error(e2.message || e.message); }
  }
}

function descargar(url, res, tipo, q) {
  const base = path.join(os.tmpdir(), 'dtr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const comun = ['--no-warnings', '--no-playlist', '-o', base + '.%(ext)s'];
  let args;
  if (tipo === 'audio') {
    args = [...comun, '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  } else if (tipo === 'image') {
    args = [...comun, '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg'];
  } else {
    const h = q === 'best' ? '' : `[height<=${q}]`;
    args = [...comun, '-f', `bv*${h}[ext=mp4]+ba[ext=m4a]/b${h}[ext=mp4]/b${h}/b`,
      '--merge-output-format', 'mp4'];
  }
  const p = spawn(YTDLP, [...args, '--', url]);
  let errTxt = '';
  p.stderr.on('data', d => (errTxt += d));
  p.on('error', e => json(res, 500, { error: e.code === 'ENOENT'
    ? 'yt-dlp no está instalado en el servidor (pip install -U yt-dlp).' : e.message }));
  p.on('close', code => {
    const dir = os.tmpdir(), pre = path.basename(base);
    const f = fs.readdirSync(dir).find(n => n.startsWith(pre));
    if (code !== 0 || !f) {
      return json(res, 502, { error: (errTxt.trim().split('\n').pop() || 'La descarga falló.') });
    }
    const file = path.join(dir, f), size = fs.statSync(file).size;
    const ext = path.extname(f).slice(1).toLowerCase();
    const tipos = { mp4: 'video/mp4', mp3: 'audio/mpeg', jpg: 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': tipos[ext] || 'application/octet-stream', 'Content-Length': size,
      'Content-Disposition': 'attachment; filename="tiktok.' + ext + '"' });
    const s = fs.createReadStream(file);
    s.pipe(res);
    const limpiar = () => fs.unlink(file, () => {});
    s.on('close', limpiar); res.on('close', limpiar);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return fs.createReadStream(path.join(__dirname, 'index.html'))
      .on('error', () => json(res, 404, { error: 'index.html no encontrado' }))
      .once('open', () => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }))
      .pipe(res);
  }
  if (u.pathname === '/style.css') {
    return fs.createReadStream(path.join(__dirname, 'style.css'))
      .on('error', () => json(res, 404, { error: 'style.css no encontrado' }))
      .once('open', () => res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }))
      .pipe(res);
  }
  if (u.pathname === '/api/health') {
    return execFile(YTDLP, ['--version'], (err, out) =>
      json(res, 200, { ok: true, ytdlp: err ? null : out.trim() }));
  }
  if (u.pathname === '/api/info' || u.pathname === '/api/download') {
    const entrada = validar(u.searchParams.get('url') || '');
    if (!entrada) return json(res, 400, { error: 'El enlace no pertenece a TikTok.' });
    return resolver(entrada).then(url => {
      if (u.pathname === '/api/info')
        return info(url).then(d => json(res, 200, d));
      const tipo = ['video', 'audio', 'image'].includes(u.searchParams.get('type')) ? u.searchParams.get('type') : 'video';
      const q = ['best', '1080', '720', '480'].includes(u.searchParams.get('q')) ? u.searchParams.get('q') : 'best';
      return descargar(url, res, tipo, q);
    }).catch(e => json(res, 502, { error: e.message }));
  }
  json(res, 404, { error: 'No encontrado' });
});

function iniciar(puerto, intentos = 0) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && intentos < 10) {
      console.log('Puerto ' + puerto + ' ocupado, probando ' + (puerto + 1) + '…');
      return iniciar(puerto + 1, intentos + 1);
    }
    throw e;
  });
  server.listen(puerto, () => console.log('DTR SYSTEM listo en http://localhost:' + puerto));
}
iniciar(Number(PORT));
