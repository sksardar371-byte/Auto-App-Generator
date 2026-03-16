(function () {
  if (!window.LMS_AUTH || !window.LMS_API) return;
  var user = window.LMS_AUTH.requireAuth(['instructor']);
  if (!user) return;
  window.LMS_AUTH.bindTopbar(user);

  var page = String(document.body.getAttribute('data-page') || '').toLowerCase();
  var state = { courses: [], enrollments: [] };

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
    var title = d.courseTitle || d.title || row.name || 'Untitled Course';
    return {
      id: String(row.id || ''),
      title: String(title),
      titleKey: normalizeKey(title),
      category: String(d.category || 'General'),
      level: String(d.level || 'Intermediate'),
      status: String(d.status || row.status || 'active'),
      price: num(d.price || d.coursePrice, 49),
      instructor: String(d.instructor || user.name || 'Instructor'),
      updatedAt: row.updatedAt || row.createdAt || '',
      raw: row,
    };
  }

  function mapEnrollment(row) {
    var d = row && row.data ? row.data : {};
    var title = d.courseTitle || d.title || row.name || 'Course';
    return {
      id: String(row.id || ''),
      title: String(title),
      titleKey: normalizeKey(title),
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

  function renderDashboard() {
    var coursePrice = {};
    state.courses.forEach(function (c) { coursePrice[c.titleKey] = c.price; });
    var revenue = state.enrollments.reduce(function (sum, e) {
      return sum + (coursePrice[e.titleKey] || 39);
    }, 0);
    var uniqueLearners = new Set(state.enrollments.map(function (e) { return e.learner; })).size;

    setText('metricCourses', state.courses.length);
    setText('metricStudents', uniqueLearners);
    setText('metricRevenue', '$' + revenue.toFixed(0));
    setText('metricRating', (state.courses.length ? 4.6 : 0).toFixed(1));

    var recent = document.getElementById('recentCourses');
    if (!recent) return;
    recent.innerHTML = state.courses.length
      ? state.courses.slice(0, 8).map(function (c) {
          return '<li><strong>' + esc(c.title) + '</strong><div class="muted">' + esc(c.category) + ' | ' + esc(c.level) + ' | ' + esc(c.status) + '</div></li>';
        }).join('')
      : '<li>No courses yet. Create your first course.</li>';
  }

  function renderManageCourses() {
    var table = document.getElementById('coursesTableBody');
    if (!table) return;
    table.innerHTML = state.courses.length
      ? state.courses.map(function (c) {
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
      : '<tr><td colspan="4">No courses created yet.</td></tr>';
  }

  function renderStudents() {
    var list = document.getElementById('studentsList');
    if (!list) return;
    list.innerHTML = state.enrollments.length
      ? state.enrollments.slice(0, 50).map(function (e) {
          return '<li><strong>' + esc(e.title) + '</strong><div class="muted">' + esc(e.learner) + ' | Progress ' + e.progress + '%</div></li>';
        }).join('')
      : '<li>No enrolled students yet.</li>';
  }

  function renderEarnings() {
    var coursePrice = {};
    state.courses.forEach(function (c) { coursePrice[c.titleKey] = c.price; });
    var revenue = state.enrollments.reduce(function (sum, e) {
      return sum + (coursePrice[e.titleKey] || 39);
    }, 0);
    setText('monthlyRevenue', '$' + revenue.toFixed(0));
    setText('payoutStatus', revenue > 0 ? 'Payout queued for month-end cycle' : 'No payout until first enrollment');
  }

  function renderProfile() {
    setText('profileName', user.name || '-');
    setText('profileEmail', user.email || '-');
    setText('profileRole', user.role || '-');
  }

  async function refreshData() {
    try {
      var rows = await Promise.all([
        window.LMS_API.listProjects('course', 300),
        window.LMS_API.listProjects('enrollment', 500),
      ]);
      state.courses = (rows[0] || []).map(mapCourse);
      state.enrollments = (rows[1] || []).map(mapEnrollment);

      if (page === 'dashboard') renderDashboard();
      if (page === 'manage-courses') renderManageCourses();
      if (page === 'students') renderStudents();
      if (page === 'earnings') renderEarnings();
      if (page === 'profile') renderProfile();
    } catch (_err) {
      window.LMS_AUTH.showToast('Unable to load instructor data.');
    }
  }

  function bindCreateCourseForm() {
    var form = document.getElementById('createCourseForm');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var payload = Object.fromEntries(new FormData(form).entries());
      var title = String(payload.courseTitle || payload.title || '').trim();
      if (!title) {
        window.LMS_AUTH.showToast('Course title is required');
        return;
      }

      var saveBtn = document.getElementById('saveCourseBtn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        var body = {
          entityType: 'course',
          visibility: 'public',
          name: title,
          title: title,
          courseTitle: title,
          description: String(payload.description || ''),
          instructor: String(payload.instructor || user.name || 'Instructor'),
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
          window.LMS_AUTH.showToast((out.data && out.data.message) || 'Unable to save course');
          return;
        }
        window.LMS_AUTH.showToast('Course saved successfully');
        form.reset();
      } catch (_err) {
        window.LMS_AUTH.showToast('Unable to save course');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Course';
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

      var course = state.courses.find(function (c) { return c.id === id; });
      if (!course) {
        window.LMS_AUTH.showToast('Course record not found');
        return;
      }

      if (action === 'delete') {
        var ok = window.confirm('Delete "' + course.title + '"?');
        if (!ok) return;
        var del = await window.LMS_API.deleteProject(id);
        if (!del.res || !del.res.ok) {
          window.LMS_AUTH.showToast((del.data && del.data.message) || 'Unable to delete course');
          return;
        }
        window.LMS_AUTH.showToast('Course deleted');
        refreshData();
        return;
      }

      if (action === 'edit') {
        var nextTitle = window.prompt('Update course title', course.title);
        if (nextTitle == null) return;
        nextTitle = String(nextTitle || '').trim();
        if (!nextTitle) {
          window.LMS_AUTH.showToast('Title cannot be empty');
          return;
        }
        var nextStatus = window.prompt('Update status (active/draft/completed)', course.status || 'active');
        if (nextStatus == null) return;
        var updatePayload = {
          entityType: 'course',
          name: nextTitle,
          title: nextTitle,
          courseTitle: nextTitle,
          status: String(nextStatus || 'active').toLowerCase(),
          visibility: 'public',
        };
        var upd = await window.LMS_API.updateProject(id, updatePayload);
        if (!upd.res || !upd.res.ok) {
          window.LMS_AUTH.showToast((upd.data && upd.data.message) || 'Unable to update course');
          return;
        }
        window.LMS_AUTH.showToast('Course updated');
        refreshData();
      }
    });
  }

  if (page === 'create-course') bindCreateCourseForm();
  if (page === 'manage-courses') bindManageActions();
  refreshData();
})();
