/* ============================================================
 * 恒盾智航 SOC · 应用入口
 * 登录 / 退出 / 时钟 / 侧边栏服务状态轮询
 * ============================================================ */
'use strict';

window.SOC = window.SOC || {};
(function () {
  const { $, api } = SOC;

  function updateClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    document.getElementById('topbar-clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // 登录
  async function doLogin() {
    const username = $('#username').value.trim();
    const password = $('#password').value;
    const errBox = $('#login-error');
    if (!username || !password) {
      errBox.style.display = 'block'; errBox.textContent = '请输入用户名和密码';
      return;
    }
    errBox.style.display = 'none';
    const btn = $('#btn-login');
    btn.disabled = true; btn.textContent = '登录中…';
    const res = await api.apiPost('/api/auth/login', { username, password });
    btn.disabled = false; btn.textContent = '登 录';
    if (res.ok && res.data && res.data.token) {
      api.setAuth(res.data.token, { username: res.data.username || username, role: res.data.role || 'admin' });
      SOC.ui.toast('登录成功', 'success');
      location.hash = '#/cockpit';
      SOC.router.render();
    } else {
      errBox.style.display = 'block';
      errBox.textContent = res.msg || '登录失败，请检查账号密码';
    }
  }

  // 退出
  function doLogout() {
    // 尝试调用后端登出（失败也继续）
    api.apiPost('/api/auth/logout', {}).catch(() => {});
    api.clearAuth();
    SOC.router.gotoLogin();
  }

  // 侧边栏健康状态轮询
  async function pollHealth() {
    const dot = $('#side-status-dot');
    const txt = $('#side-status-text');
    const res = await api.apiGet('/api/health');
    if (res.ok && res.data && res.data.status === 'ok') {
      dot.className = 'side-status-dot on';
      txt.textContent = '后端运行正常';
    } else {
      dot.className = 'side-status-dot warn';
      txt.textContent = '后端服务异常';
    }
  }

  function init() {
    $('#btn-login').addEventListener('click', doLogin);
    $('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('#btn-logout').addEventListener('click', doLogout);
    window.__socClockTimer = setInterval(updateClock, 1000);
    updateClock();
    setInterval(pollHealth, 15000);
    SOC.router.init();
  }

  // 页面就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
