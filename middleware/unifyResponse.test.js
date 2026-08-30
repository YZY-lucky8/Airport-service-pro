/**
 * unifyResponse.test.js
 * 实验目标：验证「统一响应中间件」能否把 429 状态码转换为 403，且不影响其它状态码、保持链式调用
 *
 * 被测源码逻辑（middleware/unifyResponse.js）：
 *   const unifyResponse = (req, res, next) => {
 *       const originalStatus = res.status;
 *       res.status = function (code) {
 *           if (code === 429) { code = 403; }
 *           return originalStatus.call(this, code);
 *       };
 *       next();
 *   };
 *   module.exports = unifyResponse;
 */
const unifyResponse = require('./unifyResponse');

// 构造一个可记录状态码、且支持链式调用的 mock res 对象
const makeRes = () => {
  let statusCode = null;
  const res = {
    status(code) {
      statusCode = code;
      return this; // 链式调用关键：返回自身
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    getStatus() {
      return statusCode;
    },
  };
  return res;
};

describe('unifyResponse｜429 转换规则', () => {
  test('状态码 429 (Too Many Requests) 应被转换为 403 (Forbidden)', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    unifyResponse(req, res, next);

    res.status(429);
    expect(res.getStatus()).toBe(403);
  });

  test('多次调用 res.status(429) 每次都转换为 403', () => {
    const req = {};
    const res = makeRes();
    unifyResponse(req, res, () => {});

    res.status(429);
    res.status(429);
    res.status(429);
    expect(res.getStatus()).toBe(403);
  });
});

describe('unifyResponse｜其它状态码保持原样', () => {
  const keepCodes = [
    200,  // OK
    201,  // Created
    204,  // No Content
    301,  // Moved Permanently
    400,  // Bad Request
    401,  // Unauthorized
    403,  // Forbidden（本身）
    404,  // Not Found
    500,  // Internal Server Error
    502,  // Bad Gateway
    503,  // Service Unavailable
  ];

  test.each(keepCodes)('状态码 %d 应保持原样，不做转换', (code) => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    unifyResponse(req, res, next);

    res.status(code);
    expect(res.getStatus()).toBe(code);
  });
});

describe('unifyResponse｜链式调用支持', () => {
  test('res.status(200).json({...}) 链式调用不报错且状态码正确', () => {
    const req = {};
    const res = makeRes();
    unifyResponse(req, res, () => {});

    const chainResult = res.status(200).json({ ok: true });

    expect(res.getStatus()).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(chainResult).toBe(res);
  });

  test('res.status(429).json({...}) 转换后仍可继续链式调用', () => {
    const req = {};
    const res = makeRes();
    unifyResponse(req, res, () => {});

    const chainResult = res.status(429).json({ msg: 'blocked' });

    expect(res.getStatus()).toBe(403);
    expect(res.body).toEqual({ msg: 'blocked' });
    expect(chainResult).toBe(res);
  });
});

describe('unifyResponse｜next 调用', () => {
  test('中间件执行后必须调用 next() 继续处理链', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    unifyResponse(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
