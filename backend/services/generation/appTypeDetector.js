const APP_HINT_KEYWORDS = [
  "ecommerce",
  "e-commerce",
  "commerce",
  "shop",
  "store",
  "snake",
  "chess",
  "dashboard",
  "portfolio",
  "blog",
  "task",
  "todo",
  "chat",
  "booking",
  "hotel",
  "clinic",
  "hospital",
  "appointment",
  "crm",
  "lead",
  "expense",
  "budget",
  "job portal",
  "recruitment",
  "course app",
  "course management",
  "learning app",
  "education app",
];

const detectProjectProfile = (description, language) => {
  const text = `${description || ""} ${language || ""}`.toLowerCase();
  const explicitBackend = /backend|api|express|database|mongodb|mysql|auth|login|jwt|server/.test(text);
  const gameLikeRequest = /snake|chess|tic[\s-]?tac[\s-]?toe|platformer|arcade|\bgame\b/.test(text);

  if (gameLikeRequest && !explicitBackend) return "static-web";
  if (/next\.?js|nextjs|\bnext\b/.test(text)) return "next";
  if (/react|vite/.test(text)) return "react";
  if (/fullstack|mern|mean/.test(text)) return "fullstack";
  if (explicitBackend) return "node-api";
  if (/python|flask|django|fastapi/.test(text)) return "python";
  return "static-web";
};

const shouldUseDeterministicFallback = (description) => {
  const lowered = (description || "").toLowerCase();
  return APP_HINT_KEYWORDS.some((keyword) => lowered.includes(keyword));
};

module.exports = {
  detectProjectProfile,
  shouldUseDeterministicFallback,
};
