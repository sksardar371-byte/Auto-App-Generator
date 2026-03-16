(async function () {
  const token = localStorage.getItem("token") || "";
  if (!token) {
    location.href = "login.html";
    return;
  }

  const list = document.getElementById("project-list");
  const logout = document.getElementById("logoutBtn");
  const authHeaders = { Authorization: `Bearer ${token}` };
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\/+$/, "");

  const metricCount = document.getElementById("metricCount");
  const metricLatest = document.getElementById("metricLatest");
  const metricWeight = document.getElementById("metricWeight");

  async function load() {
    const [workoutsRes, progressRes] = await Promise.all([
      fetch(`${API_BASE}/workouts`, { headers: authHeaders }),
      fetch(`${API_BASE}/progress`, { headers: authHeaders }),
    ]);
    const workoutsData = await workoutsRes.json().catch(() => ({}));
    const progressData = await progressRes.json().catch(() => ({}));
    if (!workoutsRes.ok || !progressRes.ok) {
      list.innerHTML = `<p>${workoutsData.message || progressData.message || "Failed to load dashboard metrics"}</p>`;
      return;
    }

    const workouts = Array.isArray(workoutsData.workouts) ? workoutsData.workouts : [];
    const progress = Array.isArray(progressData.progress) ? progressData.progress : [];
    const latestWorkout = workouts.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
    const latestProgress = progress.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;

    if (metricCount) metricCount.textContent = String(workouts.length);
    if (metricLatest) metricLatest.textContent = latestWorkout ? `${latestWorkout.exerciseName} (${latestWorkout.date})` : "-";
    if (metricWeight) metricWeight.textContent = latestProgress ? `${latestProgress.weight} kg` : "-";

    list.innerHTML = `
      <div class='item'>
        <strong>Recent Workouts</strong>
        <div>${workouts.length ? workouts.slice(-3).map((w) => `${w.date}: ${w.exerciseName} (${w.sets}x${w.reps})`).join("<br/>") : "No workouts yet."}</div>
      </div>
      <div class='item'>
        <strong>Recent Weight Logs</strong>
        <div>${progress.length ? progress.slice(-3).map((p) => `${p.date}: ${p.weight} kg`).join("<br/>") : "No progress logs yet."}</div>
      </div>
    `;
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
