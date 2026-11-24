import {GRADE, LOT, REVIEW, SCORES} from './store.js';

export function esc(value = '') {
  const entities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
  return String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
}

export function datetime(value) {
  return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short'}).format(new Date(value));
}

export const percent = value => `${(100 * Number(value)).toFixed(1)}%`;
export const formData = form => Object.fromEntries(new FormData(form));

export function status(value) {
  const good = ['ready', 'approved', 'sealed'].includes(value);
  const warning = ['awaiting_sample', 'repanel', 'failed'].includes(value);
  return `<span class="status ${good ? 'good' : warning ? 'warn' : ''}">${REVIEW[value] || LOT[value] || '配方草稿'}</span>`;
}

export function header(title, copy, action = '') {
  return `<header class="page-header"><div><h1>${title}</h1><p>${copy}</p></div>${action}</header>`;
}

export function field(label, name, value = '', attrs = '') {
  return `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs} required></label>`;
}

export function memo(label = '评语', value = '') {
  return `<label>${label}<textarea name="note" minlength="2" maxlength="500" required>${esc(value)}</textarea></label>`;
}

export function formEnd(label, secondary = '') {
  return `<div class="form-end"><button type="submit">${label}</button>${secondary}</div><p class="form-feedback" role="status"></p>`;
}

export function panelFields(repanel = false) {
  return `<div class="score-fields">${Object.entries(SCORES).map(([key, label]) => field(label, key, '',
    `type="number" min="0" max="${key === 'defect' ? 20 : 100}"`)).join('')}</div>
    ${repanel ? `<label>盲复评等级<select name="grade" required><option value="" selected disabled>选择复评等级</option>${Object.entries(GRADE).map(([key, label]) =>
      `<option value="${key}">${label}</option>`).join('')}</select></label>` : ''}${memo('冲泡记录与评语')}`;
}

export function panelData(form) {
  const data = formData(form);
  for (const key of Object.keys(SCORES)) data[key] = Number(data[key]);
  return data;
}

export function panelStrip(panel) {
  return `<div class="score-strip">${Object.entries(SCORES).map(([name, label]) =>
    `<span><small>${label}</small><strong>${panel.scores[name]}</strong></span>`).join('')}</div>`;
}

export function shelfSample(sample) {
  return `<div class="shelf-tag"><strong>${esc(sample.seal)}</strong><span>${esc(sample.cabinet)}</span><span>${sample.grams} g</span></div>`;
}

export function handle(form, action, onSuccess) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const feedback = form.querySelector('.form-feedback');
    button.disabled = true;
    feedback.textContent = '处理中…';
    try {
      const data = await action(form);
      await onSuccess(data);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.classList.add('error');
    } finally {
      button.disabled = false;
    }
  });
}
