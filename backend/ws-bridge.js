// ws-bridge.js —— WebSocket 事件推送桥（独立模块，避免循环依赖）
let wss = null;

function setWss(instance) {
  wss = instance;
}

function pushSecurityEvent(event) {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(event));
    }
  });
}

module.exports = { setWss, pushSecurityEvent };
