(function () {
  const API_BASE = localStorage.getItem("API_BASE_URL") || (location.protocol === "file:" ? "http://localhost:5000/api" : `${location.origin}/api`);
  window.APP_API_BASE = API_BASE.replace(/\/+$/, "");

  function showPageToast(message) {
    const text = String(message || "Done");
    const existing = document.getElementById("toast");
    if (existing) {
      existing.textContent = text;
      existing.classList.add("show");
      window.setTimeout(() => existing.classList.remove("show"), 1800);
      return;
    }

    const node = document.createElement("div");
    node.id = "toast";
    node.className = "toast show";
    node.textContent = text;
    document.body.appendChild(node);
    window.setTimeout(() => {
      node.classList.remove("show");
      window.setTimeout(() => node.remove(), 220);
    }, 1800);
  }

  function parseUser() {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch (_error) {
      return {};
    }
  }

  function hasSession() {
    const token = localStorage.getItem("token");
    const user = parseUser();
    if (!(token && String(token).trim())) return false;
    return Boolean(user && (user.email || user.username || user.name));
  }

  function loginPath() {
    const parts = String(location.pathname || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    const parent = parts.length > 1 ? parts[parts.length - 2] : "";
    if (["public", "student", "instructor", "admin"].includes(parent)) return "../login.html";
    return "login.html";
  }

  function normalizeProjectKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 120);
  }

  function readCachedProjectKey() {
    const keys = ["APP_PROJECT_KEY", "LMS_PROJECT_KEY"];
    for (const keyName of keys) {
      const value = normalizeProjectKey(localStorage.getItem(keyName));
      if (value) return value;
    }
    return "";
  }

  function cacheProjectKey(value) {
    const key = normalizeProjectKey(value);
    if (!key) return "";
    localStorage.setItem("APP_PROJECT_KEY", key);
    localStorage.setItem("LMS_PROJECT_KEY", key);
    return key;
  }

  function inferProjectKey() {
    const params = new URLSearchParams(String(location.search || ""));
    const fromQuery = cacheProjectKey(params.get("projectKey"));
    if (fromQuery) return fromQuery;
    const path = String(location.pathname || "").replace(/\\/g, "/");
    const match = path.match(/\/generated_projects\/([^/]+)\//i) || path.match(/\/preview_projects\/([^/]+)\//i);
    const fromPath = cacheProjectKey(match && match[1] ? match[1] : "");
    if (fromPath) return fromPath;
    return readCachedProjectKey();
  }

  function requireLoginForEnroll() {
    if (hasSession()) return true;
    showPageToast("Please login first to book an appointment.");
    window.setTimeout(() => { location.href = loginPath(); }, 600);
    return false;
  }

  async function enrollCourse(courseTitle) {
    if (!requireLoginForEnroll()) return;
    const token = String(localStorage.getItem("token") || "");
    const user = parseUser();
    const title = String(courseTitle || "Appointment").trim() || "Appointment";
    const projectKey = inferProjectKey();

    const payload = {
      entityType: "enrollment",
      visibility: "public",
      name: `${title} Appointment`,
      title: title,
      courseTitle: title,
      status: "active",
      progress: 0,
      studentName: String(user.username || user.name || "Patient"),
      studentEmail: String(user.email || ""),
      enrolledAt: new Date().toISOString(),
    };
    if (projectKey) payload.projectKey = projectKey;

    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    };
    if (projectKey) headers["X-Project-Key"] = projectKey;

    try {
      const res = await fetch(window.APP_API_BASE + "/projects", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        showPageToast(data.message || "This appointment is already booked.");
        return;
      }
      if (!res.ok) {
        showPageToast(data.message || "Unable to book this appointment.");
        return;
      }
      showPageToast("Appointment booked successfully.");
    } catch (_error) {
      showPageToast("Unable to book right now. Try again.");
    }
  }

  function mountLaunchingSoonActions() {
    const triggers = Array.from(document.querySelectorAll("[data-launching-soon]"));
    if (!triggers.length) return;
    const isLandingPage = document.body && document.body.classList.contains("marketing-page");
    for (const node of triggers) {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        if (isLandingPage) {
          requireLoginForEnroll();
          return;
        }
        if (!requireLoginForEnroll()) return;
        showPageToast("Appointment booking will be available soon.");
      });
    }
  }

  function mountEnrollActions() {
    const buttons = Array.from(document.querySelectorAll("[data-enroll-course]"));
    if (!buttons.length) return;
    for (const button of buttons) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const titleFromAttr = button.getAttribute("data-course-title");
        const titleFromPage = document.querySelector(".panel h2") ? document.querySelector(".panel h2").textContent : "";
        const title = String(titleFromAttr || titleFromPage || "Appointment");
        const originalText = button.textContent;
        button.textContent = "Booking...";
        button.setAttribute("aria-busy", "true");
        button.classList.add("is-busy");
        await enrollCourse(title);
        button.textContent = originalText;
        button.removeAttribute("aria-busy");
        button.classList.remove("is-busy");
      });
    }
  }

  function mountCourseDetailsFromQuery() {
    if (!/course-details\.html$/i.test(String(location.pathname || ""))) return;
    const params = new URLSearchParams(location.search || "");
    const course = params.get("course");
    const category = params.get("category");
    const level = params.get("level");
    const instructor = params.get("instructor");
    const duration = params.get("duration");
    const price = params.get("price");

    if (course) {
      const titleNode = document.querySelector(".panel h2");
      if (titleNode) titleNode.textContent = course;
      const enrollBtn = document.querySelector("[data-enroll-course]");
      if (enrollBtn) enrollBtn.setAttribute("data-course-title", course);
    }
    const kv = Array.from(document.querySelectorAll(".panel .kv"));
    kv.forEach((row) => {
      const key = row.querySelector("strong");
      const value = row.querySelector("span");
      if (!key || !value) return;
      const label = key.textContent.toLowerCase();
      if (label.includes("instructor") && instructor) value.textContent = instructor;
      if (label.includes("duration") && duration) value.textContent = duration;
      if (label.includes("level") && level) value.textContent = level;
      if (label.includes("price") && price) value.textContent = price;
    });
    const subtitle = document.querySelector(".panel > p.muted");
    if (subtitle && category) {
      subtitle.textContent = category + " service with structured care steps and guided consultation flow.";
    }
  }

  function mountLandingNav() {
    const nav = document.querySelector(".landing-nav");
    const navLinks = Array.from(document.querySelectorAll('.landing-links a[href^="#"]'));
    if (!nav || !navLinks.length) return;

    const sectionPairs = navLinks
      .map((link) => ({
        link,
        section: document.querySelector(link.getAttribute("href"))
      }))
      .filter((pair) => pair.section);

    if (!sectionPairs.length) return;

    function setScrolledState() {
      nav.classList.toggle("nav-scrolled", window.scrollY > 16);
    }

    function setActiveLink() {
      const offset = nav.offsetHeight + 24;
      let activeId = sectionPairs[0].section.id;
      for (const pair of sectionPairs) {
        const top = pair.section.getBoundingClientRect().top;
        if (top - offset <= 0) activeId = pair.section.id;
      }
      for (const pair of sectionPairs) {
        const target = `#${activeId}`;
        pair.link.classList.toggle("active", pair.link.getAttribute("href") === target);
      }
    }

    for (const pair of sectionPairs) {
      pair.link.addEventListener("click", (event) => {
        event.preventDefault();
        const top = pair.section.getBoundingClientRect().top + window.scrollY - (nav.offsetHeight + 12);
        window.scrollTo({ top, behavior: "smooth" });
        history.replaceState(null, "", `#${pair.section.id}`);
      });
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        setScrolledState();
        setActiveLink();
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      setScrolledState();
      setActiveLink();
    });
    setScrolledState();
    setActiveLink();
  }

  mountCourseDetailsFromQuery();
  mountLaunchingSoonActions();
  mountEnrollActions();
  mountLandingNav();
})();

