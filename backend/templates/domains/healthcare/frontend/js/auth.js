(function () {
  function readToken() {
    return localStorage.getItem('token') || '';
  }

  function decodeRoleFromToken(token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length < 2) return '';
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      var payload = JSON.parse(atob(b64));
      return String(payload.role || '').toLowerCase();
    } catch (_e) {
      return '';
    }
  }

  function normalizeRole(role) {
    var raw = String(role || '').toLowerCase().replace(/-/g, '_');
    if (!raw || raw === 'user' || raw === 'customer' || raw === 'student') return 'patient';
    if (raw === 'instructor' || raw === 'teacher') return 'doctor';
    if (raw === 'labtechnician') return 'lab_technician';
    return raw;
  }

  function currentUser() {
    var token = readToken();
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem('user') || '{}'); } catch (_e) { stored = {}; }
    var role = normalizeRole(stored.role || decodeRoleFromToken(token) || 'patient');
    return {
      token: token,
      role: role,
      name: String(stored.username || stored.name || stored.email || 'User'),
      email: String(stored.email || ''),
      id: stored.id || '',
    };
  }

  function rootPrefix() {
    var parts = String(location.pathname || '').replace(/\\/g, '/').split('/').filter(Boolean);
    var parent = parts.length > 1 ? parts[parts.length - 2] : '';
    return ['student', 'instructor', 'admin', 'public'].indexOf(parent) >= 0 ? '../' : '';
  }

  function pathForRole(role) {
    var r = normalizeRole(role);
    if (r === 'doctor') return 'instructor/dashboard.html';
    if (r === 'receptionist' || r === 'pharmacist' || r === 'lab_technician' || r === 'admin') return 'admin/dashboard.html';
    return 'student/dashboard.html';
  }

  function redirectAfterLogin(role) {
    location.href = pathForRole(role);
  }

  function requireAuth(allowedRoles) {
    var user = currentUser();
    if (!user.token) {
      location.href = rootPrefix() + 'login.html';
      return null;
    }
    if (Array.isArray(allowedRoles) && allowedRoles.length) {
      var normalized = allowedRoles.map(normalizeRole);
      if (normalized.indexOf(user.role) === -1) {
        location.href = rootPrefix() + pathForRole(user.role);
        return null;
      }
    }
    return user;
  }

  function bindTopbar(user) {
    var label = document.getElementById('roleUserLabel');
    if (label) label.textContent = (user.email || user.name) + ' (' + user.role + ')';
    var logout = document.getElementById('logoutBtn');
    if (logout) {
      logout.addEventListener('click', function () {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        location.href = rootPrefix() + 'login.html';
      });
    }
  }

  function showToast(text) {
    var node = document.getElementById('toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'toast';
      node.className = 'toast';
      document.body.appendChild(node);
    }
    node.textContent = String(text || 'Done');
    node.classList.add('show');
    setTimeout(function () { node.classList.remove('show'); }, 1800);
  }

  window.LMS_AUTH = {
    currentUser: currentUser,
    requireAuth: requireAuth,
    redirectAfterLogin: redirectAfterLogin,
    bindTopbar: bindTopbar,
    showToast: showToast,
    pathForRole: pathForRole,
  };
})();
