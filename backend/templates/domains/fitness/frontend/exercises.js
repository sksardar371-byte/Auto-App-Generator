(async function () {
  const token = localStorage.getItem("token") || "";
  if (!token) return (location.href = "login.html");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\/+$/, "");
  const form = document.getElementById("exerciseForm");
  const list = document.getElementById("exercise-list");

  async function load() {
    const res = await fetch(`${API_BASE}/exercises`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (list.innerHTML = `<p>${data.message || "Unable to load exercises"}</p>`);
    const rows = Array.isArray(data.exercises) ? data.exercises : [];
    list.innerHTML = rows.length
      ? rows.map((x) => `<div class='item'><strong>${x.name}</strong><div>${x.muscleGroup} | ${x.difficulty}</div><p>${x.description || ""}</p></div>`).join("")
      : "<p>No exercises yet.</p>";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const res = await fetch(`${API_BASE}/exercises`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.message || "Save failed");
    form.reset();
    await load();
  });

  await load();
})();
