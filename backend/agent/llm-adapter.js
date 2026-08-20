/**
 * ============================================================
 * 可插拔 LLM 适配器 (Pluggable LLM Adapter)
 * 支持运行时动态切换不同的 LLM 后端
 * ============================================================
 *
 * 支持的 LLM 后端：
 * - rule_engine: 基于规则的本地引擎（默认，零依赖）
 * - openai: OpenAI API (GPT-4o, GPT-3.5-turbo)
 * - vllm: 本地 vLLM 部署（Qwen, Llama 等）
 * - dashscope: 阿里云通义千问
 * - custom: 自定义兼容 OpenAI 格式的 API
 *
 * 切换方式：dispatcher.switchLLM(provider, config)
 */

class RuleEngineLLM {
  /** 基于规则的本地 LLM（零外部依赖） */
  constructor() {
    this.name = 'rule_engine';
    this.status = 'ready';
    this.latencyAvg = 0;
    this.callCount = 0;
  }

  async chat(messages, options = {}) {
    const start = Date.now();
    this.callCount++;

    // 提取最后一个用户消息
    const userMsg = messages.filter(m => m.role === 'user').pop();
    const systemMsg = messages.find(m => m.role === 'system');
    const prompt = userMsg ? userMsg.content : '';
    const systemHint = systemMsg ? systemMsg.content : '';

    // 规则匹配回复
    const reply = this._ruleMatch(prompt, systemHint);
    const latency = Date.now() - start;
    this._updateLatency(latency);

    return { content: reply, latency };
  }

  _ruleMatch(prompt, systemHint) {
    const p = prompt.toLowerCase();

    // 情感识别
    if (p.includes('焦虑') || p.includes('着急') || p.includes('慌') || p.includes('急')) {
      return '我理解您的焦急，请先别担心。请告诉我您的航班号，我来帮您处理。';
    }
    if (p.includes('愤怒') || p.includes('生气') || p.includes('投诉')) {
      return '非常抱歉给您带来不好的体验。我立即帮您记录并转接人工服务，同时请告诉我具体问题，我先尽力帮您解决。';
    }
    if (p.includes('开心') || p.includes('高兴') || p.includes('谢谢')) {
      return '不客气！很高兴能帮到您，祝您旅途愉快！';
    }

    // 航班相关
    if (p.includes('航班') || p.includes('飞机') || p.includes('起飞') || p.includes('延误')) {
      const match = prompt.match(/(CA|MU|CZ|3U|ZH)[A-Z0-9]{3,4}/);
      if (match) {
        return `您查询的${match[0]}航班，我正在为您获取最新状态...`;
      }
      return '请告诉我您的航班号，我来帮您查询航班状态。';
    }

    // 导航相关
    if (p.includes('登机口') || p.includes('去哪') || p.includes('怎么走')) {
      return '请告诉我您的航班号或目的地，我来为您导航。';
    }

    // 行李
    if (p.includes('行李') || p.includes('托运') || p.includes('超重')) {
      return '国内航班经济舱免费托运行李额度为 20kg。如需办理托运，请点击屏幕上的"在线值机·选座"按钮，或告诉我您的航班号。';
    }

    // 值机选座
    if (p.includes('值机') || p.includes('选座') || p.includes('座位')) {
      return '请点击屏幕上的"在线值机·选座"按钮办理值机和选座。';
    }

    // 餐饮购物
    if (p.includes('吃饭') || p.includes('餐厅') || p.includes('买')) {
      return '机场内有多个餐饮和购物选择。请告诉我您的偏好（中餐/西餐/咖啡/免税品），我来为您推荐。';
    }

    // 默认
    return '抱歉，我暂时没能理解您的问题。请换个方式问我，或点击屏幕上的功能按钮。';
  }

  _updateLatency(latency) {
    this.latencyAvg = (this.latencyAvg * (this.callCount - 1) + latency) / this.callCount;
  }

  getStats() {
    return {
      name: this.name,
      status: this.status,
      callCount: this.callCount,
      avgLatency: Math.round(this.latencyAvg),
    };
  }
}

class OpenAILLM {
  /** OpenAI API 适配器 */
  constructor(config = {}) {
    this.name = 'openai';
    this.status = config.apiKey ? 'ready' : 'config_needed';
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4o-mini';
    this.timeout = config.timeout || 30000;
    this.callCount = 0;
    this.latencyAvg = 0;
  }

  async chat(messages, options = {}) {
    if (!this.apiKey) {
      return { content: '⚠️ OpenAI API 未配置，请先设置 API Key', latency: 0 };
    }

    const start = Date.now();
    this.callCount++;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 512,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '未能获取回复';
      const latency = Date.now() - start;
      this._updateLatency(latency);
      return { content, latency };
    } catch (e) {
      return { content: `OpenAI 调用失败: ${e.message}`, latency: 0 };
    }
  }

  _updateLatency(latency) {
    this.latencyAvg = (this.latencyAvg * (this.callCount - 1) + latency) / this.callCount;
  }

  getStats() {
    return {
      name: this.name,
      model: this.model,
      status: this.status,
      callCount: this.callCount,
      avgLatency: Math.round(this.latencyAvg),
    };
  }
}

class VLLMLLM {
  /** 本地 vLLM 部署适配器（兼容 OpenAI 格式） */
  constructor(config = {}) {
    this.name = 'vllm';
    this.status = config.baseUrl ? 'ready' : 'config_needed';
    this.baseUrl = config.baseUrl || 'http://localhost:8000/v1';
    this.model = config.model || 'Qwen/Qwen2.5-7B';
    this.timeout = config.timeout || 60000;
    this.callCount = 0;
    this.latencyAvg = 0;
  }

  async chat(messages, options = {}) {
    if (!this.baseUrl) {
      return { content: '⚠️ vLLM 服务未配置', latency: 0 };
    }

    const start = Date.now();
    this.callCount++;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 512,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '未能获取回复';
      const latency = Date.now() - start;
      this._updateLatency(latency);
      return { content, latency };
    } catch (e) {
      return { content: `vLLM 调用失败: ${e.message}`, latency: 0 };
    }
  }

  _updateLatency(latency) {
    this.latencyAvg = (this.latencyAvg * (this.callCount - 1) + latency) / this.callCount;
  }

  getStats() {
    return {
      name: this.name,
      model: this.model,
      status: this.status,
      callCount: this.callCount,
      avgLatency: Math.round(this.latencyAvg),
    };
  }
}

class DashScopeLLM {
  /** 阿里云通义千问适配器 */
  constructor(config = {}) {
    this.name = 'dashscope';
    this.status = config.apiKey ? 'ready' : 'config_needed';
    this.apiKey = config.apiKey;
    this.model = config.model || 'qwen-turbo';
    this.timeout = config.timeout || 30000;
    this.callCount = 0;
    this.latencyAvg = 0;
  }

  async chat(messages, options = {}) {
    if (!this.apiKey) {
      return { content: '⚠️ DashScope API 未配置，请先设置 API Key', latency: 0 };
    }

    const start = Date.now();
    this.callCount++;

    try {
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 512,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '未能获取回复';
      const latency = Date.now() - start;
      this._updateLatency(latency);
      return { content, latency };
    } catch (e) {
      return { content: `DashScope 调用失败: ${e.message}`, latency: 0 };
    }
  }

  _updateLatency(latency) {
    this.latencyAvg = (this.latencyAvg * (this.callCount - 1) + latency) / this.callCount;
  }

  getStats() {
    return {
      name: this.name,
      model: this.model,
      status: this.status,
      callCount: this.callCount,
      avgLatency: Math.round(this.latencyAvg),
    };
  }
}

/**
 * LLM 管理器 - 统一入口，支持运行时切换
 */
class LLMManager {
  constructor() {
    // 默认使用规则引擎
    this.providers = {
      rule_engine: new RuleEngineLLM(),
    };
    this.currentProvider = 'rule_engine';
    this.providerConfigs = {};
    this.fallbackChain = ['rule_engine']; // 失败时的回退链
  }

  /** 注册新的 LLM 提供者 */
  register(providerName, config = {}) {
    switch (providerName) {
      case 'openai':
        this.providers[providerName] = new OpenAILLM(config);
        break;
      case 'vllm':
        this.providers[providerName] = new VLLMLLM(config);
        break;
      case 'dashscope':
        this.providers[providerName] = new DashScopeLLM(config);
        break;
      default:
        throw new Error(`不支持的 LLM 提供者: ${providerName}`);
    }
    this.providerConfigs[providerName] = config;
    return { success: true, provider: providerName, status: this.providers[providerName].status };
  }

  /** 切换当前使用的 LLM */
  switchProvider(providerName) {
    if (!this.providers[providerName]) {
      return { success: false, error: `提供者 ${providerName} 未注册` };
    }
    this.currentProvider = providerName;
    return {
      success: true,
      provider: providerName,
      status: this.providers[providerName].status,
    };
  }

  /** 使用指定 LLM 进行对话（带回退） */
  async chat(messages, options = {}) {
    // 先尝试当前提供者
    const current = this.providers[this.currentProvider];
    if (current) {
      const result = await current.chat(messages, options);
      // 如果失败，尝试回退链
      if (result.content.includes('失败') || result.content.includes('未配置')) {
        for (const fallback of this.fallbackChain) {
          if (fallback !== this.currentProvider && this.providers[fallback]) {
            const fallbackResult = await this.providers[fallback].chat(messages, options);
            if (!fallbackResult.content.includes('失败') && !fallbackResult.content.includes('未配置')) {
              return fallbackResult;
            }
          }
        }
      }
      return result;
    }
    return { content: 'LLM 服务不可用', latency: 0 };
  }

  /** 获取所有提供者统计 */
  getAllStats() {
    const stats = {};
    for (const [name, provider] of Object.entries(this.providers)) {
      stats[name] = {
        ...provider.getStats(),
        isCurrent: name === this.currentProvider,
      };
    }
    return stats;
  }

  /** 获取当前提供者名称 */
  getCurrentProvider() {
    return this.currentProvider;
  }

  /** 获取可用的提供者列表 */
  getAvailableProviders() {
    return Object.keys(this.providers);
  }
}

module.exports = { LLMManager, RuleEngineLLM, OpenAILLM, VLLMLLM, DashScopeLLM };
