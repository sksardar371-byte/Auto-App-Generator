(async function () {
  const token = localStorage.getItem("token") || "";
  if (!token) return (location.href = "login.html");
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const API_BASE = String(window.APP_API_BASE || ((location.origin || "") + "/api") || "/api").replace(/\/+$/, "");
  const ENTITY = {
    appointment: "appointment",
    booking: "booking",
    careNote: "care_note",
    labReportRequest: "lab_report_request",
  };

  const normalizeProjectKey = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 120);

  function inferProjectKey() {
    try {
      const params = new URLSearchParams(String(location.search || ""));
      const fromQuery = normalizeProjectKey(params.get("projectKey"));
      if (fromQuery) {
        localStorage.setItem("HMS_PROJECT_KEY", fromQuery);
        return fromQuery;
      }
      const path = String(location.pathname || "").replace(/\\/g, "/");
      const match = path.match(/\/generated_projects\/([^/]+)\//i) || path.match(/\/preview_projects\/([^/]+)\//i);
      const fromPath = normalizeProjectKey((match && match[1]) || "");
      if (fromPath) {
        localStorage.setItem("HMS_PROJECT_KEY", fromPath);
        return fromPath;
      }
      const cached = normalizeProjectKey(localStorage.getItem("HMS_PROJECT_KEY"));
      if (cached) return cached;
      const fallback = "hms-template-workspace";
      localStorage.setItem("HMS_PROJECT_KEY", fallback);
      return fallback;
    } catch (_err) {
      const fallback = "hms-template-workspace";
      localStorage.setItem("HMS_PROJECT_KEY", fallback);
      return fallback;
    }
  }

  const projectKey = inferProjectKey();
  const H = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(projectKey ? { "X-Project-Key": projectKey } : {}),
  };

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
  const key = (v) => (String(v || "").toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `record-${Date.now()}`);
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
  s.isStudent = /^(user|student|customer|patient)$/.test(jwtRole) || !jwtRole;

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
      { id: "l1", title: `Check-in for ${title}`, durationMin: 10 },
      { id: "l2", title: `${title} Initial Assessment`, durationMin: 15 },
      { id: "l3", title: `${title} Consultation & Plan`, durationMin: 20 },
      { id: "l4", title: `${title} Follow-up Instructions`, durationMin: 12 },
    ];
  }

  function defaultQuiz(title) {
    return {
      question: `Which step is most important before ${title}?`,
      options: [
        "Share current symptoms and medication history",
        "Skip health history details",
        "Ignore previous reports",
        "Avoid follow-up instructions",
      ],
      correctIndex: 0,
    };
  }

  function normLessons(raw, title) {
    if (!Array.isArray(raw) || !raw.length) return defaultLessons(title);
    return raw.map((x, i) => typeof x === "string"
      ? { id: `l${i + 1}`, title: x, durationMin: 20 }
      : { id: String(x.id || `l${i + 1}`), title: String(x.title || x.name || `Visit Step ${i + 1}`), durationMin: C(x.durationMin || x.duration, 5, 180, 20) });
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
    const title = String(d.courseTitle || d.title || row.name || "General Consultation");
    return {
      id: String(row.id || d.courseId || key(title)),
      courseKey: key(d.courseKey || d.courseId || row.id || title),
      title,
      instructor: String(d.instructor || "Care Team"),
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
      assignmentTitle: String(d.assignmentTitle || `Prescription Notes: ${title}`),
      quiz: normQuiz(d.quiz, title),
      updatedAt: String(row.updatedAt || row.createdAt || ""),
    };
  }

  function mapEnrollment(row) {
    const d = row && row.data ? row.data : {};
    const title = String(d.courseTitle || d.title || row.name || "General Consultation");
    const lessons = normLessons(d.lessons || d.syllabus, title);
    const en = {
      id: String(row.id || ""),
      courseKey: key(d.courseKey || d.courseId || title),
      title,
      instructor: String(d.instructor || "Care Team"),
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
      assignmentTitle: String(d.assignmentTitle || `Prescription Notes: ${title}`),
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
    const opts = options && typeof options === "object" ? { ...options } : {};
    opts.headers = { ...(opts.headers || {}), ...(projectKey ? { "X-Project-Key": projectKey } : {}) };
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function fetchCourses() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=${ENTITY.appointment}&limit=120`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function fetchEnrollments() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=${ENTITY.booking}&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function fetchDiscussionPosts() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=${ENTITY.careNote}&limit=300`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function fetchCertificateRequests() {
    const { res, data } = await req(`${API_BASE}/projects?entityType=${ENTITY.labReportRequest}&limit=300`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok && Array.isArray(data.projects) ? data.projects : [];
  }

  async function saveEnrollment(en) {
    return req(`${API_BASE}/projects/${encodeURIComponent(en.id)}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({
        entityType: ENTITY.booking,
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
      { title: "Cardiology Consultation", instructor: "Dr. Aisha Thomas", category: "Cardiology", level: "Priority", durationWeeks: 1, rating: 4.8, learners: 120, price: 49, videoUrl: "https://example.com/videos/cardiology-intro", postNotes: "Review vitals, ECG summary, and prior medication details." },
      { title: "Neurology Follow-up", instructor: "Dr. Ravi Menon", category: "Neurology", level: "Standard", durationWeeks: 1, rating: 4.7, learners: 86, price: 44, videoUrl: "https://example.com/videos/neurology-intro", postNotes: "Track symptom timeline and MRI references." },
      { title: "Orthopedic Check-up", instructor: "Dr. Nora Blake", category: "Orthopedics", level: "Routine", durationWeeks: 1, rating: 4.6, learners: 140, price: 39, videoUrl: "https://example.com/videos/ortho-intro", postNotes: "Pain score tracking and mobility checklist." },
      { title: "Dermatology Consultation", instructor: "Dr. Meera Das", category: "Dermatology", level: "Standard", durationWeeks: 1, rating: 4.5, learners: 110, price: 35, videoUrl: "https://example.com/videos/derma-intro", postNotes: "Allergy background and skin care protocol notes." },
      { title: "Pediatric Review Visit", instructor: "Dr. Nikhil Roy", category: "Pediatrics", level: "Routine", durationWeeks: 1, rating: 4.7, learners: 95, price: 32, videoUrl: "https://example.com/videos/pediatric-intro", postNotes: "Growth chart review and follow-up vaccine plan." },
    ];
    return base.sort(() => Math.random() - 0.5).slice(0, 5).map((c, i) => ({
      id: `sample-${i + 1}`,
      courseKey: key(c.title),
      status: "active",
      progress: C(30 + Math.floor(Math.random() * 40), 0, 100, 40),
      lessons: defaultLessons(c.title),
      assignmentTitle: `Prescription Notes: ${c.title}`,
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
      const videoLine = safeVideoUrl ? `<p class="course-meta"><a class="course-link" href="${safeVideoUrl}" target="_blank" rel="noopener noreferrer">View Consultation Intro</a></p>` : "";
      const action = s.isStudent
        ? enrolled ? `<span class="course-badge">Booked</span>` : `<button class="btn enroll-btn" data-course-key="${esc(c.courseKey)}" ${pending ? "disabled" : ""}>${pending ? "Booking..." : "Book Appointment"}</button>`
        : `<span class="course-meta">Patient role can book appointments</span>`;
      return `<article class="course-card">
        <h3>${esc(c.title)}</h3>
        <p class="course-meta">${esc(c.category)} | ${esc(c.level)}</p>
        <p class="course-stats"><span>${esc(c.instructor)}</span><span>${c.durationWeeks * 30} min</span><span>${c.lessons.length} visit steps</span><span>${c.learners} patients</span><span>${c.rating.toFixed(1)} score</span><span>$${c.price}</span></p>
        <div class="progress-track"><div class="progress-fill" style="width:${c.progress}%"></div></div>
        <p class="course-meta">${esc(c.assignmentTitle)}</p>
        ${videoLine}
        ${notesLine}
        <div class="course-actions">${action}</div>
      </article>`;
    }).join("") : "<p class='muted'>No doctors match your search.</p>";
    if (s.isStudent) {
      el.catalog.querySelectorAll(".enroll-btn").forEach((btn) => btn.addEventListener("click", () => handleEnroll(String(btn.getAttribute("data-course-key") || ""))));
    }
  }

  function renderMyCourses() {
    if (!el.myList) return;
    if (!s.isStudent) {
      if (el.myCount) el.myCount.textContent = "Patient View";
      el.myList.innerHTML = "<p class='muted'>Booked appointments are visible for patient accounts.</p>";
      return;
    }
    if (el.myCount) el.myCount.textContent = `${s.enrollments.length} Booked`;
    if (!s.enrollments.length) return (el.myList.innerHTML = "<p class='muted'>Book an appointment to begin consultation.</p>");
    const selected = selectedEnrollment();
    el.myList.innerHTML = s.enrollments.map((e) => `<article class="my-course-card">
      <h3>${esc(e.title)}</h3>
      <p class="course-meta">${esc(e.category)} | ${esc(e.level)}</p>
      <p class="course-stats"><span>${esc(e.instructor)}</span><span>${e.durationWeeks * 30} min</span><span>${e.rating.toFixed(1)} score</span><span>${e.progress}% complete</span></p>
      <div class="progress-track"><div class="progress-fill" style="width:${e.progress}%"></div></div>
      <p class="course-meta">${e.status} | Booked ${e.enrolledAt ? new Date(e.enrolledAt).toLocaleDateString() : "N/A"}</p>
      <div class="course-actions"><button class="btn continue-btn" data-enrollment-id="${esc(e.id)}">Open Consultation</button>${selected && selected.id === e.id ? '<span class="course-badge">Open</span>' : ""}</div>
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
      if (el.mode) el.mode.textContent = "Patient Only";
      el.cEmpty.textContent = "Consultation room is available for patient accounts.";
      el.cEmpty.hidden = false; el.cBody.hidden = true; return;
    }
    const en = selectedEnrollment();
    if (!en) {
      if (el.mode) el.mode.textContent = "Select Appointment";
      el.cEmpty.innerHTML = "Open an appointment from <strong>My Appointments</strong> to continue consultation, notes, and triage.";
      el.cEmpty.hidden = false; el.cBody.hidden = true; return;
    }
    if (el.mode) el.mode.textContent = "Live Consultation";
    el.cEmpty.hidden = true; el.cBody.hidden = false;
    if (el.cTitle) el.cTitle.textContent = en.title;
    if (el.cMeta) el.cMeta.textContent = `${en.instructor} | ${en.category} | ${en.level}`;
    if (el.cFill) el.cFill.style.width = `${en.progress}%`;
    if (el.cText) el.cText.textContent = `${en.progress}% care workflow complete | ${en.status}`;
    if (el.lessons) {
      el.lessons.innerHTML = en.lessons.map((ls) => {
        const ck = en.completedLessons.includes(ls.id) ? "checked" : "";
        return `<li><input type="checkbox" data-lesson-id="${esc(ls.id)}" ${ck}/><label>${esc(ls.title)} (${ls.durationMin} min)</label></li>`;
      }).join("");
    }
    if (el.aTitle) el.aTitle.textContent = en.assignmentTitle;
    if (el.aText) el.aText.value = en.assignmentText || "";
    if (el.aStatus) el.aStatus.textContent = en.assignmentSubmitted ? "Saved" : "Not saved";
    if (el.qQuestion) el.qQuestion.textContent = en.quiz.question;
    if (el.qOptions) {
      el.qOptions.innerHTML = en.quiz.options.map((op, idx) => `<label><input type="radio" name="quizOption" value="${idx}" ${en.quizAnswerIndex === idx ? "checked" : ""}/><span>${esc(op)}</span></label>`).join("");
    }
    if (el.qResult) el.qResult.textContent = en.quizScore > 0 ? `Latest triage score: ${en.quizScore}%` : "Not attempted";

    const certRequestsForCourse = s.certRequestRows.filter((row) => {
      const data = row && row.data ? row.data : {};
      return key(data.courseKey || data.courseId || row.name || "") === en.courseKey;
    });
    const latestRequest = certRequestsForCourse.length ? certRequestsForCourse[0] : null;
    if (el.certStatus) {
      if (en.certificateIssued) {
        el.certStatus.className = "course-meta certificate-issued";
        el.certStatus.textContent = `Published: ${en.certificateCode || "LAB-" + en.id} on ${en.certificateIssuedAt ? new Date(en.certificateIssuedAt).toLocaleDateString() : "N/A"}`;
      } else if (latestRequest) {
        el.certStatus.className = "course-meta certificate-pending";
        el.certStatus.textContent = `Request status: ${String(latestRequest.status || "pending")}`;
      } else if (canRequestCertificate(en)) {
        el.certStatus.className = "course-meta certificate-ready";
        el.certStatus.textContent = "Eligible for lab report request.";
      } else {
        el.certStatus.className = "course-meta";
        el.certStatus.textContent = "Complete visit steps, prescription notes, and triage to request report.";
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
              const role = String(data.authorRole || row.createdByRole || "patient");
              const time = row.createdAt ? new Date(row.createdAt).toLocaleString() : "just now";
              return `<li><strong>${esc(data.authorName || role)}</strong><div>${esc(data.message || row.description || "")}</div><div class="discussion-item-meta">${esc(role)} | ${esc(time)}</div></li>`;
            })
            .join("")
        : "<li>No care notes posted yet for this appointment.</li>";
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
              const cert = enrollment.certificateIssued ? "Lab report published" : "Lab report pending";
              const gradeText = enrollment.instructorGrade > 0 ? `Clinical score ${enrollment.instructorGrade}` : "Not reviewed";
              return `<li><strong>${esc(enrollment.title)}</strong><div>${esc(enrollment.instructor)} | ${esc(enrollment.level)}</div><div class="discussion-item-meta">${gradeText} | ${cert} | ${enrollment.progress}%</div></li>`;
            })
            .join("")
        : "<li>No appointment bookings available yet.</li>";
    }

    if (el.gradingEnrollmentSelect) {
      const current = el.gradingEnrollmentSelect.value || s.selectedGradingEnrollmentId || "";
      el.gradingEnrollmentSelect.innerHTML = ['<option value="">Choose appointment</option>']
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
              const requestedBy = String(data.requestedByName || data.requestedByRole || "patient");
              return `<li><strong>${esc(data.courseTitle || row.name || "Appointment")}</strong><div>${esc(requestedBy)}</div><div class="discussion-item-meta">Status: ${esc(reqStatus)}</div></li>`;
            })
            .join("")
        : "<li>No lab report requests yet.</li>";
    }
  }

  function renderRecordsAndFeeds() {
    if (el.records) {
      el.records.innerHTML = s.courseRows.length ? s.courseRows.slice(0, 10).map((r) => {
        const c = mapCourse(r);
        return `<article class="record-row"><div><strong>${esc(c.title)}</strong><small>${esc(c.instructor)} | ${esc(c.category)} | ${c.status}</small></div><small>${c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "N/A"}</small></article>`;
      }).join("") : "<p class='muted'>No live clinical records available yet.</p>";
    }
    if (el.sessions) {
      const src = s.isStudent && s.enrollments.length ? s.enrollments : s.courses;
      el.sessions.innerHTML = src.slice(0, 5).map((x, i) => `<li><strong>${["Mon", "Tue", "Wed", "Thu", "Fri"][i % 5]} ${9 + i}:00 AM</strong> - ${esc(x.title)} with ${esc(x.instructor)}</li>`).join("") || "<li>No appointments scheduled.</li>";
    }
    if (el.activity) {
      const msgs = [];
      s.enrollments.slice(0, 3).forEach((x) => {
        msgs.push(`${esc(x.title)} progress updated to ${x.progress}%.`);
        if (x.assignmentSubmitted) msgs.push(`${esc(x.title)} prescription notes saved.`);
        if (x.quizPassed) msgs.push(`${esc(x.title)} triage assessment submitted.`);
      });
      if (!msgs.length) s.courses.slice(0, 4).forEach((x) => msgs.push(`${esc(x.title)} is available for booking.`));
      el.activity.innerHTML = msgs.slice(0, 6).map((m) => `<li>${m}</li>`).join("");
    }
  }

  async function handleEnroll(courseKey) {
    if (!s.isStudent || !courseKey) return;
    if (s.byCourse.has(courseKey)) return showMsg("This appointment is already booked.", "success");
    if (s.pendingEnroll.has(courseKey)) return;
    const c = s.courses.find((x) => x.courseKey === courseKey);
    if (!c) return showMsg("Appointment slot not found. Refresh and try again.", "error");
    s.pendingEnroll.add(courseKey); renderCatalog();
    const payload = {
      entityType: ENTITY.booking,
      title: c.title, courseTitle: c.title, courseKey: c.courseKey, courseId: c.id,
      instructor: c.instructor, category: c.category, level: c.level, durationWeeks: c.durationWeeks,
      rating: c.rating, learners: c.learners, price: c.price, lessons: c.lessons,
      videoUrl: c.videoUrl || "", postNotes: c.postNotes || "",
      completedLessons: [], assignmentTitle: c.assignmentTitle, assignmentSubmitted: false, assignmentText: "",
      quiz: c.quiz, quizScore: 0, quizPassed: false, quizAnswerIndex: -1, progress: 0, status: "active",
      description: `Appointment booked for ${c.title}.`,
    };
    const { res, data } = await req(`${API_BASE}/projects`, { method: "POST", headers: H, body: JSON.stringify(payload) });
    if (!res.ok) showMsg(data.message || "Appointment booking failed.", "error");
    else showMsg(`Appointment booked successfully for "${c.title}".`, "success");
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
    if (!res.ok) return showMsg(data.message || "Failed to save visit progress.", "error");
    showMsg("Visit progress saved.", "success"); await loadData();
  }

  async function submitAssignment() {
    const en = selectedEnrollment(); if (!en || !s.isStudent) return;
    const txt = String((el.aText && el.aText.value) || "").trim();
    if (!txt) return showMsg("Add prescription notes before saving.", "error");
    en.assignmentSubmitted = true; en.assignmentText = txt; en.progress = progressOf(en); en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Unable to save prescription notes.", "error");
    showMsg("Prescription notes saved successfully.", "success"); await loadData();
  }

  async function submitQuiz() {
    const en = selectedEnrollment(); if (!en || !s.isStudent || !el.qOptions) return;
    const chosen = el.qOptions.querySelector('input[name="quizOption"]:checked');
    if (!chosen) return showMsg("Choose an option before submitting assessment.", "error");
    const idx = N(chosen.value, -1);
    en.quizAnswerIndex = idx; en.quizPassed = idx === C(en.quiz.correctIndex, 0, en.quiz.options.length - 1, 0); en.quizScore = en.quizPassed ? 100 : 40;
    en.progress = progressOf(en); en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Assessment submission failed.", "error");
    showMsg(en.quizPassed ? "Assessment submitted successfully." : "Assessment saved. Doctor will review.", en.quizPassed ? "success" : "error");
    await loadData();
  }

  async function requestCertificate() {
    const en = selectedEnrollment();
    if (!en || !s.isStudent) return;
    if (en.certificateIssued) return showMsg("Lab report already published for this appointment.", "success");
    if (!canRequestCertificate(en)) {
      return showMsg("Complete visit steps, prescription notes, and triage before requesting report.", "error");
    }
    const existing = s.certRequestRows.find((row) => {
      const data = row && row.data ? row.data : {};
      return key(data.courseKey || data.courseId || row.name || "") === en.courseKey;
    });
    if (existing) return showMsg("Lab report request already submitted.", "success");

    const payload = {
      entityType: ENTITY.labReportRequest,
      title: en.title,
      courseTitle: en.title,
      courseKey: en.courseKey,
      enrollmentId: en.id,
      requestedByRole: s.isStudent ? "patient" : "user",
      requestedByName: String(user.name || user.username || user.email || "Patient"),
      status: "pending",
      description: `Lab report request for ${en.title}`,
    };
    const { res, data } = await req(`${API_BASE}/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return showMsg(data.message || "Lab report request failed.", "error");
    showMsg("Lab report requested successfully.", "success");
    await loadData();
  }

  async function postDiscussion() {
    const en = selectedEnrollment();
    if (!en) return showMsg("Select an appointment first.", "error");
    const message = String((el.discussionInput && el.discussionInput.value) || "").trim();
    if (!message) return showMsg("Write a message before posting.", "error");

    const payload = {
      entityType: ENTITY.careNote,
      title: en.title,
      courseTitle: en.title,
      courseKey: en.courseKey,
      authorRole: s.isAdmin ? "doctor" : "patient",
      authorName: String(user.name || user.username || user.email || (s.isAdmin ? "Doctor" : "Patient")),
      message,
      description: message,
      status: "active",
    };
    const { res, data } = await req(`${API_BASE}/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return showMsg(data.message || "Unable to post care note.", "error");
    if (el.discussionInput) el.discussionInput.value = "";
    showMsg("Care note posted.", "success");
    await loadData();
  }

  async function saveGrade() {
    if (!s.isAdmin) return;
    const enrollmentId = String((el.gradingEnrollmentSelect && el.gradingEnrollmentSelect.value) || "").trim();
    if (!enrollmentId) return showMsg("Select an appointment to review.", "error");
    const en = s.enrollments.find((row) => row.id === enrollmentId);
    if (!en) return showMsg("Appointment not found.", "error");
    en.instructorGrade = C(el.gradingScoreInput ? el.gradingScoreInput.value : 0, 0, 100, 0);
    en.instructorFeedback = String((el.gradingFeedbackInput && el.gradingFeedbackInput.value) || "").trim();
    en.progress = Math.max(en.progress, Math.round(en.instructorGrade));
    en.status = en.progress >= 100 ? "completed" : "active";
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Unable to save clinical review.", "error");
    showMsg("Clinical review and feedback saved.", "success");
    await loadData();
  }

  async function issueCertificate() {
    if (!s.isAdmin) return;
    const enrollmentId = String((el.gradingEnrollmentSelect && el.gradingEnrollmentSelect.value) || "").trim();
    if (!enrollmentId) return showMsg("Select an appointment first.", "error");
    const en = s.enrollments.find((row) => row.id === enrollmentId);
    if (!en) return showMsg("Appointment not found.", "error");
    if (!canRequestCertificate(en) && en.instructorGrade < 80) {
      return showMsg("Patient is not eligible for lab report yet.", "error");
    }
    en.certificateIssued = true;
    en.certificateIssuedAt = new Date().toISOString();
    en.certificateCode = en.certificateCode || `LAB-${String(en.id || "").slice(-6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
    en.status = "completed";
    en.progress = 100;
    const { res, data } = await saveEnrollment(en);
    if (!res.ok) return showMsg(data.message || "Unable to publish lab report.", "error");
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
          entityType: ENTITY.labReportRequest,
          title: dataRow.courseTitle || pendingRequest.name || en.title,
          courseTitle: dataRow.courseTitle || en.title,
          courseKey: dataRow.courseKey || en.courseKey,
          enrollmentId: dataRow.enrollmentId || en.id,
          requestedByRole: dataRow.requestedByRole || "patient",
          requestedByName: dataRow.requestedByName || "Patient",
          status: "approved",
          description: `Lab report approved by doctor for ${en.title}`,
        }),
      });
    }
    showMsg(`Lab report published for "${en.title}".`, "success");
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
        if (!s.isAdmin) return alert("Only admin can create appointment slots.");
        const v = Object.fromEntries(new FormData(el.form).entries());
        const title = String(v.courseTitle || "").trim();
        if (!title) return alert("Appointment title is required.");
        const payload = {
          entityType: ENTITY.appointment,
          title,
          courseTitle: title,
          courseKey: key(title),
          instructor: String(v.instructor || "Care Team").trim(),
          category: String(v.category || "General Medicine").trim(),
          level: String(v.level || "Standard").trim(),
          durationWeeks: C(v.durationWeeks, 1, 52, 8),
          status: status(v.status),
          progress: /completed/i.test(String(v.status || "")) ? 100 : C(v.progress, 0, 100, 25),
          rating: C(v.rating, 1, 5, 4.6),
          learners: C(v.learners, 1, 100000, 120),
          price: C(v.price, 0, 2000, 49),
          videoUrl: String(v.videoUrl || "").trim(),
          postNotes: String(v.postNotes || "").trim(),
          lessons: defaultLessons(title),
          assignmentTitle: `Prescription Notes: ${title}`,
          quiz: defaultQuiz(title),
          notes: String(v.postNotes || "").trim(),
          description: `${title} managed by ${String(v.instructor || "Care Team").trim()}.`,
        };
        const { res, data } = await req(`${API_BASE}/projects`, { method: "POST", headers: H, body: JSON.stringify(payload) });
        if (!res.ok) return alert(data.message || "Unable to save appointment slot.");
        el.form.reset(); showMsg(`Appointment slot "${title}" created successfully.`, "success"); await loadData();
      });
    }
    if (navButtons.length) {
      navButtons.forEach((btn) => {
        btn.addEventListener("click", () => openNavTarget(btn.getAttribute("data-nav-target") || ""));
      });
    }
  }

  if (el.role) {
    if (s.isAdmin) el.role.textContent = "Role: admin. Manage appointment slots, doctor reviews, and lab report publishing.";
    else if (s.isStudent) el.role.textContent = "Role: patient. Book appointments, submit consultation notes, and request lab reports.";
    else el.role.textContent = `Role: ${jwtRole || "user"}. View hospital operations.`;
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
