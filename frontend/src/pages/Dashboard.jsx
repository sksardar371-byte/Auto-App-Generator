import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../App.css";
import axios from "axios";

// ✅ Fixed Axios setup (removed misplaced "this")
const api = axios.create({
  baseURL: "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});

export default function Dashboard() {
  const [appDesc, setAppDesc] = useState("");
  const [backendLanguage, setBackendLanguage] = useState("Node.js");
  const [projects, setProjects] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [username, setUsername] = useState("User");
  const [theme, setTheme] = useState("dark");
  const [generatedCode, setGeneratedCode] = useState("");
  const [downloadURL, setDownloadURL] = useState("");
  const [executableURL, setExecutableURL] = useState("");
  const [executableBuildError, setExecutableBuildError] = useState("");
  const [exeLoading, setExeLoading] = useState(false);
  const [iframeContent, setIframeContent] = useState("");
  const [generatedProjectName, setGeneratedProjectName] = useState("");
  const [backendURL, setBackendURL] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [timer, setTimer] = useState(0);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [editLoading, setEditLoading] = useState(false);
  const [filePlan, setFilePlan] = useState([]);
  const [planProgress, setPlanProgress] = useState(null);
  const [generationStage, setGenerationStage] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [activeGeneratingFile, setActiveGeneratingFile] = useState("");
  const [generationHistory, setGenerationHistory] = useState([]);
  const navigate = useNavigate();

  const withCacheBust = (url) => {
    if (!url) return "";
    return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
  };

  const withProjectKey = (url, projectName) => {
    const raw = String(url || "").trim();
    const key = String(projectName || "").trim();
    if (!raw || !key) return raw;
    if (/[?&]projectKey=/i.test(raw)) return raw;
    return `${raw}${raw.includes("?") ? "&" : "?"}projectKey=${encodeURIComponent(key)}`;
  };

  const resolveBackendAssetUrl = (url) => {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    const normalized = raw.startsWith("/") ? raw : `/${raw}`;
    return `http://localhost:5000${normalized}`;
  };

  const filePlanText = filePlan.length
    ? [
        "Project Build Plan",
        planProgress
          ? `${planProgress.created}/${planProgress.total} files created (${planProgress.completionPercent}%)`
          : `${filePlan.filter((f) => f.created).length}/${filePlan.length} files created`,
        "",
        ...filePlan.map((item) => {
          const marker = item.status === "generating"
            ? "..."
            : item.created
              ? "[x]"
              : "[ ]";
          return `${marker} ${item.step}. ${item.path}`;
        }),
        "",
        filePlan.find((item) => !item.created)
          ? `Next file to complete: ${filePlan.find((item) => !item.created)?.path}`
          : "All planned files are created.",
      ].join("\n")
    : "";

  // 🔹 Fetch user projects from backend
  const fetchProjects = async () => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    try {
      const res = await api.get(`/projects/user/${userId}`);
      if (res.data.success) setProjects(res.data.projects);
    } catch (err) {
      console.error("Error fetching projects:", err);
      setErrorMsg("Unable to fetch projects from server");
    }
  };

  // 🔹 Load username and theme from localStorage
  useEffect(() => {
    const savedUsername = localStorage.getItem("username");
    const savedTheme = localStorage.getItem("theme");
    if (savedUsername) setUsername(savedUsername);
    if (savedTheme) setTheme(savedTheme);
    fetchProjects();
  }, []);

  // 🔹 Timer while generating
  useEffect(() => {
    let interval;
    if (loading) interval = setInterval(() => setTimer((prev) => prev + 1), 1000);
    else setTimer(0);
    return () => clearInterval(interval);
  }, [loading]);

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) setUploadedFile(e.target.files[0]);
  };

  // 🔹 Upload abstract file
  const handleUploadAbstract = async () => {
    if (!uploadedFile) return alert("Please select a file first!");
    const formData = new FormData();
    formData.append("file", uploadedFile);

    try {
      const res = await api.post("/projects/upload-abstract", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data.success) {
        alert("✅ Abstract uploaded successfully!");
        setUploadedFile(null);
      } else {
        setErrorMsg(res.data.message || "Upload failed");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setErrorMsg(err.response?.data?.message || err.message || "Upload failed");
    }
  };

  // 🔹 Generate project using AI
  const handleGenerate = async () => {
    if (!appDesc.trim()) return alert("Please describe your app!");
    const userId = localStorage.getItem("userId");
    if (!userId) return alert("User not logged in!");

    setLoading(true);
    setGeneratedCode("");
    setDownloadURL("");
    setExecutableURL("");
    setExecutableBuildError("");
    setIframeContent("");
    setErrorMsg("");
    setGeneratedProjectName("");
    setBackendURL("");
    setEditPrompt("");
    setChatMessages([]);
    setFilePlan([]);
    setPlanProgress(null);
    setGenerationStage("queued");
    setGenerationMessage("Starting live generation...");
    setActiveGeneratingFile("");
    setGenerationHistory([]);
    const requestId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let progressRequestId = requestId;
    let progressTimer = null;
    let progressSource = null;
    const stopProgressTracking = () => {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      if (progressSource) {
        progressSource.close();
        progressSource = null;
      }
    };
    const applyProgressSnapshot = (progress) => {
      if (!progress) return;
      if (Array.isArray(progress.filePlan)) setFilePlan(progress.filePlan);
      if (progress.planProgress) setPlanProgress(progress.planProgress);
      setGenerationStage(String(progress.stage || ""));
      setGenerationMessage(String(progress.message || ""));
      if (progress.stage || progress.message) {
        setGenerationHistory((prev) => {
          const stage = String(progress.stage || "");
          const message = String(progress.message || "");
          const last = prev.length ? prev[prev.length - 1] : null;
          if (last && last.stage === stage && last.message === message) return prev;
          return [...prev, { stage, message, at: new Date().toLocaleTimeString() }].slice(-12);
        });
      }
      const generatingFile = Array.isArray(progress.filePlan)
        ? progress.filePlan.find((item) => String(item?.status || "") === "generating")?.path
        : "";
      setActiveGeneratingFile(String(generatingFile || progress.nextPendingFile || ""));
      if (progress.status === "failed") {
        setErrorMsg(progress.message || "Project generation failed");
        stopProgressTracking();
      }
      if (progress.status === "completed") {
        stopProgressTracking();
      }
    };
    const pollProgress = async () => {
      try {
        const progressRes = await api.get(`/ai/progress/${progressRequestId}`);
        const progress = progressRes?.data?.progress;
        applyProgressSnapshot(progress);
      } catch (progressErr) {
        const status = Number(progressErr?.response?.status || 0);
        if (status !== 404) {
          console.warn("Progress polling error:", progressErr?.message || progressErr);
        }
      }
    };
    const startProgressPolling = () => {
      if (progressTimer) return;
      progressTimer = setInterval(pollProgress, 250);
      pollProgress();
    };
    const startProgressStream = () => {
      if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
        startProgressPolling();
        return;
      }
      try {
        progressSource = new window.EventSource(
          `http://localhost:5000/api/ai/progress/stream/${encodeURIComponent(progressRequestId)}`
        );
        progressSource.addEventListener("progress", (event) => {
          try {
            const payload = JSON.parse(String(event?.data || "{}"));
            applyProgressSnapshot(payload?.progress);
          } catch (_err) {
            // Ignore malformed stream payloads.
          }
        });
        progressSource.onerror = () => {
          if (progressSource) {
            progressSource.close();
            progressSource = null;
          }
          startProgressPolling();
        };
      } catch (_streamErr) {
        startProgressPolling();
      }
    };
    startProgressStream();

    try {
      const appDescLower = String(appDesc || "").toLowerCase();
      const wantsSampleData = /include sample data|use sample data|with sample data|demo data is fine|mock data is fine/i.test(
        appDescLower
      );
      const wantsPromptImages = /\b(with|add|include|use|generate|create|show)\b[^.\n]{0,40}\b(images?|photos?|pictures?|banners?|thumbnails?|illustrations?)\b/i.test(
        appDescLower
      ) || /\bimage\s*(gallery|assets?|generation|generator)\b/i.test(appDescLower);
      const noSampleDataRequested = !wantsSampleData;
      const genRes = await api.post("/ai/generate", {
        description: appDesc,
        language: backendLanguage,
        backendLanguage,
        requestId,
        forceRequirementDriven: true,
        budgetMode: "balanced",
        goldenRulesMode: true,
        failOnProviderBlocked: true,
        failOnWeakAiOutput: true,
        noSampleData: noSampleDataRequested,
        splitIntoParts: false,
        useFileTreeOrchestration: true,
        useTemplateSeed: false,
        strictMode: true,
        strictFailHard: false,
        enablePlanningPass: true,
        enableWholeProjectPass: false,
        enableRepairPass: true,
        enableBackendPolishPass: false,
        enableFrontendPolishPass: false,
        enableCssRefinementPass: false,
        enableSequentialFeaturePass: false,
        enablePlanCompletionPass: true,
        includeAiImages: wantsPromptImages,
        aiImageCount: wantsPromptImages ? 6 : 0,
        buildExecutable: true,
      });
      if (!genRes.data.success) {
        const issues = Array.isArray(genRes.data.issues) ? genRes.data.issues : [];
        const detail = issues.length ? `\n- ${issues.slice(0, 5).join("\n- ")}` : "";
        setErrorMsg(`${genRes.data.message || "Project generation failed"}${detail}`);
        setLoading(false);
        return;
      }
      if (genRes?.data?.requestId) {
        progressRequestId = String(genRes.data.requestId);
      }

      const plan = genRes.data.plan || {};
      const responseFilePlan = Array.isArray(genRes.data.filePlan) ? genRes.data.filePlan : [];
      const responsePlanProgress = genRes.data.planProgress || null;
      const generatedFiles = Array.isArray(genRes.data.generatedFiles)
        ? genRes.data.generatedFiles
        : Array.isArray(genRes.data.files)
          ? genRes.data.files
          : [];
      const generatedPaths = generatedFiles
        .map((f) => String(f?.path || "").replace(/\\/g, "/").trim())
        .filter(Boolean);
      const planPaths = Array.isArray(plan?.fileBlueprint)
        ? plan.fileBlueprint.map((p) => String(p || "").replace(/\\/g, "/").trim()).filter(Boolean)
        : [];
      const defaultPlanPaths = [
        "frontend/index.html",
        "frontend/style.css",
        "frontend/script.js",
      ];
      const fallbackPlanPaths = Array.from(new Set([...planPaths, ...generatedPaths, ...defaultPlanPaths]));
      const fallbackPlan = fallbackPlanPaths.map((p, idx) => ({
        step: idx + 1,
        path: p,
        created: generatedPaths.includes(p),
        status: generatedPaths.includes(p) ? "created" : "pending",
      }));
      const effectivePlan = responseFilePlan.length ? responseFilePlan : fallbackPlan;
      const effectiveProgress = responsePlanProgress || (effectivePlan.length
        ? {
            total: effectivePlan.length,
            created: effectivePlan.filter((f) => f.created).length,
            pending: effectivePlan.filter((f) => !f.created).length,
            completionPercent: Math.round((effectivePlan.filter((f) => f.created).length / effectivePlan.length) * 100),
          }
        : null);
      const projectName = genRes.data.projectName || "";
      const lockedTemplateDomain = String(genRes.data.lockedTemplateDomain || "");
      const folder = genRes.data.projectDir || "";
      const relativeDownloadURL = genRes.data.zipURL || genRes.data.downloadURL || "";
      const relativeExecutableURL =
        String(genRes.data.executableDownloadURL || "") ||
        String(genRes.data.executableURL || "");
      const relativePreviewURL = genRes.data.previewURL || "";
      const legacyHtml = String(genRes.data.ai_result || "");
      const legacyCss = String(genRes.data.styleContent || "");
      const legacyJs = String(genRes.data.scriptContent || "");
      const planText = JSON.stringify(plan, null, 2);
      const htmlFiles = generatedFiles.filter((f) =>
        String(f?.path || "").toLowerCase().endsWith(".html")
      );
      const filesPreview = htmlFiles.length
        ? htmlFiles
            .slice(0, 8)
            .map((f) => {
              const content = String(f.content || "");
              const maxPreviewChars = 2000;
              const snippet = content.slice(0, maxPreviewChars);
              const suffix = content.length > maxPreviewChars ? "\n/* ...preview truncated... */" : "";
              return `// FILE: ${f.path}\n${snippet}${suffix}`;
            })
            .join("\n\n")
        : "";

      const hasUsefulPlan = plan && Object.keys(plan).length > 0;
      setGeneratedCode(
        filesPreview ||
        (legacyHtml ? legacyHtml.slice(0, 1800) : "") ||
        (hasUsefulPlan ? planText : "") ||
        genRes.data.message ||
        "Project generated successfully."
      );
      setDownloadURL(resolveBackendAssetUrl(relativeDownloadURL));
      setExecutableURL(
        relativeExecutableURL
        && (
          String(relativeExecutableURL).toLowerCase().endsWith(".exe")
          || String(relativeExecutableURL).toLowerCase().includes("/download-executable/")
        )
          ? resolveBackendAssetUrl(relativeExecutableURL)
          : ""
      );
      setExecutableBuildError(String(genRes?.data?.executableBuildError || ""));
      setGeneratedProjectName(projectName);
      setFilePlan(effectivePlan);
      setPlanProgress(effectiveProgress);
      setGenerationStage("completed");
      setGenerationMessage("Project generation completed.");
      setActiveGeneratingFile("");
      setGenerationHistory((prev) => {
        const last = prev.length ? prev[prev.length - 1] : null;
        if (last && last.stage === "completed") return prev;
        return [...prev, { stage: "completed", message: "Project generation completed.", at: new Date().toLocaleTimeString() }].slice(-12);
      });
      if (legacyHtml && !generatedFiles.length) {
        const srcDoc = `<!DOCTYPE html><html><head><style>${legacyCss}</style></head><body>${legacyHtml}<script>${legacyJs}</script></body></html>`;
        setIframeContent(srcDoc);
      } else {
        setIframeContent("");
      }
      // Show a static preview path first using generated file paths.
      const normalizedFilePaths = generatedFiles.map((f) =>
        String(f?.path || "").replace(/\\/g, "/").toLowerCase()
      );
      const preferredPreviewFiles = [
        "frontend/index.html",
        "frontend/public/index.html",
        "public/index.html",
        "index.html",
        "home.html",
        "public/home.html",
      ];
      const matchedPreviewFile = preferredPreviewFiles.find((p) => normalizedFilePaths.includes(p));
      const anyHtmlFile = normalizedFilePaths.find((p) => p.endsWith(".html"));
      const staticPreviewPath = relativePreviewURL
        ? relativePreviewURL
        : matchedPreviewFile
          ? `/generated_projects/${projectName}/${matchedPreviewFile}`
          : anyHtmlFile
            ? `/generated_projects/${projectName}/${anyHtmlFile}`
            : "";
      const staticPreviewFullUrl = projectName && staticPreviewPath
        ? withProjectKey(`http://localhost:5000${staticPreviewPath}`, projectName)
        : "";
      setBackendURL(withCacheBust(staticPreviewFullUrl));

      // Save in database
      await api.post("/projects/add", {
        user_id: userId,
        description: appDesc,
        language: `Frontend: HTML/CSS/JS | Backend: ${backendLanguage}`,
        ai_result: filesPreview || planText || "Generated via /api/generator",
        downloadURL: relativeDownloadURL,
        projectFolder: folder,
      });

      // Auto-start preview for generated project.
      if (projectName) {
        try {
          const previewRes = await api.post(`/generator/preview/start/${projectName}`);
          const previewUrl = previewRes?.data?.preview?.url || "";
          const previewMode = String(previewRes?.data?.preview?.mode || "");
          if (previewUrl) {
            const fullPreviewUrl = previewUrl.startsWith("http")
              ? previewUrl
              : `http://localhost:5000${previewUrl}`;
            if (previewMode === "static" || !staticPreviewFullUrl) {
              setBackendURL(withCacheBust(withProjectKey(fullPreviewUrl, projectName)));
            }
          }
        } catch (previewErr) {
          console.warn("Preview start failed:", previewErr?.message || previewErr);
          // Keep static preview URL already set above.
        }
      }
      setChatMessages([
        {
          role: "assistant",
          content: `Project ${projectName || "generated app"} is ready${lockedTemplateDomain ? ` (template: ${lockedTemplateDomain})` : ""}. Describe any change here and I will edit it.`,
        },
      ]);
      setAppDesc("");
      fetchProjects();
    } catch (err) {
      console.error("Error generating project:", err);
      const issues = Array.isArray(err.response?.data?.issues) ? err.response.data.issues : [];
      const detail = issues.length ? `\n- ${issues.slice(0, 5).join("\n- ")}` : "";
      setErrorMsg(`${err.response?.data?.message || err.message || "Server error"}${detail}`);
      setExecutableBuildError("");
      setFilePlan([]);
      setPlanProgress(null);
      setGenerationStage("failed");
      setGenerationMessage(err.response?.data?.message || err.message || "Generation failed");
      setActiveGeneratingFile("");
    } finally {
      stopProgressTracking();
      setLoading(false);
    }
  };

  // 🔹 Preview generated code
  const handlePreview = () => {
    if (backendURL) return;
    if (generatedProjectName) {
      api.post(`/generator/preview/start/${generatedProjectName}`)
        .then((previewRes) => {
          const previewUrl = previewRes?.data?.preview?.url || "";
          const previewMode = String(previewRes?.data?.preview?.mode || "");
          if (previewUrl) {
            const fullPreviewUrl = previewUrl.startsWith("http")
              ? previewUrl
              : `http://localhost:5000${previewUrl}`;
            if (previewMode === "static") {
              setBackendURL(withCacheBust(withProjectKey(fullPreviewUrl, generatedProjectName)));
              return;
            }
          }
          const fallbacks = [
            `/generated_projects/${generatedProjectName}/frontend/index.html`,
            `/generated_projects/${generatedProjectName}/frontend/public/index.html`,
            `/generated_projects/${generatedProjectName}/public/index.html`,
            `/generated_projects/${generatedProjectName}/index.html`,
            `/generated_projects/${generatedProjectName}/home.html`,
            `/generated_projects/${generatedProjectName}/public/home.html`,
          ];
          setBackendURL(withCacheBust(withProjectKey(`http://localhost:5000${fallbacks[0]}`, generatedProjectName)));
        })
        .catch((err) => {
          console.error("Preview error:", err);
          alert("Preview start failed");
        });
      return;
    }
    if (!generatedProjectName && !generatedCode && !backendURL && !iframeContent) {
      return alert("No generated project to preview!");
    }
  };

  // Edit generated project via chat prompt
  const handleEditProject = async () => {
    const changeRequest = editPrompt.trim();
    if (!generatedProjectName) return alert("Generate a project first!");
    if (!changeRequest) return;

    setEditLoading(true);
    setErrorMsg("");
    setChatMessages((prev) => [...prev, { role: "user", content: changeRequest }]);
    setEditPrompt("");

    try {
      const changeRequestLower = String(changeRequest || "").toLowerCase();
      const wantsSampleData = /include sample data|use sample data|with sample data|demo data is fine|mock data is fine/i.test(
        changeRequestLower
      );
      const noSampleDataRequested = !wantsSampleData;
      const refineRes = await api.post("/ai/refine", {
        projectName: generatedProjectName,
        changeRequest,
        language: backendLanguage,
        noSampleData: noSampleDataRequested,
      });
      if (!refineRes.data.success) {
        throw new Error(refineRes.data.message || "Project edit failed");
      }

      const updatedFiles = Array.isArray(refineRes.data.updatedFiles) ? refineRes.data.updatedFiles : [];
      const updatedContents = Array.isArray(refineRes.data.files) ? refineRes.data.files : [];
      const refinedTemplateDomain = String(refineRes.data.lockedTemplateDomain || "");
      if (updatedContents.length) {
        const previewText = updatedContents
          .slice(0, 6)
          .map((f) => `// FILE: ${f.path}\n${String(f.content || "").slice(0, 1600)}`)
          .join("\n\n");
        if (previewText) setGeneratedCode(previewText);
      }

      const relativeZipUrl = String(refineRes.data.zipURL || "");
      if (relativeZipUrl) {
        setDownloadURL(resolveBackendAssetUrl(relativeZipUrl));
      }

      const relativePreviewUrl = String(refineRes.data.previewURL || "");
      if (relativePreviewUrl) {
        setBackendURL(withCacheBust(withProjectKey(`http://localhost:5000${relativePreviewUrl}`, generatedProjectName)));
      }

      try {
        const previewRes = await api.post(`/generator/preview/start/${generatedProjectName}`);
        const previewUrl = previewRes?.data?.preview?.url || "";
        if (previewUrl) {
          const fullPreviewUrl = previewUrl.startsWith("http")
            ? previewUrl
            : `http://localhost:5000${previewUrl}`;
          setBackendURL(withCacheBust(withProjectKey(fullPreviewUrl, generatedProjectName)));
        }
      } catch (previewErr) {
        console.warn("Preview refresh failed:", previewErr?.message || previewErr);
      }

      const updatedSummary = updatedFiles.length
        ? `Updated ${updatedFiles.length} file(s): ${updatedFiles.slice(0, 6).join(", ")}`
        : "Edit applied successfully.";
      setChatMessages((prev) => [...prev, { role: "assistant", content: `${updatedSummary}${refinedTemplateDomain ? ` (template: ${refinedTemplateDomain})` : ""}` }]);
    } catch (err) {
      const errText = err.response?.data?.message || err.message || "Unable to edit this project";
      setErrorMsg(errText);
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Edit failed: ${errText}` }]);
    } finally {
      setEditLoading(false);
    }
  };

  // 🔹 Download project as ZIP
  const handleDownloadZip = async () => {
    if (!downloadURL) return alert("No project file to download!");
    const fullURL = resolveBackendAssetUrl(downloadURL);
    try {
      const response = await fetch(fullURL);
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fullURL.split("/").pop() || "project.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      alert("Failed to download ZIP file");
    }
  };

  // 🔹 Download executable app
  const handleDownloadExecutable = async () => {
    if (!executableURL) return alert("No executable file to download!");
    const fullURL = resolveBackendAssetUrl(executableURL);
    try {
      const link = document.createElement("a");
      const fallbackName = executableURL.toLowerCase().includes("/download-executable/")
        ? "Generated-App.exe"
        : (fullURL.split("/").pop() || "Run-App.exe");
      link.href = fullURL;
      link.download = fallbackName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Download error:", err);
      alert("Failed to download executable file");
    }
  };

  const handleRetryExecutableBuild = async () => {
    if (!generatedProjectName) return alert("Generate a project first!");
    setExeLoading(true);
    setErrorMsg("");
    try {
      const res = await api.post(`/generator/build-executable/${encodeURIComponent(generatedProjectName)}`, {
        timeoutMs: 25 * 60 * 1000,
      });
      const relativeExecutableURL =
        String(res?.data?.executableDownloadURL || "") ||
        String(res?.data?.executableURL || "");
      setExecutableURL(
        relativeExecutableURL
        && String(relativeExecutableURL).toLowerCase().endsWith(".exe")
          ? resolveBackendAssetUrl(relativeExecutableURL)
          : ""
      );
      setExecutableBuildError("");
    } catch (err) {
      const msg = String(err?.response?.data?.message || err?.message || "Executable build failed");
      setExecutableBuildError(msg);
      setErrorMsg(msg);
    } finally {
      setExeLoading(false);
    }
  };

  // 🔹 Download project from projects list
  const handleDownloadProject = async (downloadURL) => {
    if (!downloadURL) return alert("No project file to download!");
    const fullURL = resolveBackendAssetUrl(downloadURL);
    try {
      const response = await fetch(fullURL);
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadURL.split("/").pop() || "project.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      alert("Failed to download project file");
    }
  };

  // 🔹 Logout
  const handleLogout = () => {
    localStorage.clear();
    navigate("/signin");
  };

  // 🔹 Clear project list (frontend only)
  const handleClearProjects = () => {
    if (window.confirm("Are you sure you want to delete all projects?")) {
      setProjects([]);
    }
  };

  return (
    <div className={`main-container ${theme}-theme`}>
      <aside className="sidebar">
        <div className="logo">⚡ Auto App Generator</div>
        <nav>
          <ul>
            <li className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}>🏠 Dashboard</li>
            <li className={activeTab === "projects" ? "active" : ""} onClick={() => { setActiveTab("projects"); fetchProjects(); }}>📝 Projects</li>
            <li className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>⚙️ Settings</li>
            <li onClick={handleLogout}>🚪 Logout</li>
          </ul>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="welcome">Welcome, {username}!</div>
          <div className="profile">👤</div>
        </header>

        <section className="workspace-content">
          {/* 🧩 Dashboard Tab */}
          {activeTab === "dashboard" && (
            <div className="create-project-card">
              <h2>Create a New Project</h2>
              <div className="create-form">
                <textarea
                  placeholder="Describe a large fullstack app (modules, roles, dashboards, APIs, database, workflows)..."
                  value={appDesc}
                  onChange={(e) => setAppDesc(e.target.value)}
                />

                <label className="language-label">Choose Backend Language:</label>
                <select value={backendLanguage} onChange={(e) => setBackendLanguage(e.target.value)}>
                  <option value="Node.js">Node.js</option>
                  <option value="Python">Python</option>
                  <option value="Java">Java</option>
                </select>

                <input type="file" onChange={handleFileChange} style={{ marginTop: "10px" }} />
                <button type="button" className="generate-btn" onClick={handleUploadAbstract} style={{ marginBottom: "10px" }}>
                  📤 Upload Abstract
                </button>

                <button type="button" className="generate-btn" onClick={handleGenerate} disabled={loading}>
                  {loading ? `Generating... (${timer}s)` : "Generate Project 🚀"}
                </button>

                {loading && (
                  <div className="loading-indicator">
                    <p>🌀 Generating code... ({timer}s elapsed)</p>
                    {(generationStage || generationMessage || activeGeneratingFile) && (
                      <div className="live-generation-box">
                        <p className="live-generation-title">Live generation status</p>
                        {generationStage && <p className="live-generation-meta">Stage: {generationStage}</p>}
                        {generationMessage && <p className="live-generation-meta">{generationMessage}</p>}
                        {activeGeneratingFile && (
                          <p className="live-generation-meta">
                            Active file: <code>{activeGeneratingFile}</code>
                          </p>
                        )}
                        {generationHistory.length > 0 && (
                          <div style={{ marginTop: "8px" }}>
                            {generationHistory.map((item, idx) => (
                              <p key={`${item.at}-${idx}`} className="live-generation-meta">
                                [{item.at}] {item.stage}{item.message ? ` - ${item.message}` : ""}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {errorMsg && <div style={{ color: "red", marginTop: "10px" }}>⚠️ {errorMsg}</div>}

                {(generatedProjectName || generatedCode || (loading && filePlan.length > 0)) && (
                  <div className="generated-output">                    {generatedCode && (
                      <>
                        <h3>AI Generated Code (Preview):</h3>
                        <pre style={{
                          background: "#111",
                          color: "#0ff",
                          padding: "12px",
                          borderRadius: "8px",
                          marginTop: "10px",
                          whiteSpace: "pre-wrap",
                          maxHeight: "400px",
                          overflowY: "auto",
                        }}>
                          {generatedCode}
                        </pre>
                      </>
                    )}

                    {generatedCode && !loading && (
                      <div style={{ marginTop: "15px" }}>
                        <button type="button" className="download-btn" onClick={handleDownloadZip}>⬇️ Download ZIP</button>
                        <button type="button" className="preview-btn" onClick={handlePreview} style={{ marginLeft: "10px" }}>👁 Preview</button>
                      </div>
                    )}

                    {filePlan.length > 0 && (
                      <div className="file-plan-box">
                        <pre className="file-plan-single-box">{filePlanText}</pre>
                        <p className="file-plan-summary">
                          {planProgress
                            ? `${planProgress.created}/${planProgress.total} files created (${planProgress.completionPercent}%)`
                            : `${filePlan.filter((f) => f.created).length}/${filePlan.length} files created`}
                        </p>
                        <ul className="file-plan-list">
                          {filePlan.map((item) => {
                            const rowStatus = item.status === "generating"
                              ? "generating"
                              : item.created
                                ? "created"
                                : "pending";
                            return (
                            <li key={item.path} className={rowStatus}>
                              <span className="status-mark">{rowStatus === "generating" ? "..." : item.created ? "✓" : "○"}</span>
                              <span className="step">{item.step}.</span>
                              <code>{item.path}</code>
                            </li>
                            );
                          })}
                        </ul>
                        {filePlan.find((item) => !item.created) ? (
                          <p className="file-plan-next">
                            Next file to complete: {filePlan.find((item) => !item.created)?.path}
                          </p>
                        ) : (
                          <p className="file-plan-done">All planned files are created.</p>
                        )}
                      </div>
                    )}

                    <div className="edit-chatbox">
                      <h4>Edit Generated Project</h4>
                      <div className="chat-history">
                        {chatMessages.length === 0 ? (
                          <p className="chat-empty">Ask for changes like "add dark mode", "fix login bug", or "create profile page".</p>
                        ) : (
                          chatMessages.map((msg, idx) => (
                            <div key={`${msg.role}-${idx}`} className={`chat-message ${msg.role}`}>
                              <strong>{msg.role === "user" ? "You" : "AI"}:</strong> {msg.content}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="chat-input-row">
                        <textarea
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                          placeholder="Describe what to change in this generated project..."
                          disabled={editLoading || !generatedProjectName}
                        />
                        <button
                          type="button"
                          className="generate-btn"
                          onClick={handleEditProject}
                          disabled={editLoading || !generatedProjectName || !editPrompt.trim()}
                        >
                          {editLoading ? "Applying..." : "Send Edit"}
                        </button>
                      </div>
                    </div>

                    {backendURL ? (
                      <div className="iframe-container" style={{ marginTop: "20px", border: "1px solid #555", height: "500px" }}>
                        <iframe title="Full-Stack Preview" src={backendURL} style={{ width: "100%", height: "100%", border: "none" }} />
                      </div>
                    ) : iframeContent ? (
                      <div className="iframe-container" style={{ marginTop: "20px", border: "1px solid #555", height: "500px" }}>
                        <iframe title="AI Preview" srcDoc={iframeContent} style={{ width: "100%", height: "100%", border: "none" }} />
                      </div>
                    ) : null}

                    {(generatedProjectName || generatedCode) && !loading && (
                      <div style={{ marginTop: "15px", textAlign: "center" }}>
                        <button
                          type="button"
                          className="download-btn"
                          onClick={handleDownloadExecutable}
                          disabled={!executableURL}
                          style={{
                            backgroundColor: executableURL ? "#28a745" : "#7b7b7b",
                            borderColor: executableURL ? "#28a745" : "#7b7b7b",
                            opacity: executableURL ? 1 : 0.75,
                          }}
                        >
                          Download App
                        </button>
                        <p style={{ marginTop: "10px", fontSize: "14px", color: "#666" }}>
                          {executableURL
                            ? "Download the complete desktop application executable for your system."
                            : executableBuildError
                              ? `Executable build failed: ${executableBuildError}`
                              : "Executable is not available yet for this project build."}
                        </p>
                        {!executableURL && generatedProjectName && (
                          <button
                            type="button"
                            className="download-btn"
                            onClick={handleRetryExecutableBuild}
                            disabled={exeLoading}
                            style={{ marginTop: "10px" }}
                          >
                            {exeLoading ? "Retrying EXE build..." : "Retry EXE Build"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 📁 Projects Tab */}
          {activeTab === "projects" && (
            <div className="projects-tab">
              <h2>Your Projects</h2>
              {projects.length === 0 ? <p>No projects yet</p> : (
                <ul>
                  {projects.map((p, idx) => (
                    <li key={idx}>
                      {p.description} - {p.language}
                      <button type="button" onClick={() => handleDownloadProject(p.downloadURL)} style={{ marginLeft: "10px" }}>⬇ Download</button>
                    </li>
                  ))}
                </ul>
              )}
              {projects.length > 0 && (
                <button type="button" onClick={handleClearProjects} style={{ marginTop: "15px" }}>
                  🗑 Clear All Projects
                </button>
              )}
            </div>
          )}

          {/* ⚙️ Settings Tab */}
          {activeTab === "settings" && (
            <div className="settings-tab">
              <h2>Settings</h2>
              <label>Theme:</label>
              <select
                value={theme}
                onChange={(e) => {
                  setTheme(e.target.value);
                  localStorage.setItem("theme", e.target.value);
                }}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}




