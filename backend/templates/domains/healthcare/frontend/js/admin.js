(function () {
  if (!window.LMS_AUTH || !window.LMS_API) return;
  var user = window.LMS_AUTH.requireAuth(['admin','receptionist','pharmacist','lab_technician']);
  if (!user) return;
  window.LMS_AUTH.bindTopbar(user);

  var page = String(document.body.getAttribute('data-page') || '').toLowerCase();
  var state = { appointments: [], bookings: [], billings: [], userStatuses: [] };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : Number(fallback || 0);
  }

  function mapCourse(row) {
    var d = row && row.data ? row.data : {};
    return {
      id: String(row.id || ''),
      title: String(d.courseTitle || d.title || row.name || 'Appointment'),
      status: String(d.status || row.status || 'active'),
      category: String(d.category || 'General'),
      level: String(d.level || 'Intermediate'),
      price: num(d.price || d.coursePrice, 49),
      instructor: String(d.instructor || d.instructorEmail || row.userId || 'Doctor'),
      raw: row,
    };
  }

  function mapEnrollment(row) {
    var d = row && row.data ? row.data : {};
    return {
      id: String(row.id || ''),
      title: String(d.courseTitle || d.title || row.name || 'Appointment'),
      studentName: String(d.studentName || ''),
      studentEmail: String(d.studentEmail || ''),
      learnerKey: String(d.studentEmail || d.studentName || row.userId || row.id || ''),
      status: String(d.status || row.status || 'active'),
      progress: Math.max(0, Math.min(100, num(d.progress, 0))),
      raw: row,
    };
  }

  function mapPayment(row) {
    var d = row && row.data ? row.data : {};
    return {
      amount: num(d.amount || d.price || row.amount, 0),
      month: String(d.month || ''),
    };
  }

  function mapUserStatus(row) {
    var d = row && row.data ? row.data : {};
    return {
      id: String(row.id || ''),
      userKey: String(d.userKey || row.name || ''),
      status: String(d.status || row.status || 'active').toLowerCase(),
      role: String(d.role || ''),
      email: String(d.email || ''),
      raw: row,
    };
  }

  function statusByUserKey(key) {
    var match = state.userStatuses.find(function (x) { return x.userKey === key; });
    return match ? match.status : 'active';
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function renderDashboard() {
    var uniqueLearners = new Set(state.bookings.map(function (e) { return e.learnerKey || e.id; })).size;
    var uniqueInstructors = new Set(state.appointments.map(function (c) { return c.instructor; })).size;
    var totalUsers = uniqueLearners + uniqueInstructors + 1;
    var fallbackRevenue = state.bookings.reduce(function (sum, e) {
      var course = state.appointments.find(function (c) { return c.title === e.title; });
      return sum + (course ? course.price : 39);
    }, 0);
    var paymentRevenue = state.billings.reduce(function (sum, p) { return sum + p.amount; }, 0);
    var revenue = paymentRevenue > 0 ? paymentRevenue : fallbackRevenue;

    setText('metricUsers', totalUsers);
    setText('metricCourses', state.appointments.length);
    setText('metricRevenue', '$' + revenue.toFixed(0));
    setText('metricEnrollments', state.bookings.length);
    setText('metricRating', (state.appointments.length ? 4.5 : 0).toFixed(1));
  }

  function renderUsers() {
    var table = document.getElementById('usersTableBody');
    if (!table) return;

    var map = {};
    state.appointments.forEach(function (c) {
      var key = 'instructor:' + c.instructor;
      if (map[key]) return;
      map[key] = { key: key, email: c.instructor, role: 'doctor' };
    });
    state.bookings.forEach(function (e) {
      var email = e.studentEmail || e.studentName || e.learnerKey || ('learner-' + e.id);
      var key = 'student:' + email;
      if (map[key]) return;
      map[key] = { key: key, email: email, role: 'patient' };
    });

    var rows = Object.keys(map).map(function (k) { return map[k]; });
    table.innerHTML = rows.length
      ? rows.map(function (u) {
          var status = statusByUserKey(u.key);
          var nextLabel = status === 'blocked' ? 'Unblock' : 'Block';
          return '<tr>' +
            '<td>' + esc(u.email) + '</td>' +
            '<td>' + esc(u.role) + '</td>' +
            '<td>' + esc(status) + '</td>' +
            '<td><button class="btn secondary" type="button" data-action="toggle-user" data-user-key="' + esc(u.key) + '" data-user-role="' + esc(u.role) + '" data-user-email="' + esc(u.email) + '">' + nextLabel + '</button></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="4">No staff records found.</td></tr>';
  }

  function renderCourses() {
    var table = document.getElementById('coursesTableBody');
    if (!table) return;
    table.innerHTML = state.appointments.length
      ? state.appointments.map(function (c) {
          return '<tr>' +
            '<td>' + esc(c.title) + '</td>' +
            '<td>' + esc(c.status) + '</td>' +
            '<td>' +
              '<button class="btn secondary" type="button" data-action="set-course-status" data-id="' + esc(c.id) + '" data-status="approved">Approve</button> ' +
              '<button class="btn secondary" type="button" data-action="set-course-status" data-id="' + esc(c.id) + '" data-status="rejected">Reject</button>' +
            '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="3">No appointment records found.</td></tr>';
  }

  function renderCategories() {
    var list = document.getElementById('categoriesList');
    if (!list) return;
    var categories = Array.from(new Set(state.appointments.map(function (c) { return c.category; }).filter(Boolean)));
    list.innerHTML = categories.length
      ? categories.map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('')
      : '<li>No departments available.</li>';
  }

  function renderRevenue() {
    var table = document.getElementById('revenueTableBody');
    if (!table) return;

    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    var monthly = {};
    months.forEach(function (m) { monthly[m] = 0; });

    if (state.billings.length) {
      state.billings.forEach(function (p) {
        var month = p.month && monthly[p.month] !== undefined ? p.month : months[0];
        monthly[month] += p.amount;
      });
    } else {
      state.bookings.forEach(function (e, idx) {
        var c = state.appointments.find(function (x) { return x.title === e.title; });
        var amount = c ? c.price : 39;
        monthly[months[idx % months.length]] += amount;
      });
    }

    table.innerHTML = months.map(function (m) {
      return '<tr><td>' + m + '</td><td>$' + monthly[m].toFixed(0) + '</td></tr>';
    }).join('');
  }

  function renderReports() {
    var list = document.getElementById('reportsList');
    if (!list) return;
    var topCourse = state.appointments[0];
    var topEnrolled = {};
    state.bookings.forEach(function (e) {
      topEnrolled[e.title] = (topEnrolled[e.title] || 0) + 1;
    });
    Object.keys(topEnrolled).forEach(function (title) {
      if (!topCourse || topEnrolled[title] > (topEnrolled[topCourse.title] || 0)) {
        topCourse = { title: title };
      }
    });
    list.innerHTML = [
      'Total appointments: ' + state.appointments.length,
      'Total patient bookings: ' + state.bookings.length,
      'Top appointment slot by bookings: ' + (topCourse ? topCourse.title : 'N/A'),
    ].map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('');
  }

  function renderSettings() {
    var list = document.getElementById('settingsList');
    if (!list) return;
    list.innerHTML = '<li>Platform mode: Production</li><li>Lab report template: HMS v1</li><li>Billing gateway: Internal HMS billing (sandbox)</li>';
  }

  async function upsertUserStatus(userKey, role, email, nextStatus) {
    var existing = state.userStatuses.find(function (x) { return x.userKey === userKey; });
    var payload = {
      entityType: 'user_status',
      visibility: 'public',
      name: userKey,
      userKey: userKey,
      role: role,
      email: email,
      status: nextStatus,
    };
    if (existing) {
      return window.LMS_API.updateProject(existing.id, payload);
    }
    return window.LMS_API.createProject(payload);
  }

  function bindUsersActions() {
    var table = document.getElementById('usersTableBody');
    if (!table) return;
    table.addEventListener('click', async function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[data-action="toggle-user"]') : null;
      if (!btn) return;
      var userKey = String(btn.getAttribute('data-user-key') || '');
      var role = String(btn.getAttribute('data-user-role') || 'patient');
      var email = String(btn.getAttribute('data-user-email') || '');
      if (!userKey) return;
      var current = statusByUserKey(userKey);
      var next = current === 'blocked' ? 'active' : 'blocked';
      var out = await upsertUserStatus(userKey, role, email, next);
      if (!out.res || !out.res.ok) {
        window.LMS_AUTH.showToast((out.data && out.data.message) || 'Unable to update user status');
        return;
      }
      window.LMS_AUTH.showToast('User status updated');
      refreshData();
    });
  }

  function bindCourseActions() {
    var table = document.getElementById('coursesTableBody');
    if (!table) return;
    table.addEventListener('click', async function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[data-action="set-course-status"]') : null;
      if (!btn) return;
      var id = String(btn.getAttribute('data-id') || '');
      var nextStatus = String(btn.getAttribute('data-status') || '').toLowerCase();
      if (!id || !nextStatus) return;
      var out = await window.LMS_API.updateProject(id, {
        entityType: 'appointment',
        status: nextStatus,
        visibility: 'public',
      });
      if (!out.res || !out.res.ok) {
        window.LMS_AUTH.showToast((out.data && out.data.message) || 'Unable to update appointment');
        return;
      }
      window.LMS_AUTH.showToast('Appointment status updated');
      refreshData();
    });
  }

  async function refreshData() {
    try {
      var rows = await Promise.all([
        window.LMS_API.listProjects('appointment', 300),
        window.LMS_API.listProjects('booking', 500),
        window.LMS_API.listProjects('billing', 200),
        window.LMS_API.listProjects('user_status', 300),
      ]);
      state.appointments = (rows[0] || []).map(mapCourse);
      state.bookings = (rows[1] || []).map(mapEnrollment);
      state.billings = (rows[2] || []).map(mapPayment);
      state.userStatuses = (rows[3] || []).map(mapUserStatus);

      if (page === 'dashboard') renderDashboard();
      if (page === 'users') renderUsers();
      if (page === 'courses') renderCourses();
      if (page === 'categories') renderCategories();
      if (page === 'revenue') renderRevenue();
      if (page === 'reports') renderReports();
      if (page === 'settings') renderSettings();
    } catch (_err) {
      window.LMS_AUTH.showToast('Unable to load admin data.');
    }
  }

  if (page === 'users') bindUsersActions();
  if (page === 'courses') bindCourseActions();
  refreshData();
})();

