import type { ParentState, PasskeyItem } from '../lib/types';
import { copy, parseName, parsePoints } from '../lib/validate';
import { api, showToast } from './api';
import { authenticateWithPasskey, browserSupportsPasskey, registerPasskey } from './passkey-client';

const POLL_MS = 4000;
const TIMEZONES = [
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Europe/London',
  'America/Los_Angeles',
  'America/New_York',
  'UTC',
];

type EditTarget = { kind: 'task' | 'reward'; id: string } | null;

export function bootParent(): void {
  const boot = document.getElementById('boot');
  const gate = document.getElementById('gate');
  const enroll = document.getElementById('enroll');
  const app = document.getElementById('app');
  const form = document.getElementById('email-form') as HTMLFormElement | null;
  if (!boot || !gate || !enroll || !app || !form) return;

  const supportsPasskey = browserSupportsPasskey();
  const passkeyButton = document.getElementById('passkey-login');
  const sendLink = document.getElementById('send-link');
  const unsupported = document.getElementById('passkey-unsupported');
  if (!supportsPasskey) {
    if (passkeyButton) passkeyButton.hidden = true;
    sendLink?.classList.add('primary');
    if (unsupported) unsupported.hidden = false;
  }

  let polling = false;
  let busy = false;
  let editing: EditTarget = null;
  let fingerprint = '';
  const params = new URLSearchParams(location.search);
  if (params.get('link') === 'invalid') showToast(copy.linkInvalid);

  const showGate = () => {
    fingerprint = '';
    polling = false;
    boot.hidden = true;
    enroll.hidden = true;
    app.hidden = true;
    gate.hidden = false;
  };

  const showEnroll = () => {
    fingerprint = '';
    polling = false;
    boot.hidden = true;
    gate.hidden = true;
    app.hidden = true;
    enroll.hidden = false;
  };

  const showState = (state: ParentState) => {
    const next = JSON.stringify(state);
    if (next === fingerprint && !app.hidden) return;
    fingerprint = next;
    render(state);
  };

  const render = (state: ParentState) => {
    boot.hidden = true;
    gate.hidden = true;
    enroll.hidden = true;
    app.hidden = false;
    const balance = document.getElementById('balance');
    if (balance) balance.textContent = String(state.balance);
    const code = document.getElementById('family-code');
    if (code) code.textContent = `家庭码 ${state.familyCode}`;
    fillTimezones(state.timezone);
    renderPending(state);
    renderCatalog(state);
    renderLogs(state);
    polling = true;
  };

  const refresh = async () => {
    const result = await api<ParentState & { message?: string; error?: string }>('/api/parent/state');
    if (result.status === 401) {
      showGate();
      return;
    }
    if (result.status !== 200) return;
    if (!result.data.hasPasskeys) {
      showEnroll();
      return;
    }
    showState(result.data);
  };

  const enrollNow = async () => {
    const result = await registerPasskey();
    showToast(result.message);
    if (result.ok) await refresh();
    else if (result.message === '请先登录') showGate();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('email') as HTMLInputElement | null;
    const button = document.getElementById('send-link') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    const result = await api<{ message?: string; devLink?: string }>('/api/auth/request', {
      method: 'POST',
      body: JSON.stringify({ email: input?.value ?? '' }),
    });
    if (button) button.disabled = false;
    if (result.status !== 200) {
      showToast(result.data.message || '请输入有效的邮箱');
      return;
    }
    const note = document.getElementById('sent-note');
    if (note) {
      note.hidden = false;
      note.textContent = result.data.message || copy.magicSent;
    }
    const dev = document.getElementById('dev-link');
    if (dev) {
      if (result.data.devLink) {
        dev.hidden = false;
        dev.textContent = result.data.devLink;
      } else {
        dev.hidden = true;
        dev.textContent = '';
      }
    }
    showToast(result.data.message || copy.magicSent);
  });

  document.getElementById('passkey-login')?.addEventListener('click', async () => {
    const button = document.getElementById('passkey-login') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    const result = await authenticateWithPasskey();
    if (button) button.disabled = false;
    if (!result.ok) {
      showToast(copy.passkeyFailed);
      return;
    }
    showToast(result.message);
    await refresh();
  });

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ role: 'parent' }) });
    showToast(copy.loggedOut);
    showGate();
  };
  document.getElementById('logout')?.addEventListener('click', () => void logout());
  document.getElementById('enroll-logout')?.addEventListener('click', () => void logout());
  document.getElementById('enroll-passkey')?.addEventListener('click', () => void enrollNow());
  document.getElementById('register-another')?.addEventListener('click', () => void enrollNow());
  document.getElementById('manage-keys')?.addEventListener('click', () => {
    const panel = document.getElementById('keys-panel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) void loadKeys();
  });

  document.getElementById('timezone')?.addEventListener('change', async (event) => {
    const timezone = (event.target as HTMLSelectElement).value;
    const result = await api<{ toast?: string; message?: string; state?: ParentState }>('/api/parent/family', {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    });
    if (result.data.toast) showToast(result.data.toast);
    else if (result.data.message) showToast(result.data.message);
    if (result.data.state) showState(result.data.state);
  });

  document.getElementById('add-task')?.addEventListener('click', () => void saveTask());
  document.getElementById('add-reward')?.addEventListener('click', () => void saveReward());

  const saveTask = async () => {
    const nameInput = document.getElementById('task-name') as HTMLInputElement | null;
    const pointsInput = document.getElementById('task-points') as HTMLInputElement | null;
    const name = parseName(nameInput?.value);
    const points = parsePoints(pointsInput?.value);
    if (!name || points == null) {
      showToast(copy.taskInvalid);
      return;
    }
    const path = editing?.kind === 'task' ? `/api/parent/tasks/${editing.id}` : '/api/parent/tasks';
    const method = editing?.kind === 'task' ? 'PATCH' : 'POST';
    await mutate(path, method, { name, points }, () => {
      if (nameInput) nameInput.value = '';
      if (pointsInput) pointsInput.value = '';
      clearEdit('task');
    });
  };

  const saveReward = async () => {
    const nameInput = document.getElementById('reward-name') as HTMLInputElement | null;
    const costInput = document.getElementById('reward-cost') as HTMLInputElement | null;
    const name = parseName(nameInput?.value);
    const cost = parsePoints(costInput?.value, 9999);
    if (!name || cost == null) {
      showToast(copy.rewardInvalid);
      return;
    }
    const path = editing?.kind === 'reward' ? `/api/parent/rewards/${editing.id}` : '/api/parent/rewards';
    const method = editing?.kind === 'reward' ? 'PATCH' : 'POST';
    await mutate(path, method, { name, cost }, () => {
      if (nameInput) nameInput.value = '';
      if (costInput) costInput.value = '';
      clearEdit('reward');
    });
  };

  const mutate = async (path: string, method: string, body: unknown, done?: () => void) => {
    if (busy) return;
    busy = true;
    const result = await api<{ toast?: string; message?: string; error?: string; state?: ParentState }>(path, {
      method,
      body: JSON.stringify(body),
    });
    busy = false;
    if (result.data.toast) showToast(result.data.toast);
    else if (result.data.message) showToast(result.data.message);
    if (result.status >= 200 && result.status < 300) done?.();
    if (result.status === 403 && result.data.error === 'passkey_required') {
      showToast(result.data.message || copy.passkeyRequired);
      showEnroll();
      return;
    }
    if (result.data.state) showState(result.data.state);
    else if (result.status === 401) showGate();
  };

  const clearEdit = (kind: 'task' | 'reward') => {
    if (editing?.kind === kind) editing = null;
    const button = document.getElementById(kind === 'task' ? 'add-task' : 'add-reward');
    if (button) button.textContent = kind === 'task' ? '添加任务' : '添加奖励';
  };

  const renderPending = (state: ParentState) => {
    const list = document.getElementById('pending-list');
    const badge = document.getElementById('pending-badge');
    if (!list || !badge) return;
    list.replaceChildren();
    if (!state.pending.length) {
      badge.hidden = true;
      list.append(empty('暂无待审核的兑换申请'));
      return;
    }
    badge.hidden = false;
    badge.textContent = String(state.pending.length);
    for (const item of state.pending) {
      const card = document.createElement('div');
      card.className = 'pending-card';
      const info = document.createElement('div');
      info.className = 'item-info';
      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = `申请兑换：${item.name}`;
      const points = document.createElement('span');
      points.className = 'item-points';
      points.textContent = `扣除 ${item.cost} 星 · 申请时间 ${item.time}`;
      info.append(name, points);
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'action-btn success small';
      approve.textContent = '同意';
      approve.addEventListener('click', () => void mutate(`/api/parent/redemptions/${item.id}/approve`, 'POST', {}));
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'action-btn danger small';
      reject.textContent = '拒绝';
      reject.addEventListener('click', () => void mutate(`/api/parent/redemptions/${item.id}/reject`, 'POST', {}));
      actions.append(approve, reject);
      card.append(info, actions);
      list.append(card);
    }
  };

  const renderCatalog = (state: ParentState) => {
    const tasks = document.getElementById('task-catalog');
    const rewards = document.getElementById('reward-catalog');
    if (!tasks || !rewards) return;
    tasks.replaceChildren();
    rewards.replaceChildren();
    for (const task of state.tasks) {
      tasks.append(catalogRow(task.name, `+${task.points} 星`, () => {
        editing = { kind: 'task', id: task.id };
        const nameInput = document.getElementById('task-name') as HTMLInputElement | null;
        const pointsInput = document.getElementById('task-points') as HTMLInputElement | null;
        if (nameInput) nameInput.value = task.name;
        if (pointsInput) pointsInput.value = String(task.points);
        const button = document.getElementById('add-task');
        if (button) button.textContent = '保存修改';
      }, () => void mutate(`/api/parent/tasks/${task.id}`, 'DELETE', {})));
    }
    for (const reward of state.rewards) {
      rewards.append(catalogRow(reward.name, `${reward.cost} 星`, () => {
        editing = { kind: 'reward', id: reward.id };
        const nameInput = document.getElementById('reward-name') as HTMLInputElement | null;
        const costInput = document.getElementById('reward-cost') as HTMLInputElement | null;
        if (nameInput) nameInput.value = reward.name;
        if (costInput) costInput.value = String(reward.cost);
        const button = document.getElementById('add-reward');
        if (button) button.textContent = '保存修改';
      }, () => void mutate(`/api/parent/rewards/${reward.id}`, 'DELETE', {})));
    }
  };

  const renderLogs = (state: ParentState) => {
    const list = document.getElementById('log-list');
    if (!list) return;
    list.replaceChildren();
    for (const item of state.logs) {
      const row = document.createElement('div');
      row.className = 'log-item';
      const text = document.createElement('span');
      text.textContent = item.text;
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = item.time;
      row.append(text, time);
      list.append(row);
    }
  };

  const fillTimezones = (current: string) => {
    const select = document.getElementById('timezone') as HTMLSelectElement | null;
    if (!select || document.activeElement === select) return;
    const zones = TIMEZONES.includes(current) ? TIMEZONES : [current, ...TIMEZONES];
    if (select.options.length !== zones.length) {
      select.replaceChildren();
      for (const zone of zones) {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        select.append(option);
      }
    }
    if (select.value !== current) select.value = current;
  };

  const loadKeys = async () => {
    const list = document.getElementById('keys-list');
    if (!list) return;
    const result = await api<{ passkeys?: PasskeyItem[]; message?: string }>('/api/parent/passkeys');
    if (result.status === 401) {
      showGate();
      return;
    }
    if (result.status !== 200) {
      if (result.data.message) showToast(result.data.message);
      return;
    }
    list.replaceChildren();
    const passkeys = result.data.passkeys ?? [];
    if (!passkeys.length) {
      list.append(empty('还没有 Passkey'));
      return;
    }
    for (const key of passkeys) list.append(keyRow(key));
  };

  const keyRow = (key: PasskeyItem) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    const info = document.createElement('div');
    info.className = 'item-info';
    const title = document.createElement('span');
    title.className = 'item-name';
    title.textContent = key.friendlyName;
    const meta = document.createElement('span');
    meta.className = 'item-points';
    const kind = key.backupEligible ? '可同步' : '仅此设备';
    const used = key.lastUsedAt ? `最近使用 ${formatWhen(key.lastUsedAt)}` : '尚未使用';
    meta.textContent = `${kind} · ${used}`;
    const renameInput = document.createElement('input');
    renameInput.className = 'lumi-input-custom';
    renameInput.value = key.friendlyName;
    renameInput.maxLength = 40;
    renameInput.hidden = true;
    info.append(title, meta, renameInput);
    const actions = document.createElement('div');
    actions.className = 'auth-actions';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'action-btn small';
    rename.textContent = '改名';
    rename.addEventListener('click', () => {
      if (renameInput.hidden) {
        renameInput.hidden = false;
        rename.textContent = '保存';
        renameInput.focus();
        return;
      }
      void saveKeyName(key.id, renameInput.value);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'action-btn danger small';
    remove.textContent = '删除';
    remove.addEventListener('click', () => void removeKey(key));
    actions.append(rename, remove);
    card.append(info, actions);
    return card;
  };

  const saveKeyName = async (id: string, value: string) => {
    const name = parseName(value);
    if (!name) {
      showToast('请输入钥匙名称');
      return;
    }
    const result = await api<{ message?: string }>(`/api/parent/passkeys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ friendlyName: name }),
    });
    if (result.data.message) showToast(result.data.message);
    if (result.status === 401) showGate();
    else await loadKeys();
  };

  const removeKey = async (key: PasskeyItem) => {
    if (!window.confirm(`删除「${key.friendlyName}」？删掉最后一把后，需要重新登记才能使用家长面板。邮箱链接仍然可以登录。`)) return;
    const result = await api<{ message?: string; passkeyCount?: number }>(`/api/parent/passkeys/${key.id}`, { method: 'DELETE' });
    if (result.data.message) showToast(result.data.message);
    if (result.status === 401) {
      showGate();
      return;
    }
    if (result.status === 200 && result.data.passkeyCount === 0) {
      showEnroll();
      return;
    }
    await loadKeys();
  };

  window.setInterval(() => {
    if (!polling || document.visibilityState === 'hidden' || busy) return;
    void refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (polling && document.visibilityState === 'visible') void refresh();
  });

  void refresh();
}

function catalogRow(name: string, meta: string, onEdit: () => void, onDelete: () => void): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'item-card';
  const info = document.createElement('div');
  info.className = 'item-info';
  const title = document.createElement('span');
  title.className = 'item-name';
  title.textContent = name;
  const points = document.createElement('span');
  points.className = 'item-points';
  points.textContent = meta;
  info.append(title, points);
  const actions = document.createElement('div');
  actions.className = 'auth-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'action-btn small';
  edit.textContent = '编辑';
  edit.addEventListener('click', onEdit);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'action-btn danger small';
  remove.textContent = '停用';
  remove.addEventListener('click', onDelete);
  actions.append(edit, remove);
  card.append(info, actions);
  return card;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function empty(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.textContent = text;
  return node;
}
