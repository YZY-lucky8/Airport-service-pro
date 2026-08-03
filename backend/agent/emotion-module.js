/**
 * ============================================================
 * 情绪识别与安抚模块 (Emotion Module)
 * 参考：情感计算 (Affective Computing) 基础框架
 * ============================================================
 *
 * 功能：
 * - 细粒度情感识别（焦虑/愤怒/困惑/高兴/恐惧/平静）
 * - 情感强度评分（1-10）
 * - 情绪安抚策略选择
 * - 安抚回复生成
 *
 * 设计原则：
 * - 高情感强度优先处理（先安抚再办事）
 * - 安抚回复温和、专业、有同理心
 * - 记录情感日志用于后续分析
 */

class EmotionModule {
  constructor() {
    // 情感词典（含权重）
    this.lexicon = {
      焦虑: {
        words: [
          { w: '慌', wgt: 3 }, { w: '着急', wgt: 3 }, { w: '急', wgt: 2 },
          { w: '急死', wgt: 4 }, { w: '焦虑', wgt: 4 }, { w: '紧张', wgt: 2 },
          { w: '来不及', wgt: 3 }, { w: '快迟到了', wgt: 4 }, { w: '怎么办', wgt: 2 },
          { w: '帮帮我', wgt: 3 }, { w: '好急', wgt: 3 }, { w: '赶不上', wgt: 3 },
          { w: '慌得很', wgt: 4 }, { w: '急死了', wgt: 4 }, { w: '赶时间', wgt: 2 },
        ],
      },
      愤怒: {
        words: [
          { w: '生气', wgt: 3 }, { w: '气死', wgt: 4 }, { w: '投诉', wgt: 3 },
          { w: '太差', wgt: 2 }, { w: '坑', wgt: 2 }, { w: '无语', wgt: 2 },
          { w: '受不了', wgt: 3 }, { w: '找领导', wgt: 3 }, { w: '垃圾', wgt: 3 },
          { w: '太差了', wgt: 3 }, { w: '太坑了', wgt: 3 }, { w: '恶心', wgt: 3 },
        ],
      },
      困惑: {
        words: [
          { w: '不知道', wgt: 2 }, { w: '不懂', wgt: 2 }, { w: '不清楚', wgt: 2 },
          { w: '咋办', wgt: 2 }, { w: '不理解', wgt: 2 }, { w: '不明白', wgt: 2 },
          { w: '哪里', wgt: 1 }, { w: '怎么弄', wgt: 2 }, { w: '为什么', wgt: 1 },
        ],
      },
      高兴: {
        words: [
          { w: '开心', wgt: 2 }, { w: '太好了', wgt: 3 }, { w: '棒', wgt: 2 },
          { w: '不错', wgt: 1 }, { w: '给力', wgt: 2 }, { w: '真棒', wgt: 3 },
          { w: '好棒', wgt: 3 }, { w: '谢谢', wgt: 1 }, { w: '感谢', wgt: 1 },
        ],
      },
      恐惧: {
        words: [
          { w: '害怕', wgt: 4 }, { w: '好怕', wgt: 3 }, { w: '吓死', wgt: 4 },
          { w: '恐怖', wgt: 3 }, { w: '不安全', wgt: 3 }, { w: '危险', wgt: 3 },
          { w: '怕', wgt: 2 }, { w: '吓人', wgt: 3 }, { w: '救命', wgt: 5 },
        ],
      },
    };

    // 安抚策略模板
    this.soothingStrategies = {
      焦虑: {
        templates: [
          '请别担心，我来帮您处理。',
          '深呼吸，别着急，我来帮您看看。',
          '没关系，时间还来得及。让我帮您确认一下。',
          '我理解您的着急，别担心，马上帮您搞定。',
        ],
        tone: '温和安慰',
        strategy: '先安抚情绪，再快速给出解决方案',
      },
      愤怒: {
        templates: [
          '非常抱歉给您带来不好的体验，我马上帮您解决。',
          '我理解您的心情，请告诉我具体情况，我会尽快处理。',
          '很抱歉让您不愉快了，我立刻为您处理这个问题。',
        ],
        tone: '诚恳致歉',
        strategy: '先道歉，再快速解决实际问题',
      },
      困惑: {
        templates: [
          '没问题，我来帮您搞清楚。',
          '让我帮您看看，马上给您明确的答案。',
          '好的，我一步步告诉您。',
        ],
        tone: '耐心指导',
        strategy: '用简单明确的语言回答',
      },
      恐惧: {
        templates: [
          '请不要害怕，您现在是安全的。我来帮助您。',
          '别怕，我在这儿帮您，告诉我您需要什么。',
          '您很安全，我在这里，让我们一起处理。',
        ],
        tone: '坚定温暖',
        strategy: '先给予安全感，再提供实际帮助',
      },
    };
  }

  /**
   * 主方法：检测情感 + 生成安抚回复
   * @param {string} text 用户输入
   * @returns {Object} { emotion, intensity, soothReply, strategy }
   */
  analyze(text) {
    if (!text) {
      return { emotion: '平静', intensity: 0, soothReply: '', strategy: '' };
    }

    let maxEmotion = '平静';
    let maxScore = 0;

    for (const [emotionType, def] of Object.entries(this.lexicon)) {
      let score = 0;
      for (const { w, wgt } of def.words) {
        if (text.includes(w)) {
          score += wgt;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        maxEmotion = emotionType;
      }
    }

    // 强度归一化到 1-10
    const intensity = maxScore > 0 ? Math.min(10, Math.max(1, Math.round(scoreToIntensity(maxScore)))) : 0;

    // 高情感时生成安抚回复
    let soothReply = '';
    let strategy = '';

    if (intensity >= 5 && maxEmotion !== '平静') {
      const sDef = this.soothingStrategies[maxEmotion];
      if (sDef) {
        soothReply = sDef.templates[Math.floor(Math.random() * sDef.templates.length)];
        strategy = sDef.strategy;
      }
    }

    return {
      emotion: maxEmotion,
      intensity,
      soothReply,
      strategy,
    };
  }

  /**
   * 生成带情感温度的回复
   * 将安抚语 + 业务回复融合
   */
  wrapWithEmotion(businessReply, emotionAnalysis) {
    if (emotionAnalysis.intensity < 5) {
      return businessReply; // 低情感，直接返回业务回复
    }

    return `${emotionAnalysis.soothReply} ${businessReply}`;
  }

  /**
   * 情感日志格式化
   */
  formatLog(sessionId, userInput, analysis) {
    return {
      session_id: sessionId,
      user_input: userInput,
      detected_emotion: analysis.emotion,
      emotion_intensity: analysis.intensity,
      response_strategy: analysis.strategy,
      soothing_applied: analysis.intensity >= 5 ? 1 : 0,
    };
  }
}

/**
 * 原始分→强度（1-10）转换
 */
function scoreToIntensity(score) {
  if (score <= 1) return 1;
  if (score <= 2) return 2;
  if (score <= 4) return 4;
  if (score <= 6) return 6;
  if (score <= 8) return 8;
  return 10;
}

module.exports = EmotionModule;
