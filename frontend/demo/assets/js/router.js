/**
 * Hash 路由 —— 原生实现，无依赖
 * 路由守卫：需登录页面无 token 时跳 #/login；已登录访问 #/login 时跳 #/panel
 */
const routes = {
    '#/login':    { auth: false, render: renderLogin },
    '#/panel':    { auth: true,  render: loadPanel },
    '#/overview': { auth: true,  render: loadOverview },
    '#/trace':    { auth: true,  render: loadTrace }
};

function renderLogin() { /* 登录视图由 HTML 静态承载，无需额外渲染 */ }

function handleRoute() {
    const hash = location.hash || '#/login';
    const route = routes[hash] || routes['#/login'];

    if (route.auth && !getToken()) {
        location.hash = '#/login';
        return;
    }
    if (!route.auth && getToken() && hash === '#/login') {
        location.hash = '#/panel';
        return;
    }

    document.getElementById('view-login').style.display = route.auth ? 'none' : 'block';
    document.getElementById('view-main').style.display  = route.auth ? 'block' : 'none';

    // 导航高亮
    document.querySelectorAll('.nav-links a').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === hash);
    });

    route.render();
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', handleRoute);
