(function () {
  if (!window.LMS_AUTH || !window.LMS_API) return;
  var user = window.LMS_AUTH.requireAuth(['doctor','instructor']);
  if (!user) return;
  window.LMS_AUTH.bindTopbar(user);

  var page = String(document.body.getAttribute('data-page') || '').toLowerCase();
  var state = { appointments: [], bookings: [] };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  }

  function num(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : Number(fallback || 0);
  }

  function mapCourse(row) {
    var d = row && row.data ? row.data : {};
    var title = d.courseTitle || d.title || row.name || 'Consultation';
    return {
      id: String(row.id || ''),
      title: String(title),
      titleKey: normalizeKey(title),
      category: String(d.category || 'General'),
      level: String(d.level || 'Intermediate'),
      status: String(d.status || row.status || 'active'),
      price: num(d.price || d.coursePrice, 49),
      instructor: String(d.instructor || user.name || 'Doctor'),
      updatedAt: row.updatedAt || row.createdAt || '',
      raw: row,
    };
  }

  function mapEnrollment(row) {
    var d = row && row.data ? row.data : {};
    var title = d.courseTitle || d.title || row.name || 'Consultation';
    return {
      id: String(row.id || ''),
      title: String(title),
      titleKey: normalizeKey(title),
      courseId: String(d.courseId || ''),
      courseKey: String(d.courseKey || d.courseId || title),
      instructor: String(d.instructor || ''),
      studentName: String(d.studentName || ''),
      studentEmail: String(d.studentEmail || ''),
      status: String(d.status || row.status || 'active'),
      progress: Math.max(0, Math.min(100, num(d.progress, 0))),
      learner: String(d.studentEmail || d.studentName || row.userId || 'Learner'),
      updatedAt: row.updatedAt || row.createdAt || '',
      raw: row,
    };
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function bookingsForDoctor() {
    var meName = String(user.name || '').toLowerCase();
    var meEmail = String(user.email || '').toLowerCase();
    var matched = state.bookings.filter(function (b) {
      var assigned = String(b.instructor || '').toLowerCase();
      if (!assigned) return true;
      if (!meName && !meEmail) return true;
      return assigned === meName || assigned === meEmail || assigned.indexOf(meName) >= 0 || assigned.indexOf(meEmail) >= 0;
    });
    return matched.length ? matched : state.bookings;
  }

  function renderDashboard() {
    var coursePrice = {};
    state.appointments.forEach(function (c) { coursePrice[c.titleKey] = c.price; });
    var queue = bookingsForDoctor();
    var revenue = queue.reduce(function (sum, e) {
      return sum + (coursePrice[e.titleKey] || 39);
    }, 0);
    var uniqueLearners = new Set(queue.map(function (e) { return e.learner; })).size;

    setText('metricCourses', queue.length);
    setText('metricStudents', uniqueLearners);
    setText('metricRevenue', '$' + revenue.toFixed(0));
    setText('metricRating', (queue.length ? 4.6 : 0).toFixed(1));

    var recent = document.getElementById('recentCourses');
    if (!recent) return;
    recent.innerHTML = queue.length
      ? queue.slice(0, 20).map(function (b) {
          var status = String(b.status || 'pending').toLowerCase();
          var locked = status === 'approved' || status === 'rejected';
          var label = status.charAt(0).toUpperCase() + status.slice(1);
          var actionButtons = locked
            ? '<span class="badge secondary">' + esc(label) + '</span>'
            : '<button class="btn secondary" type="button" data-action="approve-booking" data-id="' + esc(b.id) + '">Approve</button> ' +
              '<button class="btn secondary" type="button" data-action="reject-booking" data-id="' + esc(b.id) + '">Reject</button>';
          return '<li>' +
            '<strong>' + esc(b.title) + '</strong>' +
            '<div class="muted">' + esc(b.learner) + ' | Status: ' + esc(label) + ' | Progress ' + b.progress + '%</div>' +
            '<div style="margin-top:8px;">' + actionButtons + '</div>' +
          '</li>';
        }).join('')
      : '<li>No booked appointments yet.</li>';
  }

  function renderManageCourses() {
    var table = document.getElementById('coursesTableBody');
    if (!table) return;
    table.innerHTML = state.appointments.length
      ? state.appointments.map(function (c) {
          return '<tr>' +
            '<td>' + esc(c.title) + '</td>' +
            '<td>' + esc(c.status) + '</td>' +
            '<td>' + esc(c.level) + '</td>' +
            '<td>' +
              '<button class="btn secondary" type="button" data-action="edit" data-id="' + esc(c.id) + '">Edit</button> ' +
              '<button class="btn secondary" type="button" data-action="delete" data-id="' + esc(c.id) + '">Delete</button>' +
            '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="4">No consultation records created yet.</td></tr>';
  }

  function renderStudents() {
    var list = document.getElementById('studentsList');
    if (!list) return;
    list.innerHTML = state.bookings.length
      ? state.bookings.slice(0, 50).map(function (e) {
          return '<li><strong>' + esc(e.title) + '</strong><div class="muted">' + esc(e.learner) + ' | Progress ' + e.progress + '%</div></li>';
        }).join('')
      : '<li>No patient assignments yet.</li>';
  }

  function renderEarnings() {
    var coursePrice = {};
    state.appointments.forEach(function (c) { coursePrice[c.titleKey] = c.price; });
    var revenue = state.bookings.reduce(function (sum, e) {
      return sum + (coursePrice[e.titleKey] || 39);
    }, 0);
    setText('monthlyRevenue', '$' + revenue.toFixed(0));
    setText('payoutStatus', revenue > 0 ? 'Billing summary queued for month-end review' : 'No billing records yet');
  }

  function renderProfile() {
    setText('profileName', user.name || '-');
    setText('profileEmail', user.email || '-');
    setText('profileRole', user.role || '-');
  }

  async function refreshData() {
    try {
      var rows = await Promise.all([
        window.LMS_API.listProjects('appointment', 300),
        window.LMS_API.listProjects('booking', 500),
      ]);
      state.appointments = (rows[0] || []).map(mapCourse);
      state.bookings = (rows[1] || []).map(mapEnrollment);

      if (page === 'dashboard') renderDashboard();
      if (page === 'manage-courses') renderManageCourses();
      if (page === 'students') renderStudents();
      if (page === 'earnings') renderEarnings();
      if (page === 'profile') renderProfile();
    } catch (_err) {
      window.LMS_AUTH.showToast('Unable to load doctor data.');
    }
  }

  async function updateBookingStatus(booking, nextStatus) {
    if (!booking || !booking.id) return;
    var status = String(nextStatus || '').toLowerCase();
    if (!status) return;
    var progress = booking.progress;
    if (status === 'approved') progress = Math.max(progress, 20);
    if (status === 'rejected') progress = Math.min(progress, 20);
    var payload = {
      entityType: 'booking',
      visibility: 'private',
      name: booking.title,
      title: booking.title,
      courseTitle: booking.title,
      courseId: booking.courseId || booking.courseKey || booking.title,
      courseKey: booking.courseKey || booking.courseId || booking.title,
      instructor: booking.instructor || user.name || user.email || 'Doctor',
      studentName: booking.studentName || '',
      studentEmail: booking.studentEmail || '',
      status: status,
      progress: progress,
      description: 'Doctor updated appointment to ' + status,
    };
    var out = await window.LMS_API.updateProject(booking.id, payload);
    if (!out.res || !out.res.ok) {
      window.LMS_AUTH.showToast((out.data && out.data.message) || 'Unable to update appointment status');
      return;
    }
    window.LMS_AUTH.showToast('Appointment ' + status);
    refreshData();
  }

  function bindDashboardActions() {
    var list = document.getElementById('recentCourses');
    if (!list) return;
    list.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[data-action][data-id]') : null;
      if (!btn) return;
      var id = String(btn.getAttribute('data-id') || '');
      var action = String(btn.getAttribute('data-action') || '');
      if (!id || !action) return;
      var booking = state.bookings.find(function (row) { return row.id === id; });
      if (!booking) {
        window.LMS_AUTH.showToast('Appointment not found');
        return;
      }
      if (action === 'approve-booking') updateBookingStatus(booking, 'approved');
      if (action === 'reject-booking') updateBookingStatus(booking, 'rejected');
    });
  }

  function bindCreateCourseForm() {
    var form = document.getElementById('createCourseForm');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var payload = Object.fromEntries(new FormData(form).entries());
      var title = String(payload.courseTitle || payload.title || '').trim();
      if (!title) {
        window.LMS_AUTH.showToast('Consultation title is required');
        return;
      }

      var saveBtn = document.getElementById('saveCourseBtn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        var body = {
          entityType: 'appointment',
          visibility: 'public',
          name: title,
          title: title,
          courseTitle: title,
          description: String(payload.description || ''),
          instructor: String(payload.instructor || user.name || 'Doctor'),
          instructorEmail: String(user.email || ''),
          category: String(payload.category || 'General'),
          level: String(payload.level || 'Intermediate'),
          status: String(payload.status || 'active'),
          price: num(payload.price, 49),
          durationWeeks: num(payload.durationWeeks, 8),
          thumbnailUrl: String(payload.thumbnailUrl || ''),
          videoUrl: String(payload.videoUrl || ''),
          notes: String(payload.notes || ''),
          quizQuestion: String(payload.quizQuestion || ''),
          rating: 4.6,
          enrolledLearners: 0,
        };
        var out = await window.LMS_API.createProject(body);
        if (!out.res || !out.res.ok) {
          window.LMS_AUTH.showToast((out.data && out.data.message) || 'Unable to save consultation');
          return;
        }
        window.LMS_AUTH.showToast('Consultation saved successfully');
        form.reset();
      } catch (_err) {
        window.LMS_AUTH.showToast('Unable to save consultation');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Consultation';
        }
      }
    });
  }

  function bindManageActions() {
    var table = document.getElementById('coursesTableBody');
    if (!table) return;
    table.addEventListener('click', async function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!btn) return;
      var id = String(btn.getAttribute('data-id') || '');
      var action = String(btn.getAttribute('data-action') || '');
      if (!id || !action) return;

      var course = state.appointments.find(function (c) { return c.id === id; });
      if (!course) {
        window.LMS_AUTH.showToast('Consultation record not found');
        return;
      }

      if (action === 'delete') {
        var ok = window.confirm('Delete "' + course.title + '"?');
        if (!ok) return;
        var del = await window.LMS_API.deleteProject(id);
        if (!del.res || !del.res.ok) {
          window.LMS_AUTH.showToast((del.data && del.data.message) || 'Unable to delete consultation');
          return;
        }
        window.LMS_AUTH.showToast('Consultation deleted');
        refreshData();
        return;
      }

      if (action === 'edit') {
        var nextTitle = window.prompt('Update consultation title', course.title);
        if (nextTitle == null) return;
        nextTitle = String(nextTitle || '').trim();
        if (!nextTitle) {
          window.LMS_AUTH.showToast('Title cannot be empty');
          return;
        }
        var nextStatus = window.prompt('Update status (active/draft/completed)', course.status || 'active');
        if (nextStatus == null) return;
        var updatePayload = {
          entityType: 'appointment',
          name: nextTitle,
          title: nextTitle,
          courseTitle: nextTitle,
          status: String(nextStatus || 'active').toLowerCase(),
          visibility: 'public',
        };
        var upd = await window.LMS_API.updateProject(id, updatePayload);
        if (!upd.res || !upd.res.ok) {
          window.LMS_AUTH.showToast((upd.data && upd.data.message) || 'Unable to update consultation');
          return;
        }
        window.LMS_AUTH.showToast('Consultation updated');
        refreshData();
      }
    });
  }

  if (page === 'create-course') bindCreateCourseForm();
  if (page === 'manage-courses') bindManageActions();
  if (page === 'dashboard') bindDashboardActions();
  refreshData();
})();

