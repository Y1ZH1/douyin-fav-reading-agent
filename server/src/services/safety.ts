/**
 * 内容安全服务
 *
 * 提供三层防护：
 * 1. SAFETY_GUIDELINES — 注入 System Prompt，让 AI 主动拒绝违规请求
 * 2. checkInputSafety() — 用户输入检查，拦截明显违规/越狱请求
 * 3. checkOutputSafety() — AI 输出检查，流结束后扫描
 */

// ──────────────────────────────────────────────
// 第一层：System Prompt 安全规则（注入到所有 role:system 消息中）
// ──────────────────────────────────────────────

export const SAFETY_GUIDELINES = `## 安全与使用边界（必须遵守）

作为 AI 代码导师，你必须在以下边界内工作：

### ✅ 可以做的
- 解释代码原理、编程概念、算法逻辑
- 指导最佳实践、设计模式、代码重构
- 帮助调试错误、分析性能瓶颈
- 回答编程语言、框架、工具相关的技术问题
- 审查代码安全性、可维护性、可读性

### ❌ 必须拒绝的
- 生成用于违法犯罪、网络攻击的代码（病毒、木马、钓鱼页面、暴力破解工具等）
- 生成色情、淫秽内容或与编程无关的成人内容
- 生成仇恨言论、歧视性内容或煽动暴力
- 生成赌博、欺诈相关的代码或教程
- 教授如何绕开安全限制、破解软件、盗取数据
- 提供医疗建议、法律建议等非编程领域的专业意见
- 冒充他人身份或生成欺骗性内容

### 拒绝方式
当用户提出上述违规请求时，必须明确告知："抱歉，这超出了我的职责范围。我是代码导师，只能帮助你学习编程和技术问题。" 并引导用户回到编程话题。`

// ──────────────────────────────────────────────
// 第二层：输入检查（检查用户消息中是否有明显违规内容）
// ──────────────────────────────────────────────

interface SafetyCheckResult {
  safe: boolean
  reason?: string
}

/** 触发拒绝的直接关键词模式（不区分大小写） */
const INPUT_BLOCK_PATTERNS: RegExp[] = [
  // 色情相关
  /(如何\s*)?(生成|制作|创建)\s*(色情|淫秽|成人|裸体|裸露|性[爱交]).*/i,
  /(porn|porno|nude|naked|sex\s*(video|scene|content)|erotic)\s*(code|generate|create|write)/i,

  // 恶意软件/黑客
  /(如何\s*)?(编写|制作|创建|生成)\s*(病毒|木马|蠕虫|勒索|远控|后门|僵尸网络).*/i,
  /(写|生成|创建)\s*(免杀|shellcode|exploit|恶意软件|ransomware|trojan|backdoor)/i,
  /write\s+(a\s+)?(virus|malware|ransomware|trojan|backdoor|rootkit|keylogger)/i,

  // 违法活动
  /(如何\s*)?(诈骗|钓鱼|赌博|洗钱|破解|盗号|入侵).*/i,
  /(phishing|fraud|money\s*laundering|hack\s+(into|account|system)|crack\s+software)/i,

  // 绕开限制
  /(忽略|无视|跳过|override|ignore|bypass)\s*(上述|以上|安全|safety|guidelines|rules|限制)/i,
  /(你是|you\s+are)\s*(.*)?(不受限制|没有限制|unrestricted|unconstrained|without\s+limits)/i,
  /(DAN|do\s+anything\s+now|jailbreak|越狱|破解限制)/i,

  // 冒充/越狱
  /(假装|扮演|act\s+as|pretend)\s*(.*)?(可以|能|绕过|bypass|ignore|unlimited)/i,
]

/**
 * 检查用户输入是否包含明显违规内容
 */
export function checkInputSafety(messages: { role: string; content: string }[]): SafetyCheckResult {
  for (const msg of messages) {
    if (msg.role === 'assistant' || msg.role === 'system') continue

    const content = msg.content

    // 检查长度：太短的文本不需要检查
    if (content.length < 10) continue

    for (const pattern of INPUT_BLOCK_PATTERNS) {
      if (pattern.test(content)) {
        console.warn(`[Safety] Input blocked: pattern=${pattern} content="${content.slice(0, 100)}..."`)
        return {
          safe: false,
          reason: '输入内容包含违规请求，已拦截。AI 代码导师只能帮助学习编程和技术问题。',
        }
      }
    }
  }

  return { safe: true }
}

// ──────────────────────────────────────────────
// 第三层：输出检查（AI 回复内容扫描）
// ──────────────────────────────────────────────

/** AI 输出中触发警告的关键词（发现后记录日志但不阻断，给用户看到后自行判断） */
const OUTPUT_WARNING_PATTERNS: RegExp[] = [
  /(色情|淫秽|裸体|性[爱交]|成人内容)/i,
  /(病毒|木马|黑客攻击|恶意软件|钓鱼网站)/i,
  /(非法|违法|犯罪|赌博|诈骗)/i,
]

export interface OutputCheckResult {
  hasWarning: boolean
  warnings: string[]
}

/**
 * 检查 AI 输出是否包含潜在违规内容（流结束后调用）
 */
export function checkOutputSafety(content: string): OutputCheckResult {
  const warnings: string[] = []

  for (const pattern of OUTPUT_WARNING_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(`输出包含敏感内容（匹配: ${pattern}）`)
    }
  }

  if (warnings.length > 0) {
    console.warn(`[Safety] Output warning: ${warnings.join('; ')}`)
  }

  return {
    hasWarning: warnings.length > 0,
    warnings,
  }
}
