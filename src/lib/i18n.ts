// UI language for this device. Default is English. Only an explicit ks_lang
// cookie selects Chinese. Browser Accept-Language and navigator.language are
// never consulted. This cookie is not a session cookie.

export type Locale = 'en' | 'zh-CN';

export const LANG_COOKIE = 'ks_lang';
export const LANG_MAX_AGE = 60 * 60 * 24 * 365;

const SESSION_COOKIE_NAMES = ['ks_parent_session', 'ks_child_session', 'ks_session'] as const;

export function parseLocale(value: string | null | undefined): Locale {
  return value === 'zh-CN' ? 'zh-CN' : 'en';
}

export function localeFromCookieHeader(header: string | null | undefined): Locale {
  return parseLocale(readCookie(header, LANG_COOKIE));
}

export function htmlLang(locale: Locale): Locale {
  return locale === 'zh-CN' ? 'zh-CN' : 'en';
}

export function languageCookie(locale: Locale, secure: boolean): string {
  const parts = [`${LANG_COOKIE}=${encodeURIComponent(locale)}`, 'Path=/', `Max-Age=${LANG_MAX_AGE}`, 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Choice applied by the language control. Invalid values, including bare `zh`, do not switch. */
export function applyLanguageChoice(
  next: string,
  secure: boolean,
): { locale: Locale; lang: Locale; cookie: string } | null {
  if (next !== 'en' && next !== 'zh-CN') return null;
  const locale = next;
  return { locale, lang: htmlLang(locale), cookie: languageCookie(locale, secure) };
}

export function currentLocale(): Locale {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';
}

export function isSessionCookieName(name: string): boolean {
  return (SESSION_COOKIE_NAMES as readonly string[]).includes(name);
}

function catalog(zh: boolean) {
  const stars = (count: number) => (zh ? `${count} 星` : `${count} ${count === 1 ? 'star' : 'stars'}`);
  return {
    productName: zh ? '儿童星级奖励系统' : 'Kid Star Rewards',
    languageLabel: zh ? '语言' : 'Language',
    loading: zh ? '正在加载…' : 'Loading…',
    indexIntro: zh
      ? '封闭测试。家庭由邀请名单建立，没有公开注册。儿童用家庭码绑定设备。家长使用 Passkey，或用登录链接第一次登录。'
      : 'Closed beta. Families come from an invite list. There is no public signup. A child binds a device with a family code. A parent uses a passkey, or an email link the first time.',
    kidEntry: zh ? '儿童端' : 'Child',
    parentEntry: zh ? '家长端' : 'Parent',
    kidEntryNote: zh
      ? '每日打卡加星，兑换奖励会先冻结星星，等家长确认。'
      : 'Check in each day for stars. Redeeming a reward freezes the stars until a parent confirms.',
    parentEntryNote: zh
      ? '使用 Passkey 或登录链接。同意或拒绝兑换，管理任务和奖励。'
      : 'Use a passkey or an email link. Approve or reject redemptions, and manage tasks and rewards.',
    kidTitle: zh ? '/kid · 儿童星级奖励系统' : '/kid · Kid Star Rewards',
    parentTitle: zh ? '/parent · 儿童星级奖励系统' : '/parent · Kid Star Rewards',
    gateNote: zh
      ? '输入家庭码，把这台设备绑定到家庭。同一个家庭码可以绑定多台设备。'
      : 'Enter the family code to bind this device to the family. The same family code can bind more than one device.',
    familyCodePlaceholder: zh ? '家庭码 (例: STAR-4821)' : 'Family code (e.g. STAR-4821)',
    bindDevice: zh ? '绑定这台设备' : 'Bind this device',
    imParent: zh ? '我是家长' : "I'm a parent",
    imChild: zh ? '我是小朋友' : "I'm a child",
    childFallback: zh ? '儿童' : 'Child',
    signOutDevice: zh ? '退出此设备' : 'Sign out of this device',
    signOut: zh ? '退出' : 'Sign out',
    starsAvailable: zh ? '当前可用积分' : 'Stars you can use',
    starUnit: zh ? '星' : 'stars',
    dailyTasks: zh ? '每日打卡任务' : 'Daily check-in',
    wishlist: zh ? '奖励心愿单' : 'Wish list',
    noTasks: zh ? '今天还没有任务' : 'No tasks for today',
    noRewards: zh ? '还没有奖励' : 'No rewards yet',
    done: zh ? '已完成' : 'Done',
    checkIn: zh ? '打卡' : 'Check in',
    redeem: zh ? '兑换' : 'Redeem',
    locked: zh ? '未解锁' : 'Locked',
    plusStars: (points: number) => (zh ? `+${points} 星` : `+${points} ${points === 1 ? 'star' : 'stars'}`),
    starCount: (count: number) => stars(count),
    rewardNeed: (cost: number, need: number, unlocked: boolean) =>
      unlocked
        ? zh
          ? `需要 ${cost} 星`
          : `Needs ${stars(cost)}`
        : zh
          ? `需要 ${cost} 星 (还差 ${need} 星)`
          : `Needs ${stars(cost)} (${stars(need)} to go)`,
    loginHelp: zh
      ? '第一次登录请先用邮箱链接，验证后再登记 Passkey。若已在本机或 iCloud / Google 密码管理器中有钥匙，可直接使用 Passkey。'
      : 'The first sign-in uses the email link. After that link is verified, register a passkey. If this device, or iCloud or Google Password Manager, already has a key, you can use the passkey now.',
    emailPlaceholder: zh ? '家长邮箱' : 'Parent email',
    usePasskey: zh ? '使用 Passkey 登录' : 'Sign in with a passkey',
    sendLink: zh ? '发送登录链接' : 'Email me a login link',
    passkeyUnsupported: zh ? '当前浏览器不支持 Passkey，请使用登录链接。' : 'This browser does not support passkeys. Use the login link.',
    enrollTitle: zh ? '登记 Passkey' : 'Register a passkey',
    enrollWarn: zh
      ? '这是 workers.dev 上的试用。搬到正式域名之后，已经登记的 Passkey 会失效，需要再用邮箱登录链接重新登记。'
      : 'This trial runs on workers.dev. Passkeys registered here will not move to a future custom domain. After that change they stop working, and you will need the email login link to register again.',
    enrollNote: zh
      ? '请先登记一把 Passkey，才能使用家长面板。可以使用这台设备、iCloud 钥匙串或 Google 密码管理器。登记完成后，下次可以直接用 Passkey 登录。'
      : 'Register a passkey before the parent dashboard will open. You can use this device, iCloud Keychain, or Google Password Manager. Next time you can sign in with the passkey.',
    enrollButton: zh ? '登记 Passkey' : 'Register a passkey',
    familyCode: (code: string) => (zh ? `家庭码 ${code}` : `Family code ${code}`),
    timezoneLabel: zh ? '时区' : 'Time zone',
    keysAndSignIn: zh ? '密钥与登录' : 'Keys and sign-in',
    pendingTitle: zh ? '待审核兑换请求' : 'Redemptions to review',
    noPending: zh ? '暂无待审核的兑换申请' : 'No redemptions waiting for review',
    pendingName: (name: string) => (zh ? `申请兑换：${name}` : `Redeem: ${name}`),
    pendingMeta: (cost: number, time: string) =>
      zh ? `扣除 ${cost} 星 · 申请时间 ${time}` : `${stars(cost)} on hold · Requested ${time}`,
    approve: zh ? '同意' : 'Approve',
    reject: zh ? '拒绝' : 'Reject',
    addTaskSection: zh ? '自定义新增任务' : 'Add a task',
    taskNamePlaceholder: zh ? '任务名称 (例: 帮忙洗碗)' : 'Task name (e.g. wash the dishes)',
    taskPointsPlaceholder: zh ? '奖励星数' : 'Stars to award',
    addTask: zh ? '添加任务' : 'Add task',
    addRewardSection: zh ? '自定义新增奖励' : 'Add a reward',
    rewardNamePlaceholder: zh ? '奖励名称 (例: 去游乐园)' : 'Reward name (e.g. a trip to the park)',
    rewardCostPlaceholder: zh ? '所需星数' : 'Stars required',
    addReward: zh ? '添加奖励' : 'Add reward',
    logSection: zh ? '系统的操作日志' : 'Activity log',
    saveChanges: zh ? '保存修改' : 'Save changes',
    edit: zh ? '编辑' : 'Edit',
    turnOff: zh ? '停用' : 'Turn off',
    keysWarn: zh
      ? '试用域名上的 Passkey 不能带到以后的正式域名。换域名后，请用邮箱登录链接重新登记。'
      : 'Passkeys on this trial domain will not move to a future custom domain. After the domain changes, use the email login link to register again.',
    registerAnother: zh ? '再登记一把 Passkey' : 'Register another passkey',
    noPasskeys: zh ? '还没有 Passkey' : 'No passkeys yet',
    synced: zh ? '可同步' : 'Can sync',
    thisDevice: zh ? '仅此设备' : 'This device only',
    lastUsed: (when: string) => (zh ? `最近使用 ${when}` : `Last used ${when}`),
    notUsed: zh ? '尚未使用' : 'Not used yet',
    rename: zh ? '改名' : 'Rename',
    save: zh ? '保存' : 'Save',
    delete: zh ? '删除' : 'Delete',
    deleteConfirm: (name: string) =>
      zh
        ? `删除「${name}」？删掉最后一把后，需要重新登记才能使用家长面板。邮箱链接仍然可以登录。`
        : `Delete “${name}”? If you delete the last key, you will need to register again before the parent dashboard opens. The email link can still sign you in.`,
    passkeySyncedName: zh ? '已同步的 Passkey' : 'Synced passkey',
    passkeyDeviceName: 'Passkey',
    taskInvalid: zh ? '请输入有效的任务名称与奖励星数' : 'Enter a valid task name and a star amount.',
    rewardInvalid: zh ? '请输入有效的奖励名称与所需星数' : 'Enter a valid reward name and a star cost.',
    taskAdded: zh ? '任务添加成功' : 'Task added.',
    rewardAdded: zh ? '奖励添加成功' : 'Reward added.',
    taskUpdated: zh ? '任务已更新' : 'Task updated.',
    rewardUpdated: zh ? '奖励已更新' : 'Reward updated.',
    taskDisabled: zh ? '任务已停用' : 'Task turned off.',
    rewardDisabled: zh ? '奖励已停用' : 'Reward turned off.',
    checkin: (points: number) => (zh ? `打卡成功！获得 +${points} 颗星 🌟` : `Checked in. You earned +${points} stars.`),
    alreadyChecked: zh ? '今天已经打过这个任务啦' : 'You already checked in for this task today.',
    redeemPending: zh ? '已提交兑换申请，等待家长确认' : 'Redemption sent. Waiting for a parent to confirm.',
    needStars: zh ? '星星还不够，先去完成任务吧' : 'Not enough stars yet. Finish a task first.',
    approved: (name: string) => (zh ? `已同意兑换「${name}」` : `Approved “${name}”.`),
    rejected: zh ? '已拒绝，积分已退回' : 'Rejected. The stars are back.',
    codeInvalid: zh ? '家庭码不正确' : 'That family code is not correct.',
    noChild: zh ? '这个家庭还没有儿童账号' : 'This family does not have a child account yet.',
    linkInvalid: zh ? '登录链接无效或已过期' : 'This login link is invalid or has expired.',
    magicSent: zh ? '若该邮箱已在封闭测试名单中，登录链接已生成。' : 'If this email is on the closed-beta list, a login link has been created.',
    loggedOut: zh ? '已退出' : 'Signed out.',
    timezoneSaved: zh ? '时区已更新' : 'Time zone updated.',
    passkeyFailed: zh ? '未能使用 Passkey，请改用登录链接。' : 'The passkey could not be used. Use the login link instead.',
    passkeyRegistered: zh ? 'Passkey 已登记' : 'Passkey registered.',
    passkeyRequired: zh ? '请先登记 Passkey' : 'Register a passkey first.',
    passkeySignedIn: zh ? '已使用 Passkey 登录' : 'Signed in with a passkey.',
    passkeyUnavailable: zh ? '暂时无法登记 Passkey' : 'A passkey cannot be registered right now.',
    passkeyRegisterFailed: zh ? '未能登记 Passkey，请再试一次。' : 'The passkey was not registered. Please try again.',
    keyNameRequired: zh ? '请输入钥匙名称' : 'Enter a name for this key.',
    keyRenamed: zh ? '已更新名称' : 'Name updated.',
    keyDeletedLast: zh ? '已删除最后一把 Passkey，请重新登记' : 'The last passkey was deleted. Register one again.',
    keyDeleted: zh ? '已删除这把 Passkey' : 'Passkey deleted.',
    serverBusy: zh ? '系统繁忙，请稍后再试' : 'Something went wrong. Please try again.',
    originDenied: zh ? '来源不被允许' : 'This request was blocked.',
    emailInvalid: zh ? '请输入有效的邮箱' : 'Enter a valid email address.',
    badRequest: zh ? '请求格式不正确' : 'That request could not be read.',
    loginRequired: zh ? '请先登录' : 'Sign in first.',
    bindRequired: zh ? '请先绑定设备' : 'Bind this device first.',
    secretMissing: zh ? '服务器未配置 SESSION_SECRET' : 'The server is missing SESSION_SECRET.',
    dbMissing: zh ? '服务器未配置数据库' : 'The server database is not configured.',
    passkeyVerifyFailed: zh ? 'Passkey 校验失败' : 'The passkey could not be verified.',
    passkeyDuplicate: zh ? '这把钥匙已经登记过了' : 'This passkey is already registered.',
    passkeyResponseInvalid: zh ? 'Passkey 响应无效' : 'That passkey response could not be read.',
    passkeyLocalhost: zh ? '本地开发请使用 http://localhost:4321' : 'For local development, open http://localhost:4321.',
    passkeyUnconfigured: zh ? '服务器未配置 Passkey' : 'The server is not configured for passkeys.',
    passkeyOriginInvalid: zh ? 'Passkey 来源配置无效' : 'The passkey origin setting is invalid.',
    passkeyOriginMismatch: zh ? 'Passkey 的域名配置不一致' : 'The passkey domain settings do not match.',
    passkeyPublicSuffix: zh ? 'Passkey 不能使用 workers.dev 公共后缀' : 'A passkey cannot use the public workers.dev suffix.',
    rateLimited: zh ? '尝试次数过多，请稍后再试' : 'Too many attempts. Please wait and try again.',
    challengeUsed: zh ? '挑战已使用' : 'This challenge was already used.',
    challengeExpired: zh ? '挑战已过期' : 'This challenge has expired.',
    challengeInvalid: zh ? '挑战无效' : 'This challenge is not valid.',
    familyMissing: zh ? '家庭不存在' : 'That family could not be found.',
    taskMissing: zh ? '任务不存在' : 'That task could not be found.',
    rewardMissing: zh ? '奖励不存在' : 'That reward could not be found.',
    alreadyResolved: zh ? '这条申请已经处理过了' : 'This request has already been handled.',
    timezoneInvalid: zh ? '时区无效' : 'That time zone is not valid.',
    passkeyNotFound: zh ? '找不到这把 Passkey' : 'That passkey could not be found.',
    logTimezone: (zone: string) => (zh ? `家庭时区更新为 ${zone}` : `Family time zone set to ${zone}.`),
    logCheckin: (name: string, points: number) =>
      zh ? `完成任务「${name}」，获得 +${points} 星` : `Checked in “${name}” for +${points} stars.`,
    logRedeem: (name: string, cost: number) =>
      zh ? `发起兑换「${name}」，冻结 ${cost} 星，等待家长审核` : `Asked to redeem “${name}”. ${stars(cost)} are frozen until a parent reviews it.`,
    logReject: (name: string, cost: number) =>
      zh ? `家长拒绝兑换「${name}」，返还 ${cost} 星` : `A parent rejected “${name}”. ${stars(cost)} were returned.`,
    logApprove: (name: string, cost: number) =>
      zh ? `家长同意兑换「${name}」(-${cost} 星)` : `A parent approved “${name}” (−${cost} stars).`,
    logTaskAdded: (name: string, points: number) =>
      zh ? `新增每日任务「${name}」(+${points} 星)` : `Added daily task “${name}” (+${points} stars).`,
    logTaskUpdated: (name: string, points: number) =>
      zh ? `更新每日任务「${name}」(+${points} 星)` : `Updated daily task “${name}” (+${points} stars).`,
    logTaskDisabled: (name: string) => (zh ? `停用每日任务「${name}」` : `Turned off daily task “${name}”.`),
    logRewardAdded: (name: string, cost: number) =>
      zh ? `新增兑换奖励「${name}」(${cost} 星)` : `Added reward “${name}” (${stars(cost)}).`,
    logRewardUpdated: (name: string, cost: number) =>
      zh ? `更新兑换奖励「${name}」(${cost} 星)` : `Updated reward “${name}” (${stars(cost)}).`,
    logRewardDisabled: (name: string) => (zh ? `停用兑换奖励「${name}」` : `Turned off reward “${name}”.`),
  };
}

export type Copy = ReturnType<typeof catalog>;
export type ErrorKey = { [K in keyof Copy]: Copy[K] extends string ? K : never }[keyof Copy];

export function text(locale: Locale): Copy {
  return catalog(locale === 'zh-CN');
}

export function errorText(locale: Locale, key: string): string {
  const value = text(locale)[key as keyof Copy];
  return typeof value === 'string' ? value : text(locale).serverBusy;
}

function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
