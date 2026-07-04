/**
 * ============================================================
 * 智能体核心调度器 (Agent Core Dispatcher)
 * 参考：LangGraph 有向图状态机 (DAG) 架构
 * 参考：VeriGuard 形式化验证 + Multi-Agent Defense Pipeline
 * ============================================================
 *
 * 架构（4层核心模块 + 3道安全防线）：
 *
 *  ┌─────────────────────────────────────────┐
 *  │  安全防线1：Input Guardrails（输入过滤）  │
 *  └──────────────┬──────────────────────────┘
 *                 ▼
 *  ┌─────────────────────────────────────────┐
 *  │  Perception（感知）                      │
 *  │  - 意图理解 + 实体抽取                   │
 *  │  - 情感识别                              │
 *  └──────────────┬──────────────────────────┘
 *                 ▼
 *  ┌─────────────────────────────────────────┐
 *  │  安全防线2：运行时监控                    │
 *  │  - 权限验证 + 动作白名单                 │
 *  └──────────────┬──────────────────────────┘
 *                 ▼
 *  ┌─────────────────────────────────────────┐
 *  │  Planning & Action（规划与执行）         │
 *  │  - 路由到对应处理模块                    │
 *  │  - 知识库检索 / 航班查询 / 行程建议      │
 *  └──────────────┬──────────────────────────┘
 *                 ▼
 *  ┌─────────────────────────────────────────┐
 *  │  安全防线3：输出过滤（Output Sanitizer）  │
 *  └─────────────────────────────────────────┘
 *
 * 状态机流转：
 *   INIT → GUARDRAIL_CHECK → INTENT_CLASSIFY → ACTION_ROUTE → TOOL_EXEC → OUTPUT_FILTER → DONE
 *   任何节点失败 → ERROR_HANDLER → DONE
 */

const InputGuardrail = require('./guardrail');
const IntentClassifier = require('./intent-classifier');
const KnowledgeRetriever = require('./knowledge-retriever');
const ItineraryAdvisor = require('./itinerary-advisor');
const EmotionModule = require('./emotion-module');
const SecurityManagementAgent = require('./security-management');
const { LLMManager } = require('./llm-adapter');

// 允许的动作白名单（最小权限原则）
const ALLOWED_ACTIONS = new Set([
  'query_flight',
  'query_gate',
  'query_baggage',
  'search_knowledge',
  'navigate_location',
  'generate_itinerary',
  'emotion_soothe',
  'check_in',
  'small_talk_reply',
  'security_analyze',
  'query_weather',
]);

class AgentDispatcher {
  constructor(pool, llmConfig = {}) {
    this.pool = pool;

    // 初始化各模块
    this.guardrail = new InputGuardrail();
    this.classifier = new IntentClassifier();
    this.knowledge = new KnowledgeRetriever(pool);
    this.itinerary = new ItineraryAdvisor(pool);
    this.emotion = new EmotionModule();
    this.securityAgent = new SecurityManagementAgent(pool);
    this.llm = new LLMManager();
    if (llmConfig.provider) {
      this.llm.register(llmConfig.provider, llmConfig);
      this.llm.switchProvider(llmConfig.provider);
    }

    // 审计日志
    this.auditLog = [];
  }

  /**
   * 格式化时间为北京时间 YYYY-MM-DD HH:MM
   */
  _fmtTime(d) {
    const dt = new Date(d);
    // +8h offset
    const utc = dt.getTime() + dt.getTimezoneOffset() * 60000;
    const bj = new Date(utc + 8 * 3600000);
    const yy = bj.getFullYear();
    const mm = String(bj.getMonth() + 1).padStart(2, '0');
    const dd = String(bj.getDate()).padStart(2, '0');
    const hh = String(bj.getHours()).padStart(2, '0');
    const mi = String(bj.getMinutes()).padStart(2, '0');
    return `${yy}-${mm}-${dd} ${hh}:${mi}`;
  }

  /**
   * 运行时切换 LLM 配置
   * @param {Object} config - { provider, model, apiKey, baseUrl, temperature, fallbackChain }
   */
  switchLLM(config) {
    const { provider, ...rest } = config;
    if (rest.apiKey || rest.baseUrl) {
      this.llm.register(provider, rest);
    }
    const result = this.llm.switchProvider(provider);
    return { success: result.success, provider: result.provider || provider, status: result.status || 'unknown' };
  }

  /**
   * 获取 LLM 使用统计
   */
  getLLMStats() {
    return this.llm.getAllStats();
  }

  /**
   * ============================================================
   * 主入口：处理旅客端请求
   * ============================================================
   * @param {Object} request
   *   - text: 用户输入（语音识别文本）
   *   - userId: 旅客ID/终端ID
   *   - sessionId: 会话ID
   *   - flightNo: 可选，关联航班号
   *   - terminalId: 可选，终端ID
   * @returns {Promise<Object>} 结构化响应
   */
  async processRequest(request) {
    const startTime = Date.now();
    const { text, userId = 'anonymous', sessionId = null, flightNo = null, terminalId = null } = request;

    // 状态机：INIT
    const state = {
      phase: 'INIT',
      userId,
      sessionId,
      flightNo,
      terminalId,
      originalInput: text,
      response: null,
      error: null,
      audit: [],
    };

    try {
      // ─── 安全防线 1：输入过滤 ───
      state.phase = 'GUARDRAIL_CHECK';
      const guardResult = this.guardrail.check(text);

      state.audit.push({
        phase: 'guardrail',
        flag: guardResult.flag,
        reason: guardResult.reason,
        timestamp: new Date().toISOString(),
      });

      if (!guardResult.isSafe) {
        return this._errorResponse(state, '安全拦截', `检测到潜在安全风险: ${guardResult.reason}`);
      }

      // ─── 感知层：意图理解 + 情感识别 + 实体抽取 ───
      state.phase = 'INTENT_CLASSIFY';
      const perception = this.classifier.classify(guardResult.sanitized);
      state.intent = perception.intent;
      state.entities = perception.entities;
      state.emotion = perception.emotion;
      state.emotionIntensity = perception.emotionIntensity;

      state.audit.push({
        phase: 'perception',
        intent: perception.intent,
        confidence: perception.confidence,
        emotion: perception.emotion,
        entities: perception.entities,
        timestamp: new Date().toISOString(),
      });

      // ─── 安全防线 2：运行时监控 ───
      state.phase = 'RUNTIME_CHECK';
      const action = this._intentToAction(perception.intent);
      if (!ALLOWED_ACTIONS.has(action)) {
        return this._errorResponse(state, '权限拒绝', `不允许的动作: ${action}`);
      }

      // ─── 规划与执行：路由到对应处理模块 ───
      state.phase = 'ACTION_ROUTE';
      let responseText;

      try {
        responseText = await this._routeAndExecute(action, perception, state);
      } catch (execError) {
        return this._errorResponse(state, '执行错误', `处理请求时出错: ${execError.message}`);
      }

      // ─── 情感融合：高情感先安抚 ───
      if (perception.emotionIntensity >= 5 && perception.emotion !== '平静') {
        const emotionAnalysis = this.emotion.analyze(text);
        responseText = this.emotion.wrapWithEmotion(responseText, emotionAnalysis);
      }

      // ─── 安全防线 3：输出过滤 ───
      state.phase = 'OUTPUT_FILTER';
      responseText = this.guardrail.sanitizeOutput(responseText);

      // ─── 完成 ───
      state.phase = 'DONE';
      state.response = responseText;
      state.latency = Date.now() - startTime;

      // 异步记录交互日志（不阻塞响应）
      this._logInteraction(state, perception, responseText).catch(console.error);

      return {
        success: true,
        response: responseText,
        intent: perception.intent,
        emotion: perception.emotion,
        entities: perception.entities,
        latency: state.latency,
      };

    } catch (error) {
      state.phase = 'ERROR';
      state.error = error.message;
      return this._errorResponse(state, '系统错误', error.message);
    }
  }

  /**
   * 意图 → 动作映射（确定性路由）
   */
  _intentToAction(intent) {
    const map = {
      'gate_navigation': 'query_gate',
      'emotion_support+gate_navigation': 'query_gate',
      'baggage_status': 'query_baggage',
      'emotion_support+baggage_status': 'query_baggage',
      'flight_query': 'query_flight',
      'emotion_support+flight_query': 'query_flight',
      'knowledge_qa': 'search_knowledge',
      'emotion_support+knowledge_qa': 'search_knowledge',
      'itinerary_advice': 'generate_itinerary',
      'emotion_support+itinerary_advice': 'generate_itinerary',
      'location_navigation': 'navigate_location',
      'emotion_support+location_navigation': 'navigate_location',
      'checkin_seat': 'check_in',
      'emotion_support+checkin_seat': 'check_in',
      'weather_query': 'query_weather',
      'emotion_support+weather_query': 'query_weather',
      'emotion_support': 'emotion_soothe',
      'small_talk': 'small_talk_reply',
      'security_analyze': 'security_analyze',
      'unknown': 'small_talk_reply',
    };
    return map[intent] || 'small_talk_reply';
  }

  /**
   * 路由执行
   */
  async _routeAndExecute(action, perception, state) {
    const { entities, emotion, emotionIntensity } = perception;
    const originalText = state.originalInput;

    switch (action) {

      // ── 1. 登机口导航 ──
      case 'query_gate': {
        const flightNo = entities.flight_no || state.flightNo;
        if (!flightNo) {
          return '请告诉我您的航班号，我来帮您查询登机口信息。';
        }
        try {
          const [rows] = await this.pool.query(`
            SELECT gate, status, scheduled_departure, airline, arrival_city
            FROM flight WHERE flight_no = ?
          `, [flightNo]);

          if (rows.length === 0) {
            return `暂未找到航班${flightNo}的信息。请确认航班号或前往服务台咨询。`;
          }

          const f = rows[0];
          const now = new Date();
          const dep = new Date(f.scheduled_departure);
          const minLeft = Math.max(0, Math.round((dep - now) / 60000));

          let reply = `您乘坐的${flightNo}航班（${f.airline}，目的地${f.arrival_city}），`;
          reply += `登机口${f.gate}，`;
          if (minLeft > 0) {
            reply += `距离起飞还有约${minLeft}分钟，`;
          }
          reply += `当前状态：${f.status}。正在为您导航至${f.gate}。`;
          return reply;
        } catch (e) {
          return '查询登机口时出错，请稍后再试或前往服务台。';
        }
      }

      // ── 2. 行李状态查询 ──
      case 'query_baggage': {
        // 判断是超重问题还是状态查询
        if (originalText.includes('超重')) {
          return '您的行李超重了。国内航班经济舱免费托运额度为20kg，超出部分需额外付费。请前往C岛人工柜台办理超重行李托运手续，也可以在这里告诉我您的航班号，我帮您查看具体规定。';
        }

        if (originalText.includes('丢失') || originalText.includes('坏了')) {
          return '行李出现问题请先前往机场行李服务柜台（到达层B1-12号）报案。请准备好登机牌和行李牌，工作人员会帮您查询行李状态。同时您也可以拨打机场服务热线96158。';
        }

        try {
          const flightNo = entities.flight_no || state.flightNo;
          if (flightNo) {
            const [rows] = await this.pool.query(`
              SELECT f.arrival_city FROM flight f WHERE f.flight_no = ?
            `, [flightNo]);
            if (rows.length > 0) {
              return `您的行李随航班到达${rows[0].arrival_city}后，请在到达层的行李提取区查看转盘号。转盘信息会在机场大屏上显示。`;
            }
          }
          return '请在到达层的行李提取区查看转盘号。转盘信息会在机场大屏上显示，您也可以询问工作人员。';
        } catch (e) {
          return '查询行李信息时出错，请前往行李服务柜台咨询。';
        }
      }

      // ── 3. 航班查询 ──
      case 'query_flight': {
        const flightNo = entities.flight_no || state.flightNo;
        if (!flightNo) {
          return '请告诉我您的航班号（如CA1234），我来帮您查询航班状态。';
        }
        try {
          const [rows] = await this.pool.query(`
            SELECT * FROM flight WHERE flight_no = ?
          `, [flightNo]);

          if (rows.length === 0) {
            return `暂未找到航班${flightNo}的信息。请确认航班号或前往服务台咨询。`;
          }

          const f = rows[0];
          const now = new Date();
          const dep = new Date(f.scheduled_departure);
          const arr = new Date(f.scheduled_arrival);
          const minLeft = Math.max(0, Math.round((dep - now) / 60000));

          let reply = `航班${flightNo}（${f.airline}）：`;
          reply += `${f.departure_city} → ${f.arrival_city}，`;
          reply += `计划起飞${this._fmtTime(f.scheduled_departure)}，`;
          reply += `登机口${f.gate}，`;
          reply += `状态${f.status}。`;
          if (f.status === '延误') {
            reply += ' 航班正在延误，请关注机场大屏或广播获取最新信息。';
          } else if (minLeft > 0) {
            reply += ` 距离起飞还有约${minLeft}分钟。`;
          }
          return reply;
        } catch (e) {
          return '查询航班信息时出错，请稍后再试。';
        }
      }

      // ── 4. 知识库检索 ──
      case 'search_knowledge': {
        try {
          const result = await this.knowledge.search(originalText);
          if (result.bestMatch) {
            const reply = this.knowledge.formatReply(result.bestMatch);
            return reply.answer;
          }
          return this.knowledge.fallbackReply(originalText);
        } catch (e) {
          return '知识检索暂时不可用，请稍后再试。您可以尝试换个说法或前往服务台。';
        }
      }

      // ── 5. 行程建议 ──
      case 'generate_itinerary': {
        try {
          const flightNo = entities.flight_no || state.flightNo;
          if (!flightNo) {
            return '请告诉我您的航班号，我来为您生成个性化行程建议。';
          }

          const [rows] = await this.pool.query(`
            SELECT gate, scheduled_departure FROM flight WHERE flight_no = ?
          `, [flightNo]);

          if (rows.length === 0) {
            return `暂未找到航班${flightNo}的信息。`;
          }

          const f = rows[0];
          const advice = await this.itinerary.generate({
            flight_no: flightNo,
            gate: f.gate,
            departure_time: f.scheduled_departure,
            pref_food: entities.pref_food || false,
            pref_shop: entities.pref_shop || false,
          });

          return advice;
        } catch (e) {
          return '生成行程建议时出错，请稍后再试。';
        }
      }

      // ── 6. 地点导航 ──
      case 'navigate_location': {
        const locationName = entities.location_name || '';
        try {
          const [rows] = await this.pool.query(`
            SELECT * FROM airport_poi
            WHERE is_active = 1
            AND (name LIKE ? OR description LIKE ? OR type LIKE ?)
            ORDER BY walking_time_min ASC
            LIMIT 5
          `, [`%${locationName}%`, `%${locationName}%`, `%${entities.location}%`]);

          if (rows.length === 0) {
            return `抱歉，我暂时找不到${locationName}的准确位置。请查看航站楼导览图或询问工作人员。`;
          }

          // 筛选最匹配的（名称精确匹配优先）
          let matched = rows.filter(r => r.name === locationName || r.name.includes(locationName));
          if (matched.length === 0) matched = rows.slice(0, 3);

          // 构建结构化导航数据（供前端渲染卡片+路线）
          const navResults = matched.slice(0, 3).map(r => ({
            name: r.name,
            type: r.type,
            area: r.area,
            floor: r.floor,
            walking_time_min: r.walking_time_min,
            description: r.description || '',
            nearby_gates: r.nearby_gates || '',
          }));

          // 语音播报文本
          let speechText = '';
          let reply = '';
          matched.slice(0, 3).forEach((r, i) => {
            const step = i + 1;
            const desc = `${step}. ${r.name}，位于${r.area}${r.floor}，步行约${r.walking_time_min}分钟。`;
            if (r.description) {
              desc += `${r.description}。`;
            }
            reply += desc + ' ';
            speechText += desc;
          });

          // 返回结构化对象（前端识别 navResults 字段）
          return {
            reply: reply.trim(),
            navResults,
            speechText,
          };
        } catch (e) {
          console.error('navigate_location error:', e);
          return '查询位置信息时出错，请查看航站楼导览图或询问工作人员。';
        }
      }

      // ── 7. 值机 ──
      case 'check_in': {
        if (originalText.includes('选座') || originalText.includes('座位') || originalText.includes('靠窗') || originalText.includes('过道')) {
          return '好的呢！选座前先完成值机~ 请点击屏幕上方的"在线值机·选座"按钮，或者告诉我您的航班号，我来帮您看看~';
        }
        return '好的~ 请点击屏幕上方的"在线值机·选座"按钮办理值机哦。需要帮助的话，告诉我您的航班号，我帮您查~';
      }

      // ── 7.5. 天气查询（问题2 修复） ──
      case 'query_weather': {
        // 从实体提取城市，默认北京
        let city = entities.city || '北京';
        // 常见城市别名映射
        const cityAlias = {
          '上海': '上海', '广州': '广州', '深圳': '深圳', '成都': '成都',
          '杭州': '杭州', '南京': '南京', '重庆': '重庆', '武汉': '武汉',
          '长沙': '长沙', '西安': '西安', '昆明': '昆明', '大连': '大连',
          '贵阳': '贵阳', '郑州': '郑州', '济南': '济南', '沈阳': '沈阳',
          '哈尔滨': '哈尔滨', '青岛': '青岛', '厦门': '厦门', '珠海': '珠海',
        };
        for (const [alias, cn] of Object.entries(cityAlias)) {
          if (originalText.includes(alias)) { city = cn; break; }
        }
        // 从航班目的地提取
        if (entities.flight_no || state.flightNo) {
          const fNo = entities.flight_no || state.flightNo;
          try {
            const [fRows] = await this.pool.query('SELECT arrival_city FROM flight WHERE flight_no = ?', [fNo]);
            if (fRows.length > 0 && city === '北京') city = fRows[0].arrival_city;
          } catch (e) { /* ignore */ }
        }

        try {
          const https = require('https');
          const weatherData = await new Promise((resolve, reject) => {
            https.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`, (resp) => {
              let chunks = [];
              resp.on('data', c => chunks.push(c));
              resp.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
            }).on('error', reject);
          });
          const current = weatherData.current_condition?.[0] || {};
          const nearest = weatherData.nearest_area?.[0] || {};
          const weatherCity = nearest.areaName?.find(a => a.value.includes('市') || a.value.includes('县'))?.value || city;
          const desc = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知';
          const temp = current.temp_C || '--';
          const feels = current.FeelsLikeC || temp;
          const humidity = current.humidity || '--';
          const wind = current.windspeedKmph || '--';
          const windDir = current.winddir16Point || '';
          const rain = current.pprecip || '0';

          let reply = `${weatherCity}当前天气：${desc}，气温${temp}℃，体感${feels}℃。`;
          reply += `湿度${humidity}%，${windDir ? windDir + '' : ''}风速${wind}km/h。`;
          if (parseFloat(rain) > 0) reply += `当前有降水(${rain}mm)，请携带雨具。`;
          else if (parseFloat(rain) === 0) reply += `暂无降水。`;

          // 穿衣建议
          const t = parseFloat(temp);
          if (t >= 30) reply += '天气炎热，建议穿轻薄透气的夏装。';
          else if (t >= 25) reply += '天气温暖，建议穿短袖/薄衬衫。';
          else if (t >= 20) reply += '天气舒适，建议穿长袖衬衫/薄外套。';
          else if (t >= 15) reply += '天气凉爽，建议穿外套/卫衣。';
          else if (t >= 10) reply += '天气偏冷，建议穿毛衣/厚外套。';
          else if (t >= 0) reply += '天气寒冷，建议穿棉服/羽绒服。';
          else reply += '天气严寒，请注意保暖，穿厚羽绒服。';

          // 结构化数据（前端可渲染天气卡片）
          return {
            reply,
            weather: {
              city: weatherCity,
              temp: current.temp_C,
              feelsLike: current.FeelsLikeC,
              desc,
              humidity: current.humidity,
              wind: current.windspeedKmph,
              windDir: current.winddir16Point,
              rain: current.pprecip,
            },
          };
        } catch (e) {
          console.error('天气查询失败:', e.message);
          return `暂时无法获取${city}的天气信息，请稍后再试。机场内空调温度约22-24℃，请注意保暖。`;
        }
      }

      // ── 8. 情绪安抚 ──
      case 'emotion_soothe': {
        const analysis = this.emotion.analyze(originalText);
        let reply = analysis.soothReply;

        // 尝试理解用户实际需要什么帮助
        if (entities.flight_no) {
          reply += ' 让我先帮您查看航班信息...';
          const gateReply = await this._routeAndExecute('query_gate', perception, state);
          reply += gateReply;
        } else {
          reply += ' 请告诉我您的航班号或需要什么帮助，我会全力为您处理。';
        }
        return reply;
      }

      // ── 9. 闲聊 ──
      case 'small_talk_reply': {
        const replies = {
          '你好': ['您好！欢迎来到首都机场T3航站楼。有什么可以帮您的吗？', '您好！我是您的智能助手，请告诉我您需要什么帮助。'],
          '您好': ['您好！我是首都机场智能助手，请告诉我您需要什么帮助。'],
          '谢谢': ['不客气！还有其他需要帮助的吗？', '应该的，祝您旅途愉快！'],
          '再见': ['再见！祝您旅途愉快，一路平安！', '再见！如有需要随时找我。'],
        };

        for (const [kw, options] of Object.entries(replies)) {
          if (originalText.includes(kw)) {
            return options[Math.floor(Math.random() * options.length)];
          }
        }

        return `抱歉，我没太理解您的意思。您可以问我航班信息、登机口、行李规定等问题，也可以点击屏幕上的按钮导航。`;
      }

      default:
        return '抱歉，我暂时无法处理这个请求。请换个方式问我，或点击屏幕上的按钮。';
    }
  }

  /**
   * 安全管理端：阈值分析
   */
  async processSecurityRequest(params = {}) {
    const timeWindow = params.timeWindow || 30;
    const report = await this.securityAgent.analyze(timeWindow);
    return report;
  }

  /**
   * 错误响应
   */
  _errorResponse(state, errorType, message) {
    state.error = `${errorType}: ${message}`;
    state.phase = 'ERROR';
    state.latency = Date.now() - Date.parse(state.audit[0]?.timestamp || new Date());

    return {
      success: false,
      response: `抱歉，${message} 如有需要请前往服务台或拨打服务热线96158。`,
      error: state.error,
      intent: state.intent || 'unknown',
    };
  }

  /**
   * 异步记录交互日志
   */
  async _logInteraction(state, perception, responseText) {
    try {
      await this.pool.execute(`
        INSERT INTO agent_interaction_log (
          session_token, user_input, intent, emotion, entities,
          action_chosen, response_text, confidence, guardrail_flagged,
          guardrail_reason, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        state.sessionId || 'anonymous',
        state.originalInput,
        perception.intent,
        perception.emotion,
        JSON.stringify(perception.entities),
        this._intentToAction(perception.intent),
        responseText,
        perception.confidence,
        state.audit.find(a => a.phase === 'guardrail')?.flag !== 'clean' ? 1 : 0,
        state.audit.find(a => a.phase === 'guardrail')?.reason || null,
        state.latency,
      ]);
    } catch (e) {
      console.error('记录交互日志失败:', e);
    }
  }
}

module.exports = AgentDispatcher;
