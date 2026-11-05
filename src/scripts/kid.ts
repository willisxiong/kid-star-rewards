import type { KidState, KidTask, RewardItem } from '../lib/types';
import { api, icon, showToast } from './api';

const POLL_MS = 4000;

export function bootKid(): void {
  const boot = document.getElementById('boot');
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const form = document.getElementById('code-form') as HTMLFormElement | null;
  if (!boot || !gate || !app || !form) return;

  let polling = false;
  let busy = false;
  let fingerprint = '';

  const showGate = (note?: string) => {
    fingerprint = '';
    polling = false;
    boot.hidden = true;
    app.hidden = true;
    gate.hidden = false;
    if (note) {
      const noteEl = document.getElementById('gate-note');
      if (noteEl) noteEl.textContent = note;
    }
  };

  const showState = (state: KidState) => {
    const next = JSON.stringify(state);
    if (next === fingerprint && !app.hidden) return;
    fingerprint = next;
    render(state);
  };

  const render = (state: KidState) => {
    boot.hidden = true;
    gate.hidden = true;
    app.hidden = false;
    const balance = document.getElementById('balance');
    const childName = document.getElementById('child-name');
    if (balance) balance.textContent = String(state.balance);
    if (childName) childName.textContent = state.childName;
    renderTasks(state);
    renderRewards(state);
    polling = true;
  };

  const refresh = async () => {
    const result = await api<KidState>('/api/kid/state');
    if (result.status === 401) {
      showGate();
      return;
    }
    if (result.status !== 200) return;
    showState(result.data);
  };

  const renderTasks = (state: KidState) => {
    const grid = document.getElementById('task-grid');
    if (!grid) return;
    grid.replaceChildren();
    if (!state.tasks.length) {
      grid.append(empty('今天还没有任务'));
      return;
    }
    for (const task of state.tasks) grid.append(taskCard(task, state));
  };

  const taskCard = (task: KidTask, state: KidState) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    const info = document.createElement('div');
    info.className = 'item-info';
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = task.name;
    const points = document.createElement('span');
    points.className = 'item-points';
    const star = icon('star', true);
    star.style.fontSize = '14px';
    star.style.color = '#f59e0b';
    points.append(star, document.createTextNode(` +${task.points} 星`));
    info.append(name, points);
    const button = document.createElement('button');
    button.type = 'button';
    if (task.done) {
      button.className = 'action-btn disabled';
      button.disabled = true;
      const mark = icon('check_circle');
      mark.style.fontSize = '16px';
      button.append(mark, document.createTextNode(' 已完成'));
    } else {
      button.className = 'action-btn primary';
      button.textContent = '打卡';
      button.addEventListener('click', () => void onCheckin(task.id, state));
    }
    card.append(info, button);
    return card;
  };

  const renderRewards = (state: KidState) => {
    const grid = document.getElementById('reward-grid');
    if (!grid) return;
    grid.replaceChildren();
    if (!state.rewards.length) {
      grid.append(empty('还没有奖励'));
      return;
    }
    for (const reward of state.rewards) grid.append(rewardCard(reward, state));
  };

  const rewardCard = (reward: RewardItem, state: KidState) => {
    const unlocked = state.balance >= reward.cost;
    const need = reward.cost - state.balance;
    const pct = Math.max(0, Math.min(100, Math.round((state.balance / reward.cost) * 100)));
    const card = document.createElement('div');
    card.className = 'item-card';
    const info = document.createElement('div');
    info.className = 'item-info';
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = reward.name;
    const points = document.createElement('span');
    points.className = 'item-points';
    points.textContent = unlocked ? `需要 ${reward.cost} 星` : `需要 ${reward.cost} 星 (还差 ${need} 星)`;
    const bar = document.createElement('div');
    bar.className = 'progress-bar-bg';
    const fill = document.createElement('div');
    fill.className = 'progress-bar-fill';
    fill.style.width = unlocked ? '100%' : `${pct}%`;
    bar.append(fill);
    info.append(name, points, bar);
    const button = document.createElement('button');
    button.type = 'button';
    if (unlocked) {
      button.className = 'action-btn success';
      button.textContent = '兑换';
      button.addEventListener('click', () => void onRedeem(reward.id));
    } else {
      button.className = 'action-btn disabled';
      button.disabled = true;
      button.textContent = '未解锁';
    }
    card.append(info, button);
    return card;
  };

  const onCheckin = async (taskId: string, _state: KidState) => {
    if (busy) return;
    busy = true;
    const result = await api<{ toast?: string; state?: KidState; message?: string }>('/api/kid/checkin', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    });
    busy = false;
    if (result.data.toast) showToast(result.data.toast);
    else if (result.data.message) showToast(result.data.message);
    if (result.data.state) showState(result.data.state);
  };

  const onRedeem = async (rewardId: string) => {
    if (busy) return;
    busy = true;
    const result = await api<{ toast?: string; state?: KidState; message?: string }>('/api/kid/redeem', {
      method: 'POST',
      body: JSON.stringify({ rewardId }),
    });
    busy = false;
    if (result.data.toast) showToast(result.data.toast);
    else if (result.data.message) showToast(result.data.message);
    if (result.data.state) showState(result.data.state);
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('family-code-input') as HTMLInputElement | null;
    const familyCode = input?.value ?? '';
    const result = await api<{ message?: string; state?: KidState }>('/api/auth/child', {
      method: 'POST',
      body: JSON.stringify({ familyCode }),
    });
    if (result.status !== 200 || !result.data.state) {
      showToast(result.data.message || '家庭码不正确');
      return;
    }
    if (input) input.value = '';
    showState(result.data.state);
  });

  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    showToast('已退出');
    showGate();
  });

  window.setInterval(() => {
    if (!polling || document.visibilityState === 'hidden' || busy) return;
    void refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (polling && document.visibilityState === 'visible') void refresh();
  });

  void refresh();
}

function empty(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.textContent = text;
  return node;
}
