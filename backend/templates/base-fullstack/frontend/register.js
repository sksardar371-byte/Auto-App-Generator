(async function(){
  const form = document.getElementById("registerForm");
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const { res, data } = await requestJson(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if(!res.ok) return alert(data.message || "Registration failed");
      alert("Registered successfully. Please login.");
      location.href = "login.html";
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const msg = isAbort
        ? `API request timed out. Check backend at ${API_BASE}`
        : `Cannot reach backend API at ${API_BASE}. Start backend server and try again.`;
      alert(msg);
    }
  });
})();
