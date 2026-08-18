/**
 * ============================================================
 * JWT 认证中间件（纯 Node.js 实现，零外部依赖）
 * ============================================================
 *
 * 使用 HMAC-SHA256 签名，Base64Url 编码
 * 支持：管理员登录 → 获取 Token → 受保护 API 鉴权
 *
 *   默认管理员账号由环境变量 ADMIN_PASSWORD 配置，部署时注入
 */

const crypto = require('crypto');

// ── 配置 ──
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update('Airport-service-pro-jwt-secret-change-me-in-production').digest('hex');
const JWT_EXPIRY_SECONDS = parseInt(process.env.JWT_EXPIRY) || 300; // 默认 300 秒
const VALID_ADMIN_USERS = new Map();
VALID_ADMIN_USERS.set('admin', process.env.ADMIN_PASSWORD || 'admin');
// 默认管理员，应尽快修改

// ── Base64Url 工具 ──
function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

// ── JWT 核心 ──
function sign(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
  }));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;

    // 验证签名
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    // 恒定时间比较
    if (signature.length !== expected.length) return null;
    const sigMatch = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
    if (!sigMatch) return null;

    // 解析 payload
    const payload = JSON.parse(base64UrlDecode(body));

    // 检查过期
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ── 密码哈希（简单但安全的哈希） ──
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

// 存储用户密码哈希
const userHashes = new Map();
for (const [username, password] of VALID_ADMIN_USERS) {
  userHashes.set(username, hashPassword(password));
}

// ── 登录验证 ──
function authenticateUser(username, password) {
  const storedHash = userHashes.get(username);
  if (!storedHash || !verifyPassword(password, storedHash)) {
    return null;
  }
  return { username, role: 'admin' };
}
// ── 登录失败锁定（5次失败锁60秒） ──
const failMap = new Map();
const MAX_FAIL = 5, LOCK_MS = 60000;
function checkLock(ip) {
  const r = failMap.get(ip);
  if (!r) return false;
  if (Date.now() - r.ts > LOCK_MS) { failMap.delete(ip); return false; }
  return r.count >= MAX_FAIL;
}
function recordFail(ip) {
  const r = failMap.get(ip) || { count: 0, ts: Date.now() };
  r.count += 1; r.ts = Date.now(); failMap.set(ip, r);
}
function resetFail(ip) { failMap.delete(ip); }

// ── 添加/修改管理员 ──
function addAdminUser(username, password) {
  userHashes.set(username, hashPassword(password));
  VALID_ADMIN_USERS.set(username, password);
  return true;
}

function removeAdminUser(username) {
  userHashes.delete(username);
  VALID_ADMIN_USERS.delete(username);
  return true;
}

// ── Express 中间件 ──
function authMiddleware(req, res, next) {
  // 从多个位置提取 token
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'];
  } else if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: '需要管理员登录' });
  }

  const decoded = verify(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'TOKEN_EXPIRED', message: '登录已过期，请重新登录' });
  }

  req.user = decoded;
  req.adminToken = token;
  next();
}

// ── 可选认证（有 token 就设 user，没有也不拦） ──
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'];
  } else if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  if (token) {
    const decoded = verify(token);
    if (decoded) {
      req.user = decoded;
      req.adminToken = token;
    }
  }

  next();
}

// ── 管理员列表 ──
function getAdminList() {
  return Array.from(VALID_ADMIN_USERS.keys());
}

module.exports = {
  sign,
  verify,
  authenticateUser,
  addAdminUser,
  removeAdminUser,
  authMiddleware,
  optionalAuth,
  getAdminList,
  hashPassword,
  JWT_SECRET,
  checkLock,
  recordFail,
  resetFail,

};
