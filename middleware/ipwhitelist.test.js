/**
 * ipwhitelist.test.js
 * 实验目标：验证「IP 白名单中间件」能否正确判定请求来源 IP 是否在白名单内
 *
 * 被测源码逻辑（middleware/ipWhitelist.js）：
 *   const WHITELIST_IPS = ['127.0.0.1', '::1', '192.168.1.1', '10.0.0.1'];
 *   const isWhitelisted = (ip) => WHITELIST_IPS.includes(ip);
 *   const ipWhitelistMiddleware = (req, res, next) => {
 *       const clientIp = req.ip || req.connection.remoteAddress;
 *       req.isWhitelisted = isWhitelisted(clientIp);
 *       next();
 *   };
 *   module.exports = { ipWhitelistMiddleware, isWhitelisted };
 */
const { ipWhitelistMiddleware, isWhitelisted } = require('./ipWhitelist');

describe('isWhitelisted｜纯函数正例（白名单 IP）', () => {
  const allowed = ['127.0.0.1', '::1', '192.168.1.1', '10.0.0.1'];

  test.each(allowed)('IP %s 应被判定为白名单内（返回 true）', (ip) => {
    expect(isWhitelisted(ip)).toBe(true);
  });
});

describe('isWhitelisted｜纯函数反例（非白名单 IP）', () => {
  const denied = [
    '8.8.8.8',        // 公网 IP
    '1.1.1.1',        // 公网 IP
    '10.0.0.2',       // 同网段但不在清单里
    '192.168.1.2',    // 内网但不在清单里
    '',               // 空串
    null,             // 空值
    undefined,        // 未定义
  ];

  test.each(denied)('IP %s 不应被判定为白名单（返回 false）', (ip) => {
    expect(isWhitelisted(ip)).toBe(false);
  });
});

describe('ipWhitelistMiddleware｜中间件取 IP 与打标', () => {
  test('从 req.ip 获取客户端 IP，白名单 IP -> req.isWhitelisted = true', () => {
    const req = { headers: {}, ip: '10.0.0.1' };
    const res = {};
    const next = jest.fn();

    ipWhitelistMiddleware(req, res, next);

    expect(req.isWhitelisted).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('从 req.connection.remoteAddress 获取 IP（req.ip 缺失时回退）', () => {
    const req = { headers: {}, connection: { remoteAddress: '192.168.1.1' } };
    const res = {};
    const next = jest.fn();

    ipWhitelistMiddleware(req, res, next);

    expect(req.isWhitelisted).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('非白名单 IP（如 8.8.8.8）-> req.isWhitelisted = false，且仍调用 next', () => {
    const req = { headers: {}, ip: '8.8.8.8' };
    const res = {};
    const next = jest.fn();

    ipWhitelistMiddleware(req, res, next);

    expect(req.isWhitelisted).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('ipWhitelistMiddleware｜边界行为观察（源码健壮性，如实记录）', () => {
  // 实测发现：当 req 连 connection 字段都没有时，源码会直接抛 TypeError
  // （req.ip || req.connection.remoteAddress 中 req.connection 为 undefined）。
  // 真实运行中 Express 通常都会带 req.ip / req.connection，此用例仅固化记录该边界。
  test('req 完全没有 ip/connection 时，源码会抛 TypeError', () => {
    const req = {};
    const res = {};
    const next = jest.fn();

    expect(() => ipWhitelistMiddleware(req, res, next)).toThrow(TypeError);
  });
});
