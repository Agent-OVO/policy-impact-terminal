const ERROR_PAGE_PATTERN = /信息模板页面配置实体不能为空|access denied|forbidden|request blocked|页面不存在|系统繁忙|服务异常|出错了|验证码|安全验证/i;
const MIN_POLICY_PAGE_BYTES = 200;

export function validatePolicyPageHtml(value, options = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  const text = typeof value === "string" ? value : decodeText(buffer);
  const normalized = text.replace(/\s+/g, " ").trim();
  const minBytes = positiveInteger(options.minBytes, MIN_POLICY_PAGE_BYTES);

  if (buffer.length < minBytes) {
    return {
      valid: false,
      reason: `policy page payload is only ${buffer.length} bytes`,
      textPreview: normalized.slice(0, 160)
    };
  }
  if (ERROR_PAGE_PATTERN.test(normalized.slice(0, 2_000))) {
    return {
      valid: false,
      reason: "policy page payload matches a known error or access-control page",
      textPreview: normalized.slice(0, 160)
    };
  }
  if (!/<(?:html|body|article|main|div|p|title)\b/i.test(text)) {
    return {
      valid: false,
      reason: "policy page payload does not contain recognizable HTML structure",
      textPreview: normalized.slice(0, 160)
    };
  }
  return {
    valid: true,
    reason: null,
    textPreview: normalized.slice(0, 160)
  };
}

export function assertUsablePolicyPageHtml(value, options = {}) {
  const result = validatePolicyPageHtml(value, options);
  if (!result.valid) {
    throw new Error(`Unusable official policy page: ${result.reason}; preview=${JSON.stringify(result.textPreview)}`);
  }
  return result;
}

function decodeText(buffer) {
  let text = new TextDecoder("utf-8").decode(buffer);
  const replacementCount = [...text].filter((char) => char.charCodeAt(0) === 0xfffd).length;
  if (replacementCount > Math.max(5, text.length * 0.01)) {
    try { text = new TextDecoder("gb18030").decode(buffer); } catch { /* retain UTF-8 */ }
  }
  return text;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
