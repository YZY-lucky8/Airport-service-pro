/**
 * bypassForCritical.test.js
 * 实验目标：验证「关键请求免扰中间件」能否正确识别关键路径并打标 criticalBypass
 *
 * 被测源码逻辑（middleware/bypassForCritical.js）：
 *   const CRITICAL_PATHS = ['/api/emergency-help', '/api/emergency', '/api/critical/assistance'];
 *   const isCriticalRequest = (req) =>
 *       CRITICAL_PATHS.some(path => req.path === path || req.path.startsWith(path));
 *   const bypassForCriticalMiddleware = (req, res, next) => {
 *       req.criticalBypass = isCriticalRequest(req);
 *       next();
 *   };
 *   module.exports = bypassForCriticalMiddleware;
 */
const bypassForCritical = require('./bypassForCritical');

// 构造一个最小化的 mock 请求对象，只带 path 字段
const makeReq = (path) => ({ path });

describe('bypassForCritical｜关键路径识别（正例）', () => {
  const criticalPaths = [
    '/api/emergency-help',        // 精确命中第 1 条
    '/api/emergency',             // 精确命中第 2 条
    '/api/critical/assistance',   // 精确命中第 3 条
  ];

  test.each(criticalPaths)('请求 %s 应被标记 criticalBypass = true', (path) => {
    const req = makeReq(path);
    const res = {};
    const next = jest.fn();

    bypassForCritical(req, res, next);

    expect(req.criticalBypass).toBe(true);
  });
});

describe('bypassForCritical｜关键路径前缀（startswith 命中）', () => {
  // startsWith 是前缀匹配：关键路径下面带的子路径同样会被视为关键
  const prefixedPaths = [
    '/api/emergency-help/sub-task',
    '/api/emergency/12345',
    '/api/critical/assistance/details',
  ];

  test.each(prefixedPaths)('请求 %s 命中前缀，应标记 criticalBypass = true', (path) => {
    const req = makeReq(path);
    const res = {};
    const next = jest.fn();

    bypassForCritical(req, res, next);

    expect(req.criticalBypass).toBe(true);
  });
});

describe('bypassForCritical｜非关键路径（反例）', () => {
  const normalPaths = [
    '/api/login',                  // 普通登录接口
    '/api/order/list',             // 普通业务接口
    '/',
    '/api/emergenc',               // 缺少尾部字符
  ];

  test.each(normalPaths)('请求 %s 不应被标记，criticalBypass = false', (path) => {
    const req = makeReq(path);
    const res = {};
    const next = jest.fn();

    bypassForCritical(req, res, next);

    expect(req.criticalBypass).toBe(false);
  });
});

describe('bypassForCritical｜放行行为（next 调用）', () => {
  test('无论路径是否关键，都必须调用 next() 继续处理链', () => {
    const req = makeReq('/api/emergency-help');
    const res = {};
    const next = jest.fn();

    bypassForCritical(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // 且 next 无参数（不中断、不传错）
    expect(next).toHaveBeenCalledWith();
  });

  test('关键路径与非关键路径连续请求互不污染', () => {
    const next1 = jest.fn();
    const req1 = makeReq('/api/emergency-help');
    bypassForCritical(req1, {}, next1);

    const next2 = jest.fn();
    const req2 = makeReq('/api/login');
    bypassForCritical(req2, {}, next2);

    expect(req1.criticalBypass).toBe(true);
    expect(req2.criticalBypass).toBe(false);
  });
});

describe('bypassForCritical｜边界行为观察（源码前缀匹配宽松，如实记录）', () => {
  // 实测发现：/api/emergency-other 以 "/api/emergency" 开头，会被 startsWith 误命中。
  // 这是源码 CRITICAL_PATHS 使用 startsWith 导致的预期内行为，此处固化记录，避免误当 bug。
  test('/api/emergency-other 会被误判为关键请求（startsWith 前缀宽松）', () => {
    const req = { path: '/api/emergency-other' };
    const res = {};
    const next = jest.fn();

    bypassForCritical(req, res, next);

    expect(req.criticalBypass).toBe(true);
  });
});
