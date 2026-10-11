/**
 * 测试运行器：先起一个 8080 的静态服务，再跑指定的测试脚本，跑完关掉。
 *
 * 为什么需要它：`_test/` 下 20 多个脚本都写死了 `http://127.0.0.1:8080`，
 * 以前必须手动先 `node serve.mjs 8080` 开着。这样就变成了一个隐式的后台依赖 ——
 * 服务挂了测试就全红，而且没人知道是测试坏了还是服务没开。
 *
 * 现在：
 *     node _test/with-server.mjs _test/verify.mjs
 * 服务随本进程生灭，不留后台进程。
 *
 * 用法：
 *     node _test/with-server.mjs <脚本> [脚本参数...]
 *     node _test/with-server.mjs --port 8080 _test/verify.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
let port = 8080;
const pi = argv.indexOf('--port');
if (pi >= 0) { port = Number(argv[pi + 1]); argv.splice(pi, 2); }
if (!argv.length) {
  console.error('用法: node _test/with-server.mjs <脚本> [参数...]');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

/** 端口被占用就复用已存在的服务（比如用户自己开着 serve.mjs） */
const probe = () => new Promise((resolve) => {
  const r = http.get({ host: '127.0.0.1', port, path: '/index.html', timeout: 1500 }, (res) => {
    res.resume();
    resolve(res.statusCode === 200);
  });
  r.on('error', () => resolve(false));
  r.on('timeout', () => { r.destroy(); resolve(false); });
});

let started = false;
if (await probe()) {
  console.log(`[with-server] ${port} 端口已有服务，复用`);
} else {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  started = true;
  console.log(`[with-server] 已启动临时服务 http://127.0.0.1:${port}（随本进程退出关闭）`);
}

const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
const cleanup = () => { if (started) { try { server.close(); } catch (e) { /* ignore */ } } };
child.on('exit', (code, sig) => { cleanup(); process.exit(code ?? (sig ? 1 : 0)); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { child.kill(s); cleanup(); process.exit(130); });
