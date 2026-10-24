export const STUDENT_EMAIL_DOMAIN = 's.upc.edu.cn';
export const STUDENT_EMAIL_HINT = '仅限中国石油大学（华东）学生邮箱（@s.upc.edu.cn）';

const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_PART = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export interface StudentEmailResult {
  ok: boolean;
  email: string;
  message?: string;
}

/**
 * Validates a school email without extracting or rewriting the local part.
 * Only the domain is compared case-insensitively; dots and plus aliases are
 * preserved because they may be legitimate school aliases.
 */
export function validateStudentEmail(input: unknown): StudentEmailResult {
  const email = typeof input === 'string' ? input.trim() : '';
  if (!email) return { ok: false, email, message: '请输入学校邮箱' };
  if (email.length > 254) return { ok: false, email, message: '邮箱地址过长' };
  if (/\s/.test(email)) return { ok: false, email, message: '邮箱地址不能包含空格' };

  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) {
    return { ok: false, email, message: '邮箱格式不正确，请填写一个完整的学校邮箱' };
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { ok: false, email, message: '邮箱格式不正确，请检查 @ 前的地址' };
  }
  if (!LOCAL_PART.test(local)) {
    return { ok: false, email, message: '邮箱格式不正确，请检查是否包含非法字符' };
  }
  if (!DOMAIN_PART.test(domain) || domain.includes('..')) {
    return { ok: false, email, message: '邮箱格式不正确，请填写完整域名' };
  }
  if (domain.toLowerCase() !== STUDENT_EMAIL_DOMAIN) {
    return { ok: false, email, message: STUDENT_EMAIL_HINT };
  }
  return { ok: true, email };
}
