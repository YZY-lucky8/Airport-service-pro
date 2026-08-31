/* ============================================================
 * 恒盾智航 SOC · Hash 路由 + 登录守卫 + 导航高亮
 * 路由表：
 *   #/cockpit   安全态势总览
 *   #/trust     会话信任监控
 *   #/audit     PEP 授权审计
 *   #/pollution 污染溯源中心
 *   #/policy    自适应策略
 *   #/alerts    告警处理中心
 *   #/system    系统管理
 * ============================================================ */
'use strict';

window.SOC = window.SOC || {};
(function () {
  const ROUTES = [
    { path: '#/cockpit', title: '安全态势总览', page: 'cockpit' },
    { path: '#/trust', title: '会话信任监控', page: 'trust' },
    { path: '#/audit', title: 'PEP 授权审计', page: 'audit' },
    { path: '#/pollution', title: '污染溯源中心', page: 'pollution' },
    { path: '#/policy', title: '自适应策略', page: 'policy' },
    { path: '#/alerts', title: '告警处理中心', page: 'alerts' },
    { path: '#/system', title: '系统管理', page: 'system' },
  ];

  function currentRoute() {
    const h = location.hash || '#/cockpit';
    return ROUTES.find(r => h === r.path) || ROUTES[0];
  }

  function isAuthed() { return !!SOC.api.getToken(); }

  function showLogin() {
    document.getElementById('view-login').style.display = 'flex';
    document.getElementById('view-main').style.display = 'none';
  }
  function showMain() {
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-main').style.display = 'flex';
  }

  function gotoLogin() {
    clearInterval(window.__socClockTimer);
    showLogin();
    location.hash = '#/login';
  }

  function render() {
    const route = currentRoute();
    if (route.path === '#/login' || !isAuthed()) { showLogin(); return; }
    showMain();
    // 导航高亮
    document.querySelectorAll('#side-nav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === route.path);
    });
    document.getElementById('topbar-title').textContent = route.title;
    const user = SOC.api.getUser();
    document.getElementById('topbar-user').textContent = (user && user.username) || 'admin';
    const container = document.getElementById('page-container');
    container.innerHTML = '';
    const page = SOC.pages && SOC.pages[route.page];
    if (page && typeof page.render === 'function') {
      page.render(container);
      if (typeof page.onShow === 'function') page.onShow(container);
    } else {
      container.innerHTML = `<div class="empty">页面模块未加载：${route.page}</div>`;
    }
  }

  function init() {
    window.addEventListener('hashchange', render);
    // 初始登录检查
    if (isAuthed()) render(); else gotoLogin();
  }

  SOC.router = { ROUTES, currentRoute, render, init, gotoLogin, isAuthed };
})();
