import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../App.css";

export default function SignUp() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const res = await axios.post("http://localhost:5000/api/auth/signup", {
        username,
        email,
        password,
      });

      // ✅ Check if signup succeeded
      if (res?.data?.success) {
        // Store user info in localStorage (backend returns userId directly)
        const userId = res.data.userId || res.data.user?._id;
        const storedUsername = res.data.username || res.data.user?.username || username;
        
        if (userId) {
          localStorage.setItem("userId", userId);
          localStorage.setItem("username", storedUsername);
          // ✅ Directly navigate to dashboard
          navigate("/dashboard");
        } else {
          alert("Signup successful! Please sign in.");
          navigate("/signin");
        }
      } else {
        // Show message if signup failed
        alert(res?.data?.message || "Signup failed. Please try again.");
      }
    } catch (err) {
      console.error("Signup Error:", err);

      // Show meaningful error from backend if available
      const errorMsg = err.response?.data?.message || err.message || "Unknown error";
      alert("Error signing up: " + errorMsg);
    }
  };

  return (
    <div className="signup-page">
      <div className="signup-container">
        <h2 className="signup-title">Sign Up</h2>
        <form className="signup-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
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
          <button type="submit" className="cta">Sign Up</button>
        </form>
      </div>
    </div>
  );
}
