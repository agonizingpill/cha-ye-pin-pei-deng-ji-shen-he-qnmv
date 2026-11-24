import {esc, field, formData, formEnd, handle} from './components.js';
import {load, request, ROLE, setSession, store} from './store.js';
import {intake, sensory} from './pages/intake.js';
import {blends} from './pages/blends.js';
import {samples} from './pages/samples.js';

const rooms = {
  lots: {label: '原料批次', render: intake, keys: ['lots']},
  sensory: {label: '感官评审', render: sensory, keys: ['lots']},
  blends: {label: '拼配审核', render: blends, keys: ['lots', 'blends', 'thresholds']},
  samples: {label: '留样封存', render: samples, keys: ['lots', 'blends']}
};
const root = document.querySelector('#room');
let revision = 0;
let tick;

function login() {
  root.innerHTML = `<main id="main" class="login-layout"><section class="tea-cover"><div class="brand-stamp">岩<span>册</span></div>
    <div class="cover-title"><p>武夷岩茶 · 审评室</p><h1>拼配<br>等级审核</h1><span></span></div>
    <div class="cover-work"><p>审评单、试拼配方和留样封签归在同一册，签发时可以回查每批原料。</p></div></section>
    <section class="login-desk"><form id="login" class="form-stack"><div><h2>登录审评台</h2><p>请输入评审室工号和口令。</p></div>
    ${field('工号', 'username', '', 'autocomplete="username" maxlength="40"')}
    ${field('口令', 'password', '', 'type="password" autocomplete="current-password"')}
    ${formEnd('进入工作区')}<details><summary>试用工号</summary>
    <div class="demo-roles"><button type="button" class="quiet" data-demo="lin">配方评审员</button>
    <button type="button" class="quiet" data-demo="he">独立评审员</button><button type="button" class="quiet" data-demo="xu">品质主管</button>
    <button type="button" class="quiet" data-demo="view">只读观察员</button></div></details></form></section></main>`;
  const form = root.querySelector('#login');
  form.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
    form.elements.username.value = button.dataset.demo;
    form.elements.password.value = 'Teacup1121!';
    form.elements.username.focus();
  }));
  handle(form, item => request('/session', formData(item)), session => {
    setSession(session);
    location.hash = '#/lots';
  });
}

async function render(message = '') {
  clearTimeout(tick);
  const pass = ++revision;
  const [page = 'lots', spec] = location.hash.slice(2).split('/');
  if (!store.session || page === 'login') return login();
  const section = Object.hasOwn(rooms, page) ? page : 'lots';
  const room = rooms[section];
  const user = store.session.user;
  const id = /^\d+$/.test(spec || '') ? Number(spec) : spec;
  root.innerHTML = `<div class="app-shell"><aside class="rail"><a class="brand" href="#/lots"><span class="brand-stamp">岩<span>册</span></span><strong>拼配评审室</strong></a>
    <nav aria-label="工作区">${Object.entries(rooms).map(([key, row]) => `<a href="#/${key}" ${key === section ? 'aria-current="page"' : ''}>${row.label}</a>`).join('')}</nav>
    <div class="identity"><strong>${esc(user.name)}</strong><span>${ROLE[user.role]}</span><button type="button" id="logout">退出</button></div></aside>
    <main id="main" tabindex="-1"><div class="desk-top"><span>武夷岩茶 / 品质室</span><button type="button" id="reload" class="quiet">刷新台账</button></div>
    ${message ? `<p class="notice" role="status">${esc(message)}</p>` : ''}<div id="page"><p class="empty">正在翻阅台账…</p></div></main></div>`;
  root.querySelector('#logout').onclick = () => { setSession(null); location.hash = '#/login'; };
  root.querySelector('#reload').onclick = () => render();
  const content = root.querySelector('#page');
  try {
    await load(...room.keys);
    if (pass !== revision) return;
    room.render(content, id, render);
    const review = store.blends.find(row => row.id === id)?.review;
    if (section === 'blends' && (review?.state === 'queued' || review?.recalc?.state === 'queued'))
      tick = setTimeout(() => render(), 1800);
  } catch (error) {
    if (pass === revision) content.innerHTML = `<p class="empty error" role="alert">${esc(error.message)} 请刷新台账重试。</p>`;
  }
}

window.addEventListener('hashchange', () => render());
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#main')?.focus();
});
render();
