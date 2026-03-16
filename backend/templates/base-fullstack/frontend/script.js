(function(){
  const API_BASE = localStorage.getItem("API_BASE_URL") || (location.protocol === "file:" ? "http://localhost:5000/api" : `${location.origin}/api`);
  window.APP_API_BASE = API_BASE.replace(/\/+$/, "");
})();
