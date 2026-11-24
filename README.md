# 岩册 · 茶叶拼配等级审核

南涧岩茶工坊的品质室用岩册核对拼配比例、独立盲复评、双人签发和留样柜位。每个签发等级可回查送审当时的原料评分及封签。

## 工坊工作流

南涧岩茶工坊是一个模拟客户，有 12 名工人、两名日常评审员和一名品质主管。原料班交接批次号、产区、火功与净重，品质室逐批冲泡、称配并签发等级。包装班按已签发且入柜的批次核对封签后接手。工坊原来分开用纸质感官单、Excel 配比表和留样柜台账，容易漏掉称重差额、在评分后来被更改时丢失送审依据，以及把交界样按最高模型概率直接定级。

| 角色 | 可操作页面 | 典型动作 |
|---|---|---|
| `operator` 评审员 | 原料、感官、拼配、留样 | 登记到货与评分、修订自己的草稿、送审、盲复评或初审他人的配方、封签入柜 |
| `supervisor` 品质主管 | 全部台账、阈值版本、拼配及留样操作 | 发布阈值版本、签发、重试失败计算、封存 |
| `viewer` 观察员 | 全部台账 | 查批次、模型判定、签发和柜位 |

### 2026 年 11 月 21 日交班剧本

1. 08:40，林苇收录 `WUYI-1121-A` 马头岩肉桂 36.00 kg、`WUYI-1121-B` 慧苑坑水仙 48.50 kg 等五批原料。
2. 09:00，何栀录入肉桂香气 94、汤体 92、回甘 90、叶底 88、杂味扣分 1。她将 80 g 原料样以 `RL-1121-1` 封存到 A 柜 01 格。
3. 09:20，林苇以肉桂 60% 和水仙 40% 送审 `BL-1121-A` 岩骨桂香。审核单冻结评分、封签及阈值 v1。
4. 09:40，何栀查模型概率和原料组成，完成初审。许衡另行签发。品质室把签发后的成品留样入 B 柜。
5. 10:05，`BL-1121-B` 兰韵试拼的置信度低于生效阈值。何栀先完成盲复评，再查看模型候选，随后初审，许衡签发复评所得等级。
6. 10:30，`BL-1121-C` 罗汉增厚试案的 55/40 配比只合计 95.00%，暂缓送审。调整到 55/45 后还须补 `WUYI-1121-E` 铁罗汉的留样封签。
7. 11:00，许衡发布带理由的新阈值。铁罗汉补封入柜后重送时采用新版本，早先的两张审核依据保留原版本。
8. 11:20，包装班用只读账户核对签发等级和成品封签，按入柜记录交班。

## 启动

```sh
cp .env.example .env
docker compose config --quiet
docker compose up -d --build --wait
# 演示资料默认随 API 初始化，也可手动重复执行。
docker compose exec -T backend python -m scripts.seed_demo
docker compose down -v --remove-orphans
```

| 入口 | 地址 |
|---|---|
| 审评台 | `http://localhost:18267` |
| API 与 OpenAPI | `http://localhost:19267`、`http://localhost:19267/docs` |
| MySQL | `localhost:17767`，数据库 `tearoom`，用户 `tearoom` |

演示工号 `lin`（林苇）和 `he`（何栀）均为评审员，可演示作者和审核员的分工。`xu`（许衡）为主管，`view`（周舟）为观察员。四个账户的演示口令均为 `Teacup1121!`。

| 配置 | 用途 |
|---|---|
| `COMPOSE_PROJECT_NAME` | Compose 容器前缀 |
| `FRONTEND_PORT` / `BACKEND_PORT` / `DB_PORT` | 宿主机映射端口 |
| `DB_PASSWORD` / `DB_ROOT_PASSWORD` | MySQL 访问口令，`DB_PASSWORD` 用于容器中的 `DATABASE_URL` |
| `JWT_SECRET` | HS256 签名密钥 |
| `SEED_DEMO` | 启动是否填充演示资料 |
| `DATABASE_URL` / `REDIS_URL` | API 和 worker 内部连接 |

本地开发可继续使用 Compose 的 MySQL 和 Redis，安装 `backend/requirements.txt` 后从 `backend/` 运行 `uvicorn src.main:app --reload`。设置 `DATABASE_URL` 指向本机映射的 MySQL，`REDIS_URL` 指向开发 Redis，`JWT_SECRET` 使用开发值。前端使用 Nginx 容器提供原生模块并代理 `/api/`。Compose 中数据库、队列和 worker 心跳分别使用命名卷。`down -v` 会清掉本项目的数据卷。

## 判级依据

`GradientBoostingClassifier` 的输入是按配比加权的香气、汤体、回甘、叶底、杂味扣分，及原料香气的加权标准差。固定种子 67 生成 1,050 条模拟历史样本，分层拆成 787 条训练、263 条校准。依次检查候选置信度线 `.50, .55, …, .95`，取验证样本保留至少 25 条、保留集正确率至少 90% 的最低值。未找到合格阈值时全部复评。实际阈值取校准线和已冻结主管策略的较高值。等级概率对应精选级、标准级及复配级。低于阈值走盲复评，由复评杯样等级替代模型候选。

计算任务在 MySQL 中持久化，Redis 唤醒 worker。队列通知丢失时 worker 扫描待计算记录，失败后由主管按原输入摘要重试。记录保留输入、SHA-256、参数、固定种子、概率、校准覆盖率及验证准确率。数据从模拟历史生成，验证指标用于说明阈值行为。静态初始数据 5 批原料、5 张原料感官单、4 个原料封签、3 套配方、2 个待计算审核、1 个阈值版本。seed 按自然键补建，并保留录入后的业务变化。

| 路径 | 职责 |
|---|---|
| `backend/src/models.py` / `schemas.py` | 批次、感官单、拼配比例、等级、阈值与封签约束 |
| `backend/src/workflow.py` / `routes.py` / `present.py` | 快照、独立复评、双人签发、封存及 API |
| `backend/src/grade_model.py` / `worker.py` | 模型拟合、阈值校准、持久化消费 |
| `backend/scripts/seed_demo.py` | 可重入的演示工作台初始化 |
| `frontend/src/store.js` / `components.js` / `pages/` | API、会话、共享界面件、业务入口 |

前后端共享枚举 `Role`、`ReviewState`、`Grade` 见 `backend/src/constants.py` 和 `frontend/src/store.js`。原料可用性在 `backend/src/workflow.py` 计算，展示映射在 `frontend/src/store.js`。项目使用 Python 3.11、FastAPI、SQLAlchemy、scikit-learn、MySQL 8、Redis 7、Nginx 与原生 HTML/CSS/JS。

[MIT License](LICENSE)


## 业务核验模块

登录后打开页面右下角的「业务核验」。可从实时业务台账筛选记录、导出所选结果，主管可对当前证据签认并填写说明。

- **签发等级留样链** 对照签发等级采用的各原料份额和可追踪留样；有评审专属留样时单列，没有留样时提醒仓管补核。

### 二次扩展核验

- **拼配原料品评覆盖** 逐配方核对有占比的原料批是否具备品评，将缺少原料品评的配方交给品控补测。
