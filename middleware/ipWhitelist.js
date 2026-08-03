const WHITELIST_IPS = [
    '127.0.0.1',
    '::1',
    '192.168.1.1',
    '10.0.0.1'
];

const isWhitelisted = (ip) => {
    return WHITELIST_IPS.includes(ip);
};

const ipWhitelistMiddleware = (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    req.isWhitelisted = isWhitelisted(clientIp);
    next();
};

module.exports = { ipWhitelistMiddleware, isWhitelisted };