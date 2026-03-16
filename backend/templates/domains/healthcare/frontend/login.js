(function(){
  const form = document.getElementById("loginForm");
  if(!form) return;
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\/+$/, "");

  async function requestJson(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_err) {
        data = { message: raw || "Invalid server response" };
      }
      return { res, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeRole(role) {
    const r = String(role || "").toLowerCase().replace(/-/g, "_");
    if (!r || r === "user" || r === "customer" || r === "student") return "patient";
    if (r === "instructor" || r === "teacher") return "doctor";
    if (r === "labtechnician") return "lab_technician";
    return r;
  }

  function redirectByRole(role) {
    const r = normalizeRole(role);
    if (r === "doctor") return (location.href = "instructor/dashboard.html");
    if (r === "receptionist" || r === "pharmacist" || r === "lab_technician" || r === "admin") {
      return (location.href = "admin/dashboard.html");
    }
    return (location.href = "student/dashboard.html");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in...";
    }
    try {
      const { res, data } = await requestJson(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if(!res.ok) return alert(data.message || "Login failed");
      const role = normalizeRole((data.user && data.user.role) || data.role || "patient");
      localStorage.setItem("token", data.token || "");
      localStorage.setItem("user", JSON.stringify({ ...(data.user || {}), role }));
      redirectByRole(role);
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const msg = isAbort
        ? `API request timed out. Check backend at ${API_BASE}`
        : `Cannot reach backend API at ${API_BASE}. Start backend server and try again.`;
      alert(msg);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Login";
      }
    }
  });
})();
