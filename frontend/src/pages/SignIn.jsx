import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../App.css";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // ✅ Make sure your Express backend is running on port 5000
      const res = await axios.post("http://localhost:5000/api/auth/signin", {
        email,
        password,
      });

      if (res.data.success) {
        // Store user details safely
        localStorage.setItem("userId", res.data.userId);
        localStorage.setItem("username", res.data.username || "User");

        alert("Login successful!");
        navigate("/dashboard");
      } else {
        alert(res.data.message || "Login failed");
      }
    } catch (err) {
      // ✅ Better error handling
      if (err.response) {
        // Server responded with a status code outside 2xx
        alert(err.response.data.message || "Invalid credentials");
      } else if (err.request) {
        // Request made but no response received
        alert("Server not reachable. Make sure backend is running on port 5000.");
      } else {
        // Something else went wrong
        alert("Error signing in. Please try again.");
      }
      console.error("SignIn error:", err);
    }
  };

  return (
    <div className="signin-page">
      <div className="signin-container">
        <h2 className="signin-title">Sign In</h2>
        <form className="signin-form" onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" className="cta">Sign In</button>
        </form>
      </div>
    </div>
  );
}
