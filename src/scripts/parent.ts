import type { ParentState } from '../lib/types';
import { copy, parseName, parsePoints } from '../lib/validate';
import { api, showToast } from './api';

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
  const app = document.getElementById('app');
  const form = document.getElementById('email-form') as HTMLFormElement | null;
  if (!boot || !gate || !app || !form) return;

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
    app.hidden = true;
    gate.hidden = false;
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
    const result = await api<ParentState>('/api/parent/state');
    if (result.status === 401) {
      showGate();
      return;
    }
    if (result.status !== 200) return;
    showState(result.data);
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

  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    showToast(copy.loggedOut);
    showGate();
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
    const result = await api<{ toast?: string; message?: string; state?: ParentState }>(path, {
      method,
      body: JSON.stringify(body),
    });
    busy = false;
    if (result.data.toast) showToast(result.data.toast);
    else if (result.data.message) showToast(result.data.message);
    if (result.status >= 200 && result.status < 300) done?.();
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

function empty(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.textContent = text;
  return node;
}
