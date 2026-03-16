(async function(){
  const token = localStorage.getItem("token") || "";
  if(!token){ location.href = "login.html"; return; }
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  function decodeJwtPayload(tokenValue) {
    try {
      const parts = String(tokenValue || "").split(".");
      if (parts.length < 2) return {};
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(b64)
          .split("")
          .map((ch) => "%" + ("00" + ch.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(json);
    } catch (_err) {
      return {};
    }
  }
  const payload = decodeJwtPayload(token);
  const role = String(user?.role || payload?.role || "user").toLowerCase();
  const isAdmin = role === "admin";
  const list = document.getElementById("project-list");
  const form = document.getElementById("dashboardFeatureForm");
  const logout = document.getElementById("logoutBtn");
  const roleAccessNote = document.getElementById("roleAccessNote");
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\/+$/, "");
  if (roleAccessNote) {
    roleAccessNote.textContent = isAdmin
      ? "Role: admin. You can create, update, and manage records."
      : "Role: user. You have view-only access in this dashboard.";
  }
  if (form && !isAdmin) {
    form.style.display = "none";
  }
  async function load(){
    const res = await fetch(`${API_BASE}/projects`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){ list.innerHTML = `<p>${data.message || "Failed to load records"}</p>`; return; }
    const rows = Array.isArray(data.projects) ? data.projects : [];
    list.innerHTML = rows.length ? rows.map((x)=>`<div class='item'><strong>${x.name}</strong><div>${x.status||""}</div><p>${x.description||""}</p></div>`).join("") : "<p>No records yet.</p>";
  }
  if(form){
    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if (!isAdmin) return alert("Only admin can create records.");
      const payload = Object.fromEntries(new FormData(form).entries());
      const res = await fetch(`${API_BASE}/projects`, { method:"POST", headers: authHeaders, body: JSON.stringify(payload)});
      const data = await res.json().catch(()=>({}));
      if(!res.ok) return alert(data.message || "Save failed");
      form.reset();
      await load();
    });
  }
  if(logout){ logout.addEventListener("click", ()=>{ localStorage.removeItem("token"); localStorage.removeItem("user"); location.href="login.html"; }); }
  await load();
})();
