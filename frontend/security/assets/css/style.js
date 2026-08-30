/* assets/js/api.js */

// 配置基础 URL (根据实际后端地址修改)
const BASE_URL = '/api';

/**
 * 核心请求函数
 * 自动携带 Token，自动处理 JSON 解析，包含超时控制
 */
async function request(url, options = {}) {
    const token = localStorage.getItem('authToken');

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // 超时控制：10 秒
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(BASE_URL + url, {
            ...options,
            headers,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 401 未授权：清除 Token 并跳转登录页
        if (response.status === 401) {
            localStorage.removeItem('authToken');
            window.location.href = 'login.html';
            return;
        }

        // 处理非成功状态码，尝试提取错误信息
        if (!response.ok) {
            let errorMsg = `请求失败 (${response.status})`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errData.error || JSON.stringify(errData);
            } catch {
                errorMsg = response.statusText || errorMsg;
            }
            throw new Error(errorMsg);
        }

        // 处理空响应（如 204 No Content）
        if (response.status === 204) {
            return null;
        }

        // 根据 Content-Type 决定如何解析
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        return await response.text();

    } catch (error) {
        clearTimeout(timeoutId);
        // 超时错误特殊处理
        if (error.name === 'AbortError') {
            throw new Error('请求超时，请稍后重试');
        }
        // 网络错误友好提示
        if (error.message === 'Failed to fetch') {
            throw new Error('网络连接失败，请检查网络');
        }
        throw error;
    }
}

// --- 具体的 API 接口定义 ---

// 获取攻击日志（过滤无效查询参数）
async function getAttackLogs(params = {}) {
    const filtered = Object.entries(params).reduce((acc, [key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
            acc[key] = val;
        }
        return acc;
    }, {});
    const queryString = new URLSearchParams(filtered).toString();
    const url = queryString ? `/logs?${queryString}` : '/logs';
    return await request(url);
}

// 获取统计数据
async function getStats() {
    return await request('/stats');
}

// 模拟值机提交
async function submitCheckIn(data) {
    return await request('/check-in', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

// 导出（使用命名空间避免覆盖）
window.api = {
    getAttackLogs,
    getStats,
    submitCheckIn
};