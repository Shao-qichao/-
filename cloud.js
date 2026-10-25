/* AlgoDojo 云同步：Supabase Auth + PostgREST，单行 JSON 状态 */
(function (global) {
  'use strict';

  var STORE_KEY = 'algodojo.cloud.v1';
  var cfg = null;
  try { cfg = JSON.parse(global.localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { cfg = null; }

  function saveCfg() {
    try {
      if (cfg) global.localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
      else global.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* ignore */ }
  }

  function base() { return cfg.url.replace(/\/+$/, ''); }

  function headers(extra) {
    var h = { apikey: cfg.key, 'Content-Type': 'application/json' };
    if (cfg.access) h.Authorization = 'Bearer ' + cfg.access;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function handle(res) {
    return res.text().then(function (txt) {
      var data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
      if (!res.ok) {
        var msg = (data && (data.msg || data.message || data.error_description || data.hint || data.details)) || ('HTTP ' + res.status);
        var err = new Error(String(msg));
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  function storeAuth(d) {
    cfg.access = d.access_token;
    cfg.refresh = d.refresh_token;
    cfg.exp = Date.now() + (d.expires_in || 3600) * 1000;
    if (d.user) {
      cfg.uid = d.user.id;
      cfg.email = d.user.email || cfg.email;
    }
    saveCfg();
  }

  function signIn(url, key, email, password) {
    cfg = {
      url: String(url || '').replace(/\/+$/, ''),
      key: String(key || ''),
      email: String(email || ''),
      access: null, refresh: null, exp: 0, uid: null, lastSync: null
    };
    return fetch(base() + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cfg.email, password: password })
    }).then(handle).then(function (d) {
      storeAuth(d);
      return d;
    }, function (err) {
      cfg = null;
      saveCfg();
      throw err;
    });
  }

  function refreshSession() {
    if (!cfg || !cfg.refresh) return Promise.reject(new Error('会话已失效，请重新连接'));
    return fetch(base() + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cfg.refresh })
    }).then(handle).then(function (d) {
      storeAuth(d);
      return d;
    });
  }

  function ensureToken() {
    if (!cfg) return Promise.reject(new Error('未连接云端'));
    if (cfg.access && cfg.exp - 60000 > Date.now()) return Promise.resolve();
    return refreshSession();
  }

  function authed(fn) {
    return ensureToken().then(fn).catch(function (err) {
      if (err && err.status === 401 && cfg && cfg.refresh) {
        return refreshSession().then(fn);
      }
      throw err;
    });
  }

  function pull() {
    return authed(function () {
      return fetch(base() + '/rest/v1/algodojo_state?select=data,updated_at&user_id=eq.' + encodeURIComponent(cfg.uid), {
        headers: headers()
      }).then(handle);
    }).then(function (rows) {
      if (!rows || !rows.length) return null;
      return { data: rows[0].data, updatedAt: rows[0].updated_at };
    });
  }

  function push(state) {
    return authed(function () {
      return fetch(base() + '/rest/v1/algodojo_state?on_conflict=user_id', {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{
          user_id: cfg.uid,
          data: state,
          updated_at: new Date().toISOString()
        }])
      }).then(handle);
    }).then(function () {
      cfg.lastSync = new Date().toISOString();
      saveCfg();
      return true;
    });
  }

  function disconnect() {
    cfg = null;
    saveCfg();
  }

  function status() {
    return {
      saved: !!cfg,
      connected: !!(cfg && cfg.access && cfg.exp > Date.now()),
      email: (cfg && cfg.email) || '',
      lastSync: (cfg && cfg.lastSync) || ''
    };
  }

  function autoConnect() {
    if (!cfg || !cfg.refresh) return Promise.resolve(null);
    return pull();
  }

  global.AlgoCloud = {
    signIn: signIn,
    pull: pull,
    push: push,
    disconnect: disconnect,
    status: status,
    autoConnect: autoConnect
  };
})(window);
