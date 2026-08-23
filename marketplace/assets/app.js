/**
 * NokoriBot 插件广场 SPA
 */
(function () {
  const API = 'api.php';
  const $app = document.getElementById('app');
  const $navAuth = document.getElementById('nav-auth');

  let currentUser = null;

  // ── API helpers ──
  async function api(action, opts = {}) {
    const url = new URL(API, location.href);
    url.searchParams.set('action', action);
    if (opts.id) url.searchParams.set('id', opts.id);
    const fetchOpts = { credentials: 'same-origin' };
    if (opts.method) fetchOpts.method = opts.method;
    if (opts.body) {
      fetchOpts.method = 'POST';
      if (opts.body instanceof FormData) {
        fetchOpts.body = opts.body;
      } else {
        fetchOpts.headers = { 'Content-Type': 'application/json' };
        fetchOpts.body = JSON.stringify(opts.body);
      }
    }
    const res = await fetch(url, fetchOpts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  // ── Toast ──
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ── Auth ──
  async function checkAuth() {
    try {
      const data = await api('me');
      currentUser = data.logged_in ? data.user : null;
    } catch { currentUser = null; }
    renderNav();
  }

  function renderNav() {
    if (currentUser) {
      $navAuth.innerHTML =
        '<a href="#/upload">上传插件</a>' +
        '<span style="color:var(--text-dim)">' + esc(currentUser.display_name || currentUser.username) + '</span>' +
        '<a href="#" onclick="window._logout();return false">登出</a>';
    } else {
      $navAuth.innerHTML =
        '<a href="#/login">登录</a>' +
        '<a href="#/register">注册</a>';
    }
  }

  window._logout = async function () {
    await api('logout');
    currentUser = null;
    renderNav();
    toast('已登出');
    navigate('/');
  };

  // ── Router ──
  function getRoute() {
    const hash = location.hash.slice(1) || '/';
    return hash;
  }

  function navigate(path) {
    location.hash = path;
  }

  window.addEventListener('hashchange', () => route());

  function route() {
    const path = getRoute();
    $app.innerHTML = '<div class="loading">加载中…</div>';

    if (path === '/' || path === '') renderHome();
    else if (path.startsWith('/plugin/')) renderPlugin(path.split('/plugin/')[1]);
    else if (path === '/login') renderLogin();
    else if (path === '/register') renderRegister();
    else if (path === '/upload') renderUpload();
    else $app.innerHTML = '<div class="empty"><p>页面不存在</p><a href="#/">返回首页</a></div>';
  }

  // ── Pages ──
  async function renderHome() {
    try {
      const data = await api('plugins');
      const plugins = data.plugins || [];
      if (plugins.length === 0) {
        $app.innerHTML = '<div class="empty"><p>还没有插件</p>' +
          (currentUser ? '<a href="#/upload" class="btn btn-primary">上传第一个插件</a>' : '<a href="#/login" class="btn btn-primary">登录后上传</a>') +
          '</div>';
        return;
      }
      let html = '<div class="plugin-grid">';
      for (const p of plugins) {
        html += '<a class="plugin-card" href="#/plugin/' + esc(p.id) + '">' +
          '<div class="name">' + esc(p.name) + '</div>' +
          '<div class="desc">' + esc(p.description || '暂无描述') + '</div>' +
          '<div class="meta">' +
          '<span class="tag">v' + esc(p.version || '?') + '</span>' +
          '<span>' + esc(p.author || '未知') + '</span>' +
          '<span>⬇ ' + (p.downloads || 0) + '</span>' +
          '</div></a>';
      }
      html += '</div>';
      $app.innerHTML = html;
    } catch (e) {
      $app.innerHTML = '<div class="empty"><p>加载失败: ' + esc(e.message) + '</p></div>';
    }
  }

  async function renderPlugin(id) {
    try {
      const p = await api('plugin', { id });
      const canDelete = currentUser && currentUser.username === p.uploaded_by;
      $app.innerHTML =
        '<div class="detail-header">' +
          '<div><h1>' + esc(p.name) + '</h1><div class="version">v' + esc(p.version || '?') + '</div></div>' +
          '<div class="detail-actions">' +
            '<a class="btn btn-primary" href="' + API + '?action=download&id=' + esc(p.id) + '">下载</a>' +
            (canDelete ? '<button class="btn btn-danger btn-sm" onclick="window._deletePlugin(\'' + esc(p.id) + '\')">删除</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="detail-info">' +
          '<div class="info-item"><div class="label">作者</div><div class="value">' + esc(p.author || '未知') + '</div></div>' +
          '<div class="info-item"><div class="label">版本</div><div class="value">' + esc(p.version || '-') + '</div></div>' +
          '<div class="info-item"><div class="label">下载次数</div><div class="value">' + (p.downloads || 0) + '</div></div>' +
          '<div class="info-item"><div class="label">大小</div><div class="value">' + formatSize(p.size || 0) + '</div></div>' +
          '<div class="info-item"><div class="label">上传者</div><div class="value">' + esc(p.uploaded_by || '-') + '</div></div>' +
          '<div class="info-item"><div class="label">上传时间</div><div class="value">' + esc(p.uploaded_at || '-') + '</div></div>' +
        '</div>' +
        '<div class="detail-desc">' +
          '<p>' + esc(p.description || '暂无描述') + '</p>' +
        '</div>';
    } catch (e) {
      $app.innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p><a href="#/">返回首页</a></div>';
    }
  }

  window._deletePlugin = async function (id) {
    if (!confirm('确定要删除这个插件吗？')) return;
    try {
      await api('delete', { method: 'POST', body: { id } });
      toast('已删除');
      navigate('/');
    } catch (e) { toast(e.message, 'error'); }
  };

  function renderLogin() {
    $app.innerHTML =
      '<div class="form-page">' +
        '<h1>登录</h1>' +
        '<div id="login-error" class="form-error" style="display:none"></div>' +
        '<div class="form-group"><label>用户名</label><input id="f-user" autocomplete="username"></div>' +
        '<div class="form-group"><label>密码</label><input id="f-pass" type="password" autocomplete="current-password"></div>' +
        '<button class="btn btn-primary" style="width:100%" onclick="window._doLogin()">登录</button>' +
        '<div class="form-footer">没有账号？<a href="#/register">注册</a></div>' +
      '</div>';
    document.getElementById('f-pass').addEventListener('keydown', e => { if (e.key === 'Enter') window._doLogin(); });
  }

  window._doLogin = async function () {
    const username = document.getElementById('f-user').value.trim();
    const password = document.getElementById('f-pass').value;
    const $err = document.getElementById('login-error');
    try {
      await api('login', { method: 'POST', body: { username, password } });
      await checkAuth();
      toast('登录成功');
      navigate('/');
    } catch (e) {
      $err.textContent = e.message;
      $err.style.display = 'block';
    }
  };

  function renderRegister() {
    $app.innerHTML =
      '<div class="form-page">' +
        '<h1>注册</h1>' +
        '<div id="reg-error" class="form-error" style="display:none"></div>' +
        '<div class="form-group"><label>用户名</label><input id="f-user" autocomplete="username"></div>' +
        '<div class="form-group"><label>昵称</label><input id="f-name" placeholder="可选"></div>' +
        '<div class="form-group"><label>密码</label><input id="f-pass" type="password" autocomplete="new-password"></div>' +
        '<button class="btn btn-primary" style="width:100%" onclick="window._doRegister()">注册</button>' +
        '<div class="form-footer">已有账号？<a href="#/login">登录</a></div>' +
      '</div>';
  }

  window._doRegister = async function () {
    const username = document.getElementById('f-user').value.trim();
    const display_name = document.getElementById('f-name').value.trim();
    const password = document.getElementById('f-pass').value;
    const $err = document.getElementById('reg-error');
    try {
      await api('register', { method: 'POST', body: { username, password, display_name } });
      await checkAuth();
      toast('注册成功');
      navigate('/');
    } catch (e) {
      $err.textContent = e.message;
      $err.style.display = 'block';
    }
  };

  function renderUpload() {
    if (!currentUser) { navigate('/login'); return; }
    $app.innerHTML =
      '<div class="form-page" style="max-width:500px">' +
        '<h1>上传插件</h1>' +
        '<div id="upload-error" class="form-error" style="display:none"></div>' +
        '<div class="upload-area" id="drop-zone">' +
          '<input type="file" id="file-input" accept=".zip">' +
          '<p>点击选择或拖拽 .zip 文件到此处</p>' +
        '</div>' +
        '<div id="file-info" style="display:none;margin-bottom:16px;font-size:0.85rem;color:var(--text-dim)"></div>' +
        '<button class="btn btn-primary" style="width:100%" id="upload-btn" disabled onclick="window._doUpload()">上传</button>' +
      '</div>';

    const $zone = document.getElementById('drop-zone');
    const $input = document.getElementById('file-input');
    const $info = document.getElementById('file-info');
    const $btn = document.getElementById('upload-btn');
    let selectedFile = null;

    $zone.addEventListener('click', () => $input.click());
    $zone.addEventListener('dragover', e => { e.preventDefault(); $zone.classList.add('dragover'); });
    $zone.addEventListener('dragleave', () => $zone.classList.remove('dragover'));
    $zone.addEventListener('drop', e => {
      e.preventDefault();
      $zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]);
    });
    $input.addEventListener('change', () => { if ($input.files.length) pickFile($input.files[0]); });

    function pickFile(file) {
      if (!file.name.endsWith('.zip')) { toast('只接受 .zip 文件', 'error'); return; }
      selectedFile = file;
      $info.textContent = '已选择: ' + file.name + ' (' + formatSize(file.size) + ')';
      $info.style.display = 'block';
      $btn.disabled = false;
    }

    window._doUpload = async function () {
      if (!selectedFile) return;
      $btn.disabled = true;
      $btn.textContent = '上传中…';
      const fd = new FormData();
      fd.append('plugin', selectedFile);
      try {
        await api('upload', { body: fd });
        toast('上传成功');
        navigate('/plugin/' + selectedFile.name.replace('.zip', ''));
      } catch (e) {
        document.getElementById('upload-error').textContent = e.message;
        document.getElementById('upload-error').style.display = 'block';
        $btn.disabled = false;
        $btn.textContent = '上传';
      }
    };
  }

  // ── Util ──
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── Init ──
  checkAuth().then(() => route());
})();
