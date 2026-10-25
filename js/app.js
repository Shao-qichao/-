/* AlgoDojo 界面层 */
(function () {
  'use strict';

  var Core = window.AlgoCore;
  var Cloud = window.AlgoCloud;
  var CONF = window.ALGODOJO_CONFIG || {};
  var state = Core.load();
  var view = 'today';
  var today = Core.todayStr();
  var filters = { q: '', type: 'all', status: 'all' };
  var openStages = { c: true, cpp: false, algo: false, ds: false };
  var confirmResolve = null;
  var pushTimer = null;
  var pendingRemote = null;
  var viewEl, toastEl, sheetRoot;

  var TYPE_LABEL = { problem: '题目', tutorial: '教程', video: '视频', book: '书', article: '文章' };
  var TYPE_ICON = { problem: '题', tutorial: '文', video: '视', book: '书', article: '章' };
  var STATUS_LABEL = { todo: '未开始', doing: '进行中', done: '已完成' };
  var KIND_ORDER = { study: 0, practice: 1, review: 2, custom: 3 };
  var DIFFS = ['入门', '普及-', '普及/提高-', '普及+/提高', '提高+/省选-', '省选/NOI-'];
  var SQL = [
    'create table if not exists public.algodojo_state (',
    '  user_id uuid primary key references auth.users(id) on delete cascade,',
    '  data jsonb not null,',
    '  updated_at timestamptz not null default now()',
    ');',
    'alter table public.algodojo_state enable row level security;',
    'create policy "algodojo own state" on public.algodojo_state',
    '  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);'
  ].join('\n');

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function persist(opts) {
    opts = opts || {};
    if (!opts.silent) {
      if (!state.meta) state.meta = {};
      state.meta.updatedAt = new Date().toISOString();
    }
    if (!Core.save(state)) toast('保存失败：浏览器不允许本地存储');
    if (!opts.silent) schedulePush();
  }

  function schedulePush() {
    if (!Cloud || !Cloud.status().saved) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      Cloud.push(state).catch(function (err) { console.warn('云同步失败', err); });
    }, 1500);
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var prefix = d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '-';
    return prefix + (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function syncNow(silent) {
    if (!Cloud || !Cloud.status().saved) return;
    Cloud.pull().then(function (remote) {
      var localTs = (state.meta && state.meta.updatedAt) || '';
      if (!remote) return Cloud.push(state);
      if (remote.updatedAt > localTs) {
        state = Core.normalize(remote.data);
        Core.save(state);
        render(true);
        if (!silent) toast('已拉取云端数据');
      } else if (localTs > remote.updatedAt) {
        return Cloud.push(state);
      }
    }).then(function () {
      if (!silent) toast('已同步');
    }).catch(function (err) {
      if (!silent) toast('同步失败：' + err.message);
    });
  }

  function topicById(id) {
    return state.topics.filter(function (t) { return t.id === id; })[0] || null;
  }

  function resourceById(id) {
    return state.resources.filter(function (r) { return r.id === id; })[0] || null;
  }

  function kindRank(kind) {
    return Object.prototype.hasOwnProperty.call(KIND_ORDER, kind) ? KIND_ORDER[kind] : 9;
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    viewEl = $('#view');
    toastEl = $('#toast');
    sheetRoot = $('#sheet-root');

    var info = Core.ensureToday(state, today);
    persist({ silent: !info.added });

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        view = btn.getAttribute('data-view');
        render(false);
        window.scrollTo(0, 0);
      });
    });

    viewEl.addEventListener('click', onViewClick);
    viewEl.addEventListener('input', onViewInput);
    viewEl.addEventListener('change', onViewChange);
    sheetRoot.addEventListener('click', onSheetClick);
    sheetRoot.addEventListener('submit', onSheetSubmit);

    render(false);
    registerSW();
    setTimeout(function () { syncNow(true); }, 900);

    setInterval(tick, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
      if (!document.hidden) syncNow(true);
    });
  }

  function tick() {
    var now = Core.todayStr();
    if (now !== today) {
      today = now;
      Core.ensureToday(state, today);
      persist();
      render(false);
    }
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  /* ---------------- 路由 ---------------- */

  function render(keepScroll) {
    var y = window.scrollY;
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    if (view === 'today') renderToday();
    else if (view === 'resources') renderResources();
    else if (view === 'roadmap') renderRoadmap();
    else renderSettings();
    if (keepScroll) window.scrollTo(0, y);
  }

  /* ---------------- 今日 ---------------- */

  function renderToday() {
    var s = Core.stats(state, today);
    var tasks = state.tasks.filter(function (t) { return t.date === today; })
      .sort(function (a, b) { return kindRank(a.kind) - kindRank(b.kind); });
    var carry = state.tasks.filter(function (t) {
      return t.date < today && !t.done && !t.skipped;
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 3);

    var pct = s.todayTotal ? Math.round(s.todayDone / s.todayTotal * 100) : 0;
    var topic = Core.currentTopic(state);
    var lacksProblems = topic && !state.resources.some(function (r) {
      return r.type === 'problem' && r.topicId === topic.id && r.status !== 'done';
    });

    var html = '';
    html += '<div class="topbar"><div>';
    html += '<div class="date-title">' + esc(Core.fmtDateCn(today)) + '</div>';
    html += '<div class="date-sub">' + (topic ? '当前：' + esc(topic.title) : '全部知识点已完成') + '</div>';
    html += '</div><div class="streak">🔥 ' + s.streak + ' 天</div></div>';

    html += '<div class="card progress-card">';
    html += '<div class="progress-head"><span>今日进度</span><span class="progress-num">' + s.todayDone + '/' + s.todayTotal + '</span></div>';
    html += '<div class="bar"><span style="width:' + pct + '%"></span></div>';
    html += '</div>';

    if (carry.length) {
      html += '<h2 class="section-title">顺延 · ' + carry.length + '</h2><div class="card">';
      carry.forEach(function (t) { html += taskRow(t, true); });
      html += '</div>';
    }

    html += '<h2 class="section-title">今日任务</h2>';
    if (tasks.length) {
      html += '<div class="card">';
      tasks.forEach(function (t) { html += taskRow(t, false); });
      html += '</div>';
    } else if (!topic) {
      html += '<div class="card empty"><span class="big">🎉</span>37 个知识点全部完成<br>接下来去刷真题和打比赛吧</div>';
    } else {
      html += '<div class="card empty"><span class="big">◷</span>今天还没有任务<br><button class="btn btn-sm mt8" data-action="gen-today">生成今日任务</button></div>';
    }

    if (lacksProblems && topic) {
      html += '<div class="card mt8 small muted">当前知识点还没有配题，去「资料 → 新增」加两道题，明天就会自动排进刷题任务。</div>';
    }

    html += '<button class="btn add-task-btn" data-action="add-task">＋ 添加任务</button>';

    var note = (state.dailyLogs[today] && state.dailyLogs[today].summary) || '';
    html += '<div class="note-box"><label for="note-input">一句话复盘</label>';
    html += '<textarea id="note-input" placeholder="今天卡在哪？明天先做什么？">' + esc(note) + '</textarea></div>';

    viewEl.innerHTML = html;
  }

  function taskRow(t, isCarry) {
    var topic = t.topicId ? topicById(t.topicId) : null;
    var meta = [];
    if (t.kind === 'study') meta.push('第 ' + t.dayIndex + '/' + t.totalDays + ' 天');
    if (t.kind === 'practice') meta.push(t.targetCount + ' 题');
    if (t.kind === 'custom') meta.push('自定义');
    if (topic) meta.push(topic.title);
    if (isCarry) meta.push(t.date.slice(5).replace('-', '/'));

    var cls = 'task' + (t.done ? ' done' : '') + (t.skipped ? ' skipped' : '');
    var h = '<div class="' + cls + '" data-id="' + t.id + '">';
    h += '<button class="check' + (t.done ? ' done' : '') + '" data-action="toggle" data-id="' + t.id + '" type="button" aria-label="完成"></button>';
    h += '<div class="task-body"><div class="task-title">' + esc(t.title) + '</div><div class="task-meta">';
    if (isCarry) h += '<span class="badge">顺延</span>';
    h += esc(meta.join(' · ')) + '</div></div>';
    h += '<button class="more" data-action="menu" data-id="' + t.id + '" type="button" aria-label="更多">⋯</button>';
    h += '</div>';
    return h;
  }

  /* ---------------- 资料库 ---------------- */

  function renderResources() {
    var problems = state.resources.filter(function (r) { return r.type === 'problem'; }).length;
    var html = '<div class="topbar"><div><div class="date-title">资料库</div>';
    html += '<div class="date-sub">' + state.resources.length + ' 条 · 题目 ' + problems + ' 道</div></div>';
    html += '<button class="btn btn-sm" data-action="add-resource" type="button">＋ 新增</button></div>';
    html += '<div class="search-wrap"><span class="search-icon">⌕</span>';
    html += '<input id="res-search" type="search" placeholder="搜索标题或标签" value="' + esc(filters.q) + '"></div>';
    html += '<div class="chips">';
    var types = [['all', '全部'], ['problem', '题目'], ['tutorial', '教程'], ['video', '视频'], ['book', '书'], ['article', '文章']];
    types.forEach(function (pair) {
      html += '<button class="chip' + (filters.type === pair[0] ? ' active' : '') + '" data-action="res-type" data-type="' + pair[0] + '" type="button">' + pair[1] + '</button>';
    });
    html += '</div>';
    html += '<div class="card" id="res-list">' + resourceListHtml() + '</div>';
    viewEl.innerHTML = html;
  }

  function resourceListHtml() {
    var q = filters.q.trim().toLowerCase();
    var list = state.resources.filter(function (r) {
      if (filters.type !== 'all' && r.type !== filters.type) return false;
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      if (!q) return true;
      var hay = (r.title + ' ' + (r.tags || []).join(' ') + ' ' + (r.note || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (!list.length) {
      return '<div class="empty"><span class="big">▤</span>没有匹配的资料<br>换个关键词，或点右上角新增</div>';
    }
    list = list.slice().sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; });
    var h = '';
    list.forEach(function (r) {
      var pillCls = r.status === 'done' ? 'done' : r.status === 'doing' ? 'doing' : '';
      h += '<div class="res-item" data-action="open-res" data-id="' + r.id + '">';
      h += '<div class="res-icon">' + (TYPE_ICON[r.type] || '文') + '</div>';
      h += '<div class="res-body"><div class="res-title">' + esc(r.title) + '</div>';
      h += '<div class="res-meta">' + esc([r.source || TYPE_LABEL[r.type], r.difficulty].filter(Boolean).join(' · ')) + '</div>';
      if (r.tags && r.tags.length) {
        h += '<div class="tags">';
        r.tags.slice(0, 4).forEach(function (t) { h += '<span class="tag">' + esc(t) + '</span>'; });
        h += '</div>';
      }
      h += '</div><span class="status-pill ' + pillCls + '">' + STATUS_LABEL[r.status] + '</span></div>';
    });
    return h;
  }

  function openResourceForm(id) {
    var r = id ? resourceById(id) : null;
    var isNew = !r;
    r = r || { title: '', url: '', type: 'problem', source: '', difficulty: '入门', status: 'todo', note: '', tags: [], topicId: (Core.currentTopic(state) || {}).id || '' };

    var h = '<button class="sheet-close" data-sheet-close type="button">✕</button>';
    h += '<h3 class="sheet-title">' + (isNew ? '新增资料' : '编辑资料') + '</h3>';
    h += '<div class="sheet-sub">只有标题必填，其余可以以后补</div>';
    h += '<form id="res-form" data-id="' + (id || '') + '">';
    h += '<div class="field"><label>标题 *</label><input name="title" value="' + esc(r.title) + '" placeholder="例：P1046 陶陶摘苹果" required></div>';
    h += '<div class="field"><label>链接</label><input name="url" value="' + esc(r.url) + '" placeholder="https://..." inputmode="url"></div>';
    h += '<div class="field-row">';
    h += '<div class="field"><label>类型</label><select name="type">';
    Object.keys(TYPE_LABEL).forEach(function (k) {
      h += '<option value="' + k + '"' + (r.type === k ? ' selected' : '') + '>' + TYPE_LABEL[k] + '</option>';
    });
    h += '</select></div>';
    h += '<div class="field"><label>状态</label><select name="status">';
    Object.keys(STATUS_LABEL).forEach(function (k) {
      h += '<option value="' + k + '"' + (r.status === k ? ' selected' : '') + '>' + STATUS_LABEL[k] + '</option>';
    });
    h += '</select></div></div>';
    h += '<div class="field-row">';
    h += '<div class="field"><label>来源</label><input name="source" value="' + esc(r.source) + '" placeholder="洛谷 / B站 / 书"></div>';
    h += '<div class="field"><label>难度</label><select name="difficulty">';
    DIFFS.forEach(function (d) {
      h += '<option value="' + d + '"' + (r.difficulty === d ? ' selected' : '') + '>' + d + '</option>';
    });
    h += '</select></div></div>';
    h += '<div class="field"><label>关联知识点</label><select name="topicId"><option value="">（不关联）</option>';
    state.topics.forEach(function (t) {
      h += '<option value="' + t.id + '"' + (r.topicId === t.id ? ' selected' : '') + '>' + esc(t.title) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="field"><label>标签（用逗号分隔）</label><input name="tags" value="' + esc((r.tags || []).join('、')) + '" placeholder="洛谷、二分"></div>';
    h += '<div class="field"><label>笔记</label><textarea name="note" placeholder="一句话心得">' + esc(r.note) + '</textarea></div>';
    h += '<div class="form-actions"><button type="button" class="btn btn-ghost" data-sheet-close>取消</button>';
    h += '<button type="submit" class="btn btn-primary">' + (isNew ? '保存' : '保存修改') + '</button></div>';
    h += '</form>';
    openSheet(h);
  }

  function openResourceDetail(id) {
    var r = resourceById(id);
    if (!r) return;
    var topic = r.topicId ? topicById(r.topicId) : null;
    var h = '<button class="sheet-close" data-sheet-close type="button">✕</button>';
    h += '<h3 class="sheet-title">' + esc(r.title) + '</h3>';
    h += '<div class="sheet-sub">' + esc([TYPE_LABEL[r.type], r.source, r.difficulty, STATUS_LABEL[r.status]].filter(Boolean).join(' · ')) + '</div>';
    if (topic) h += '<div class="small muted">关联知识点：' + esc(topic.title) + '</div>';
    if (r.tags && r.tags.length) {
      h += '<div class="tags mt8">';
      r.tags.forEach(function (t) { h += '<span class="tag">' + esc(t) + '</span>'; });
      h += '</div>';
    }
    if (r.note) h += '<div class="card mt16 small">' + esc(r.note) + '</div>';
    h += '<div class="sheet-actions">';
    if (r.url) h += '<a class="btn btn-primary btn-block" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">打开链接</a>';
    h += '<button class="menu-item" data-action="res-toggle" data-id="' + r.id + '">' + (r.status === 'done' ? '标记为未完成' : '标记为已完成') + '</button>';
    h += '<button class="menu-item" data-action="res-edit" data-id="' + r.id + '">编辑</button>';
    h += '<button class="menu-item danger" data-action="res-delete" data-id="' + r.id + '">删除</button>';
    h += '</div>';
    openSheet(h);
  }

  /* ---------------- 路线图 ---------------- */

  function renderRoadmap() {
    var s = Core.stats(state, today);
    var html = '<div class="topbar"><div><div class="date-title">学习路线</div>';
    html += '<div class="date-sub">C → C++ → 算法 → 数据结构</div></div></div>';
    html += '<div class="stats">';
    html += '<div class="stat"><div class="stat-num">' + s.topicsDone + '<span class="small muted" style="font-size:12px">/' + s.topicsTotal + '</span></div><div class="stat-label">知识点</div></div>';
    html += '<div class="stat"><div class="stat-num">' + s.problems + '</div><div class="stat-label">累计题数</div></div>';
    html += '<div class="stat"><div class="stat-num">' + s.streak + '</div><div class="stat-label">连续天数</div></div>';
    html += '</div>';

    window.ALGODOJO_SEED.stages.forEach(function (st) {
      var list = state.topics.filter(function (t) { return t.stage === st.key; });
      var done = list.filter(function (t) { return t.status === 'done'; }).length;
      var isOpen = !!openStages[st.key];
      html += '<div class="stage' + (isOpen ? ' open' : '') + '">';
      html += '<div class="stage-head" data-action="toggle-stage" data-stage="' + st.key + '">';
      html += '<span class="stage-name">' + esc(st.name) + '</span>';
      html += '<span class="stage-progress">' + done + '/' + list.length + ' <span class="chev">▶</span></span></div>';
      html += '<div class="stage-body">';
      list.forEach(function (t) {
        html += '<div class="topic" data-action="open-topic" data-id="' + t.id + '">';
        html += '<span class="dot ' + (t.status === 'done' ? 'done' : t.status === 'learning' ? 'learning' : '') + '"></span>';
        html += '<span class="topic-title">' + esc(t.title) + '</span>';
        html += '<span class="topic-days">' + t.estimatedDays + 'd</span></div>';
      });
      html += '</div></div>';
    });
    viewEl.innerHTML = html;
  }

  function openTopicSheet(id) {
    var t = topicById(id);
    if (!t) return;
    var resources = state.resources.filter(function (r) { return r.topicId === id; });
    var isCurrent = state.settings.currentTopicId === id;
    var h = '<button class="sheet-close" data-sheet-close type="button">✕</button>';
    h += '<h3 class="sheet-title">' + esc(t.title) + '</h3>';
    h += '<div class="sheet-sub">' + esc(t.goal) + '</div>';
    h += '<div class="small muted">预计 ' + t.estimatedDays + ' 天 · ' + (isCurrent ? '当前知识点' : STATUS_LABEL[t.status]) + '</div>';
    h += '<div class="sheet-actions">';
    if (!isCurrent) h += '<button class="menu-item" data-action="set-topic" data-id="' + t.id + '">设为当前知识点</button>';
    if (t.status !== 'done') h += '<button class="menu-item" data-action="topic-status" data-id="' + t.id + '" data-status="done">标记为已完成</button>';
    else h += '<button class="menu-item" data-action="topic-status" data-id="' + t.id + '" data-status="todo">重新打开</button>';
    h += '</div>';
    h += '<h2 class="section-title">关联资料 · ' + resources.length + '</h2>';
    if (resources.length) {
      h += '<div class="card">';
      resources.slice(0, 6).forEach(function (r) {
        h += '<div class="res-item" data-action="open-res" data-id="' + r.id + '">';
        h += '<div class="res-icon">' + (TYPE_ICON[r.type] || '文') + '</div>';
        h += '<div class="res-body"><div class="res-title">' + esc(r.title) + '</div>';
        h += '<div class="res-meta">' + esc([r.source, r.difficulty].filter(Boolean).join(' · ')) + '</div></div>';
        h += '<span class="status-pill ' + (r.status === 'done' ? 'done' : '') + '">' + STATUS_LABEL[r.status] + '</span></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="empty small">这个知识点还没有资料<br>去资料库新增一条并关联它</div>';
    }
    openSheet(h);
  }

  /* ---------------- 设置 ---------------- */

  function renderSettings() {
    var h = '<div class="topbar"><div><div class="date-title">设置</div>';
    h += '<div class="date-sub">AlgoDojo v1.0 · 本地版</div></div></div>';

    h += '<div class="card"><div class="settings-row"><div><div class="settings-label">每日保底题数</div>';
    h += '<div class="settings-hint">刷题任务按这个数量生成</div></div>';
    h += '<input id="daily-min" type="number" min="1" max="5" value="' + (state.settings.dailyMinProblems || 2) + '"></div>';
    h += '<div class="settings-row"><div><div class="settings-label">Codeforces 用户名</div>';
    h += '<div class="settings-hint">用于按需同步通过的题目</div></div></div>';
    h += '<div class="field mt8"><input id="cf-handle" value="' + esc(state.settings.cfHandle) + '" placeholder="你的 CF handle"></div>';
    h += '<button class="btn btn-sm btn-block" data-action="cf-sync" type="button">同步 Codeforces</button></div>';

    h += '<h2 class="section-title">数据</h2><div class="card">';
    h += '<div class="settings-row"><div><div class="settings-label">存储位置</div>';
    h += '<div class="settings-hint">本机浏览器 · 换设备不会自动同步</div></div>';
    h += '<span class="status-pill">本地</span></div>';
    h += '<div class="settings-row"><div><div class="settings-label">导出备份</div>';
    h += '<div class="settings-hint">下载 JSON，可再导入</div></div>';
    h += '<button class="btn btn-sm" data-action="export" type="button">导出</button></div>';
    h += '<div class="settings-row"><div><div class="settings-label">导入备份</div>';
    h += '<div class="settings-hint">会覆盖当前全部数据</div></div>';
    h += '<button class="btn btn-sm" data-action="import" type="button">选择文件</button></div>';
    h += '<div class="settings-row"><div><div class="settings-label">导入题单</div>';
    h += '<div class="settings-hint">追加题目，自动跳过已有的</div></div>';
    h += '<button class="btn btn-sm" data-action="import-problems" type="button">选择题单</button></div>';
    h += '<div class="settings-row"><div><div class="settings-label">清空数据</div>';
    h += '<div class="settings-hint">恢复初始知识点和起步题</div></div>';
    h += '<button class="btn btn-sm btn-danger" data-action="reset" type="button">清空</button></div></div>';

    var cs = Cloud ? Cloud.status() : { saved: false, connected: false };
    h += '<h2 class="section-title">云同步</h2><div class="card">';
    if (cs.connected) {
      h += '<div class="settings-row"><div><div class="settings-label">已连接</div>';
      h += '<div class="settings-hint">' + esc(cs.email || '') + (cs.lastSync ? ' · 上次 ' + esc(fmtTime(cs.lastSync)) : '') + '</div></div>';
      h += '<span class="status-pill done">在线</span></div>';
      h += '<div class="settings-row"><div><div class="settings-label">立即同步</div>';
      h += '<div class="settings-hint">取较新的一份数据</div></div>';
      h += '<button class="btn btn-sm" data-action="cloud-sync" type="button">同步</button></div>';
      h += '<div class="settings-row"><div><div class="settings-label">断开</div>';
      h += '<div class="settings-hint">只清除本机登录状态</div></div>';
      h += '<button class="btn btn-sm btn-danger" data-action="cloud-disconnect" type="button">断开</button></div>';
    } else {
      h += '<div class="settings-row"><div><div class="settings-label">未连接</div>';
      h += '<div class="settings-hint">' + (CONF.supabaseUrl ? '项目已预置，填邮箱密码即可' : '连接后手机和电脑共用一份数据') + '</div></div>';
      h += '<span class="status-pill">离线</span></div>';
      h += '<button class="btn btn-sm btn-block" data-action="cloud-connect" type="button">连接 Supabase</button>';
    }
    h += '</div>';

    h += '<h2 class="section-title">装到手机桌面</h2><div class="card small muted">';
    h += '<div>iPhone：Safari 打开 → 分享 → 添加到主屏幕。</div>';
    h += '<div class="mt8">Android：Chrome 打开 → 右上角 ⋮ → 添加到主屏幕 / 安装应用。</div>';
    h += '<div class="mt8">注意：正式安装需要 HTTPS 部署（Vercel 免费），本地文件打开只能当普通网页用。</div></div>';

    h += '<h2 class="section-title">关于</h2><div class="card small muted">';
    h += '<div>AlgoDojo（算法道场）· 单人使用的算法学习面板。</div>';
    h += '<div class="mt8">云同步（Supabase）待接入：把项目 URL 和 anon key 给我即可，数据结构不用改。</div></div>';

    viewEl.innerHTML = h;
  }

  /* ---------------- 事件 ---------------- */

  function onViewClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    var id = el.getAttribute('data-id');

    if (action === 'toggle') {
      var task = state.tasks.filter(function (t) { return t.id === id; })[0];
      if (!task) return;
      if (task.done) {
        Core.uncompleteTask(state, id);
      } else {
        Core.completeTask(state, id);
        toast('完成 +1');
      }
      persist();
      render(true);
    } else if (action === 'menu') {
      openTaskMenu(id);
    } else if (action === 'add-task') {
      openAddTask();
    } else if (action === 'gen-today') {
      var info = Core.ensureToday(state, today);
      persist();
      render(false);
      toast(info.added ? '已生成今日任务' : info.reason === 'alldone' ? '全部知识点已完成' : '今天已经有任务了');
    } else if (action === 'res-type') {
      filters.type = el.getAttribute('data-type');
      renderResources();
    } else if (action === 'add-resource') {
      openResourceForm(null);
    } else if (action === 'open-res') {
      openResourceDetail(id);
    } else if (action === 'toggle-stage') {
      var key = el.getAttribute('data-stage');
      openStages[key] = !openStages[key];
      render(true);
    } else if (action === 'open-topic') {
      openTopicSheet(id);
    } else if (action === 'cf-sync') {
      syncCF();
    } else if (action === 'cloud-connect') {
      openCloudConnect();
    } else if (action === 'cloud-sync') {
      syncNow(false);
    } else if (action === 'cloud-disconnect') {
      askConfirm('断开云同步？', '本机数据会保留，只是不再自动上传和拉取。', '断开').then(function (ok) {
        if (!ok) return;
        Cloud.disconnect();
        render(false);
        toast('已断开');
      });
    } else if (action === 'export') {
      exportData();
    } else if (action === 'import') {
      importData();
    } else if (action === 'import-problems') {
      importProblems();
    } else if (action === 'reset') {
      resetData();
    }
  }

  function onViewInput(e) {
    if (e.target.id === 'res-search') {
      filters.q = e.target.value;
      var list = $('#res-list');
      if (list) list.innerHTML = resourceListHtml();
    } else if (e.target.id === 'note-input') {
      var entry = state.dailyLogs[today] || { summary: '' };
      entry.summary = e.target.value;
      entry.updatedAt = new Date().toISOString();
      state.dailyLogs[today] = entry;
      persist();
    } else if (e.target.id === 'cf-handle') {
      state.settings.cfHandle = e.target.value.trim();
      persist();
    }
  }

  function onViewChange(e) {
    if (e.target.id === 'daily-min') {
      var v = Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 2));
      state.settings.dailyMinProblems = v;
      e.target.value = v;
      persist();
      toast('已设为每天 ' + v + ' 题');
    }
  }

  function onSheetClick(e) {
    if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    var id = actionEl.getAttribute('data-id');

    if (action === 'task-tomorrow') {
      Core.rescheduleTask(state, id, Core.addDays(today, 1));
      persist(); closeSheet(); render(true); toast('已改到明天');
    } else if (action === 'task-skip') {
      Core.skipTask(state, id);
      persist(); closeSheet(); render(true);
    } else if (action === 'task-delete') {
      Core.deleteTask(state, id);
      persist(); closeSheet(); render(true); toast('已删除');
    } else if (action === 'res-toggle') {
      var r = resourceById(id);
      if (r) {
        if (r.status === 'done') {
          r.status = 'todo'; r.completedAt = null;
          state.problemLogs = state.problemLogs.filter(function (l) {
            return !(l.platform === 'manual' && l.problemKey === r.id);
          });
        } else {
          r.status = 'done'; r.completedAt = new Date().toISOString();
          if (r.type === 'problem') Core.logProblem(state, r, 'manual');
        }
        persist();
      }
      closeSheet(); render(true);
    } else if (action === 'res-edit') {
      closeSheet(); openResourceForm(id);
    } else if (action === 'res-delete') {
      closeSheet();
      askConfirm('删除这条资料？', '删除后无法恢复，相关任务里的引用会失效。', '删除').then(function (ok) {
        if (!ok) return;
        state.resources = state.resources.filter(function (x) { return x.id !== id; });
        persist(); render(true); toast('已删除');
      });
    } else if (action === 'set-topic') {
      state.settings.currentTopicId = id;
      var t = topicById(id);
      if (t) t.status = 'learning';
      persist(); closeSheet(); render(false); toast('已切换当前知识点');
    } else if (action === 'topic-status') {
      var st = actionEl.getAttribute('data-status');
      var topic = topicById(id);
      if (topic) {
        if (st === 'done') {
          topic.status = 'done';
          if (state.settings.currentTopicId === id) Core.advance(state);
        } else {
          topic.status = st;
          state.settings.currentTopicId = id;
        }
      }
      persist(); closeSheet(); render(true);
    } else if (action === 'cloud-use-remote') {
      if (pendingRemote && pendingRemote.data) {
        state = Core.normalize(pendingRemote.data);
        Core.save(state);
        pendingRemote = null;
        closeSheet(); render(false); toast('已使用云端数据');
      }
    } else if (action === 'cloud-use-local') {
      Cloud.push(state).then(function () {
        pendingRemote = null;
        closeSheet(); render(false); toast('已上传本地数据');
      }).catch(function (err) {
        toast('上传失败：' + err.message);
      });
    } else if (action === 'copy-sql') {
      navigator.clipboard.writeText(SQL).then(function () {
        toast('SQL 已复制');
      }).catch(function () {
        toast('复制失败，请手动选中');
      });
    } else if (action === 'confirm-yes') {
      var resolveYes = confirmResolve;
      confirmResolve = null;
      closeSheet();
      if (resolveYes) resolveYes(true);
    } else if (action === 'confirm-no') {
      var resolveNo = confirmResolve;
      confirmResolve = null;
      closeSheet();
      if (resolveNo) resolveNo(false);
    }
  }

  function onSheetSubmit(e) {
    if (e.target.id === 'cloud-form') { submitCloudForm(e); return; }
    if (e.target.id !== 'res-form') return;
    e.preventDefault();
    var form = e.target;
    var fd = new FormData(form);
    var title = String(fd.get('title') || '').trim();
    if (!title) { toast('标题不能为空'); return; }
    var id = form.getAttribute('data-id');
    var tagsRaw = String(fd.get('tags') || '');
    var tags = tagsRaw.split(/[,，、;；\s]+/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8);

    var payload = {
      title: title,
      url: String(fd.get('url') || '').trim(),
      type: String(fd.get('type') || 'problem'),
      source: String(fd.get('source') || '').trim(),
      difficulty: String(fd.get('difficulty') || ''),
      status: String(fd.get('status') || 'todo'),
      topicId: String(fd.get('topicId') || ''),
      tags: tags,
      note: String(fd.get('note') || '').trim()
    };

    if (id) {
      var r = resourceById(id);
      if (!r) return;
      var wasDone = r.status === 'done';
      Object.assign(r, payload);
      if (!wasDone && r.status === 'done') {
        r.completedAt = new Date().toISOString();
        if (r.type === 'problem') Core.logProblem(state, r, 'manual');
      }
      if (wasDone && r.status !== 'done') {
        r.completedAt = null;
        state.problemLogs = state.problemLogs.filter(function (l) {
          return !(l.platform === 'manual' && l.problemKey === r.id);
        });
      }
    } else {
      state.resources.push(Object.assign({
        id: 'r-' + Core.uid(),
        createdAt: new Date().toISOString(),
        completedAt: null,
        code: ''
      }, payload));
    }
    persist(); closeSheet(); render(true); toast(id ? '已保存' : '已添加');
  }

  /* ---------------- 云同步 ---------------- */

  function openCloudConnect() {
    var h = '<button class="sheet-close" data-sheet-close type="button">✕</button>';
    h += '<h3 class="sheet-title">连接 Supabase</h3>';
    h += '<div class="sheet-sub">密钥只存在这台设备，不会上传到别处</div>';
    h += '<details class="sql-details"><summary>第一次使用？点开看建表 SQL</summary>';
    h += '<pre class="sql-box">' + esc(SQL) + '</pre>';
    h += '<button class="btn btn-sm btn-block" data-action="copy-sql" type="button">复制 SQL</button>';
    h += '<div class="small muted mt8">在 Supabase → SQL Editor 里执行；再到 Authentication → Users 添加一个邮箱+密码用户（勾选 auto confirm）。</div>';
    h += '</details>';
    h += '<form id="cloud-form">';
    h += '<div class="field"><label>Project URL</label><input name="url" value="' + esc(CONF.supabaseUrl || '') + '" placeholder="https://xxxx.supabase.co" autocomplete="off" required></div>';
    h += '<div class="field"><label>Publishable key（或 anon key）</label><input name="key" value="' + esc(CONF.supabaseKey || '') + '" placeholder="sb_publishable_..." autocomplete="off" required></div>';
    h += '<div class="field"><label>邮箱</label><input name="email" type="email" value="' + esc(CONF.email || '') + '" placeholder="你在 Supabase 添加的用户" autocomplete="username" required></div>';
    h += '<div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required></div>';
    h += '<div id="cloud-error" class="error-text"></div>';
    h += '<div class="form-actions"><button type="button" class="btn btn-ghost" data-sheet-close>取消</button>';
    h += '<button type="submit" class="btn btn-primary">连接</button></div></form>';
    openSheet(h);
  }

  function askCloudChoice(remote) {
    var when = fmtTime(remote.updatedAt);
    var h = '<h3 class="sheet-title">云端已有数据</h3>';
    h += '<div class="sheet-sub">云端更新于 ' + esc(when || '未知时间') + '，要保留哪一份？</div>';
    h += '<div class="sheet-actions">';
    h += '<button class="menu-item" data-action="cloud-use-remote">使用云端数据（覆盖本机）</button>';
    h += '<button class="menu-item" data-action="cloud-use-local">使用本机数据（覆盖云端）</button>';
    h += '</div>';
    openSheet(h);
  }

  function submitCloudForm(e) {
    e.preventDefault();
    var form = e.target;
    var fd = new FormData(form);
    var errEl = $('#cloud-error');
    var btn = form.querySelector('button[type="submit"]');
    if (errEl) errEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = '连接中…'; }

    Cloud.signIn(String(fd.get('url') || ''), String(fd.get('key') || ''),
      String(fd.get('email') || ''), String(fd.get('password') || ''))
      .then(function () { return Cloud.pull(); })
      .then(function (remote) {
        if (!remote) {
          return Cloud.push(state).then(function () {
            closeSheet(); render(false); toast('已连接，本地数据已上传');
          });
        }
        pendingRemote = remote;
        closeSheet();
        askCloudChoice(remote);
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = '连接'; }
        var msg = err.message || '连接失败';
        if (/relation|does not exist|schema cache/i.test(msg)) msg += '（表还没建，先执行上面的 SQL）';
        if (errEl) errEl.textContent = msg;
        else toast(msg);
      });
  }

  /* ---------------- 弹层 ---------------- */

  function openSheet(inner) {
    sheetRoot.innerHTML = '<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true">' + inner + '</div></div>';
    document.body.style.overflow = 'hidden';
    var bd = sheetRoot.querySelector('.sheet-backdrop');
    bd.addEventListener('click', function (e) {
      if (e.target === bd) closeSheet();
    });
  }

  function closeSheet() {
    sheetRoot.innerHTML = '';
    document.body.style.overflow = '';
    if (confirmResolve) {
      var r = confirmResolve;
      confirmResolve = null;
      r(false);
    }
  }

  function askConfirm(title, desc, okText) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      var h = '<h3 class="sheet-title">' + esc(title) + '</h3>';
      h += '<div class="sheet-sub">' + esc(desc) + '</div>';
      h += '<div class="form-actions"><button class="btn btn-ghost" data-action="confirm-no" type="button">取消</button>';
      h += '<button class="btn btn-danger" data-action="confirm-yes" type="button">' + esc(okText || '确认') + '</button></div>';
      openSheet(h);
    });
  }

  function openTaskMenu(id) {
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var kindLabel = t.kind === 'study' ? '学习' : t.kind === 'practice' ? '刷题' : '自定义';
    var h = '<h3 class="sheet-title">' + esc(t.title) + '</h3>';
    h += '<div class="sheet-sub">' + t.date + ' · ' + kindLabel + '</div>';
    h += '<div class="sheet-actions">';
    h += '<button class="menu-item" data-action="task-tomorrow" data-id="' + t.id + '">改到明天</button>';
    h += '<button class="menu-item" data-action="task-skip" data-id="' + t.id + '">' + (t.skipped ? '取消跳过' : '跳过这条') + '</button>';
    h += '<button class="menu-item danger" data-action="task-delete" data-id="' + t.id + '">删除</button>';
    h += '</div>';
    openSheet(h);
  }

  function openAddTask() {
    var h = '<button class="sheet-close" data-sheet-close type="button">✕</button>';
    h += '<h3 class="sheet-title">添加任务</h3>';
    h += '<div class="sheet-sub">只加到今天，不影响自动生成的路线</div>';
    h += '<form id="task-form">';
    h += '<div class="field"><label>任务内容</label><input name="title" placeholder="例：补昨天的二分题" required></div>';
    h += '<div class="field"><label>类型</label><select name="kind"><option value="custom">其他</option><option value="study">学习</option><option value="practice">刷题</option></select></div>';
    h += '<div class="form-actions"><button type="button" class="btn btn-ghost" data-sheet-close>取消</button>';
    h += '<button type="submit" class="btn btn-primary">添加</button></div></form>';
    openSheet(h);
    var form = $('#task-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var title = String(fd.get('title') || '').trim();
      if (!title) return;
      Core.addManualTask(state, today, title, String(fd.get('kind') || 'custom'));
      persist(); closeSheet(); render(true); toast('已添加');
    });
  }

  /* ---------------- 数据操作 ---------------- */

  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'algodojo-' + today + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('已导出备份');
  }

  function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          if (!data || !Array.isArray(data.topics)) throw new Error('格式不对');
          askConfirm('导入会覆盖当前数据', '建议先导出一份备份。继续？', '导入').then(function (ok) {
            if (!ok) return;
            state = Core.normalize(data);
            persist(); render(false); toast('导入完成');
          });
        } catch (err) {
          toast('导入失败：不是有效的备份文件');
        }
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function resetData() {
    askConfirm('清空全部数据？', '任务、资料、笔记都会删除，恢复初始状态。', '清空').then(function (ok) {
      if (!ok) return;
      state = Core.defaultState();
      persist(); render(false); toast('已重置');
    });
  }

  function importProblems() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var items = Array.isArray(data) ? data : (data && data.problems);
          if (!Array.isArray(items)) throw new Error('格式不对');
          var seen = {};
          state.resources.forEach(function (r) {
            if (r.code) seen[String(r.code).toUpperCase()] = true;
          });
          var added = 0, skipped = 0;
          items.forEach(function (it) {
            var code = String((it && it.code) || '').trim().toUpperCase();
            if (!code || seen[code]) { skipped++; return; }
            var topicId = it.topicId && topicById(it.topicId) ? it.topicId : '';
            state.resources.push({
              id: 'r-' + code + '-' + Core.uid().slice(0, 6),
              code: code,
              title: it.title ? code + ' ' + String(it.title).replace(new RegExp('^' + code + '\\s*'), '') : code,
              url: it.url || ('https://www.luogu.com.cn/problem/' + code),
              type: 'problem',
              source: it.source || '洛谷',
              difficulty: it.difficulty || '入门',
              status: 'todo',
              note: '',
              tags: Array.isArray(it.tags) ? it.tags : ['洛谷', '题单'],
              topicId: topicId,
              createdAt: new Date().toISOString(),
              completedAt: null
            });
            seen[code] = true;
            added++;
          });
          persist(); render(false);
          toast('导入 ' + added + ' 题' + (skipped ? '，跳过 ' + skipped + ' 题' : ''));
        } catch (e) {
          toast('题单格式不对，需要 { problems: [...] }');
        }
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function syncCF() {
    var handle = (state.settings.cfHandle || '').trim();
    if (!handle) { toast('先在设置里填 Codeforces 用户名'); return; }
    toast('正在同步…');
    fetch('https://codeforces.com/api/user.status?handle=' + encodeURIComponent(handle) + '&from=1&count=100')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || data.status !== 'OK') throw new Error((data && data.comment) || '返回异常');
        var added = 0;
        data.result.forEach(function (sub) {
          if (sub.verdict !== 'OK' || !sub.problem) return;
          var key = String(sub.problem.contestId) + '-' + sub.problem.index;
          var exists = state.problemLogs.some(function (l) {
            return l.platform === 'cf' && l.problemKey === key;
          });
          if (exists) return;
          state.problemLogs.push({
            id: Core.uid(), platform: 'cf', problemKey: key,
            title: sub.problem.name, difficulty: sub.problem.rating ? String(sub.problem.rating) : '',
            solvedAt: new Date(sub.creationTimeSeconds * 1000).toISOString(), source: 'auto'
          });
          added++;
        });
        persist(); render(true);
        toast(added ? '同步完成，新增 ' + added + ' 题' : '没有新通过的题');
      })
      .catch(function () {
        toast('同步失败：浏览器直连被拦截，先手动记录');
      });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
