import React from "react";
import { useNavigate } from "react-router-dom";
import "../App.css"; // Ensure correct path

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing">
      {/* Navbar */}
      <nav className="navbar">
        <div className="logo">⚡Auto App Generator</div>
        <div className="nav-buttons">
          <button className="signin" onClick={() => navigate("/signin")}>
            Sign In
          </button>
          <button className="signup" onClick={() => navigate("/signup")}>
            Sign Up
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="hero">
        <h1>Build Your App Instantly with AI</h1>
        <p>
          Auto App Generator helps you create complete web and mobile app
          projects using Artificial Intelligence. Just describe your idea — 
          and let AI generate clean, working code instantly.
        </p>

        {/* Info Section moved inside hero for proper stacking */}
        <section className="features">
          <div className="feature">
            <h3>🧠 AI Code Generation</h3>
            <p>Describe your app in simple words and get ready-to-use project code.</p>
          </div>

          <div className="feature">
            <h3>💾 Save Projects</h3>
            <p>All your generated projects are safely stored and can be revisited anytime.</p>
          </div>

          <div className="feature">
            <h3>⚙️ Multi-Language Support</h3>
            <p>Generate apps in React, Node.js, Python, MERN, or Java effortlessly.</p>
          </div>
        </section>

        {/* Get Started button placed AFTER all features */}
        <button className="cta" onClick={() => navigate("/signup")}>
          Get Started 🚀
        </button>
      </div>
    </div>
  );
}
