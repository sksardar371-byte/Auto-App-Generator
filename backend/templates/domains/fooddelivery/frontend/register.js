(async function () {
  const form = document.getElementById("registerForm");
  if (!form) return;
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\/+$/, "");

  async function requestJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_err) {
      data = { message: text || "Invalid server response" };
    }
    return { res, data };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const { res, data } = await requestJson(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return alert(data.message || "Registration failed");
      alert("Registered successfully. Please login.");
      location.href = "login.html";
    } catch (err) {
      alert(String(err.message || "Unable to connect to server"));
    }
  });
})();
