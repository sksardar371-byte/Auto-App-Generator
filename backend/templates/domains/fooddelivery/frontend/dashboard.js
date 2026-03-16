(function () {
  var token = localStorage.getItem("token") || "";
  if (!token) {
    location.href = "login.html";
    return;
  }
  var user = {};
  try {
    user = JSON.parse(localStorage.getItem("user") || "{}");
  } catch (_err) {
    user = {};
  }
  var role = String(user.role || "customer").toLowerCase();
  var userName = document.getElementById("userName");
  var roleBadge = document.getElementById("roleBadge");
  if (userName) userName.textContent = String(user.name || user.email || "User");
  if (roleBadge) roleBadge.textContent = role;

  var roleLink = document.getElementById("roleHomeLink");
  if (roleLink) {
    if (role === "restaurant_owner") roleLink.href = "owner-dashboard.html";
    else if (role === "delivery_partner") roleLink.href = "delivery-dashboard.html";
    else if (role === "admin") roleLink.href = "admin-dashboard.html";
    else roleLink.href = "profile.html";
  }

  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      location.href = "login.html";
    });
  }
})();
