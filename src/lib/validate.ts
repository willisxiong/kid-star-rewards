export const copy = {
  taskInvalid: '请输入有效的任务名称与奖励星数',
  rewardInvalid: '请输入有效的奖励名称与所需星数',
  taskAdded: '任务添加成功',
  rewardAdded: '奖励添加成功',
  taskUpdated: '任务已更新',
  rewardUpdated: '奖励已更新',
  taskDisabled: '任务已停用',
  rewardDisabled: '奖励已停用',
  checkin: (points: number) => `打卡成功！获得 +${points} 颗星 🌟`,
  alreadyChecked: '今天已经打过这个任务啦',
  redeemPending: '已提交兑换申请，等待家长确认',
  needStars: '星星还不够，先去完成任务吧',
  approved: (name: string) => `已同意兑换「${name}」`,
  rejected: '已拒绝，积分已退回',
  codeInvalid: '家庭码不正确',
  linkInvalid: '登录链接无效或已过期',
  magicSent: '若该邮箱已在封闭测试名单中，登录链接已生成。',
  loggedOut: '已退出',
  timezoneSaved: '时区已更新',
} as const;

export function parseName(value: unknown, max = 40): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\r\n]+/g, ' ').trim();
  if (!name || name.length > max) return null;
  return name;
}

export function parsePoints(value: unknown, max = 999): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) return null;
  return numeric;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return null;
  return email;
}

export function normalizeFamilyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) return null;
  return code;
}
