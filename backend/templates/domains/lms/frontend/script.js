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

  function safeDecode(value) {
    const raw = String(value || "");
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch (_error) {
      return raw;
    }
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

  function inferProjectKeyFromPathLike(rawPath) {
    const path = String(rawPath || "").replace(/\\/g, "/");
    if (!path) return "";
    const scopedMatch =
      path.match(/\/generated_projects\/([^/]+)\//i) ||
      path.match(/\/preview_projects\/([^/]+)\//i);
    if (scopedMatch && scopedMatch[1]) {
      return normalizeProjectKey(safeDecode(scopedMatch[1]));
    }
    const segments = path.split("/").filter(Boolean);
    const markerIndex = segments.findIndex((segment) => /^(frontend|public)$/i.test(String(segment || "")));
    if (markerIndex > 0) {
      return normalizeProjectKey(safeDecode(segments[markerIndex - 1]));
    }
    return "";
  }

  function inferProjectKeyFromUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value, "http://localhost");
      const fromQuery = normalizeProjectKey(safeDecode(parsed.searchParams.get("projectKey")));
      if (fromQuery) return fromQuery;
      return inferProjectKeyFromPathLike(parsed.pathname);
    } catch (_error) {
      const queryMatch = value.match(/[?&]projectKey=([^&#]+)/i);
      if (queryMatch && queryMatch[1]) {
        return normalizeProjectKey(safeDecode(queryMatch[1]));
      }
      return inferProjectKeyFromPathLike(value);
    }
  }

  function inferProjectKey() {
    const params = new URLSearchParams(String(location.search || ""));
    const fromQuery = cacheProjectKey(params.get("projectKey"));
    if (fromQuery) return fromQuery;
    const fromPath = cacheProjectKey(inferProjectKeyFromPathLike(location.pathname));
    if (fromPath) return fromPath;
    const fromReferrer = cacheProjectKey(inferProjectKeyFromUrl(document.referrer || ""));
    if (fromReferrer) return fromReferrer;
    return readCachedProjectKey();
  }

  function appendProjectKeyToHref(href, projectKey) {
    const raw = String(href || "").trim();
    const key = normalizeProjectKey(projectKey);
    if (!raw || !key) return raw;
    if (/[?&]projectKey=/i.test(raw)) return raw;
    const hashIndex = raw.indexOf("#");
    const base = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}projectKey=${encodeURIComponent(key)}${hash}`;
  }

  function propagateProjectKeyToLinks() {
    const projectKey = inferProjectKey();
    if (!projectKey) return;
    const links = Array.from(document.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = String(link.getAttribute("href") || "").trim();
      if (!href) continue;
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
      if (/^https?:\/\//i.test(href)) {
        try {
          const target = new URL(href);
          if (target.origin !== location.origin) continue;
        } catch (_error) {
          continue;
        }
      }
      link.setAttribute("href", appendProjectKeyToHref(href, projectKey));
    }
  }

  function requireLoginForEnroll() {
    if (hasSession()) return true;
    showPageToast("Please login first to enroll.");
    window.setTimeout(() => { location.href = loginPath(); }, 600);
    return false;
  }

  async function enrollCourse(courseTitle) {
    if (!requireLoginForEnroll()) return;
    const token = String(localStorage.getItem("token") || "");
    const user = parseUser();
    const title = String(courseTitle || "Course").trim() || "Course";
    const projectKey = inferProjectKey();

    const payload = {
      entityType: "enrollment",
      visibility: "public",
      name: `${title} Enrollment`,
      title: title,
      courseTitle: title,
      status: "active",
      progress: 0,
      studentName: String(user.username || user.name || "Student"),
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
        showPageToast(data.message || "You are already enrolled in this course.");
        return;
      }
      if (!res.ok) {
        showPageToast(data.message || "Unable to enroll in this course.");
        return;
      }
      showPageToast("Successfully enrolled in course.");
    } catch (_error) {
      showPageToast("Unable to enroll right now. Try again.");
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
        showPageToast("Enrollment will be available soon. Launching soon.");
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
        const title = String(titleFromAttr || titleFromPage || "Course");
        const originalText = button.textContent;
        button.textContent = "Enrolling...";
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
      subtitle.textContent = category + " course with practical curriculum and guided assignments.";
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

  propagateProjectKeyToLinks();
  mountCourseDetailsFromQuery();
  mountLaunchingSoonActions();
  mountEnrollActions();
  mountLandingNav();
})();
