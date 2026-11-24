import {esc, field, formData, formEnd, handle, header, shelfSample, status} from '../components.js';
import {request, store} from '../store.js';

export function samples(root, id, refresh) {
  const rows = [
    ...store.lots.map(lot => ({key: `lot-${lot.id}`, code: lot.code, title: lot.cultivar, group: '原料留样',
      sample: lot.sample, state: lot.state, url: `/lots/${lot.id}/sample`, canSeal: !lot.sample})),
    ...store.blends.filter(blend => ['approved', 'sealed'].includes(blend.review?.state)).map(blend => ({
      key: `blend-${blend.id}`, code: blend.code, title: blend.name, group: '拼配成品留样', sample: blend.review.sample,
      state: blend.review.state, url: `/reviews/${blend.review.id}/sample`, canSeal: blend.review.state === 'approved'}))
  ];
  const current = rows.find(row => row.key === id) || rows.find(row => row.canSeal) || rows[0];
  const editable = current?.canSeal && store.session.user.role !== 'viewer';
  const groups = ['原料留样', '拼配成品留样'];
  root.innerHTML = `${header('留样封存', '登记封签、留样克重与柜位。成品须在主管签发后入柜。')}
  <div class="work-grid shelf-grid"><section class="paper shelf">${groups.map(group => `<h2>${group}</h2>
  <ul>${rows.filter(row => row.group === group).map(row => `<li class="${row.key === current?.key ? 'chosen' : ''}">
    <a href="#/samples/${row.key}"><strong>${esc(row.title)}</strong><small>${esc(row.code)}</small></a>
    ${row.sample ? shelfSample(row.sample) : status(row.state)}</li>`).join('') || `<li class="empty">${group === '原料留样' ? '登记到货后即可封存原料样。' : '待主管签发首个拼配等级。'}</li>`}</ul>`).join('')}</section>
  ${current ? `<aside class="paper side-ticket"><span class="mono">${esc(current.code)}</span><h2>${esc(current.title)}</h2>
    <p>${current.group} · ${current.sample ? '已入柜' : '等待封存'}</p>
    ${current.sample ? shelfSample(current.sample) : editable ? `<form id="seal-form" class="form-stack">
      ${field('封签号', 'seal', '', 'placeholder="RL-1121-06" pattern="[A-Z0-9][A-Z0-9-]{1,39}"')}
      ${field('留样净重（g）', 'grams', 80, 'type="number" min="20" max="1000"')}
      ${field('柜位', 'cabinet', '', 'placeholder="A 柜 / 06 格" maxlength="60"')}${formEnd('登记封签并入柜')}</form>` :
      '<p class="muted">请由评审员或品质主管核对实物并登记。</p>'}</aside>` : ''}</div>`;
  const form = root.querySelector('#seal-form');
  if (form) handle(form, element => request(current.url, formData(element)), () => refresh('封签已登记。'));
}
