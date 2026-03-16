(async function () {
  const token = localStorage.getItem("token") || "";
  if (!token) {
    location.href = "login.html";
    return;
  }
  const list = document.getElementById("project-list");
  const form = document.getElementById("dashboardFeatureForm");
  const logout = document.getElementById("logoutBtn");
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\/+$/, "");

  const metricCount = document.getElementById("metricCount");
  const metricValue = document.getElementById("metricValue");

  async function load() {
    const res = await fetch(`${API_BASE}/projects`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      list.innerHTML = `<p>${data.message || "Failed to load leads"}</p>`;
      return;
    }
    const rows = Array.isArray(data.projects) ? data.projects : [];
    const value = rows.reduce((n, x) => n + Number(x?.data?.dealValue || 0), 0);
    if (metricCount) metricCount.textContent = String(rows.length);
    if (metricValue) metricValue.textContent = value.toFixed(2);
    list.innerHTML = rows.length
      ? rows
          .map(
            (x) =>
              `<div class='item'><strong>${x.name}</strong><div>Company: ${x?.data?.company || "-"}</div><div>Stage: ${
                x?.data?.stage || x.status || "-"
              }</div><div>Value: ${x?.data?.dealValue || 0}</div><p>${x.description || ""}</p></div>`
          )
          .join("")
      : "<p>No leads yet.</p>";
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.status = payload.stage || "new";
      const res = await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.message || "Save failed");
      form.reset();
      await load();
    });
  }

  if (logout) {
    logout.addEventListener("click", () => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      location.href = "login.html";
    });
  }
  await load();
})();
