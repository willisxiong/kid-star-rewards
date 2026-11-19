import { currentLocale, text } from '../lib/i18n';
import type { KidState, KidTask, RewardItem } from '../lib/types';
import { api, icon, showToast } from './api';

const POLL_MS = 4000;

export function bootKid(initial: KidState | null): void {
  const boot = document.getElementById('boot');
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const form = document.getElementById('code-form') as HTMLFormElement | null;
  if (!boot || !gate || !app || !form) return;

  let polling = false;
  let busy = false;
  let epoch = 0;
  let fingerprint = '';

  const ui = () => text(currentLocale());
  const params = new URLSearchParams(location.search);
  const bind = params.get('bind');
  if (bind === 'invalid') showToast(ui().codeInvalid);
  else if (bind === 'nochild') showToast(ui().noChild);
  if (bind) {
    params.delete('bind');
    const next = params.toString();
    history.replaceState(null, '', next ? `${location.pathname}?${next}` : location.pathname);
  }

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
    const ticket = epoch;
    const result = await api<KidState>('/api/kid/state');
    if (ticket !== epoch) return;
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
      grid.append(empty(ui().noTasks));
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
    points.append(star, document.createTextNode(` ${ui().plusStars(task.points)}`));
    info.append(name, points);
    const button = document.createElement('button');
    button.type = 'button';
    if (task.done) {
      button.className = 'action-btn disabled';
      button.disabled = true;
      const mark = icon('check_circle');
      mark.style.fontSize = '16px';
      button.append(mark, document.createTextNode(` ${ui().done}`));
    } else {
      button.className = 'action-btn primary';
      button.textContent = ui().checkIn;
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
      grid.append(empty(ui().noRewards));
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
    points.textContent = ui().rewardNeed(reward.cost, need, unlocked);
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
      button.textContent = ui().redeem;
      button.addEventListener('click', () => void onRedeem(reward.id));
    } else {
      button.className = 'action-btn disabled';
      button.disabled = true;
      button.textContent = ui().locked;
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

  document.getElementById('logout')?.addEventListener('click', async () => {
    epoch += 1;
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ role: 'child' }) });
    showToast(ui().loggedOut);
    showGate();
  });

  window.setInterval(() => {
    if (!polling || document.visibilityState === 'hidden' || busy) return;
    void refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (polling && document.visibilityState === 'visible') void refresh();
  });

  if (initial) showState(initial);
  void refresh();
}

function empty(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.textContent = text;
  return node;
}
