const CRITICAL_PATHS = [
    '/api/emergency-help',
    '/api/emergency',
    '/api/critical/assistance'
];

// 检查是否是关键请求
const isCriticalRequest = (req) => {
    return CRITICAL_PATHS.some(path => req.path === path || req.path.startsWith(path));
};

// 中间件函数
const bypassForCriticalMiddleware = (req, res, next) => {
    req.criticalBypass = isCriticalRequest(req);
    next();
};

module.exports = bypassForCriticalMiddleware;