/**
 * ============================================================
 * 安全防线 1：输入过滤 (Input Guardrails)
 * 参考：Meta Llama Guard / LLM Guard 设计理念
 * 参考论文：A Multi-Agent LLM Defense Pipeline (IEEE 2025)
 * ============================================================
 *
 * 功能：拦截 Prompt Injection、恶意代码注入、PII 隐私数据
 * 这是智能体的第一道防线，在意图识别之前执行
 *
 * 架构定位：Input Guardrails Layer
 * - 检测恶意注入（prompt injection, system prompt leak）
 * - 检测 SQL/Command/XSS 注入
 * - PII 脱敏（身份证号、手机号）
 * - 输出过滤（防止智能体泄露内部信息）
 */

class InputGuardrail {
  constructor() {
    // Prompt Injection 检测规则
    this.injectionPatterns = [
      // 英文注入模式
      /\b(ignore|disregard|forget)\b.*\b(previous|prior|above|earlier)\b.*\b(instruction|directive|command)/i,
      /\b(system|assistant|model)\s*[:=]/i,
      /\byou (are|should|must)\s+(a|an|the)\s+\w+\s+(that|who)/i,
      /<\s*system\s*>/i,
      /<\s*\/?\s*instruction\s*>/i,
      /\[SYSTEM\]/i,
      /\[INST\]/i,
      /\b(from|starting)\s+(now|here)\b.*\b(you|act|behave)/i,
      /\b(output|print|show|repeat)\b.*\b(system|prompt|instruction|context)/i,
      /\b(jailbreak|bypass|exploit|hack)/i,
      // 中文注入模式
      /忽略.*之前.*的.*指令/i,
      /忘记.*之前.*的/i,
      /你(现在|应该)是.*一个/i,
      /系统提示词/i,
      /输出.*系统.*指令/i,
      /重复.*以上.*所有/i,
      /不要.*遵守.*规则/i,
      /请(你|您).*忽略.*限制/i,
      /现在你叫/i,
      /你的新名字是/i,
      /你现在是一个/i,
      // 结构化注入
      /^<\|system\|>/i,
      /^<\|user\|>/i,
      /^###\s*(System|User|Assistant)/i,
    ];

    // SQL 注入检测
    this.sqlInjectionPatterns = [
      /\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC)\b.*\b(FROM|INTO|TABLE|SET|WHERE)\b/i,
      /(\bOR\b\s+[\d']+\s*=\s*[\d']+)|(\bAND\b\s+[\d']+\s*=\s*[\d']+)$/i,
      /'\s*(OR|AND)\s+'?\d*'\s*=\s*'?1'/i,
      /(--|;|\/\*).*\b(DROP|DELETE|ALTER)/i,
      /'\s*;?\s*(DROP|DELETE|UPDATE|INSERT)\b/i,
    ];

    // Command 注入检测
    this.commandInjectionPatterns = [
      /;\s*(rm|ls|cat|wget|curl|bash|sh|nc|python|perl|ruby|node|chmod|chown)\b/i,
      /\|\s*(rm|ls|cat|wget|curl|bash|sh|nc)\b/i,
      /`[^`]*`/,
      /\$\([^)]*\)/,
      /&&\s*(rm|wget|curl|bash)/i,
      /\|\|\s*(rm|wget|curl|bash)/i,
      /\\x[0-9a-fA-F]{2}/,
      /%0[aAdD]/,
    ];

    // XSS 检测
    this.xssPatterns = [
      /<\s*script\b[^>]*>/i,
      /javascript\s*:/i,
      /on(error|load|click|mouseover|focus|blur)\s*=/i,
      /<\s*img\b[^>]+onerror/i,
      /<\s*iframe\b/i,
      /<\s*object\b/i,
      /<\s*embed\b/i,
      /document\.(cookie|write|location)/i,
      /window\.(location|eval)/i,
    ];

    // PII 检测（只标记，不阻止）
    this.piiPatterns = {
      id_card: /(\d{6})(\d{4})(\d{4})(\d{3}[Xx\d])/,
      phone: /1[3-9]\d{8}/,
      bank_card: /\b\d{16,19}\b/,
      email: /[\w.-]+@[\w.-]+\.\w{2,}/,
    };
  }

  /**
   * 主检测方法
   * @param {string} input - 用户输入
   * @returns {Object} { isSafe, flag, reason, sanitized }
   */
  check(input) {
    if (!input || typeof input !== 'string') {
      return { isSafe: false, flag: 'invalid_input', reason: '输入为空或格式无效', sanitized: '' };
    }

    // 1. 长度限制（防止 DoS）
    if (input.length > 2000) {
      return { isSafe: false, flag: 'input_too_long', reason: '输入过长', sanitized: input.substring(0, 2000) };
    }

    // 2. 去除零宽字符（防止隐蔽注入）
    let cleaned = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    // 3. Prompt Injection 检测
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(cleaned)) {
        return { isSafe: false, flag: 'prompt_injection', reason: '检测到可能的提示词注入攻击', sanitized: '' };
      }
    }

    // 4. SQL 注入检测
    for (const pattern of this.sqlInjectionPatterns) {
      if (pattern.test(cleaned)) {
        return { isSafe: false, flag: 'sql_injection', reason: '检测到SQL注入尝试', sanitized: '' };
      }
    }

    // 5. Command 注入检测
    for (const pattern of this.commandInjectionPatterns) {
      if (pattern.test(cleaned)) {
        return { isSafe: false, flag: 'command_injection', reason: '检测到命令注入尝试', sanitized: '' };
      }
    }

    // 6. XSS 检测
    for (const pattern of this.xssPatterns) {
      if (pattern.test(cleaned)) {
        return { isSafe: false, flag: 'xss_attempt', reason: '检测到XSS攻击尝试', sanitized: '' };
      }
    }

    // 7. PII 脱敏（记录但不阻止）
    const piiFound = [];
    let sanitized = cleaned;

    for (const [type, pattern] of Object.entries(this.piiPatterns)) {
      if (pattern.test(sanitized)) {
        piiFound.push(type);
        // 脱敏处理
        if (type === 'id_card') {
          sanitized = sanitized.replace(this.piiPatterns.id_card, '$1********$4');
        } else if (type === 'phone') {
          sanitized = sanitized.replace(/(1[3-9]\d{3})\d{4}(\d{4})/, '$1****$2');
        }
      }
    }

    return {
      isSafe: true,
      flag: piiFound.length > 0 ? `pii_detected:${piiFound.join(',')}` : 'clean',
      reason: piiFound.length > 0 ? `检测到PII数据: ${piiFound.join(', ')}` : '通过安全检测',
      sanitized,
      piiTypes: piiFound,
    };
  }

  /**
   * 输出过滤 - 防止智能体泄露内部信息
   * @param {string} output - 智能体生成的回复
   * @returns {string} 过滤后的回复
   */
  sanitizeOutput(output) {
    if (!output) return '';

    // 移除可能的内部信息泄露
    const leakPatterns = [
      /system\s*(prompt|instruction|message)/gi,
      /内部.*指令/gi,
      /system_code/gi,
      /internal.*config/gi,
    ];

    let sanitized = output;
    for (const pattern of leakPatterns) {
      sanitized = sanitized.replace(pattern, '[系统信息已过滤]');
    }

    return sanitized;
  }

  /**
   * 信任标签 (参考 ICLR 2025 Prompt Infection 论文)
   * 在 Agent 间传递信息时，为每段内容打上信任标签
   */
  tagTrustLevel(content, level) {
    return {
      _trust: level, // 'system' | 'verified' | 'user_sanitized' | 'untrusted'
      _timestamp: Date.now(),
      content,
    };
  }
}

module.exports = InputGuardrail;
