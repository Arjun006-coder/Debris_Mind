import React, { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Shield,
  Activity,
  Zap,
  Play,
  Check,
  RefreshCw,
  Layers,
  Server,
  HelpCircle,
  Radio,
  Cpu
} from "lucide-react";
import confetti from "canvas-confetti";
import Globe from "./components/Globe";
import Galaxy from "./components/Galaxy";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
const WS_BASE = import.meta.env.VITE_WS_BASE || API_BASE.replace(/^http/, "ws");

export default function App() {
  // Mode selection: 'live' or 'demo'
  const [mode, setMode] = useState("demo");
  const [demoId, setDemoId] = useState("active_active");

  // Telemetry & Conjunction State
  const [conjunctions, setConjunctions] = useState([]);
  const [orbits, setOrbits] = useState({});
  const [stats, setStats] = useState({
    total_monitored: 50,
    conjunctions_24h: 3,
    maneuvers_executed: 14,
    fuel_saved_pct: 34.2,
    collision_prob_index: "1.24e-7"
  });

  const [selectedConjunction, setSelectedConjunction] = useState(null);
  const [maneuveredOrbit, setManeuveredOrbit] = useState(null);

  // Negotiation & LLM State
  const [logs, setLogs] = useState([]);
  const [proposalsA, setProposalsA] = useState([]);
  const [proposalsB, setProposalsB] = useState([]);
  const [decision, setDecision] = useState(null);
  const [brief, setBrief] = useState("");

  const [isScanning, setIsScanning] = useState(false);
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

  // References
  const logContainerRef = useRef(null);
  const wsRef = useRef(null);

  // Load initial backend telemetry if server is available
  useEffect(() => {
    fetchBackgroundTelemetry();
  }, []);

  const fetchBackgroundTelemetry = async () => {
    try {
      const statsRes = await fetch(`${API_BASE}/api/stats`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      
      const orbitsRes = await fetch(`${API_BASE}/api/orbits`);
      if (orbitsRes.ok) {
        const orbitsData = await orbitsRes.json();
        setOrbits(orbitsData);
      }
    } catch (e) {
      console.warn("Backend server not responding. Operating in offline demo fallback mode.");
    }
  };

  // Scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle Mode & Demo Scenario selection
  useEffect(() => {
    if (mode === "demo") {
      loadDemoData(demoId);
    } else {
      setSelectedConjunction(null);
      setManeuveredOrbit(null);
      setLogs([]);
      setProposalsA([]);
      setProposalsB([]);
      setDecision(null);
      setBrief("");
      setIsApproved(false);
      scanLiveConjunctions();
    }
  }, [mode, demoId]);

  const loadDemoData = async (scenarioId) => {
    setIsScanning(true);
    setSelectedConjunction(null);
    setManeuveredOrbit(null);
    setLogs([]);
    setProposalsA([]);
    setProposalsB([]);
    setDecision(null);
    setBrief("");
    setIsApproved(false);

    try {
      const res = await fetch(`${API_BASE}/api/demo/${scenarioId}`);
      if (res.ok) {
        const data = await res.json();
        setDemoState(data);
      } else {
        throw new Error("Backend response error");
      }
    } catch (e) {
      import("./fallback_scenarios").then(({ fallbackScenarios }) => {
        const data = fallbackScenarios[scenarioId];
        if (data) setDemoState(data);
      });
    } finally {
      setIsScanning(false);
    }
  };

  const setDemoState = (data) => {
    setSelectedConjunction(data.conjunction);
    setConjunctions([data.conjunction]);
    
    setOrbits(prev => ({
      ...prev,
      [data.satA.name]: { positions: data.orbitA },
      [data.satB.name]: { positions: data.orbitB }
    }));
  };

  const scanLiveConjunctions = async () => {
    setIsScanning(true);
    try {
      const res = await fetch(`${API_BASE}/api/conjunctions`);
      if (res.ok) {
        const data = await res.json();
        setConjunctions(data);
        if (data.length > 0) {
          setSelectedConjunction(data[0]);
        }
      }
    } catch (e) {
      alert("Failed to scan live conjunctions. Is the FastAPI server running?");
    } finally {
      setIsScanning(false);
    }
  };

  const startNegotiation = () => {
    if (!selectedConjunction) return;
    
    setIsApproved(false);
    setManeuveredOrbit(null);
    setLogs([]);
    setProposalsA([]);
    setProposalsB([]);
    setDecision(null);
    setBrief("");
    setIsNegotiating(true);

    if (mode === "live") {
      runLiveWsNegotiation();
    } else {
      runSimulatedDemoNegotiation();
    }
  };

  const runLiveWsNegotiation = () => {
    const url = `${WS_BASE}/ws/negotiate?satA=${selectedConjunction.satA}&satB=${selectedConjunction.satB}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "log") {
        appendLog(data.message, "system");
      } else if (data.type === "agent_proposals") {
        if (data.agent === "A") {
          setProposalsA(data.proposals);
          appendLog(`Agent A [${data.name}] submitted ${data.proposals.length} proposals.`, "agent-a");
          data.proposals.forEach(p => {
            appendLog(` -> Option [${p.direction}]: dV = ${p.delta_v_ms} m/s, New Miss = ${p.new_miss_km} km`, "agent-a");
          });
        } else {
          setProposalsB(data.proposals);
          appendLog(`Agent B [${data.name}] submitted proposals.`, "agent-b");
          data.proposals.forEach(p => {
            appendLog(` -> Option [${p.direction}]: dV = ${p.delta_v_ms} m/s, New Miss = ${p.new_miss_km} km`, "agent-b");
          });
        }
      } else if (data.type === "decision") {
        setDecision(data.decision);
        setBrief(data.brief);
        appendLog(`Mediator selected optimal resolution: ${data.decision.executor} to execute ${data.decision.satA_action.delta_v_ms > 0 ? data.decision.satA_action.direction : data.decision.satB_action.direction} burn.`, "mediator");
        setIsNegotiating(false);
        fetchManeuveredOrbit(data.decision);
      }
    };

    ws.onerror = () => {
      appendLog("WebSocket connection failed. Falling back to simulated run.", "error");
      runSimulatedDemoNegotiation();
    };
  };

  const fetchManeuveredOrbit = async (decisionData) => {
    try {
      if (mode === "live") {
        const demoRes = await fetch(`${API_BASE}/api/demo/active_active`);
        if (demoRes.ok) {
          const demoData = await demoRes.json();
          if (decisionData.executor === "STARLINK-1234") {
            setManeuveredOrbit(demoData.orbitA_maneuvered);
          } else {
            setManeuveredOrbit(demoData.orbitB_maneuvered);
          }
        }
      }
    } catch (e) {
      console.warn("Could not retrieve maneuver coordinates.");
    }
  };

  const runSimulatedDemoNegotiation = async () => {
    let scenarioData;
    try {
      const res = await fetch(`${API_BASE}/api/demo/${demoId}`);
      if (res.ok) {
        scenarioData = await res.json();
      } else {
        throw new Error();
      }
    } catch (e) {
      const { fallbackScenarios } = await import("./fallback_scenarios");
      scenarioData = fallbackScenarios[demoId];
    }

    const steps = [
      { msg: `Conjunction Alert: ${selectedConjunction.satA} and ${selectedConjunction.satB} are on a collision course (Miss: ${selectedConjunction.miss_km} km, TCA: ${selectedConjunction.tca}).`, type: "system", delay: 1000 },
      { msg: "Spawning autonomous orbital negotiation agents for both spacecraft...", type: "system", delay: 1200 },
      { msg: `Agent A [${selectedConjunction.satA}] analyzing orbital slot, fuel footprint (85% remaining), and mission priority...`, type: "agent-a", delay: 1500 },
      {
        action: () => {
          setProposalsA(scenarioData.agentA_proposals);
          appendLog(`Agent A [${selectedConjunction.satA}] submitted 3 avoidance maneuver proposals:`, "agent-a");
          scenarioData.agentA_proposals.forEach((p, i) => {
            appendLog(` -> Option ${i+1} [${p.direction}]: delta-V = ${p.delta_v_ms} m/s | Fuel: -${p.fuel_cost_pct}% | Est. Miss: ${p.new_miss_km} km`, "agent-a");
          });
        },
        delay: 500
      },
      { msg: `Agent B [${selectedConjunction.satB}] analyzing orbital slot, fuel footprint, and mission priority...`, type: "agent-b", delay: 1500 },
      {
        action: () => {
          setProposalsB(scenarioData.agentB_proposals);
          appendLog(`Agent B [${selectedConjunction.satB}] submitted proposals:`, "agent-b");
          scenarioData.agentB_proposals.forEach((p, i) => {
            appendLog(` -> Option ${i+1} [${p.direction}]: delta-V = ${p.delta_v_ms} m/s | Fuel: -${p.fuel_cost_pct}% | Est. Miss: ${p.new_miss_km} km`, "agent-b");
          });
        },
        delay: 500
      },
      { msg: "Mediator Agent analyzing 9 proposal cross-combinations for optimal joint efficiency...", type: "mediator", delay: 1500 },
      {
        action: () => {
          const dec = scenarioData.decision;
          setDecision(dec);
          setBrief(scenarioData.brief);
          
          if (dec.executor === selectedConjunction.satA) {
            setManeuveredOrbit(scenarioData.orbitA_maneuvered);
          } else if (dec.executor === selectedConjunction.satB) {
            setManeuveredOrbit(scenarioData.orbitB_maneuvered);
          } else {
            setManeuveredOrbit(scenarioData.orbitA_maneuvered);
          }

          appendLog("Maneuver plan negotiated successfully!", "success");
          appendLog(`Mediator Choice: ${dec.executor} will perform the avoidance maneuver.`, "mediator");
          appendLog(` -> Resulting Miss Distance: ${dec.final_miss_km} km (SAFE)`, "success");
          appendLog(` -> Total Fuel Impact: ${dec.total_fuel_pct}%`, "success");
          setIsNegotiating(false);
        },
        delay: 0
      }
    ];

    for (let step of steps) {
      await new Promise(r => setTimeout(r, step.delay));
      if (step.msg) {
        appendLog(step.msg, step.type);
      }
      if (step.action) {
        step.action();
      }
    }
  };

  const appendLog = (msg, type) => {
    setLogs(prev => [...prev, { text: msg, type }]);
  };

  const handleApprove = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });

    setIsApproved(true);
    
    setStats(prev => ({
      ...prev,
      conjunctions_24h: Math.max(0, prev.conjunctions_24h - 1),
      maneuvers_executed: prev.maneuvers_executed + 1
    }));
  };

  return (
    <div className="app-wrapper">
      {/* Dynamic Floating Particles Backdrop from React Bits */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden", opacity: 0.22 }}>
        <Galaxy
          mouseRepulsion={true}
          mouseInteraction={true}
          density={1.2}
          glowIntensity={0.5}
          saturation={0.7}
          hueShift={35} /* Luxury Warm Gold Tone matching portfolio background */
          starSpeed={0.3}
          rotationSpeed={0.05}
        />
      </div>

      {/* Top Navbar */}
      <header className="dashboard-header">
        <div className="header-brand">
          <div className="brand-icon">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-editorial tracking-wider text-white mb-0.5 leading-none">
              DEBRIS<span className="text-[#d4c4a8] font-sans font-light tracking-widest text-sm ml-1">MIND</span>
            </h1>
            <span className="text-[10px] tracking-[0.25em] font-mono text-slate-500 uppercase block">Autonomous Orbital Traffic Management</span>
          </div>
        </div>

        {/* System Status & Mode Selectors */}
        <div className="header-controls">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-950/80 border border-slate-800/60 rounded-lg text-xxs font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-slate-400 uppercase tracking-wider">SYSTEM ONLINE</span>
          </div>

          <div className="mode-selector">
            <button
              onClick={() => setMode("demo")}
              className={`mode-btn ${mode === "demo" ? "active" : ""}`}
            >
              Demo Scenario
            </button>
            <button
              onClick={() => setMode("live")}
              className={`mode-btn ${mode === "live" ? "active" : ""}`}
            >
              Live Telemetry
            </button>
          </div>

          {mode === "demo" && (
            <select
              value={demoId}
              onChange={(e) => setDemoId(e.target.value)}
              className="dropdown-select"
            >
              <option value="active_active">Scenario 1: Active vs Active</option>
              <option value="active_debris">Scenario 2: Active vs Debris</option>
              <option value="cooperative_rescue">Scenario 3: Coordinated Rescue</option>
            </select>
          )}

          <button
            onClick={() => (mode === "live" ? scanLiveConjunctions() : loadDemoData(demoId))}
            className="p-2 border border-slate-800 rounded-lg bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white hover:border-[#d4c4a8] transition-all"
            disabled={isScanning || isNegotiating}
            title="Scan / Refresh Telemetry"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? "animate-spin text-[#d4c4a8]" : ""}`} />
          </button>
        </div>
      </header>

      {/* Main stats layout */}
      <div className="stats-container">
        <div className="glass-panel">
          <div className="hud-corner tl"></div>
          <div className="hud-corner tr"></div>
          <div className="hud-corner bl"></div>
          <div className="hud-corner br"></div>
          <div className="mono-label">Monitored Fleet</div>
          <div className="text-xl font-bold font-editorial text-white mt-1">{stats.total_monitored}</div>
        </div>

        <div className="glass-panel" style={{ borderLeft: stats.conjunctions_24h > 0 ? "2px solid var(--accent-red)" : "1px solid var(--border-color)" }}>
          <div className="hud-corner tl"></div>
          <div className="hud-corner tr"></div>
          <div className="hud-corner bl"></div>
          <div className="hud-corner br"></div>
          <div className="mono-label">Active Conjunctions</div>
          <div className="text-xl font-bold font-editorial text-white mt-1" style={{ color: stats.conjunctions_24h > 0 ? "var(--accent-red)" : "inherit" }}>
            {stats.conjunctions_24h}
          </div>
        </div>

        <div className="glass-panel">
          <div className="hud-corner tl"></div>
          <div className="hud-corner tr"></div>
          <div className="hud-corner bl"></div>
          <div className="hud-corner br"></div>
          <div className="mono-label">Avoidance Executed</div>
          <div className="text-xl font-bold font-editorial text-emerald-400 mt-1">{stats.maneuvers_executed}</div>
        </div>

        <div className="glass-panel">
          <div className="hud-corner tl"></div>
          <div className="hud-corner tr"></div>
          <div className="hud-corner bl"></div>
          <div className="hud-corner br"></div>
          <div className="mono-label">Fuel footprint saved</div>
          <div className="text-xl font-bold font-editorial text-amber-400 mt-1">{stats.fuel_saved_pct}%</div>
        </div>

        <div className="glass-panel">
          <div className="hud-corner tl"></div>
          <div className="hud-corner tr"></div>
          <div className="hud-corner bl"></div>
          <div className="hud-corner br"></div>
          <div className="mono-label">Avg Collision Risk</div>
          <div className="text-xs font-mono text-indigo-300 mt-2 font-semibold">{stats.collision_prob_index}</div>
        </div>
      </div>

      {/* Main Grid content */}
      <main className="dashboard-grid">
        
        {/* Left Column: Conjunctions Alert Feed */}
        <section className="glass-panel">
          <div className="hud-corner tl"></div>
          <div className="hud-corner tr"></div>
          <div className="hud-corner bl"></div>
          <div className="hud-corner br"></div>

          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="flex items-center gap-2" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="relative flex h-2 w-2" style={{ display: "inline-flex", position: "relative", width: "8px", height: "8px" }}>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" style={{ position: "absolute", width: "100%", height: "100%", borderRadius: "50%" }}></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" style={{ position: "relative", width: "8px", height: "8px", borderRadius: "50%" }}></span>
              </span>
              <h2 className="text-xs uppercase font-mono tracking-widest text-[#d4c4a8] font-bold">Threat Feed</h2>
            </div>
            <span className="bg-rose-950/20 border border-rose-500/30 text-rose-400 text-[9px] font-mono px-2 py-0.5 rounded uppercase" style={{ padding: "2px 6px", border: "1px solid rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.1)", borderRadius: "4px" }}>
              {conjunctions.length} Alerts
            </span>
          </div>

          <div className="alert-feed-list">
            {conjunctions.length === 0 ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                <Shield className="w-8 h-8 text-slate-700 mb-2" style={{ marginBottom: "8px" }} />
                <span>Zero Collision Threats</span>
              </div>
            ) : (
              conjunctions.map((conj, idx) => {
                const isSelected = selectedConjunction?.satA === conj.satA && selectedConjunction?.satB === conj.satB;
                const isCritical = conj.miss_km < 1.0;
                
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (!isNegotiating) {
                        setSelectedConjunction(conj);
                        setManeuveredOrbit(null);
                        setLogs([]);
                        setProposalsA([]);
                        setProposalsB([]);
                        setDecision(null);
                        setBrief("");
                        setIsApproved(false);
                      }
                    }}
                    className={`alert-card ${isSelected ? "selected" : ""} ${isCritical ? "critical" : ""}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "8px" }}>
                      <span className="text-[11px] font-mono font-bold text-slate-100">{conj.satA}</span>
                      <span className={`text-[8px] font-mono px-2 py-0.5 rounded uppercase border`} style={{
                        background: isCritical ? "rgba(244,63,94,0.15)" : "rgba(212,196,168,0.15)",
                        color: isCritical ? "var(--accent-red)" : "var(--primary-gold)",
                        borderColor: isCritical ? "rgba(244,63,94,0.3)" : "rgba(212,196,168,0.3)"
                      }}>
                        {conj.risk} RISK
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mb-2">⟷ {conj.satB}</div>
                    
                    <div className="text-xxs font-mono bg-black/40 p-2 rounded border border-slate-900" style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", padding: "6px 10px", borderRadius: "4px", border: "1px solid #111" }}>
                      <span className="text-slate-400">Est. Miss:</span>
                      <span className={isCritical ? "text-rose-400 font-bold" : "text-amber-400 font-bold"}>
                        {conj.miss_km} km
                      </span>
                    </div>

                    <div className="mt-3 text-[9px] font-mono text-slate-500" style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
                      <span>TCA:</span>
                      <span>{new Date(conj.tca).toLocaleTimeString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Center: Globe and Actions */}
        <section className="panel-globe-view">
          <Globe
            orbits={orbits}
            selectedConjunction={selectedConjunction}
            maneuveredOrbit={maneuveredOrbit}
            executor={decision?.executor}
            isManeuverApproved={isApproved}
          />

          <div className="glass-panel relative" style={{ padding: "20px" }}>
            <div className="hud-corner tl"></div>
            <div className="hud-corner tr"></div>
            <div className="hud-corner bl"></div>
            <div className="hud-corner br"></div>

            <div className="threat-control-board">
              <div className="flex flex-col gap-1.5" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span className="mono-label">Active Collision Vector</span>
                <span className="text-sm font-bold text-white font-mono flex items-center gap-2" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem" }}>
                  {selectedConjunction ? (
                    <>
                      <span className="text-rose-400">{selectedConjunction.satA}</span>
                      <span className="text-slate-600">⟷</span>
                      <span className="text-slate-200">{selectedConjunction.satB}</span>
                    </>
                  ) : (
                    <span className="text-slate-600 uppercase">Awaiting Selection</span>
                  )}
                </span>
              </div>
              
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={startNegotiation}
                  disabled={!selectedConjunction || isNegotiating || isApproved}
                  className="btn-premium btn-premium-cyan"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Negotiate Plan</span>
                </button>

                <button
                  onClick={handleApprove}
                  disabled={!decision || isApproved || isNegotiating}
                  className="btn-premium btn-premium-green"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve Burn</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Negotiation logs & Operator Brief */}
        <section className="panel-operators-console">
          
          {/* Top Right: Realtime Negotiation Logs */}
          <div className="glass-panel" style={{ flex: 1, minHeight: "220px", marginBottom: "20px" }}>
            <div className="hud-corner tl"></div>
            <div className="hud-corner tr"></div>
            <div className="hud-corner bl"></div>
            <div className="hud-corner br"></div>

            <div className="flex items-center gap-2 pb-3 border-b border-slate-800/80" style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs uppercase font-mono tracking-widest text-[#d4c4a8] font-bold">Agent Telemetry</h2>
            </div>
            
            <div ref={logContainerRef} className="terminal-console">
              {/* Scanline CRT overlay */}
              <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,_rgba(0,0,0,0.15)_50%),_linear-gradient(90deg,rgba(0,229,255,0.02),rgba(0,0,0,0),rgba(192,132,252,0.02))] bg-[size:100%_4px,_6px_100%] opacity-40" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.15 }}></div>

              {logs.length === 0 ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", textTransform: "uppercase" }}>
                  <span>Awaiting Negotiation Launch</span>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`terminal-line ${log.type}`}>
                    {log.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom Right: Operator Brief Card */}
          <div className={`glass-panel`} style={{
            minHeight: "270px",
            borderLeft: isApproved ? "2px solid var(--accent-green)" : decision ? "2px solid var(--primary-gold)" : "1px solid var(--border-color)",
            background: isApproved ? "rgba(16,185,129,0.02)" : decision ? "rgba(212,196,168,0.02)" : "var(--bg-card)"
          }}>
            <div className="hud-corner tl"></div>
            <div className="hud-corner tr"></div>
            <div className="hud-corner bl"></div>
            <div className="hud-corner br"></div>

            <div className="flex items-center gap-2 pb-3 border-b border-slate-800/80" style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <Server className="w-4 h-4 text-amber-500" />
              <h2 className="text-xs uppercase font-mono tracking-widest text-[#d4c4a8] font-bold">Avoidance Briefing</h2>
            </div>

            <div style={{ flex: 1, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "0.7rem", paddingRight: "4px" }}>
              {!decision ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", padding: "40px 0" }}>
                  <HelpCircle className="w-6 h-6 mb-2 text-slate-700" style={{ marginBottom: "8px" }} />
                  <span className="uppercase tracking-wider">Waiting for burn plan decision</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div className={`p-2.5 rounded border text-center font-bold tracking-wider uppercase`} style={{
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid",
                    textAlign: "center",
                    fontWeight: "bold",
                    textTransform: "uppercase",
                    fontSize: "0.65rem",
                    background: isApproved ? "rgba(16,185,129,0.15)" : "rgba(212,196,168,0.15)",
                    borderColor: isApproved ? "rgba(16,185,129,0.3)" : "rgba(212,196,168,0.3)",
                    color: isApproved ? "var(--accent-green)" : "var(--primary-gold)"
                  }}>
                    {isApproved ? "Burn Authorized & Uploaded" : "Authorization Required"}
                  </div>

                  <div className="bg-slate-950 p-3 rounded border border-slate-900" style={{ background: "rgba(0,0,0,0.4)", padding: "12px", borderRadius: "6px", border: "1px solid #111", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1c1c24", paddingBottom: "4px" }}>
                      <span style={{ color: "var(--text-muted)", textTransform: "uppercase" }}>Threat Vector</span>
                      <span style={{ color: "#fff", fontWeight: "bold" }}>{selectedConjunction.satA.split("-")[0]} / {selectedConjunction.satB.split("-")[0]}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1c1c24", paddingBottom: "4px" }}>
                      <span style={{ color: "var(--text-muted)", textTransform: "uppercase" }}>Time of Arrival</span>
                      <span style={{ color: "#ddd" }}>{new Date(selectedConjunction.tca).toUTCString().slice(17, 25)} UTC</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", paddingTop: "4px" }}>
                      <div>
                        <span style={{ color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.55rem", display: "block" }}>Unmitigated Miss</span>
                        <span style={{ color: "var(--accent-red)", fontWeight: "bold" }}>{selectedConjunction.miss_km} km</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.55rem", display: "block" }}>Negotiated Miss</span>
                        <span style={{ color: "var(--accent-green)", fontWeight: "bold" }}>{decision.final_miss_km} km</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <span style={{ color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.6rem", display: "block", marginBottom: "4px" }}>Target Burn Action</span>
                    <p style={{ color: "#fff", fontWeight: "bold", background: "#050508", padding: "10px", borderRadius: "4px", border: "1px solid #111", lineHeight: "1.4" }}>
                      {decision.executor === "BOTH"
                        ? "Execute coordinated double burn."
                        : `Execute a ${decision.executor === selectedConjunction.satA ? decision.satA_action.direction : decision.satB_action.direction} burn on ${decision.executor}.`}
                    </p>
                  </div>

                  <div>
                    <span style={{ color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.6rem", display: "block", marginBottom: "4px" }}>Decision Justification</span>
                    <p style={{ color: "#aaa", background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "4px", border: "1px solid #111", lineHeight: "1.5" }}>
                      {brief.split("Maneuver Justification:")[1] || brief}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

        </section>

      </main>
    </div>
  );
}
