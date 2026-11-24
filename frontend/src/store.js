export const ROLE = {operator: '评审员', supervisor: '品质主管', viewer: '只读观察员'};
export const REVIEW = {queued: '排队计算', failed: '计算失败', repanel: '待盲复评', verify: '待初审',
  signoff: '待签发', approved: '待成品封存', sealed: '已封存'};
export const RECALC = {queued: '复算核对中', matched: '复算吻合', mismatched: '复算对不上', failed: '复算失败'};
export const MISMATCH = {candidate: '候选等级', probabilities: '各级概率', needs_repanel: '复评去向'};
export const GRADE = {selection: '精选级', standard: '标准级', secondary: '复配级'};
export const LOT = {awaiting_panel: '待感官评审', awaiting_sample: '待留样', ready: '可用于拼配'};
export const SCORES = {aroma: '香气', body: '汤体', sweetness: '回甘', leaf: '叶底', defect: '杂味扣分'};

const key = 'tea-room-session';
export const store = {session: JSON.parse(sessionStorage.getItem(key) || 'null'), lots: [], blends: [], thresholds: []};
export function setSession(session) {
  store.session = session;
  if (session) sessionStorage.setItem(key, JSON.stringify(session));
  else sessionStorage.removeItem(key);
}

export async function request(path, data, method = data === undefined ? 'GET' : 'POST') {
  const headers = {'Content-Type': 'application/json'};
  if (store.session) headers.Authorization = `Bearer ${store.session.token}`;
  let response;
  try {
    response = await fetch(`/api${path}`, {method, headers, body: data === undefined ? undefined : JSON.stringify(data)});
  } catch {
    throw new Error('连接评审台失败，请重试。');
  }
  const payload = await response.json();
  if (response.status === 401 && path !== '/session') {
    setSession(null);
    location.hash = '#/login';
  }
  if (!response.ok) throw new Error(payload.detail || '操作未完成，请重试。');
  return payload;
}

export async function load(...keys) {
  const values = await Promise.all(keys.map(key => request(`/${key}`)));
  keys.forEach((key, index) => { store[key] = values[index]; });
}
