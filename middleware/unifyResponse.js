const unifyResponse = (req, res, next) => {
    // 保存原始的 status 方法
    const originalStatus = res.status;
    
    // 重写 status 方法
    res.status = function(code) {
        // 将 429 (Too Many Requests) 转换为 403 (Forbidden)
        if (code === 429) {
            code = 403;
        }
        return originalStatus.call(this, code);
    };
    
    next();
};

module.exports = unifyResponse;