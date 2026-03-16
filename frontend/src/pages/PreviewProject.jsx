// src/pages/PreviewProject.jsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

// ✅ Axios instance
const api = axios.create({
  baseURL: "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});

export default function PreviewProject() {
  const { projectId } = useParams(); // Get project ID from URL
  const [previewHTML, setPreviewHTML] = useState(""); // Store HTML for iframe
  const [backendURL, setBackendURL] = useState(""); // Store backend URL if available
  const [error, setError] = useState(""); // Store any error message
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        // First, try to start the backend
        const startRes = await api.post(`/projects/start-preview/${projectId}`);
        if (startRes.data.success) {
          if (startRes.data.url) {
            // Backend is running, use it for full app preview
            setBackendURL(startRes.data.url);
            setPreviewHTML(""); // Clear HTML since we're using backend
          } else if (startRes.data.html) {
            // No backend, use inlined HTML
            setPreviewHTML(startRes.data.html);
            setBackendURL("");
          }
        } else {
          // Fallback to old method
          const res = await api.get(`/projects/${projectId}`);
          if (res.data.success && res.data.project) {
            const project = res.data.project;
            const aiResult = project.ai_result || "";
            const language = project.language;

            let htmlPreview = "";

            // ✅ Prepare preview HTML
            if (language === "React") {
              htmlPreview = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8" />
                  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                  <title>Live React Preview</title>
                  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
                  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
                  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
                </head>
                <body>
                  <div id="root"></div>
                  <script type="text/babel">
                    try {
                      ${aiResult}
                      if (typeof App === "function") {
                        const root = ReactDOM.createRoot(document.getElementById("root"));
                        root.render(<App />);
                      } else {
                        document.getElementById("root").innerHTML = "<pre>App component not found</pre>";
                      }
                    } catch (e) {
                      document.body.innerHTML = "<pre style='color:red'>Preview Error: " + e.message + "</pre>";
                    }
                  </script>
                </body>
                </html>
              `;
            } else {
              // For non-React code, use the full inlined HTML
              htmlPreview = aiResult;
            }

            setPreviewHTML(htmlPreview);
          } else {
            setError("Project not found.");
          }
        }
      } catch (err) {
        console.error("Error fetching project:", err);
        setError("Error fetching project data.");
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [projectId]);

  if (loading) return <div style={{ padding: "20px" }}>⏳ Loading preview...</div>;
  if (error) return <div style={{ color: "red", padding: "20px" }}>⚠️ {error}</div>;

  return (
    backendURL ? (
      <iframe
        title="project-preview"
        src={backendURL}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: "100vw", height: "100vh", border: "none" }}
      />
    ) : (
      <iframe
        title="project-preview"
        srcDoc={previewHTML}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: "100vw", height: "100vh", border: "none" }}
      />
    )
  );
}
