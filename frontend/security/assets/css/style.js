/* assets/js/api.js */

// 配置基础 URL (根据你的实际后端地址修改)
const BASE_URL = '/api'; 

/**
 * 核心请求函数
 * 自动携带 Token，自动处理 JSON 解析
 */
async function request(url, options = {}) {
    // 1. 从 localStorage 获取 Token
    const token = localStorage.getItem('authToken');

    // 2. 构建请求头
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    // 如果有 Token，添加到请求头
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // 3. 发起请求
    try {
        const response = await fetch(BASE_URL + url, {
            ...options,
            headers: headers
        });

        // 4. 统一错误处理
        if (response.status === 401) {
            // 如果未授权，跳转回登录页
            window.location.href = 'login.html';
            return;
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        // 5. 返回 JSON 数据
        const data = await response.json();
        return data;

    } catch (error) {
        console.error('请求失败:', error);
        throw error;
    }
}

// --- 具体的 API 接口定义 ---

// 获取攻击日志
async function getAttackLogs(params = {}) {
    // 将参数转换为查询字符串 ?type=attack&page=1
    const queryString = new URLSearchParams(params).toString();
    return await request(`/logs?${queryString}`);
}

// 获取统计数据 (用于 Dashboard)
async function getStats() {
    return await request('/stats');
}

// 模拟值机提交 (如果后端有真实接口，请替换 URL)
async function submitCheckIn(data) {
    // 这里模拟 POST 请求
    return await request('/check-in', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

// 导出给其他文件使用
window.api = {
    getAttackLogs,
    getStats,
    submitCheckIn
};