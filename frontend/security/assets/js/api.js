/* assets/js/api.js */

// 修改 1: 基础地址改为文档提供的地址
const API_BASE = 'http://81.70.228.232:3000'; 

/**
 * 通用请求函数
 * 根据文档，目前不需要 Token 验证（文档未提及），所以去掉了 Authorization
 */
async function request(url, options = {}) {
    // 文档未要求 Token，故移除相关逻辑
    const config = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    try {
        // 拼接基础地址和接口路径
        const response = await fetch(API_BASE + url, config);
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('请求失败:', error);
        throw error;
    }
}

// 修改 2: 对应文档中的三个接口

// 1. 记录操作日志 (POST /api/log)
export function logAction(data) {
    return request('/api/log', {
        method: 'POST',
        body: JSON.stringify({
            module: data.module,     // 模块名
            level: data.level || 'info', // 日志级别
            message: data.message    // 日志内容
        })
    });
}

// 2. 获取客流量统计数据 (GET /api/stats)
export function getStats() {
    return request('/api/stats');
}

// 3. 获取攻击日志 (GET /api/logs?type=attack)
export function getAttackLogs() {
    // 文档指定了 type=attack 参数
    return request('/api/logs?type=attack'); 
}

// 导出给 window 使用（保持原有调用方式兼容）
window.api = {
    logAction,
    getStats,
    getAttackLogs
};