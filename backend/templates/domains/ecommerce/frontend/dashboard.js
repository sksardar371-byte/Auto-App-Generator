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
  const metricStock = document.getElementById("metricStock");
  const metricValue = document.getElementById("metricValue");

  async function load() {
    const res = await fetch(`${API_BASE}/projects`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      list.innerHTML = `<p>${data.message || "Failed to load products"}</p>`;
      return;
    }
    const rows = Array.isArray(data.projects) ? data.projects : [];
    const totalStock = rows.reduce((n, x) => n + Number(x?.data?.stock || 0), 0);
    const totalValue = rows.reduce((n, x) => n + Number(x?.data?.price || 0) * Number(x?.data?.stock || 0), 0);
    if (metricCount) metricCount.textContent = String(rows.length);
    if (metricStock) metricStock.textContent = String(totalStock);
    if (metricValue) metricValue.textContent = totalValue.toFixed(2);
    list.innerHTML = rows.length
      ? rows
          .map(
            (x) =>
              `<div class='item'><strong>${x.name}</strong><div>Status: ${x.status}</div><div>Category: ${x?.data?.category || "-"}</div><div>Price: ${
                x?.data?.price || 0
              } | Stock: ${x?.data?.stock || 0}</div></div>`
          )
          .join("")
      : "<p>No products yet.</p>";
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
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
