/* AlgoDojo 核心逻辑：日期、任务生成、打卡、进度 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'algodojo.v1';

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseDate(s) {
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function addDays(s, n) {
    var d = parseDate(s);
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function fmtDateCn(s) {
    var d = parseDate(s);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + '日一二三四五六'[d.getDay()];
  }

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function byOrder(a, b) { return a.order - b.order; }

  function defaultState() {
    var seed = global.ALGODOJO_SEED;
    return {
      version: 1,
      settings: {
        dailyMinProblems: 2,
        cfHandle: '',
        currentTopicId: seed.topics[0].id,
        theme: 'dark'
      },
      topics: seed.topics.map(function (t) {
        return { id: t.id, stage: t.stage, title: t.title, goal: t.goal, estimatedDays: t.estimatedDays, order: t.order, status: 'todo' };
      }),
      resources: seed.resources.map(function (r) { return Object.assign({}, r); }),
      tasks: [],
      problemLogs: [],
      dailyLogs: {}
    };
  }

  function normalize(state) {
    var seed = global.ALGODOJO_SEED;
    state.version = 1;
    state.settings = Object.assign({ dailyMinProblems: 2, cfHandle: '', currentTopicId: null, theme: 'dark' }, state.settings || {});
    state.topics = Array.isArray(state.topics) ? state.topics : [];
    state.resources = Array.isArray(state.resources) ? state.resources : [];
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.problemLogs = Array.isArray(state.problemLogs) ? state.problemLogs : [];
    state.dailyLogs = state.dailyLogs && typeof state.dailyLogs === 'object' ? state.dailyLogs : {};

    var have = {};
    state.topics.forEach(function (t) { have[t.id] = true; });

    seed.topics.forEach(function (t) {
      if (!have[t.id]) state.topics.push({ id: t.id, stage: t.stage, title: t.title, goal: t.goal, estimatedDays: t.estimatedDays, order: t.order, status: 'todo' });
    });

    state.topics.sort(byOrder);

    if (!state.settings.currentTopicId) {
      var first = state.topics.filter(function (t) { return t.status !== 'done'; })[0];
      state.settings.currentTopicId = first ? first.id : null;
    }
    return state;
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('读取本地数据失败，使用初始数据', e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('保存失败', e);
      return false;
    }
  }

  function currentTopic(state) {
    var t = state.topics.filter(function (x) { return x.id === state.settings.currentTopicId; })[0];
    if (t && t.status !== 'done') return t;
    return state.topics.filter(function (x) { return x.status !== 'done'; }).sort(byOrder)[0] || null;
  }

  function advance(state) {
    var next = state.topics.filter(function (x) { return x.status !== 'done'; }).sort(byOrder)[0];
    state.settings.currentTopicId = next ? next.id : null;
    if (next) next.status = 'learning';
  }

  function studyCount(state, topicId) {
    return state.tasks.filter(function (t) { return t.topicId === topicId && t.kind === 'study'; }).length;
  }

  /* 生成某天的任务；已有 generated 任务则跳过 */
  function ensureToday(state, date, depth) {
    depth = depth || 0;
    if (depth > 5) return { added: 0, reason: 'loop' };
    if (state.tasks.some(function (t) { return t.date === date && t.origin === 'generated'; })) {
      return { added: 0, reason: 'exists' };
    }
    var topic = currentTopic(state);
    if (!topic) return { added: 0, reason: 'alldone' };
    if (topic.status === 'todo') topic.status = 'learning';

    var used = studyCount(state, topic.id);
    if (used >= topic.estimatedDays) {
      topic.status = 'done';
      advance(state);
      return ensureToday(state, date, depth + 1);
    }

    var now = new Date().toISOString();
    var made = [];
    made.push({
      id: uid(), date: date, kind: 'study', title: '学：' + topic.title,
      topicId: topic.id, resourceIds: [], targetCount: 0,
      dayIndex: used + 1, totalDays: topic.estimatedDays,
      done: false, skipped: false, origin: 'generated', createdAt: now
    });

    var probs = state.resources.filter(function (r) {
      return r.type === 'problem' && r.topicId === topic.id && r.status !== 'done';
    }).slice(0, Math.max(1, state.settings.dailyMinProblems || 2));

    if (probs.length) {
      made.push({
        id: uid(), date: date, kind: 'practice',
        title: '刷：' + probs.map(function (p) { return p.code || p.title; }).join('  '),
        topicId: topic.id, resourceIds: probs.map(function (p) { return p.id; }),
        targetCount: probs.length, dayIndex: 0, totalDays: 0,
        done: false, skipped: false, origin: 'generated', createdAt: now
      });
    }

    state.tasks = state.tasks.concat(made);
    return { added: made.length, reason: 'ok', topic: topic, hasProblems: probs.length > 0 };
  }

  function logProblem(state, resource, source) {
    var exists = state.problemLogs.some(function (l) {
      return l.platform === 'manual' && l.problemKey === resource.id;
    });
    if (exists) return false;
    state.problemLogs.push({
      id: uid(), platform: 'manual', problemKey: resource.id,
      title: resource.title, difficulty: resource.difficulty || '',
      solvedAt: new Date().toISOString(), source: source || 'manual'
    });
    return true;
  }

  function completeTask(state, taskId) {
    var task = state.tasks.filter(function (t) { return t.id === taskId; })[0];
    if (!task || task.done) return { ok: false };
    task.done = true;
    task.doneAt = new Date().toISOString();

    if (task.kind === 'practice') {
      task.resourceIds.forEach(function (rid) {
        var r = state.resources.filter(function (x) { return x.id === rid; })[0];
        if (!r) return;
        r.status = 'done';
        r.completedAt = r.completedAt || new Date().toISOString();
        logProblem(state, r, 'task');
      });
    }

    if (task.kind === 'study') {
      var topic = state.topics.filter(function (x) { return x.id === task.topicId; })[0];
      if (topic) {
        var doneDays = state.tasks.filter(function (t) {
          return t.topicId === topic.id && t.kind === 'study' && t.done;
        }).length;
        if (doneDays >= topic.estimatedDays) {
          topic.status = 'done';
          advance(state);
        }
      }
    }
    return { ok: true, task: task };
  }

  function uncompleteTask(state, taskId) {
    var task = state.tasks.filter(function (t) { return t.id === taskId; })[0];
    if (!task || !task.done) return false;
    task.done = false;
    delete task.doneAt;

    if (task.kind === 'practice') {
      task.resourceIds.forEach(function (rid) {
        var r = state.resources.filter(function (x) { return x.id === rid; })[0];
        if (r) { r.status = 'todo'; r.completedAt = null; }
        state.problemLogs = state.problemLogs.filter(function (l) {
          return !(l.platform === 'manual' && l.problemKey === rid);
        });
      });
    }

    if (task.kind === 'study') {
      var topic = state.topics.filter(function (x) { return x.id === task.topicId; })[0];
      if (topic && topic.status === 'done') {
        topic.status = 'learning';
        state.settings.currentTopicId = topic.id;
      }
    }
    return true;
  }

  function skipTask(state, taskId) {
    var t = state.tasks.filter(function (x) { return x.id === taskId; })[0];
    if (!t) return false;
    t.skipped = !t.skipped;
    return true;
  }

  function rescheduleTask(state, taskId, newDate) {
    var t = state.tasks.filter(function (x) { return x.id === taskId; })[0];
    if (!t) return false;
    t.date = newDate;
    return true;
  }

  function addManualTask(state, date, title, kind) {
    state.tasks.push({
      id: uid(), date: date, kind: kind || 'custom', title: title,
      topicId: null, resourceIds: [], targetCount: 0, dayIndex: 0, totalDays: 0,
      done: false, skipped: false, origin: 'manual', createdAt: new Date().toISOString()
    });
  }

  function deleteTask(state, taskId) {
    state.tasks = state.tasks.filter(function (t) { return t.id !== taskId; });
  }

  function streak(state, today) {
    var dates = {};
    state.tasks.forEach(function (t) { if (t.done) dates[t.date] = true; });
    var cursor = dates[today] ? today : addDays(today, -1);
    var n = 0;
    while (dates[cursor]) { n++; cursor = addDays(cursor, -1); }
    return n;
  }

  function stats(state, today) {
    var doneTopics = state.topics.filter(function (t) { return t.status === 'done'; }).length;
    var todayTasks = state.tasks.filter(function (t) { return t.date === today; });
    var todayDone = todayTasks.filter(function (t) { return t.done; }).length;
    return {
      topicsDone: doneTopics,
      topicsTotal: state.topics.length,
      problems: state.problemLogs.length,
      streak: streak(state, today),
      todayDone: todayDone,
      todayTotal: todayTasks.length
    };
  }

  global.AlgoCore = {
    STORAGE_KEY: STORAGE_KEY,
    todayStr: todayStr,
    addDays: addDays,
    fmtDateCn: fmtDateCn,
    uid: uid,
    defaultState: defaultState,
    normalize: normalize,
    load: load,
    save: save,
    currentTopic: currentTopic,
    advance: advance,
    ensureToday: ensureToday,
    completeTask: completeTask,
    uncompleteTask: uncompleteTask,
    skipTask: skipTask,
    rescheduleTask: rescheduleTask,
    addManualTask: addManualTask,
    deleteTask: deleteTask,
    streak: streak,
    stats: stats,
    logProblem: logProblem
  };
})(window);