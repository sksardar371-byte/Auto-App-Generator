(function () {
  var API_BASE = String(window.APP_API_BASE || ((location.origin || '') + '/api')).replace(/\/+$/, '');
  var DEFAULT_HMS_PROJECT_KEY = 'hms-template-workspace';

  function normalizeProjectKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 120);
  }

  function readCachedProjectKey() {
    var keys = ['APP_PROJECT_KEY', 'HMS_PROJECT_KEY'];
    for (var i = 0; i < keys.length; i += 1) {
      var value = normalizeProjectKey(localStorage.getItem(keys[i]));
      if (value) return value;
    }
    return '';
  }

  function cacheProjectKey(value) {
    var key = normalizeProjectKey(value);
    if (!key) return '';
    localStorage.setItem('APP_PROJECT_KEY', key);
    localStorage.setItem('HMS_PROJECT_KEY', key);
    return key;
  }

  function inferProjectKey() {
    try {
      var params = new URLSearchParams(String(location.search || ''));
      var fromQuery = cacheProjectKey(params.get('projectKey'));
      if (fromQuery) return fromQuery;
      var path = String(location.pathname || '').replace(/\\/g, '/');
      var match = path.match(/\/generated_projects\/([^/]+)\//i) || path.match(/\/preview_projects\/([^/]+)\//i);
      var fromPath = cacheProjectKey(match && match[1] ? match[1] : '');
      if (fromPath) return fromPath;
      var cached = readCachedProjectKey();
      if (cached) return cached;
      return cacheProjectKey(DEFAULT_HMS_PROJECT_KEY);
    } catch (_err) {
      return cacheProjectKey(DEFAULT_HMS_PROJECT_KEY);
    }
  }

  function authHeaders(extra) {
    var token = localStorage.getItem('token') || '';
    var base = extra && typeof extra === 'object' ? { ...extra } : {};
    if (token) base.Authorization = 'Bearer ' + token;
    var projectKey = inferProjectKey();
    if (projectKey) base['X-Project-Key'] = projectKey;
    return base;
  }

  async function request(path, options) {
    var opts = options && typeof options === 'object' ? { ...options } : {};
    opts.headers = authHeaders(opts.headers || {});
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    var res = await fetch(API_BASE + path, opts);
    var data = await res.json().catch(function () { return {}; });
    return { res: res, data: data };
  }

  async function listProjects(entityType, limit, extraQuery) {
    var query = extraQuery && typeof extraQuery === 'object' ? extraQuery : {};
    var params = new URLSearchParams();
    params.set('entityType', String(entityType || 'record'));
    params.set('limit', String(limit || 100));
    Object.keys(query).forEach(function (k) {
      var v = query[k];
      if (v === undefined || v === null || v === '') return;
      params.set(String(k), String(v));
    });
    var out = await request('/projects?' + params.toString(), { method: 'GET' });
    if (!out.res.ok || !Array.isArray(out.data.projects)) return [];
    return out.data.projects;
  }

  async function createProject(payload) {
    var body = payload && typeof payload === 'object' ? { ...payload } : {};
    if (!body.projectKey) {
      var key = inferProjectKey();
      if (key) body.projectKey = key;
    }
    return request('/projects', { method: 'POST', body: body });
  }

  async function updateProject(id, payload) {
    var key = String(id || '').trim();
    if (!key) return { res: { ok: false }, data: { message: 'Missing record id' } };
    var body = payload && typeof payload === 'object' ? { ...payload } : {};
    if (!body.projectKey) {
      var pKey = inferProjectKey();
      if (pKey) body.projectKey = pKey;
    }
    return request('/projects/' + encodeURIComponent(key), { method: 'PUT', body: body });
  }

  async function deleteProject(id) {
    var key = String(id || '').trim();
    if (!key) return { res: { ok: false }, data: { message: 'Missing record id' } };
    return request('/projects/' + encodeURIComponent(key), { method: 'DELETE' });
  }

  var apiClient = {
    base: API_BASE,
    request: request,
    listProjects: listProjects,
    createProject: createProject,
    updateProject: updateProject,
    deleteProject: deleteProject,
    inferProjectKey: inferProjectKey,
    authHeaders: authHeaders,
  };
  window.HMS_API = apiClient;
  window.LMS_API = window.LMS_API || apiClient;
})();
