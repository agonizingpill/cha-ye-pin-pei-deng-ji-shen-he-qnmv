import {datetime, esc, field, formData, formEnd, handle, header, memo, panelData, panelFields, panelStrip, percent, status} from '../components.js';
import {GRADE, MISMATCH, RECALC, request, store} from '../store.js';

function shareRow(row = {}) {
  return `<div class="share-row"><label>原料批次<select name="lot" required><option value="">选择原料</option>
    ${store.lots.map(lot => `<option value="${lot.id}" ${lot.id === row.lot_id ? 'selected' : ''}>${esc(lot.cultivar)} · ${esc(lot.code)}</option>`).join('')}</select></label>
    ${field('比例（%）', 'percent', row.percent || '', 'type="number" min="0.01" max="100" step="0.01"')}
    <button type="button" class="quiet remove-share" aria-label="移除此原料">移除</button></div>`;
}

function editor(blend, root, refresh) {
  root.innerHTML = `${header(blend ? '修订拼配配方' : '填写拼配配方', '可以先存草稿，送审前须核对配比合计与每批原料留样。',
    `<a class="button quiet" href="#/blends${blend ? '/' + blend.id : ''}">返回台账</a>`)}
    <form id="recipe-form" class="paper form-stack recipe-form"><div class="two">
    ${field('配方号', 'code', blend?.code, blend ? 'readonly' : 'pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="BL-1121-D"')}
    ${field('拼配名', 'name', blend?.name, 'maxlength="60"')}</div><h2>原料比例</h2>
    <div id="shares">${(blend?.shares || [{}, {}]).map(shareRow).join('')}</div>
    <div class="sum-line"><button type="button" class="quiet" id="add-share">添加原料</button><output id="share-total"></output></div>
    ${memo('拼配意图', blend?.note)}${formEnd('保存配方草稿')}</form>`;
  const form = root.querySelector('#recipe-form');
  const shares = root.querySelector('#shares');
  const update = () => {
    const sum = [...shares.querySelectorAll('[name=percent]')].reduce((count, input) => count + Math.round(Number(input.value) * 100), 0);
    root.querySelector('#share-total').textContent = `配比合计 ${(sum / 100).toFixed(2)}%`;
    root.querySelector('#add-share').disabled = shares.children.length >= 8;
    shares.querySelectorAll('.remove-share').forEach(button => { button.disabled = shares.children.length <= 2; });
  };
  update();
  shares.addEventListener('input', update);
  shares.addEventListener('click', event => {
    if (!event.target.matches('.remove-share')) return;
    event.target.closest('.share-row').remove();
    update();
  });
  root.querySelector('#add-share').addEventListener('click', () => {
    shares.insertAdjacentHTML('beforeend', shareRow());
    update();
  });
  handle(form, element => {
    const {code, name, note} = formData(element);
    const data = {code, name, note, shares: [...shares.children].map(row => {
      const {lot, percent} = formDataFrom(row);
      return {lot_id: Number(lot), percent};
    })};
    return request(blend ? `/blends/${blend.id}` : '/blends', data, blend ? 'PUT' : 'POST');
  }, row => { location.hash = `#/blends/${row.id}`; });
}

function formDataFrom(row) {
  return {lot: row.querySelector('[name=lot]').value, percent: row.querySelector('[name=percent]').value};
}

function evidence(review) {
  const evidence = review.result;
  if (!evidence) return `<p class="empty">${review.state === 'failed' ? esc(review.failure) : '计算排队中，完成后显示复评决定。'}</p>`;
  return `<section class="evidence"><h3>模型判级依据</h3><div class="calibration-line">
    <span>最高置信度 <strong>${percent(evidence.confidence)}</strong></span><span>生效阈值 <strong>${percent(evidence.effective_threshold)}</strong></span><span>阈值 v${review.snapshot.policy_version}</span></div>
    ${evidence.probabilities ? `<div class="grade-bars">${Object.entries(GRADE).map(([key, label]) => `<div><span>${label}</span>
      <meter min="0" max="1" value="${evidence.probabilities[key]}">${percent(evidence.probabilities[key])}</meter><strong>${percent(evidence.probabilities[key])}</strong></div>`).join('')}</div>` :
      '<p class="muted">完成盲复评后显示各等级概率。</p>'}
    <details><summary>冻结输入与模型记录</summary><p class="mono digest">${esc(review.digest)}</p>
    <p>模型 ${esc(evidence.model)} · 种子 ${evidence.seed} · 训练 ${evidence.validation.training_rows} 条 / 验证 ${evidence.validation.validation_rows} 条</p>
    <ul>${review.snapshot.ingredients.map(row => `<li>${esc(row.lot)} · 封签 ${esc(row.seal)} · 审评单 #${row.panel_id}</li>`).join('')}</ul></details></section>`;
}

function recalcValues(result) {
  return `<p>候选等级 <strong>${GRADE[result.candidate]}</strong> · 复评去向 <strong>${result.needs_repanel ? '转盲复评' : '模型直判'}</strong></p>
    <div class="grade-bars">${Object.entries(GRADE).map(([key, label]) => `<div><span>${label}</span>
      <meter min="0" max="1" value="${result.probabilities[key]}">${percent(result.probabilities[key])}</meter><strong>${percent(result.probabilities[key])}</strong></div>`).join('')}</div>`;
}

function recalcSection(review) {
  const recalc = review.recalc;
  if (!recalc) return '';
  const items = (recalc.mismatches || []).map(key => MISMATCH[key] || key).join('、');
  const note = recalc.state === 'mismatched' ? `<p class="recalc-alert">对不上：${items}。已撤回初审、转盲复评，首算留底备查。</p>` :
    recalc.state === 'failed' ? `<p class="recalc-alert">复算失败：${esc(recalc.failure || '原模型取不到')}，签发已被拦截。</p>` :
    recalc.state === 'queued' ? '<p class="muted">独立复算进行中，吻合前签发将被拦截。</p>' : '';
  const compare = recalc.baseline && recalc.result ? `<div class="recalc-diff">
    <div><h4>首算留底</h4>${recalcValues(recalc.baseline)}</div>
    <div><h4>独立复算</h4>${recalcValues(recalc.result)}</div></div>` : '';
  return `<section class="evidence recalc"><h3>签发前独立复算 ${status(recalc.state)}</h3>
    <p class="muted">复算单 #${recalc.id} · 第 ${recalc.attempts} 次 · ${datetime(recalc.created_at)}</p>
    ${note}${compare}
    ${recalc.state === 'failed' && store.session.user.role === 'supervisor' ?
      `<form id="recalc-action">${formEnd('按原复算单重试')}</form>` : ''}</section>`;
}

function reviewActions(blend, user) {
  const {review} = blend;
  const own = user.id === blend.author_id;
  if (!review) return own ? `<form id="review-action" data-action="submit"><p class="muted">送审后锁定配方、原料评分、封签和阈值版本。</p>
    ${formEnd('冻结配方并送审', `<a class="button quiet" href="#/blends/edit-${blend.id}">修订配比</a>`)}</form>` : '';
  const state = review.state;
  if (state === 'approved') return `<a class="button" href="#/samples/blend-${blend.id}">登记成品留样 →</a>`;
  if (state === 'repanel' && user.role === 'operator' && !own) return `<form id="review-action" data-action="repanel" class="form-stack">
    <h3>盲复评</h3>${panelFields(true)}${formEnd('提交独立盲评')}</form>`;
  if (state === 'verify' && user.role === 'operator' && !own) return `<form id="review-action" data-action="verify" class="form-stack">
    ${memo('初审意见')}${formEnd('确认初审等级')}</form>`;
  if (state === 'signoff' && user.role === 'supervisor') {
    const blocked = !review.repanel && (!review.recalc || review.recalc.state !== 'matched');
    return `${blocked ? `<p class="empty">模型直判须独立复算吻合后放行${review.recalc ? `（当前：${RECALC[review.recalc.state]}）` : '（复算单缺失）'}。</p>` : ''}
      <form id="review-action" data-action="signoff" class="form-stack">
      ${memo('主管签发意见')}${formEnd('签发等级')}</form>`;
  }
  if (state === 'failed' && user.role === 'supervisor') return `<form id="review-action" data-action="retry">${formEnd('按原快照重试')}</form>`;
  return own && ['repanel', 'verify'].includes(state) ? '<p class="empty">等待另一位评审员处理。配方作者不可审核自己的配方。</p>' : '';
}

function blendDetail(blend) {
  const {review} = blend;
  const total = blend.shares.reduce((sum, row) => sum + Math.round(Number(row.percent) * 100), 0) / 100;
  return `<article class="paper blend-detail"><div class="blend-heading"><div><span class="mono">${esc(blend.code)} / V${blend.revision}</span>
    <h2>${esc(blend.name)}</h2></div>${status(review?.state)}</div><blockquote>${esc(blend.note)}</blockquote>
    <section class="blend-formula"><h3>配方组成 <small>合计 ${total.toFixed(2)}%</small></h3>
    <div class="ratio-band" aria-hidden="true">${blend.shares.map(row => `<div style="flex:${Number(row.percent)}"></div>`).join('')}</div>
    <ul>${blend.shares.map(row => `<li><strong>${esc(row.cultivar)}</strong><a href="#/lots/${row.lot_id}">${esc(row.code)}</a>
      <span>${esc(row.percent)}%</span>${!review ? status(row.lot_state) : ''}</li>`).join('')}</ul></section>
    ${review ? `${evidence(review)}${recalcSection(review)}${review.repanel ? `<section><h3>独立复评 · ${esc(review.repanel.author)}</h3>
      ${panelStrip(review.repanel)}<blockquote>${esc(review.repanel.note)}</blockquote><p>${GRADE[review.repanel.grade]}</p></section>` : ''}
      ${review.verified_by ? `<p class="muted">初审 ${esc(review.verified_by)}${review.signed_by ? ` · 主管 ${esc(review.signed_by)}` : ''}</p>` : ''}
      ${review.final_grade ? `<div class="issued"><span>已签发等级</span><strong>${GRADE[review.final_grade]}</strong></div>` : ''}` : ''}
    ${reviewActions(blend, store.session.user)}</article>`;
}

function policy(root, refresh) {
  const editable = store.session.user.role === 'supervisor';
  root.innerHTML = `${header('判级阈值版本', '新版本在下次送审时生效。已排队及已签发审核保留原版本。',
    '<a class="button quiet" href="#/blends">返回拼配台账</a>')}
    <div class="work-grid"><section class="paper"><h2>发布记录</h2><ul class="policies">${store.thresholds.map(row =>
      `<li><span class="mono">V${row.id}</span><strong>${percent(row.floor)}</strong><span>${esc(row.reason)} <small>${esc(row.author)}</small></span></li>`).join('') || '<li>等待主管发布首个阈值。</li>'}</ul></section>
      ${editable ? `<form id="policy-form" class="paper form-stack"><h2>发布新阈值</h2><p class="muted">最终生效值取策略阈值和验证集校准值中的较高值。</p>
       ${field('策略阈值（0.500–0.990）', 'floor', '', 'type="number" min="0.5" max="0.99" step="0.001"')}${memo('变更理由')}${formEnd('发布版本')}</form>` : ''}</div>`;
  const form = root.querySelector('#policy-form');
  if (form) handle(form, item => request('/thresholds', formData(item)), () => refresh('新版阈值已发布。'));
}

export function blends(root, id, refresh) {
  const user = store.session.user;
  if (id === 'policy') return policy(root, refresh);
  const edit = typeof id === 'string' && id.startsWith('edit-') ? store.blends.find(row => row.id === Number(id.slice(5))) : null;
  if (user.role === 'operator' && (id === 'new' || edit?.author_id === user.id && !edit.review)) return editor(edit, root, refresh);
  const selected = store.blends.find(row => row.id === id) || store.blends[0];
  root.innerHTML = `${header('拼配等级审核', '查看配方组成、盲复评队列及双人签发记录。', `<div class="header-actions">
    <a class="button quiet" href="#/blends/policy">阈值版本</a>${user.role === 'operator' ? '<a class="button" href="#/blends/new">新建拼配</a>' : ''}</div>`)}
    <div class="review-grid"><aside class="paper review-index"><h2>拼配台账</h2><ul>${store.blends.map(row =>
      `<li><a class="${row.id === selected?.id ? 'active' : ''}" href="#/blends/${row.id}"><span><small>${esc(row.code)}</small>
      <strong>${esc(row.name)}</strong></span>${status(row.review?.state)}</a></li>`).join('') || '<li class="empty">新建首个拼配配方。</li>'}</ul></aside>
    ${selected ? blendDetail(selected) : ''}</div>`;
  const action = root.querySelector('#review-action');
  if (action) handle(action, form => {
    const kind = form.dataset.action;
    if (kind === 'submit') return request(`/blends/${selected.id}/review`, {});
    const data = kind === 'repanel' ? panelData(form) : formData(form);
    return request(`/reviews/${selected.review.id}/${kind}`, data);
  }, () => refresh('审核记录已更新。'));
  const recalcAction = root.querySelector('#recalc-action');
  if (recalcAction) handle(recalcAction, () => request(`/reviews/${selected.review.id}/recalc/retry`, {}),
    () => refresh('已按原复算单重新排队复算。'));
}
