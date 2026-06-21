/**
 * ============================================================
 * 感知模块：意图理解 + 实体抽取 (Perception Module)
 * 参考：LangGraph State Machine 设计理念
 * ============================================================
 *
 * 功能：
 * 1. 意图分类 — 将用户自然语言映射到预定义意图
 * 2. 情感识别 — 检测焦虑/愤怒/困惑/高兴/恐惧等情感
 * 3. 实体抽取 — 提取航班号、地点、时间等结构化实体
 *
 * 设计理念：
 * - Constrained Decoding：从预定义意图列表中选，不是自由生成
 * - 情感高优先级检测（焦虑≥7 → 强制触发安抚策略）
 * - 多意图融合（emotion + 具体业务意图）
 */

class IntentClassifier {
  constructor() {
    // 预定义意图库（确定性状态机节点）
    this.intentLibrary = {
      // 1. 登机口导航
      gate_navigation: {
        keywords: ['登机口', 'gate', '登机', '在哪里登机', '去登机口', '找登机口', '哪个登机口', '登机口改', '登机口变了'],
        regex: [
          /登机口.*在/, /在.*登机口/, /.*登机口.*改/, /找不到.*登机口/,
          /去.*登机口/, /登机口.*哪/, /gate.*在/,
        ],
        entities: ['flight_no', 'gate'],
        priority: 90,
      },

      // 2. 行李状态查询
      baggage_status: {
        keywords: ['行李', '托运行李', '行李状态', '行李在哪', '行李取', '行李转盘', '行李丢失', '行李坏了', '行李超重'],
        regex: [/行李.*在/, /行李.*状态/, /行李.*取/, /.*行李.*丢失/, /行李.*坏/, /行李.*超重/],
        entities: ['baggage_claim'],
        priority: 80,
      },

      // 3. 航班查询
      flight_query: {
        keywords: ['航班', '航班号', '起飞', '到达', '延误', '取消', '取消了吗', '什么时候飞', '几点起飞', 'flight'],
        regex: [/航班.*状态/, /.*延误/, /.*取消/, /.*起飞.*时间/, /.*几点.*飞/, /航班.*号/],
        entities: ['flight_no'],
        priority: 85,
      },

      // 4. 知识库问答
      knowledge_qa: {
        keywords: ['充电宝', '托运', '能带', '可以带', '规定', '规则', '液体', '刀具', '打火机', '婴儿', '儿童票', '停车', 'wifi', '停车费', '卫生间', '厕所'],
        regex: [/.*能.*带.*/, /.*可以.*带.*/, /.*能.*托运.*/, /.*规定.*/, /充电宝/, /打火机/, /液体.*带/, /停车.*费/],
        entities: ['topic'],
        priority: 75,
      },

      // 5. 行程建议
      itinerary_advice: {
        keywords: ['还剩', '时间够', '来得及', '吃什么', '推荐', '买什么', '逛什么', '玩什么', '来得及吗', '还有多久'],
        regex: [/.*时间.*够/, /.*来得及/, /.*推荐/, /.*吃什么/, /.*买什么/, /.*逛什么/, /还有.*多久/],
        entities: ['preference', 'time_budget'],
        priority: 70,
      },

      // 6. 地点导航
      location_navigation: {
        keywords: ['安检', '卫生间', '厕所', '餐厅', '吃饭', '免税店', '购物', '商店', '值机', '办登机牌', '行李提取', '失物招领', '轮椅', '特殊旅客', '地铁', '公交', '出租车', '大巴', '停车'],
        regex: [/.*安检.*在/, /.*卫生间.*在/, /.*餐厅.*在/, /.*在哪/, /.*到.*怎么走/],
        entities: ['location'],
        priority: 80,
      },

      // 7. 值机选座
      checkin_seat: {
        keywords: ['值机', 'check in', '选座', '选座位', '座位', '靠窗', '靠过道', '靠走道', '换座', '改座位'],
        regex: [/.*值机/, /.*选座/, /.*靠窗/, /.*靠过道/, /.*换座/],
        entities: ['flight_no', 'seat_pref'],
        priority: 85,
      },

      // 8. 闲聊
      small_talk: {
        keywords: ['你好', '您好', '谢谢', '再见', '拜拜', '辛苦了', '好的', '知道了', '明白', '嗯', '好'],
        regex: [/^(你好|您好|早上好|晚上好)/, /^(谢谢|感谢)/, /^(再见|拜拜)/],
        entities: [],
        priority: 10,
      },
    };

    // 情感词典
    this.emotionDict = {
      焦虑: {
        keywords: ['慌', '着急', '急', '急死', '焦虑', '紧张', '来不及', '快迟到了', '怎么办', '来不及了', '好急', '急死了', '赶不上', '快到了'],
        regex: [/慌/, /着急/, /急(死|疯|坏)?/, /来不及/, /快迟到/, /赶不上/, /.*怎么办/, /帮帮我/],
      },
      愤怒: {
        keywords: ['生气', '气死', '投诉', '差', '垃圾', '太差了', '坑', '太坑了', '无语', '受不了', '找领导'],
        regex: [/气(死|炸)?/, /投诉/, /太差/, /太坑/, /无语/, /受不了/, /找领导/],
      },
      困惑: {
        keywords: ['不知道', '不懂', '不清楚', '哪里', '怎么弄', '为什么', '咋办', '不理解', '不明白'],
        regex: [/不知道/, /不懂/, /不清楚/, /咋办/, /不理解/, /不明白/],
      },
      高兴: {
        keywords: ['开心', '太好了', '棒', '不错', '给力', '好棒', '真棒', '谢谢', '感恩'],
        regex: [/开心/, /太好了/, /真棒/, /好棒/, /不错/, /给力/],
      },
      恐惧: {
        keywords: ['害怕', '怕', '吓', '恐怖', '不安全', '危险', '吓死', '好怕'],
        regex: [/害怕/, /好怕/, /吓(死|人)?/, /恐怖/, /不安全/],
      },
    };
  }

  /**
   * 主分类方法
   * @param {string} text 用户输入
   * @returns {Object} { intent, confidence, emotion, emotionIntensity, entities }
   */
  classify(text) {
    if (!text || !text.trim()) {
      return { intent: 'unknown', confidence: 0, emotion: '平静', emotionIntensity: 0, entities: {} };
    }

    const cleanText = text.trim();

    // 1. 情感检测
    const emotion = this._detectEmotion(cleanText);

    // 2. 意图匹配（选最高分）
    const intentResult = this._matchIntent(cleanText);

    // 3. 实体抽取
    const entities = this._extractEntities(cleanText, intentResult.intent);

    // 4. 高情感 + 业务意图 = 复合意图
    let finalIntent = intentResult.intent;
    let finalConfidence = intentResult.confidence;

    if (emotion.intensity >= 7 && intentResult.intent !== 'unknown' && intentResult.intent !== 'small_talk') {
      finalIntent = `emotion_support+${intentResult.intent}`;
      finalConfidence = Math.min(1, intentResult.confidence * 0.7 + emotion.intensity / 10 * 0.3);
    } else if (emotion.intensity >= 7 && intentResult.intent === 'unknown') {
      finalIntent = 'emotion_support';
      finalConfidence = emotion.intensity / 10;
    }

    return {
      intent: finalIntent,
      confidence: Math.round(finalConfidence * 100) / 100,
      emotion: emotion.type,
      emotionIntensity: emotion.intensity,
      entities,
    };
  }

  /**
   * 意图匹配 — Constrained Decoding 方式
   */
  _matchIntent(text) {
    let bestIntent = 'unknown';
    let bestScore = 0;

    for (const [intentName, def] of Object.entries(this.intentLibrary)) {
      let score = 0;

      // 关键词命中
      for (const kw of def.keywords) {
        if (text.includes(kw)) score += 2;
      }

      // 正则命中（权重更高）
      for (const re of def.regex) {
        if (re.test(text)) score += 4;
      }

      // 优先级加权
      if (score > 0) {
        score = score * (1 + def.priority / 100);
      }

      if (score > bestScore) {
        bestScore = score;
        bestIntent = intentName;
      }
    }

    const confidence = bestScore > 0 ? Math.min(1, bestScore / 20) : 0;
    return { intent: bestIntent, confidence };
  }

  /**
   * 情感检测
   */
  _detectEmotion(text) {
    let detectedType = '平静';
    let maxIntensity = 0;

    for (const [emotionType, def] of Object.entries(this.emotionDict)) {
      let matchCount = 0;

      for (const kw of def.keywords) {
        if (text.includes(kw)) matchCount++;
      }
      for (const re of def.regex) {
        if (re.test(text)) matchCount++;
      }

      if (matchCount > 0) {
        const intensity = Math.min(10, 3 + matchCount * 2);
        if (intensity > maxIntensity) {
          maxIntensity = intensity;
          detectedType = emotionType;
        }
      }
    }

    return { type: detectedType, intensity: maxIntensity };
  }

  /**
   * 实体抽取
   */
  _extractEntities(text, intent) {
    const entities = {};

    // 航班号（2字母+3~4数字）
    const flightMatch = text.match(/([A-Za-z]{2}\d{3,4})/);
    if (flightMatch) entities.flight_no = flightMatch[1];

    // 登机口（D/E+数字，机场常见）
    const gateMatch = text.match(/[DE]\d{1,3}/);
    if (gateMatch) entities.gate = gateMatch[0].toUpperCase();

    // 地点偏好
    const locations = {
      '安检': 'security', '卫生间': 'toilet', '厕所': 'toilet',
      '餐厅': 'restaurant', '吃饭': 'restaurant', '美食': 'restaurant',
      '免税店': 'shop', '购物': 'shop', '商店': 'shop',
      '值机': 'checkin', '登机牌': 'checkin',
      '行李提取': 'baggage', '失物招领': 'lost',
      '轮椅': 'special', '特殊旅客': 'special',
      '地铁': 'transport', '公交': 'transport', '出租车': 'transport',
    };
    for (const [kw, loc] of Object.entries(locations)) {
      if (text.includes(kw)) {
        entities.location = loc;
        entities.location_name = kw;
        break;
      }
    }

    // 座位偏好
    if (text.includes('靠窗')) entities.seat_pref = '靠窗';
    else if (text.includes('过道') || text.includes('走道')) entities.seat_pref = '靠过道';
    else if (text.includes('中间')) entities.seat_pref = '中间';
    else if (text.includes('出口')) entities.seat_pref = '安全出口';

    // 时间预算
    const timeMatch = text.match(/(\d+)\s*(分钟|min|分)/);
    if (timeMatch) entities.time_budget = parseInt(timeMatch[1]);

    // 偏好标签
    if (/[吃]饭|餐厅|美食|喝|餐/.test(text)) entities.pref_food = true;
    if (/[买]东西|逛|免税店|购物/.test(text)) entities.pref_shop = true;

    return entities;
  }
}

module.exports = IntentClassifier;
