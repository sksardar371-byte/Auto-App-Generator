(async function () {
  const token = localStorage.getItem("token") || "";
  if (!token) return (location.href = "login.html");
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const API_BASE = String(window.APP_API_BASE || ((location.origin || "") + "/api") || "/api").replace(/\/+$/, "");
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const $ = (id) => document.getElementById(id);
  const el = {
    role: $("roleAccessNote"),
    msg: $("enrollmentMessage"),
    source: $("catalogSourceTag"),
    search: $("catalogSearch"),
    category: $("catalogCategory"),
    catalog: $("courseCatalog"),
    myCount: $("myCourseCount"),
    myList: $("myCoursesList"),
    records: $("project-list"),
    sessions: $("upcomingSessions"),
    activity: $("activityFeed"),
    form: $("dashboardFeatureForm"),
    refresh: $("refreshBtn"),
    logout: $("logoutBtn"),
    mCourses: $("metricCourses"),
    mActive: $("metricActive"),
    mCompleted: $("metricCompleted"),
    mRating: $("metricRating"),
    mode: $("classroomModeTag"),
    cEmpty: $("classroomEmpty"),
    cBody: $("classroomContent"),
    cTitle: $("classroomCourseTitle"),
    cMeta: $("classroomCourseMeta"),
    cFill: $("classroomProgressFill"),
    cText: $("classroomProgressText"),
    lessons: $("lessonChecklist"),
    saveLesson: $("saveProgressBtn"),
    aTitle: $("assignmentTitle"),
    aText: $("assignmentText"),
    aSubmit: $("submitAssignmentBtn"),
    aStatus: $("assignmentStatus"),
    qQuestion: $("quizQuestion"),
    qOptions: $("quizOptions"),
    qSubmit: $("submitQuizBtn"),
    qResult: $("quizResult"),
    certStatus: $("certificateStatus"),
    certRequestBtn: $("requestCertificateBtn"),
    discussionList: $("discussionList"),
    discussionInput: $("discussionInput"),
    postDiscussionBtn: $("postDiscussionBtn"),
    courseCreatePanel: $("courseCreatePanel"),
    courseCatalogView: $("viewCourseCatalog"),
    instructorPanel: $("instructorPanel"),
    instructorEnrollmentList: $("instructorEnrollmentList"),
    gradingEnrollmentSelect: $("gradingEnrollmentSelect"),
    gradingScoreInput: $("gradingScoreInput"),
    gradingFeedbackInput: $("gradingFeedbackInput"),
    saveGradeBtn: $("saveGradeBtn"),
    issueCertificateBtn: $("issueCertificateBtn"),
    certificateRequestList: $("certificateRequestList"),
  };
  const navButtons = Array.from(document.querySelectorAll(".lms-sidebar-nav [data-nav-target]"));
  const viewPanels = Array.from(document.querySelectorAll("[data-view-group]"));
  const NAV_TARGET_ALIASES = {
    viewAssignments: "viewClassroom",
    viewCohorts: "viewUpcomingSessions",
    viewReports: "viewCourseRecords",
  };

  const s = {
    isAdmin: false,
    isStudent: false,
    courses: [],
    courseRows: [],
    enrollments: [],
    byCourse: new Map(),
    selectedEnrollmentId: "",
    pendingEnroll: new Set(),
    discussionRows: [],
    certRequestRows: [],
    selectedGradingEnrollmentId: "",
    timer: null,
  };

  const N = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const C = (v, min, max, d) => Math.max(min, Math.min(max, N(v, d)));
  const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const key = (v) => (String(v || "").toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `course-${Date.now()}`);
  const status = (v) => (/completed/i.test(String(v || "")) ? "completed" : /draft/i.test(String(v || "")) ? "draft" : "active");
  const jwtRole = (() => {
    try {
      const p = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return String(user.role || p.role || "user").toLowerCase();
    } catch (_e) {
      return String(user.role || "user").toLowerCase();
    }
  })();
  s.isAdmin = jwtRole === "admin";
  s.isStudent = /^(user|student|customer)$/.test(jwtRole) || !jwtRole;

  function showMsg(text, type) {
    if (!el.msg) return;
    el.msg.className = "enrollment-message show " + (type === "error" ? "error" : "success");
    el.msg.textContent = text;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      el.msg.className = "enrollment-message";
      el.msg.textContent = "";
    }, 3200);
  }

  function normalizeNavTarget(targetId) {
    const keyId = String(targetId || "").trim();
    return NAV_TARGET_ALIASES[keyId] || keyId;
  }

  function setActiveNav(targetId) {
    const keyId = normalizeNavTarget(targetId);
    navButtons.forEach((btn) => {
      btn.classList.toggle("active", String(btn.getAttribute("data-nav-target") || "") === keyId);
    });
  }

  function setVisibleView(targetId) {
    const keyId = normalizeNavTarget(targetId);
    if (!keyId) return;
    viewPanels.forEach((panel) => {
      panel.hidden = String(panel.getAttribute("data-view-group") || "") !== keyId;
    });
  }

  function openNavTarget(targetId, smooth = true) {
    const keyId = normalizeNavTarget(targetId);
    if (!keyId) return;
    setActiveNav(keyId);
    setVisibleView(keyId);
    const section = document.getElementById(keyId);
    if (!section) return;
    if (location.hash !== `#${keyId}`) history.replaceState(null, "", `#${keyId}`);
    if (smooth) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function defaultLessons(title) {
    return [
      { id: "l1", title: `Intro to ${title}`, durationMin: 20 },
      { id: "l2", title: `${title} Core Concepts`, durationMin: 24 },
      { id: "l3", title: `${title} Practical Lab`, durationMin: 30 },
      { id: "l4", title: `${title} Final Review`, durationMin: 22 },
    ];
  }

  function defaultQuiz(title) {
    return {
      question: `Which method best improves outcomes in ${title}?`,
      options: [
        "Structured practice with feedback",
        "Skip fundamentals",
        "No hands-on work",
        "Ignore revision",
      ],
      correctIndex: 0,
    };
  }

  function normLessons(raw, title) {
    if (!Array.isArray(raw) || !raw.length) return defaultLessons(title);
    return raw.map((x, i) => typeof x === "string"
      ? { id: `l${i + 1}`, title: x, durationMin: 20 }
      : { id: String(x.id || `l${i + 1}`), title: String(x.title || x.name || `Lesson ${i + 1}`), durationMin: C(x.durationMin || x.duration, 5, 180, 20) });
  }

  function normQuiz(raw, title) {
    const q = raw && typeof raw === "object" ? raw : defaultQuiz(title);
    const options = Array.isArray(q.options) ? q.options.map((x) => String(x || "")).filter(Boolean) : [];
    if (options.length < 2) return defaultQuiz(title);
    return { question: String(q.question || defaultQuiz(title).question), options, correctIndex: C(q.correctIndex, 0, options.length - 1, 0) };
  }

  function progressOf(en) {
    const lesson = Math.round((en.completedLessons.length / Math.max(en.lessons.length, 1)) * 70);
    const assign = en.assignmentSubmitted ? 15 : 0;
    const quiz = en.quizPassed ? 15 : Math.round(C(en.quizScore, 0, 100, 0) * 0.08);
    return C(lesson + assign + quiz, 0, 100, 0);
  }

  function canRequestCertificate(enrollment) {
    if (!enrollment) return false;
    return enrollment.progress >= 80 && enrollment.assignmentSubmitted && enrollment.quizPassed;
  }

  function mapCourse(row) {
    const d = row && row.data ? row.data : {};
    const title = String(d.courseTitle || d.title || row.name || "Untitled Course");
    return {
      id: String(row.id || d.courseId || key(title)),
      courseKey: key(d.courseKey || d.courseId || row.id || title),
      title,
      instructor: String(d.instructor || "Course Team"),
      category: String(d.category || "General"),
      level: String(d.level || "Intermediate"),
      durationWeeks: C(d.durationWeeks, 1, 52, 8),
      status: status(d.status || row.status),
      progress: C(d.progress, 0, 100, 30),
      rating: C(d.rating, 1, 5, 4.5),
      learners: C(d.learners, 1, 100000, 120),
      price: C(d.price, 0, 2000, 49),
      videoUrl: String(d.videoUrl || d.videoLink || ""),
      postNotes: String(d.postNotes || d.notes || ""),
      lessons: normLessons(d.lessons || d.syllabus, title),
      assignmentTitle: String(d.assignmentTitle || `Project Assignment: ${title}`),
      quiz: normQuiz(d.quiz, title),
      updatedAt: String(row.updatedAt || row.createdAt || ""),
    };
  }

  function mapEnrollment(row) {
    const d = row && row.data ? row.data : {};
    const title = String(d.courseTitle || d.title || row.name || "Untitled Course");
    const lessons = normLessons(d.lessons || d.syllabus, title);
    const en = {
      id: String(row.id || ""),
      courseKey: key(d.courseKey || d.courseId || title),
      title,
      instructor: String(d.instructor || "Course Team"),
      category: String(d.category || "General"),
      level: String(d.level || "Intermediate"),
      durationWeeks: C(d.durationWeeks, 1, 52, 8),
      rating: C(d.rating, 1, 5, 4.5),
      learners: C(d.learners, 1, 100000, 120),
      price: C(d.price, 0, 2000, 49),
      videoUrl: String(d.videoUrl || d.videoLink || ""),
      postNotes: String(d.postNotes || d.notes || ""),
      lessons,
      completedLessons: Array.isArray(d.completedLessons) ? d.completedLessons.map((x) => String(x || "")).filter(Boolean) : [],
      assignmentTitle: String(d.assignmentTitle || `Project Assignment: ${title}`),
      assignmentSubmitted: Boolean(d.assignmentSubmitted),
      assignmentText: String(d.assignmentText || ""),
      quiz: normQuiz(d.quiz, title),
      quizScore: C(d.quizScore, 0, 100, 0),
      quizPassed: Boolean(d.quizPassed),
      quizAnswerIndex: N(d.quizAnswerIndex, -1),
      instructorGrade: C(d.instructorGrade, 0, 100, 0),
      instructorFeedback: String(d.instructorFeedback || ""),
      certificateIssued: Boolean(d.certificateIssued),
      certificateIssuedAt: String(d.certificateIssuedAt || ""),
      certificateCode: String(d.certificateCode || ""),
      progress: C(d.progress, 0, 100, 0),
      status: status(d.status || row.status),
      enrolledAt: String(row.createdAt || ""),
    };
    const p = progressOf(en);
    en.progress = Math.max(en.progress, p);
    en.status = en.progress >= 100 ? "completed" : "active";
    return en;
  }

  async function req(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function fetchCourses() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=course&limit=120`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function fetchEnrollments() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=enrollment&limit=200`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function fetchDiscussionPosts() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=discussion_post&limit=300`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function fetchCertificateRequests() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=certificate_request&limit=300`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function saveEnrollment(en) {
    return req(`${API_BASE}/projects/${encodeURIComponent(en.id)}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({
        entityType: "enrollment",
        title: en.title,
        courseTitle: en.title,
        courseId: en.id || en.courseKey,
        courseKey: en.courseKey,
        instructor: en.instructor,
        category: en.category,
        level: en.level,
        durationWeeks: en.durationWeeks,
        rating: en.rating,
        learners: en.learners,
        price: en.price,
        videoUrl: en.videoUrl || "",
        postNotes: en.postNotes || "",
        lessons: en.lessons,
        completedLessons: en.completedLessons,
        assignmentTitle: en.assignmentTitle,
        assignmentSubmitted: en.assignmentSubmitted,
        assignmentText: en.assignmentText,
        quiz: en.quiz,
        quizScore: en.quizScore,
        quizPassed: en.quizPassed,
        quizAnswerIndex: en.quizAnswerIndex,
        instructorGrade: en.instructorGrade,
        instructorFeedback: en.instructorFeedback,
        certificateIssued: Boolean(en.certificateIssued),
        certificateIssuedAt: en.certificateIssuedAt || "",
        certificateCode: en.certificateCode || "",
        progress: en.progress,
        status: en.status,
        description: `Learning progress ${en.progress}% in ${en.title}`,
      }),
    });
  }

  function sampleCatalog() {
    const base = [
      { title: "Full Stack Web Development Bootcamp", instructor: "Aisha Thomas", category: "Web Development", level: "Intermediate", durationWeeks: 12, rating: 4.8, learners: 420, price: 79, videoUrl: "https://example.com/videos/full-stack-intro", postNotes: "Week 1 setup notes and coding standards." },
      { title: "Data Analytics with Python", instructor: "Ravi Menon", category: "Data Science", level: "Beginner", durationWeeks: 8, rating: 4.6, learners: 365, price: 59, videoUrl: "https://example.com/videos/data-analytics-intro", postNotes: "Notebook links and dataset preparation notes." },
      { title: "Cloud Engineering on AWS", instructor: "Nora Blake", category: "Cloud Computing", level: "Advanced", durationWeeks: 10, rating: 4.7, learners: 215, price: 99, videoUrl: "https://example.com/videos/aws-engineering-intro", postNotes: "AWS account checklist and security best practices." },
      { title: "Product Design Systems", instructor: "Liam OConnor", category: "Design", level: "Intermediate", durationWeeks: 6, rating: 4.5, learners: 182, price: 44, videoUrl: "https://example.com/videos/design-systems-intro", postNotes: "Figma library setup notes and workflow." },
      { title: "SQL for Analytics Teams", instructor: "Neha Kapoor", category: "Data Science", level: "Beginner", durationWeeks: 4, rating: 4.4, learners: 310, price: 39, videoUrl: "https://example.com/videos/sql-analytics-intro", postNotes: "Query patterns and joins revision notes." },
    ];
    return base.sort(() => Math.random() - 0.5).slice(0, 5).map((c, i) => ({
      id: `sample-${i + 1}`,
      courseKey: key(c.title),
      status: "active",
      progress: C(30 + Math.floor(Math.random() * 40), 0, 100, 40),
      lessons: defaultLessons(c.title),
      assignmentTitle: `Project Assignment: ${c.title}`,
      quiz: defaultQuiz(c.title),
      updatedAt: "",
      ...c,
    }));
  }

  function selectedEnrollment() {
    if (!s.selectedEnrollmentId && s.enrollments.length) s.selectedEnrollmentId = s.enrollments[0].id;
    return s.enrollments.find((x) => x.id === s.selectedEnrollmentId) || null;
  }

  function filterCatalog() {
    const q = String((el.search && el.search.value) || "").toLowerCase().trim();
    const cat = String((el.category && el.category.value) || "all").toLowerCase();
    return s.courses.filter((c) => {
      if (cat !== "all" && String(c.category).toLowerCase() !== cat) return false;
      if (!q) return true;
      return [c.title, c.instructor, c.category, c.level].join(" ").toLowerCase().includes(q);
    });
  }

  function renderMetrics() {
    if (el.mCourses) el.mCourses.textContent = String(s.courses.length);
    if (el.mActive) el.mActive.textContent = String(s.courses.filter((x) => x.status === "active").length);
    if (el.mCompleted) el.mCompleted.textContent = String(s.isStudent ? s.enrollments.filter((x) => x.status === "completed").length : s.courses.filter((x) => x.status === "completed").length);
    if (el.mRating) el.mRating.textContent = (s.courses.length ? (s.courses.reduce((a, b) => a + b.rating, 0) / s.courses.length) : 0).toFixed(1);
  }

  function renderCatalog() {
    if (!el.catalog) return;
    const rows = filterCatalog();
    el.catalog.innerHTML = rows.length ? rows.map((c) => {
      const enrolled = s.byCourse.has(c.courseKey);
      const pending = s.pendingEnroll.has(c.courseKey);
      const safeVideoUrl = /^https?:\/\//i.test(c.videoUrl || "") ? esc(c.videoUrl) : "";
      const notesLine = c.postNotes ? `<p class="course-meta">Notes: ${esc(String(c.postNotes).slice(0, 140))}</p>` : "";
      const videoLine = safeVideoUrl ? `<p class="course-meta"><a class="course-link" href="${safeVideoUrl}" target="_blank" rel="noopener noreferrer">Watch Intro Video</a></p>` : "";
      const action = s.isStudent
        ? enrolled ? `<span class="course-badge">Enrolled</span>` : `<button class="btn enroll-btn" data-course-key="${esc(c.courseKey)}" ${pending ? "disabled" : ""}>${pending ? "Enrolling..." : "Enroll Now"}</button>`
        : `<span class="course-meta">Student role can enroll</span>`;
      return `<article class="course-card">
        <h3>${esc(c.title)}</h3>
        <p class="course-meta">${esc(c.category)} | ${esc(c.level)}</p>
        <p class="course-stats"><span>${esc(c.instructor)}</span><span>${c.durationWeeks} weeks</span><span>${c.lessons.length} lessons</span><span>${c.learners} learners</span><span>${c.rating.toFixed(1)} rating</span><span>$${c.price}</span></p>
        <div class="progress-track"><div class="progress-fill" style="width:${c.progress}%"></div></div>
        <p class="course-meta">${esc(c.assignmentTitle)}</p>
        ${videoLine}
        ${notesLine}
        <div class="course-actions">${action}</div>
      </article>`;
    }).join("") : "<p class='muted'>No courses match your search.</p>";
    if (s.isStudent) {
      el.catalog.querySelectorAll(".enroll-btn").forEach((btn) => btn.addEventListener("click", () => handleEnroll(String(btn.getAttribute("data-course-key") || ""))));
    }
  }

  function renderMyCourses() {
    if (!el.myList) return;
    if (!s.isStudent) {
      if (el.myCount) el.myCount.textContent = "Student View";
      el.myList.innerHTML = "<p class='muted'>My Courses is visible for student accounts.</p>";
      return;
    }
    if (el.myCount) el.myCount.textContent = `${s.enrollments.length} Enrolled`;
    if (!s.enrollments.length) return (el.myList.innerHTML = "<p class='muted'>Enroll in a course to start learning.</p>");
    const selected = selectedEnrollment();
    el.myList.innerHTML = s.enrollments.map((e) => `<article class="my-course-card">
      <h3>${esc(e.title)}</h3>
      <p class="course-meta">${esc(e.category)} | ${esc(e.level)}</p>
      <p class="course-stats"><span>${esc(e.instructor)}</span><span>${e.durationWeeks} weeks</span><span>${e.rating.toFixed(1)} rating</span><span>${e.progress}% complete</span></p>
      <div class="progress-track"><div class="progress-fill" style="width:${e.progress}%"></div></div>
      <p class="course-meta">${e.status} | Joined ${e.enrolledAt ? new Date(e.enrolledAt).toLocaleDateString() : "N/A"}</p>
      <div class="course-actions"><button class="btn continue-btn" data-enrollment-id="${esc(e.id)}">Open Classroom</button>${selected && selected.id === e.id ? '<span class="course-badge">Open</span>' : ""}</div>
    </article>`).join("");
    el.myList.querySelectorAll(".continue-btn").forEach((btn) => btn.addEventListener("click", () => {
      s.selectedEnrollmentId = String(btn.getAttribute("data-enrollment-id") || "");
      renderMyCourses();
      renderClassroom();
      openNavTarget("viewClassroom", false);
    }));
  }

  function renderClassroom() {
    if (!el.cEmpty || !el.cBody) return;
    if (!s.isStudent) {
      if (el.mode) el.mode.textContent = "Student Only";
      el.cEmpty.textContent = "Classroom interactions are available for student accounts.";
      el.cEmpty.hidden = false; el.cBody.hidden = true; return;
    }
    const en = selectedEnrollment();
    if (!en) {
      if (el.mode) el.mode.textContent = "Select Course";
      el.cEmpty.innerHTML = "Open a course from <strong>My Courses</strong> to continue lessons, submit assignment, and take quiz.";
      el.cEmpty.hidden = false; el.cBody.hidden = true; return;
    }
    if (el.mode) el.mode.textContent = "Live Classroom";
    el.cEmpty.hidden = true; el.cBody.hidden = false;
    if (el.cTitle) el.cTitle.textContent = en.title;
    if (el.cMeta) el.cMeta.textContent = `${en.instructor} | ${en.category} | ${en.level}`;
    if (el.cFill) el.cFill.style.width = `${en.progress}%`;
    if (el.cText) el.cText.textContent = `${en.progress}% complete | ${en.status}`;
    if (el.lessons) {
      el.lessons.innerHTML = en.lessons.map((ls) => {
        const ck = en.completedLessons.includes(ls.id) ? "checked" : "";
        return `<li><input type="checkbox" data-lesson-id="${esc(ls.id)}" ${ck}/><label>${esc(ls.title)} (${ls.durationMin} min)</label></li>`;
      }).join("");
    }
    if (el.aTitle) el.aTitle.textContent = en.assignmentTitle;
    if (el.aText) el.aText.value = en.assignmentText || "";
    if (el.aStatus) el.aStatus.textContent = en.assignmentSubmitted ? "Submitted" : "Not submitted";
    if (el.qQuestion) el.qQuestion.textContent = en.quiz.question;
    if (el.qOptions) {
      el.qOptions.innerHTML = en.quiz.options.map((op, idx) => `<label><input type="radio" name="quizOption" value="${idx}" ${en.quizAnswerIndex === idx ? "checked" : ""}/><span>${esc(op)}</span></label>`).join("");
    }
    if (el.qResult) el.qResult.textContent = en.quizScore > 0 ? `Latest score: ${en.quizScore}%` : "Not attempted";

    const certRequestsForCourse = s.certRequestRows.filter((row) => {
      const data = row && row.data ? row.data : {};
      return key(data.courseKey || data.courseId || row.name || "") === en.courseKey;
    });
    const latestRequest = certRequestsForCourse.length ? certRequestsForCourse[0] : null;
    if (el.certStatus) {
      if (en.certificateIssued) {
        el.certStatus.className = "course-meta certificate-issued";
        el.certStatus.textContent = `Issued: ${en.certificateCode || "CERT-" + en.id} on ${en.certificateIssuedAt ? new Date(en.certificateIssuedAt).toLocaleDateString() : "N/A"}`;
      } else if (latestRequest) {
        el.certStatus.className = "course-meta certificate-pending";
        el.certStatus.textContent = `Request status: ${String(latestRequest.status || "pending")}`;
      } else if (canRequestCertificate(en)) {
        el.certStatus.className = "course-meta certificate-ready";
        el.certStatus.textContent = "Eligible for certificate request.";
      } else {
        el.certStatus.className = "course-meta";
        el.certStatus.textContent = "Complete lessons, assignment, and quiz to unlock certificate.";
      }
    }
    if (el.certRequestBtn) {
      const canRequest = !en.certificateIssued && canRequestCertificate(en) && !latestRequest;
      el.certRequestBtn.disabled = !canRequest;
    }

    if (el.discussionList) {
      const posts = s.discussionRows.filter((row) => {
        const data = row && row.data ? row.data : {};
        return key(data.courseKey || data.courseId || row.name || "") === en.courseKey;
      });
      el.discussionList.innerHTML = posts.length
        ? posts
            .slice(0, 20)
            .map((row) => {
              const data = row && row.data ? row.data : {};
              const role = String(data.authorRole || row.createdByRole || "student");
              const time = row.createdAt ? new Date(row.createdAt).toLocaleString() : "just now";
              return `<li><strong>${esc(data.authorName || role)}</strong><div>${esc(data.message || row.description || "")}</div><div class="discussion-item-meta">${esc(role)} | ${esc(time)}</div></li>`;
            })
            .join("")
        : "<li>No discussion posts yet for this course.</li>";
    }
  }

  function renderInstructorPanel() {
    if (!el.instructorPanel) return;
    if (!s.isAdmin) {
      el.instructorPanel.style.display = "none";
      return;
    }
    el.instructorPanel.style.display = "";
    const enrollments = s.enrollments;

    if (el.instructorEnrollmentList) {
      el.instructorEnrollmentList.innerHTML = enrollments.length
        ? enrollments
            .slice(0, 30)
            .map((enrollment) => {
              const cert = enrollment.certificateIssued ? "Certificate issued" : "No certificate";
              const gradeText = enrollment.instructorGrade > 0 ? `Grade ${enrollment.instructorGrade}` : "Not graded";
              return `<li><strong>${esc(enrollment.title)}</strong><div>${esc(enrollment.instructor)} | ${esc(enrollment.level)}</div><div class="discussion-item-meta">${gradeText} | ${cert} | ${enrollment.progress}%</div></li>`;
            })
            .join("")
        : "<li>No enrollments available yet.</li>";
    }

    if (el.gradingEnrollmentSelect) {
      const current = el.gradingEnrollmentSelect.value || s.selectedGradingEnrollmentId || "";
      el.gradingEnrollmentSelect.innerHTML = ['<option value="">Choose enrollment</option>']
        .concat(
          enrollments.map((enrollment) => `<option value="${esc(enrollment.id)}">${esc(enrollment.title)} - ${esc(enrollment.instructor)} (${enrollment.progress}%)</option>`)
        )
        .join("");
      const hasCurrent = enrollments.some((enrollment) => enrollment.id === current);
      el.gradingEnrollmentSelect.value = hasCurrent ? current : "";
      s.selectedGradingEnrollmentId = el.gradingEnrollmentSelect.value || "";
      const selected = enrollments.find((enrollment) => enrollment.id === s.selectedGradingEnrollmentId);
      if (selected) {
        if (el.gradingScoreInput) el.gradingScoreInput.value = String(selected.instructorGrade || 0);
        if (el.gradingFeedbackInput) el.gradingFeedbackInput.value = selected.instructorFeedback || "";
      } else {
        if (el.gradingScoreInput) el.gradingScoreInput.value = "85";
        if (el.gradingFeedbackInput) el.gradingFeedbackInput.value = "";
      }
    }

    if (el.certificateRequestList) {
      const requestRows = s.certRequestRows;
      el.certificateRequestList.innerHTML = requestRows.length
        ? requestRows
            .slice(0, 30)
            .map((row) => {
              const data = row && row.data ? row.data : {};
              const reqStatus = String(row.status || data.status || "pending");
              const requestedBy = String(data.requestedByName || data.requestedByRole || "student");
              return `<li><strong>${esc(data.courseTitle || row.name || "Course")}</strong><div>${esc(requestedBy)}</div><div class="discussion-item-meta">Status: ${esc(reqStatus)}</div></li>`;
            })
            .join("")
        : "<li>No certificate requests yet.</li>";
    }
  }

  function renderRecordsAndFeeds() {
    if (el.records) {
      el.records.innerHTML = s.courseRows.length ? s.courseRows.slice(0, 10).map((r) => {
        const c = mapCourse(r);
        return `<article class="record-row"><div><strong>${esc(c.title)}</strong><small>${esc(c.instructor)} | ${esc(c.category)} | ${c.status}</small></div><small>${c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "N/A"}</small></article>`;
      }).join("") : "<p class='muted'>No live course records available yet.</p>";
    }
    if (el.sessions) {
      const src = s.isStudent && s.enrollments.length ? s.enrollments : s.courses;
      el.sessions.innerHTML = src.slice(0, 5).map((x, i) => `<li><strong>${["Mon", "Tue", "Wed", "Thu", "Fri"][i % 5]} ${9 + i}:00 AM</strong> - ${esc(x.title)} with ${esc(x.instructor)}</li>`).join("") || "<li>No sessions planned.</li>";
    }
    if (el.activity) {
      const msgs = [];
      s.enrollments.slice(0, 3).forEach((x) => {
        msgs.push(`${esc(x.title)} progress updated to ${x.progress}%.`);
        if (x.assignmentSubmitted) msgs.push(`${esc(x.title)} assignment submitted.`);
        if (x.quizPassed) msgs.push(`${esc(x.title)} quiz checkpoint passed.`);
      });
      if (!msgs.length) s.courses.slice(0, 4).forEach((x) => msgs.push(`${esc(x.title)} is available for enrollment.`));
      el.activity.innerHTML = msgs.slice(0, 6).map((m) => `<li>${m}</li>`).join("");
    }
  }

  async function handleEnroll(courseKey) {
    if (!s.isStudent || !courseKey) return;
    if (s.byCourse.has(courseKey)) return showMsg("You are already enrolled in this course.", "success");
    if (s.pendingEnroll.has(courseKey)) return;
    const c = s.courses.find((x) => x.courseKey === courseKey);
    if (!c) return showMsg("Course not found. Refresh and try again.", "error");
    s.pendingEnroll.add(courseKey); renderCatalog();
    const payload = {
      entityType: "enrollment",
      title: c.title, courseTitle: c.title, courseKey: c.courseKey, courseId: c.id,
      instructor: c.instructor, category: c.category, level: c.level, durationWeeks: c.durationWeeks,
      rating: c.rating, learners: c.learners, price: c.price, lessons: c.lessons,
      videoUrl: c.videoUrl || "", postNotes: c.postNotes || "",
      completedLessons: [], assignmentTitle: c.assignmentTitle, assignmentSubmitted: false, assignmentText: "",
      quiz: c.quiz, quizScore: 0, quizPassed: false, quizAnswerIndex: -1, progress: 0, status: "active",
      description: `Successfully enrolled in ${c.title}.`,
    };
    const { res, data } = await req(`${API_BASE}/projects`, { method: "POST", headers: H, body: JSON.stringify(payload) });
    if (!res.ok) showMsg(data.message || "Enrollment failed.", "error");
    else showMsg(`Successfully enrolled in "${c.title}".`, "success");
    s.pendingEnroll.delete(courseKey);
    await loadData();
    const en = s.enrollments.find((x) => x.courseKey === courseKey);
    if (en) s.selectedEnrollmentId = en.id;
    renderMyCourses(); renderClassroom(); renderCatalog();
  }

  async function saveLessonProgress() {
    const en = selectedEnrollment(); if (!en || !s.isStudent || !el.lessons) return;
    en.completedLessons = Array.from(el.lessons.querySelectorAll('input[type="checkbox"]:checked')).map((x) => String(x.getAttribute("data-lesson-id") || "")).filter(Boolean);
    en.progress = progressOf(en); en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Failed to save lesson progress.", "error");
    showMsg("Lesson progress saved.", "success"); await loadData();
  }

  async function submitAssignment() {
    const en = selectedEnrollment(); if (!en || !s.isStudent) return;
    const txt = String((el.aText && el.aText.value) || "").trim();
    if (!txt) return showMsg("Add assignment text before submitting.", "error");
    en.assignmentSubmitted = true; en.assignmentText = txt; en.progress = progressOf(en); en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Assignment submission failed.", "error");
    showMsg("Assignment submitted successfully.", "success"); await loadData();
  }

  async function submitQuiz() {
    const en = selectedEnrollment(); if (!en || !s.isStudent || !el.qOptions) return;
    const chosen = el.qOptions.querySelector('input[name="quizOption"]:checked');
    if (!chosen) return showMsg("Choose an option before submitting quiz.", "error");
    const idx = N(chosen.value, -1);
    en.quizAnswerIndex = idx; en.quizPassed = idx === C(en.quiz.correctIndex, 0, en.quiz.options.length - 1, 0); en.quizScore = en.quizPassed ? 100 : 40;
    en.progress = progressOf(en); en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Quiz submission failed.", "error");
    showMsg(en.quizPassed ? "Quiz passed. Great work." : "Quiz submitted. Review and try again.", en.quizPassed ? "success" : "error");
    await loadData();
  }

  async function requestCertificate() {
    const en = selectedEnrollment();
    if (!en || !s.isStudent) return;
    if (en.certificateIssued) return showMsg("Certificate already issued for this course.", "success");
    if (!canRequestCertificate(en)) {
      return showMsg("Complete lessons, assignment, and quiz before requesting certificate.", "error");
    }
    const existing = s.certRequestRows.find((row) => {
      const data = row && row.data ? row.data : {};
      return key(data.courseKey || data.courseId || row.name || "") === en.courseKey;
    });
    if (existing) return showMsg("Certificate request already submitted.", "success");

    const payload = {
      entityType: "certificate_request",
      title: en.title,
      courseTitle: en.title,
      courseKey: en.courseKey,
      enrollmentId: en.id,
      requestedByRole: s.isStudent ? "student" : "user",
      requestedByName: String(user.name || user.username || user.email || "Student"),
      status: "pending",
      description: `Certificate request for ${en.title}`,
    };
    const { res, data } = await req(`${API_BASE}/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return showMsg(data.message || "Certificate request failed.", "error");
    showMsg("Certificate requested successfully.", "success");
    await loadData();
  }

  async function postDiscussion() {
    const en = selectedEnrollment();
    if (!en) return showMsg("Select a course first.", "error");
    const message = String((el.discussionInput && el.discussionInput.value) || "").trim();
    if (!message) return showMsg("Write a message before posting.", "error");

    const payload = {
      entityType: "discussion_post",
      title: en.title,
      courseTitle: en.title,
      courseKey: en.courseKey,
      authorRole: s.isAdmin ? "instructor" : "student",
      authorName: String(user.name || user.username || user.email || (s.isAdmin ? "Instructor" : "Student")),
      message,
      description: message,
      status: "active",
    };
    const { res, data } = await req(`${API_BASE}/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return showMsg(data.message || "Unable to post discussion.", "error");
    if (el.discussionInput) el.discussionInput.value = "";
    showMsg("Discussion posted.", "success");
    await loadData();
  }

  async function saveGrade() {
    if (!s.isAdmin) return;
    const enrollmentId = String((el.gradingEnrollmentSelect && el.gradingEnrollmentSelect.value) || "").trim();
    if (!enrollmentId) return showMsg("Select an enrollment to grade.", "error");
    const en = s.enrollments.find((row) => row.id === enrollmentId);
    if (!en) return showMsg("Enrollment not found.", "error");
    en.instructorGrade = C(el.gradingScoreInput ? el.gradingScoreInput.value : 0, 0, 100, 0);
    en.instructorFeedback = String((el.gradingFeedbackInput && el.gradingFeedbackInput.value) || "").trim();
    en.progress = Math.max(en.progress, Math.round(en.instructorGrade));
    en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Unable to save grade.", "error");
    showMsg("Grade and feedback saved.", "success");
    await loadData();
  }

  async function issueCertificate() {
    if (!s.isAdmin) return;
    const enrollmentId = String((el.gradingEnrollmentSelect && el.gradingEnrollmentSelect.value) || "").trim();
    if (!enrollmentId) return showMsg("Select an enrollment first.", "error");
    const en = s.enrollments.find((row) => row.id === enrollmentId);
    if (!en) return showMsg("Enrollment not found.", "error");
    if (!canRequestCertificate(en) && en.instructorGrade < 80) {
      return showMsg("Learner is not eligible for certificate yet.", "error");
    }
    en.certificateIssued = true;
    en.certificateIssuedAt = new Date().toISOString();
    en.certificateCode = en.certificateCode || `CERT-${String(en.id || "").slice(-6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
    en.status = "completed";
    en.progress = 100;
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Unable to issue certificate.", "error");
    const pendingRequest = s.certRequestRows.find((row) => {
      const dataRow = row && row.data ? row.data : {};
      const requestCourseKey = key(dataRow.courseKey || dataRow.courseId || row.name || "");
      const requestStatus = String(row.status || dataRow.status || "pending").toLowerCase();
      return requestCourseKey === en.courseKey && requestStatus !== "approved";
    });
    if (pendingRequest) {
      const dataRow = pendingRequest.data || {};
      await req(`${API_BASE}/projects/${encodeURIComponent(pendingRequest.id)}`, {
        method: "PUT",
        headers: H,
        body: JSON.stringify({
          entityType: "certificate_request",
          title: dataRow.courseTitle || pendingRequest.name || en.title,
          courseTitle: dataRow.courseTitle || en.title,
          courseKey: dataRow.courseKey || en.courseKey,
          enrollmentId: dataRow.enrollmentId || en.id,
          requestedByRole: dataRow.requestedByRole || "student",
          requestedByName: dataRow.requestedByName || "Student",
          status: "approved",
          description: `Certificate approved by instructor for ${en.title}`,
        }),
      });
    }
    showMsg(`Certificate issued for "${en.title}".`, "success");
    await loadData();
  }

  async function loadData() {
    const [courseRows, enrollmentRows, discussionRows, certRequestRows] = await Promise.all([
      fetchCourses(),
      fetchEnrollments(),
      fetchDiscussionPosts(),
      fetchCertificateRequests(),
    ]);
    s.courseRows = courseRows;
    s.enrollments = enrollmentRows.map(mapEnrollment);
    s.discussionRows = discussionRows;
    s.certRequestRows = certRequestRows;
    s.byCourse = new Map(s.enrollments.map((x) => [x.courseKey, x]));
    s.courses = courseRows.length ? Array.from(new Map(courseRows.map((r) => { const c = mapCourse(r); return [c.courseKey, c]; })).values()) : sampleCatalog();
    if (el.source) el.source.textContent = courseRows.length ? "Live Data" : "Sample Data";
    if (el.category) {
      const cats = Array.from(new Set(s.courses.map((c) => c.category))).sort((a, b) => a.localeCompare(b));
      const cur = el.category.value || "all";
      el.category.innerHTML = ['<option value="all">All Categories</option>'].concat(cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)).join("");
      el.category.value = cats.includes(cur) ? cur : "all";
    }
    if (s.selectedGradingEnrollmentId && !s.enrollments.some((x) => x.id === s.selectedGradingEnrollmentId)) {
      s.selectedGradingEnrollmentId = "";
    }
    if (s.selectedEnrollmentId && !s.enrollments.some((x) => x.id === s.selectedEnrollmentId)) s.selectedEnrollmentId = "";
    renderMetrics(); renderCatalog(); renderMyCourses(); renderClassroom(); renderRecordsAndFeeds(); renderInstructorPanel();
  }

  function bind() {
    if (el.search) el.search.addEventListener("input", () => { renderCatalog(); renderMetrics(); });
    if (el.category) el.category.addEventListener("change", () => { renderCatalog(); renderMetrics(); });
    if (el.refresh) el.refresh.addEventListener("click", () => loadData());
    if (el.logout) el.logout.addEventListener("click", () => { localStorage.removeItem("token"); localStorage.removeItem("user"); location.href = "login.html"; });
    if (el.saveLesson) el.saveLesson.addEventListener("click", () => saveLessonProgress());
    if (el.aSubmit) el.aSubmit.addEventListener("click", () => submitAssignment());
    if (el.qSubmit) el.qSubmit.addEventListener("click", () => submitQuiz());
    if (el.certRequestBtn) el.certRequestBtn.addEventListener("click", () => requestCertificate());
    if (el.postDiscussionBtn) el.postDiscussionBtn.addEventListener("click", () => postDiscussion());
    if (el.saveGradeBtn) el.saveGradeBtn.addEventListener("click", () => saveGrade());
    if (el.issueCertificateBtn) el.issueCertificateBtn.addEventListener("click", () => issueCertificate());
    if (el.gradingEnrollmentSelect) {
      el.gradingEnrollmentSelect.addEventListener("change", () => {
        s.selectedGradingEnrollmentId = String(el.gradingEnrollmentSelect.value || "");
        const en = s.enrollments.find((row) => row.id === s.selectedGradingEnrollmentId);
        if (!en) return;
        if (el.gradingScoreInput) el.gradingScoreInput.value = String(en.instructorGrade || 0);
        if (el.gradingFeedbackInput) el.gradingFeedbackInput.value = en.instructorFeedback || "";
      });
    }
    if (el.form) {
      el.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!s.isAdmin) return alert("Only admin can create course records.");
        const v = Object.fromEntries(new FormData(el.form).entries());
        const title = String(v.courseTitle || "").trim();
        if (!title) return alert("Course title is required.");
        const payload = {
          entityType: "course",
          title,
          courseTitle: title,
          courseKey: key(title),
          instructor: String(v.instructor || "Course Team").trim(),
          category: String(v.category || "General").trim(),
          level: String(v.level || "Intermediate").trim(),
          durationWeeks: C(v.durationWeeks, 1, 52, 8),
          status: status(v.status),
          progress: /completed/i.test(String(v.status || "")) ? 100 : C(v.progress, 0, 100, 25),
          rating: C(v.rating, 1, 5, 4.6),
          learners: C(v.learners, 1, 100000, 120),
          price: C(v.price, 0, 2000, 49),
          videoUrl: String(v.videoUrl || "").trim(),
          postNotes: String(v.postNotes || "").trim(),
          lessons: defaultLessons(title),
          assignmentTitle: `Project Assignment: ${title}`,
          quiz: defaultQuiz(title),
          notes: String(v.postNotes || "").trim(),
          description: `${title} managed by ${String(v.instructor || "Course Team").trim()}.`,
        };
        const { res, data } = await req(`${API_BASE}/projects`, { method: "POST", headers: H, body: JSON.stringify(payload) });
        if (!res.ok) return alert(data.message || "Unable to save course.");
        el.form.reset(); showMsg(`Course "${title}" created successfully.`, "success"); await loadData();
      });
    }
    if (navButtons.length) {
      navButtons.forEach((btn) => {
        btn.addEventListener("click", () => openNavTarget(btn.getAttribute("data-nav-target") || ""));
      });
    }
  }

  if (el.role) {
    if (s.isAdmin) el.role.textContent = "Role: admin. Create courses, grade learners, issue certificates, and moderate LMS activity.";
    else if (s.isStudent) el.role.textContent = "Role: student. Enroll, complete lessons, submit assignments, participate in discussion, and request certificates.";
    else el.role.textContent = `Role: ${jwtRole || "user"}. View LMS operations.`;
  }
  if (!s.isAdmin) {
    if (el.courseCreatePanel) el.courseCreatePanel.hidden = true;
    if (el.courseCatalogView) el.courseCatalogView.classList.add("catalog-student-view");
  } else {
    if (el.courseCreatePanel) el.courseCreatePanel.hidden = false;
    if (el.courseCatalogView) el.courseCatalogView.classList.remove("catalog-student-view");
  }
  if (el.instructorPanel && !s.isAdmin) {
    el.instructorPanel.style.display = "none";
  }

  if (navButtons.length) {
    const hashTarget = normalizeNavTarget(String(location.hash || "").replace(/^#/, ""));
    if (hashTarget && document.getElementById(hashTarget)) openNavTarget(hashTarget, false);
    else openNavTarget("viewDashboard", false);
  }
  bind();
  await loadData();
})();
