/* assets/js/auth.js */

// 检查认证状态
export function checkAuth() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        window.location.href = 'login.html';
    }
}

// 退出登录
export function logout() {
    localStorage.removeItem('auth_token');
    window.location.href = 'login.html';
}