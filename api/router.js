// bird2vec pak API router — mounted at /api/bird2vec by tetra pak-loader.
//
// Purpose: server-side proxy to xeno-canto.org so the browser iframe
// doesn't get rate-limited / Cloudflare-challenged, and the API key
// stays off the page.
//
// Key resolution order:
//   1. process.env.XENO_CANTO_API_KEY
//   2. $TETRA_DIR/bird2vec/keys.toml   →  [xeno_canto] key = "..."
//   3. 401 with a helpful message
//
// Endpoints:
//   GET /api/bird2vec/health           → { ok, hasKey, source }
//   GET /api/bird2vec/search?q=&page=  → XC v3 /recordings JSON
//   GET /api/bird2vec/fetch?url=       → streams audio bytes (allowlisted host)

import fs from 'fs';
import path from 'path';
import os from 'os';

const XC_API = 'https://xeno-canto.org/api/3/recordings';
const UA = 'tetra-bird2vec/0.1 (+https://github.com/mricos/bird2vec)';
const ALLOWED_FETCH_HOSTS = new Set(['xeno-canto.org', 'www.xeno-canto.org']);

function tetraDir() {
    return process.env.TETRA_DIR || path.join(os.homedir(), 'tetra');
}

// Minimal TOML key reader — only handles  [section]\n key = "value"
// pattern we actually write. Avoids pulling a toml dep into the pak.
function readKeyFromToml(file, section, field) {
    if (!fs.existsSync(file)) return null;
    const txt = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`\\[${section}\\][^\\[]*?${field}\\s*=\\s*"([^"]+)"`, 'i');
    const m = txt.match(re);
    return m ? m[1] : null;
}

function resolveKey() {
    if (process.env.XENO_CANTO_API_KEY) {
        return { key: process.env.XENO_CANTO_API_KEY, source: 'env' };
    }
    const tomlPath = path.join(tetraDir(), 'bird2vec', 'keys.toml');
    const key = readKeyFromToml(tomlPath, 'xeno_canto', 'key');
    if (key) return { key, source: tomlPath };
    return { key: null, source: null };
}

export async function createRouter(deps) {
    const { express } = deps;
    if (!express) throw new Error('bird2vec router requires express dep');
    const router = express.Router();

    router.get('/health', (_req, res) => {
        const { key, source } = resolveKey();
        res.json({
            ok: true,
            hasKey: Boolean(key),
            source: key ? source : null,
            hint: key ? null : 'Set XENO_CANTO_API_KEY env var, or write [xeno_canto] key="…" into $TETRA_DIR/bird2vec/keys.toml',
        });
    });

    router.get('/search', async (req, res) => {
        const { key, source } = resolveKey();
        if (!key) {
            return res.status(401).json({
                error: 'no_xc_key',
                hint: 'Set XENO_CANTO_API_KEY or write [xeno_canto] key="…" to $TETRA_DIR/bird2vec/keys.toml',
            });
        }
        const q = String(req.query.q || '').trim();
        if (!q) return res.status(400).json({ error: 'missing q' });
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page) || 20));
        const url = `${XC_API}?query=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}&page=${page}&per_page=${perPage}`;
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': UA, 'Accept': 'application/json' },
                redirect: 'follow',
            });
            const ct = r.headers.get('content-type') || '';
            if (!r.ok) {
                const body = await r.text();
                return res.status(r.status).json({
                    error: 'upstream',
                    status: r.status,
                    contentType: ct,
                    body: body.slice(0, 500),
                });
            }
            if (!ct.includes('json')) {
                const body = await r.text();
                return res.status(502).json({
                    error: 'upstream_not_json',
                    hint: 'Cloudflare challenge or HTML error — key may be invalid',
                    contentType: ct,
                    body: body.slice(0, 500),
                });
            }
            const json = await r.json();
            res.json({ ...json, _proxied: { source } });
        } catch (e) {
            res.status(502).json({ error: 'fetch_failed', message: e.message });
        }
    });

    router.get('/fetch', async (req, res) => {
        const raw = String(req.query.url || '');
        if (!raw) return res.status(400).json({ error: 'missing url' });
        let u;
        try { u = new URL(raw); } catch { return res.status(400).json({ error: 'bad url' }); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
            return res.status(400).json({ error: 'protocol not allowed' });
        }
        if (!ALLOWED_FETCH_HOSTS.has(u.hostname)) {
            return res.status(403).json({ error: 'host not allowed', host: u.hostname });
        }
        try {
            const r = await fetch(u.toString(), {
                headers: { 'User-Agent': UA, 'Accept': 'audio/*,*/*' },
                redirect: 'follow',
            });
            if (!r.ok) return res.status(r.status).json({ error: 'upstream', status: r.status });
            const ct = r.headers.get('content-type') || 'application/octet-stream';
            res.setHeader('content-type', ct);
            const cl = r.headers.get('content-length');
            if (cl) res.setHeader('content-length', cl);
            // Stream the body through. Node fetch returns a web ReadableStream;
            // Readable.fromWeb adapts to node stream for pipe().
            const { Readable } = await import('stream');
            Readable.fromWeb(r.body).pipe(res);
        } catch (e) {
            res.status(502).json({ error: 'fetch_failed', message: e.message });
        }
    });

    return router;
}
