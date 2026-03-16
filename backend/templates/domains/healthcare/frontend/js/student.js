(function () {
  function mountStudent() {
    if (!window.LMS_AUTH || !window.LMS_API) return;
    var user = window.LMS_AUTH.requireAuth(['patient','student']);
    if (!user) return;
    window.LMS_AUTH.bindTopbar(user);

    var page = String(document.body.getAttribute('data-page') || '').toLowerCase();

    function tuneStudentLayout() {
      var sidebar = document.querySelector('.role-nav');
      if (sidebar) {
        var profileLink = sidebar.querySelector('a[href="profile.html"]');
        if (profileLink) profileLink.remove();
      }

      var catalogBtn = document.querySelector('.role-sidebar > a.btn.secondary[href*="doctors.html"], .role-sidebar > a.btn.secondary[href*="course-catalog"]');
      if (catalogBtn) catalogBtn.textContent = 'Find Doctors';

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
        title: String(d.courseTitle || d.title || row.name || 'Appointment'),
        courseKey: String(d.courseKey || d.courseId || d.courseTitle || d.title || row.name || ''),
        instructor: String(d.instructor || 'Care Team'),
        progress: Math.max(0, Math.min(100, Number(d.progress || 0))),
        status: String(d.status || row.status || 'active'),
        updatedAt: row.updatedAt || row.createdAt || '',
        certificateIssued: Boolean(d.certificateIssued),
      };
    }

    function mapCourse(row) {
      var d = row && row.data ? row.data : {};
      return {
        id: String(row.id || ''),
        courseKey: String(d.courseKey || d.courseId || d.courseTitle || d.title || row.name || ''),
        title: String(d.courseTitle || d.title || row.name || 'Appointment'),
        instructor: String(d.instructor || 'Care Team'),
        level: String(d.level || 'Beginner'),
        category: String(d.category || 'General'),
        duration: String((d.durationWeeks ? (d.durationWeeks * 30) : 30) + ' minutes'),
        price: Number(d.price || d.coursePrice || 39),
      };
    }

    Promise.all([
      window.LMS_API.listProjects('booking', 300),
      window.LMS_API.listProjects('appointment', 200),
    ]).then(function (values) {
      var enrollments = values[0].map(mapEnrollment);
      var courses = values[1].map(mapCourse);

      var completed = enrollments.filter(function (x) { return x.status === 'completed' || x.progress >= 100; }).length;
      var active = enrollments.filter(function (x) {
        var s = String(x.status || '').toLowerCase();
        return s !== 'completed' && s !== 'rejected' && s !== 'cancelled';
      }).length;
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
            return '<li><strong>' + e.title + '</strong><div class="muted">Status ' + e.status + ' | Progress ' + e.progress + '% | Last update ' + fmtDate(e.updatedAt) + '</div></li>';
          }).join('') : '<li>No booked appointments yet.</li>';
        }

        var recommendedList = document.getElementById('recommendedList');
        if (recommendedList) {
          recommendedList.innerHTML = courses.length ? courses.slice(0, 6).map(function (c) {
            return '<li><strong>' + c.title + '</strong><div class="muted">' + c.category + ' | ' + c.level + ' | ' + c.instructor + '</div></li>';
          }).join('') : '<li>No specialists available right now.</li>';
        }

        var upcoming = document.getElementById('upcomingList');
        if (upcoming) {
          upcoming.innerHTML = courses.slice(0, 5).map(function (c, i) {
            return '<li><strong>' + ['Mon','Tue','Wed','Thu','Fri'][i % 5] + ' ' + (9 + i) + ':00</strong> ' + c.title + '</li>';
          }).join('') || '<li>No upcoming appointments.</li>';
        }

        var activity = document.getElementById('activityList');
        if (activity) {
          activity.innerHTML = enrollments.slice(0, 6).map(function (e) {
            return '<li>' + e.title + ' status changed to ' + e.status + ' (progress ' + e.progress + '%).</li>';
          }).join('') || '<li>No care activity yet.</li>';
        }
      }

      if (page === 'my-courses') {
        var my = document.getElementById('myCoursesList');
        if (my) {
          my.innerHTML = enrollments.length ? enrollments.map(function (e) {
            return '<article class="course-item"><h3>' + e.title + '</h3><p class="muted">Status: ' + e.status + '</p><div class="progress-track"><div class="progress-fill" style="width:' + e.progress + '%"></div></div><p class="muted">Last update: ' + fmtDate(e.updatedAt) + '</p><a class="btn secondary" href="course-player.html?course=' + encodeURIComponent(e.id) + '">Open Consultation Room</a></article>';
          }).join('') : '<p class="muted">Book an appointment to begin your care journey.</p>';
        }
      }

      if (page === 'doctors') {
        var doctorCatalog = document.getElementById('doctorCatalog');
        if (doctorCatalog) {
          var list = courses.length ? courses : [
            { id: 'dr-aisha-thomas', courseKey: 'dr-aisha-thomas', title: 'Cardiology Consultation', instructor: 'Dr. Aisha Thomas', category: 'Cardiology', level: 'Priority', duration: '30 minutes', price: 30 },
            { id: 'dr-ravi-menon', courseKey: 'dr-ravi-menon', title: 'Neurology Consultation', instructor: 'Dr. Ravi Menon', category: 'Neurology', level: 'Standard', duration: '30 minutes', price: 28 },
            { id: 'dr-nora-blake', courseKey: 'dr-nora-blake', title: 'Orthopedic Consultation', instructor: 'Dr. Nora Blake', category: 'Orthopedics', level: 'Routine', duration: '25 minutes', price: 25 }
          ];
          var bookedKeys = new Set(enrollments.map(function (e) {
            return String(e.courseKey || e.title || '').toLowerCase();
          }));
          doctorCatalog.innerHTML = list.map(function (d) {
            var key = String(d.courseKey || d.id || d.title || '').toLowerCase();
            var booked = bookedKeys.has(key);
            var action = booked
              ? '<span class="badge secondary">Booked</span>'
              : '<button class="btn secondary" type="button" data-action="book-appointment" data-course-id="' + d.id + '" data-course-key="' + key + '" data-title="' + d.title.replace(/"/g, '&quot;') + '" data-instructor="' + d.instructor.replace(/"/g, '&quot;') + '" data-category="' + d.category.replace(/"/g, '&quot;') + '" data-level="' + d.level.replace(/"/g, '&quot;') + '" data-price="' + String(d.price) + '">Book Appointment</button>';
            return '<article class="course-item"><h3>' + d.instructor + '</h3><p class="muted">' + d.category + ' | ' + d.level + '</p><p class="muted">' + d.title + ' | ' + d.duration + ' | $' + d.price + '</p><div style="margin-top:10px;">' + action + '</div></article>';
          }).join('');

          doctorCatalog.querySelectorAll('button[data-action="book-appointment"]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              var key = String(btn.getAttribute('data-course-key') || '').toLowerCase();
              if (!key) return;
              if (bookedKeys.has(key)) {
                window.LMS_AUTH.showToast('Appointment already booked.');
                return;
              }
              btn.disabled = true;
              btn.textContent = 'Booking...';
              try {
                var payload = {
                  entityType: 'booking',
                  visibility: 'private',
                  name: String(btn.getAttribute('data-title') || 'Appointment'),
                  title: String(btn.getAttribute('data-title') || 'Appointment'),
                  courseTitle: String(btn.getAttribute('data-title') || 'Appointment'),
                  courseId: String(btn.getAttribute('data-course-id') || key),
                  courseKey: key,
                  instructor: String(btn.getAttribute('data-instructor') || 'Care Team'),
                  category: String(btn.getAttribute('data-category') || 'General'),
                  level: String(btn.getAttribute('data-level') || 'Standard'),
                  durationWeeks: 1,
                  price: Number(btn.getAttribute('data-price') || 39),
                  studentName: String(user.name || ''),
                  studentEmail: String(user.email || ''),
                  status: 'pending',
                  progress: 0,
                  description: 'Appointment booking request',
                };
                var out = await window.LMS_API.createProject(payload);
                if (!out.res || !out.res.ok) {
                  window.LMS_AUTH.showToast((out.data && out.data.message) || 'Unable to book appointment');
                  btn.disabled = false;
                  btn.textContent = 'Book Appointment';
                  return;
                }
                window.LMS_AUTH.showToast('Appointment booked successfully');
                setTimeout(function () { location.href = 'my-courses.html'; }, 400);
              } catch (_err) {
                window.LMS_AUTH.showToast('Unable to book appointment');
                btn.disabled = false;
                btn.textContent = 'Book Appointment';
              }
            });
          });
        }
      }

      if (page === 'certificates') {
        var certTable = document.getElementById('certTableBody');
        if (certTable) {
          var rows = enrollments.filter(function (e) { return e.certificateIssued; });
          certTable.innerHTML = rows.length ? rows.map(function (e, i) {
            return '<tr><td>' + e.title + '</td><td>LAB-' + String(i + 1).padStart(4, '0') + '</td><td>' + fmtDate(e.updatedAt) + '</td><td><button class="btn secondary">Download PDF</button></td></tr>';
          }).join('') : '<tr><td colspan="4">No lab reports available yet.</td></tr>';
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
      window.LMS_AUTH.showToast('Unable to load patient data.');
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
          out.textContent = String(selected.value) === '0' ? 'Checklist submitted (100%).' : 'Checklist submitted. Care team will review your response.';
        });
      }
    }
  }

  mountStudent();
})();

