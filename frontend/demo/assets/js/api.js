/**
 * API 统一入口 —— mock/真实一键切换
 * USE_MOCK = true  ：走 mock 数据层（D1-D3 开发阶段）
 * USE_MOCK = false ：请求后端真实接口（D4 联调时切换）
 * 页面代码只调 apiGet / apiPost / doLogin / logout，不感知 mock/真实。
 */
const USE_MOCK = false;
const TOKEN_KEY = 'demo_token';   // 独立 token key，避免与现有管理端 admin_token 冲突

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

/* 真实请求：GET，自动带 Bearer token，401 清 token 回登录 */
async function realApiGet(endpoint) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const response = await fetch(endpoint, { headers });
    if (response.status === 401) {
        clearToken();
        location.hash = '#/login';
        throw new Error('未登录或登录已过期');
    }
    return response.json();
}

/* 真实请求：POST */
async function realApiPost(endpoint, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (response.status === 401) {
        clearToken();
        location.hash = '#/login';
        throw new Error('未登录或登录已过期');
    }
    return response.json();
}

/* 统一 GET 入口 */
async function apiGet(endpoint) {
    if (USE_MOCK) return mockResolve(endpoint);
    return realApiGet(endpoint);
}

/* 统一 POST 入口 */
async function apiPost(endpoint, body) {
    if (USE_MOCK) return { success: true, data: body };
    return realApiPost(endpoint, body);
}

/* 登录：mock 模式直接返回假 token */
async function doLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    if (!username || !password) {
        errEl.textContent = '请输入用户名和密码';
        errEl.style.display = 'block';
        return;
    }
    let json;
    if (USE_MOCK) {
        json = { success: true, token: 'mock-token-' + Date.now() };
    } else {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        json = await res.json();
    }
    if (json.success && json.token) {
        setToken(json.token);
        location.hash = '#/panel';
    } else {
        errEl.textContent = json.message || '登录失败，请检查账号密码';
        errEl.style.display = 'block';
    }
}

/* 退出登录 */
function logout() {
    clearToken();
    location.hash = '#/login';
}
