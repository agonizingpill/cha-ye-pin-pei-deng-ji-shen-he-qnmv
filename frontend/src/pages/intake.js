import {esc, field, formData, formEnd, handle, header, panelData, panelFields, panelStrip, shelfSample, status, datetime} from '../components.js';
import {request, store} from '../store.js';

export function intake(root, id, refresh) {
  const canEdit = store.session.user.role === 'operator';
  const lot = store.lots.find(lot => lot.id === id) || store.lots[0];
  const form = `<form class="paper form-stack" id="lot-form"><h2>原料到货登记</h2>
    <div class="two">${field('批次号', 'code', '', 'placeholder="WUYI-1121-F" pattern="[A-Z0-9][A-Z0-9-]{1,39}"')}
    ${field('品种', 'cultivar', '', 'placeholder="肉桂" maxlength="60"')}
    ${field('产区', 'origin', '', 'placeholder="马头岩" maxlength="60"')}
    ${field('焙火', 'roast', '', 'placeholder="中足火" maxlength="60"')}
    ${field('到货日期', 'received', '', 'type="date"')}
    ${field('净重（kg）', 'kilograms', '', 'type="number" min="0.01" step="0.01"')}</div>${formEnd('登记原料')}
    </form>`;
  root.innerHTML = `${header('原料批次', '核对入库茶样的来源、净重与评审进度。', canEdit ?
    `<a class="button" href="#/lots/new">登记到货</a>` : '')}
    <div class="work-grid"><section class="paper ledger"><h2>到货茶样 <small>${store.lots.length} 个批次</small></h2>
    ${store.lots.length ? `<div class="table-wrap"><table><thead><tr><th>批次 / 品种</th><th>来源</th><th>净重</th><th>可用性</th></tr></thead>
      <tbody>${store.lots.map(row => `<tr class="${id !== 'new' && lot?.id === row.id ? 'chosen' : ''}">
      <td><a href="#/lots/${row.id}">${esc(row.cultivar)}</a><small>${esc(row.code)}</small></td>
      <td>${esc(row.origin)}<small>${esc(row.roast)}</small></td><td>${esc(row.kilograms)} kg</td><td>${status(row.state)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">从登记一批到货原料开始。</p>'}</section>
    ${(id === 'new' || !lot) && canEdit ? form : lot ? `<aside class="paper side-ticket">
      <span class="mono">${esc(lot.code)}</span><h2>${esc(lot.cultivar)} · ${esc(lot.origin)}</h2><p>${esc(lot.received)} 到货，${esc(lot.roast)}</p>
      <h3>最近感官评语</h3>${lot.panels[0] ? `<blockquote>${esc(lot.panels[0].note)}</blockquote>` : '<p>等待首轮冲泡评分。</p>'}
      <h3>原料留样</h3>${lot.sample ? shelfSample(lot.sample) : '<p>到货样尚未登记柜位和封签。</p>'}
      <div class="side-links"><a href="#/sensory/${lot.id}">查看审评单 →</a><a href="#/samples/lot-${lot.id}">查看留样 →</a></div></aside>` : ''}</div>`;
  const newLot = root.querySelector('#lot-form');
  if (newLot) handle(newLot, form => request('/lots', formData(form)), row => { location.hash = `#/lots/${row.id}`; });
}

export function sensory(root, id, refresh) {
  const current = store.lots.find(lot => lot.id === id) || store.lots[0];
  const editable = store.session.user.role === 'operator';
  root.innerHTML = `${header('感官评审', '按批次录入冲泡评分。后续送审会冻结当时最新的一张审评单。')}
    ${current ? `<div class="work-grid sensory-grid"><section class="paper"><h2>冲泡记录</h2>
    <div class="lot-links">${store.lots.map(lot => `<a class="${lot.id === current.id ? 'active' : ''}" href="#/sensory/${lot.id}">${esc(lot.cultivar)}<small>${esc(lot.code)}</small></a>`).join('')}</div>
    <h3>${esc(current.cultivar)} · ${esc(current.origin)}</h3>
    ${current.panels.map(panel => `<article class="panel-record">${panelStrip(panel)}
      <blockquote>${esc(panel.note)}</blockquote><small>${esc(panel.author)} · ${datetime(panel.created_at)}</small></article>`).join('') || '<p class="empty">这批原料还没有审评单。</p>'}</section>
      ${editable ? `<form id="panel-form" class="paper form-stack"><h2>填写审评单</h2><p class="muted">香气、汤体、回甘、叶底各 0–100 分。杂味扣分 0–20 分。</p>
      ${panelFields()}${formEnd('保存感官记录')}</form>` : ''}</div>` : '<p class="empty">登记原料后即可创建冲泡记录。</p>'}`;
  const form = root.querySelector('#panel-form');
  if (form) handle(form, element => request(`/lots/${current.id}/panels`, panelData(element)), () => refresh('感官记录已保存。'));
}
