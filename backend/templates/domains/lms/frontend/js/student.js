(function () {
  function mountStudent() {
    if (!window.LMS_AUTH || !window.LMS_API) return;
    var user = window.LMS_AUTH.requireAuth(['student']);
    if (!user) return;
    window.LMS_AUTH.bindTopbar(user);

    var page = String(document.body.getAttribute('data-page') || '').toLowerCase();

    function tuneStudentLayout() {
      var sidebar = document.querySelector('.role-nav');
      if (sidebar) {
        var profileLink = sidebar.querySelector('a[href="profile.html"]');
        if (profileLink) profileLink.remove();
      }

      var catalogBtn = document.querySelector('.role-sidebar > a.btn.secondary[href*="course-catalog"]');
      if (catalogBtn) catalogBtn.textContent = 'Go to Courses';

      var actions = document.querySelector('.topbar-actions');
      if (actions && !actions.querySelector('a[href="profile.html"]')) {
        var profileBtn = document.createElement('a');
        profileBtn.className = 'btn secondary topbar-profile-link';
        profileBtn.href = 'profile.html';
        profileBtn.textContent = 'Profile';
        if (page === 'profile') profileBtn.classList.add('is-current');

        var logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) actions.insertBefore(profileBtn, logoutBtn);
        else actions.appendChild(profileBtn);
      } else if (actions && page === 'profile') {
        var topbarProfile = actions.querySelector('a[href="profile.html"]');
        if (topbarProfile) topbarProfile.classList.add('is-current');
      }
    }

    tuneStudentLayout();

    function fmtDate(input) {
      if (!input) return 'N/A';
      var d = new Date(input);
      return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString();
    }

    function mapEnrollment(row) {
      var d = row && row.data ? row.data : {};
      return {
        id: String(row.id || ''),
        title: String(d.courseTitle || d.title || row.name || 'Untitled Course'),
        progress: Math.max(0, Math.min(100, Number(d.progress || 0))),
        status: String(d.status || row.status || 'active'),
        updatedAt: row.updatedAt || row.createdAt || '',
        certificateIssued: Boolean(d.certificateIssued),
      };
    }

    function mapCourse(row) {
      var d = row && row.data ? row.data : {};
      return {
        title: String(d.courseTitle || d.title || row.name || 'Untitled Course'),
        instructor: String(d.instructor || 'Course Team'),
        level: String(d.level || 'Beginner'),
        category: String(d.category || 'General'),
      };
    }

    Promise.all([
      window.LMS_API.listProjects('enrollment', 300),
      window.LMS_API.listProjects('course', 200),
    ]).then(function (values) {
      var enrollments = values[0].map(mapEnrollment);
      var courses = values[1].map(mapCourse);

      var completed = enrollments.filter(function (x) { return x.status === 'completed' || x.progress >= 100; }).length;
      var active = enrollments.filter(function (x) { return x.status !== 'completed'; }).length;
      var certs = enrollments.filter(function (x) { return x.certificateIssued; }).length;

      if (page === 'dashboard') {
        var ids = {
          enrolled: 'metricEnrolled',
          active: 'metricActive',
          completed: 'metricCompleted',
          certs: 'metricCertificates',
          hours: 'metricHours'
        };
        var node;
        node = document.getElementById(ids.enrolled); if (node) node.textContent = String(enrollments.length);
        node = document.getElementById(ids.active); if (node) node.textContent = String(active);
        node = document.getElementById(ids.completed); if (node) node.textContent = String(completed);
        node = document.getElementById(ids.certs); if (node) node.textContent = String(certs);
        node = document.getElementById(ids.hours); if (node) node.textContent = String((enrollments.length * 4) + (completed * 6));

        var learningList = document.getElementById('learningList');
        if (learningList) {
          learningList.innerHTML = enrollments.length ? enrollments.slice(0, 6).map(function (e) {
            return '<li><strong>' + e.title + '</strong><div class="muted">Progress ' + e.progress + '% | Last update ' + fmtDate(e.updatedAt) + '</div></li>';
          }).join('') : '<li>No enrolled courses yet.</li>';
        }

        var recommendedList = document.getElementById('recommendedList');
        if (recommendedList) {
          recommendedList.innerHTML = courses.length ? courses.slice(0, 6).map(function (c) {
            return '<li><strong>' + c.title + '</strong><div class="muted">' + c.category + ' | ' + c.level + ' | ' + c.instructor + '</div></li>';
          }).join('') : '<li>No recommended courses available.</li>';
        }

        var upcoming = document.getElementById('upcomingList');
        if (upcoming) {
          upcoming.innerHTML = courses.slice(0, 5).map(function (c, i) {
            return '<li><strong>' + ['Mon','Tue','Wed','Thu','Fri'][i % 5] + ' ' + (9 + i) + ':00</strong> ' + c.title + '</li>';
          }).join('') || '<li>No upcoming sessions.</li>';
        }

        var activity = document.getElementById('activityList');
        if (activity) {
          activity.innerHTML = enrollments.slice(0, 6).map(function (e) {
            return '<li>' + e.title + ' progress updated to ' + e.progress + '%.</li>';
          }).join('') || '<li>No learning activity yet.</li>';
        }
      }

      if (page === 'my-courses') {
        var my = document.getElementById('myCoursesList');
        if (my) {
          my.innerHTML = enrollments.length ? enrollments.map(function (e) {
            return '<article class="course-item"><h3>' + e.title + '</h3><p class="muted">Status: ' + e.status + '</p><div class="progress-track"><div class="progress-fill" style="width:' + e.progress + '%"></div></div><p class="muted">Last watched: ' + fmtDate(e.updatedAt) + '</p><a class="btn secondary" href="course-player.html?course=' + encodeURIComponent(e.id) + '">Open Course Player</a></article>';
          }).join('') : '<p class="muted">Enroll in a course to start learning.</p>';
        }
      }

      if (page === 'certificates') {
        var certTable = document.getElementById('certTableBody');
        if (certTable) {
          var rows = enrollments.filter(function (e) { return e.certificateIssued; });
          certTable.innerHTML = rows.length ? rows.map(function (e, i) {
            return '<tr><td>' + e.title + '</td><td>CERT-' + String(i + 1).padStart(4, '0') + '</td><td>' + fmtDate(e.updatedAt) + '</td><td><button class="btn secondary">Download PDF</button></td></tr>';
          }).join('') : '<tr><td colspan="4">No certificates earned yet.</td></tr>';
        }
      }

      if (page === 'profile') {
        var profileName = document.getElementById('profileName');
        var profileEmail = document.getElementById('profileEmail');
        var profileRole = document.getElementById('profileRole');
        if (profileName) profileName.textContent = user.name;
        if (profileEmail) profileEmail.textContent = user.email || '-';
        if (profileRole) profileRole.textContent = user.role;
      }
    }).catch(function () {
      window.LMS_AUTH.showToast('Unable to load live data.');
    });

    if (page === 'quiz') {
      var submit = document.getElementById('submitQuizBtn');
      if (submit) {
        submit.addEventListener('click', function () {
          var selected = document.querySelector('input[name="quizOption"]:checked');
          var out = document.getElementById('quizResult');
          if (!out) return;
          if (!selected) {
            out.textContent = 'Select an option first.';
            return;
          }
          out.textContent = String(selected.value) === '0' ? 'Passed (100%)' : 'Submitted (40%). Review and retry.';
        });
      }
    }
  }

  mountStudent();
})();
