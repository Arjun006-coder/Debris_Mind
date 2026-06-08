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
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";
const WS_BASE = "ws://127.0.0.1:8000";

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
      // Fetch stats
      const statsRes = await fetch(`${API_BASE}/api/stats`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      
      // Fetch background orbits
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
      // Try to load cached scenario from backend
      const res = await fetch(`${API_BASE}/api/demo/${scenarioId}`);
      if (res.ok) {
        const data = await res.json();
        setDemoState(data);
      } else {
        throw new Error("Backend response error");
      }
    } catch (e) {
      // Hardcoded local offline fallback if backend server isn't running
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
    
    // Inject the scenario orbits into the active set
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
          // Auto select first conjunction
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

  // 1. Live Negotiation via WebSockets
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
        
        // Fetch maneuvered path coordinates from backend if available
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
      // Fetch scenario orbits again to verify if we need to load adjusted paths
      if (mode === "live") {
        // Since live coordinate modification requires analytical TLE perturbation:
        // We fetch the scenario data from backend or local calculator
        // For the seeded live conjunction of Starlink-1234, we can retrieve its maneuver path:
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

  // 2. Offline Simulated Replay (High fidelity timers)
  const runSimulatedDemoNegotiation = async () => {
    // Import current demo scenario cache data
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
          
          // Set maneuvered path visualizer
          if (dec.executor === selectedConjunction.satA) {
            setManeuveredOrbit(scenarioData.orbitA_maneuvered);
          } else if (dec.executor === selectedConjunction.satB) {
            setManeuveredOrbit(scenarioData.orbitB_maneuvered);
          } else {
            // Both
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
    // Celebration
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });

    setIsApproved(true);
    
    // Dynamically update dashboard stats
    setStats(prev => ({
      ...prev,
      conjunctions_24h: Math.max(0, prev.conjunctions_24h - 1),
      maneuvers_executed: prev.maneuvers_executed + 1
    }));
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#04060d] text-slate-100">
      {/* Top Navbar */}
      <header className="dashboard-header">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-950/80 rounded-lg border border-indigo-500/30 glow-cyan">
            <Shield className="w-6 h-6 text-[#00e5ff]" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-widest font-display text-white mb-0 leading-none">DEBRISMIND</h1>
            <span className="text-xxs tracking-widest font-mono text-slate-500 uppercase">Autonomous Orbital Traffic Control</span>
          </div>
        </div>

        {/* Mode & Demo Selector */}
        <div className="flex items-center gap-3">
          <div className="flex bg-[#0b0f19] border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setMode("demo")}
              className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${mode === "demo" ? "bg-indigo-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Demo Mode
            </button>
            <button
              onClick={() => setMode("live")}
              className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${mode === "live" ? "bg-indigo-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Live Monitor
            </button>
          </div>

          {mode === "demo" && (
            <select
              value={demoId}
              onChange={(e) => setDemoId(e.target.value)}
              className="bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
            >
              <option value="active_active">Scenario 1: Active vs Active</option>
              <option value="active_debris">Scenario 2: Active vs Debris</option>
              <option value="cooperative_rescue">Scenario 3: Low-Fuel Rescue</option>
            </select>
          )}

          <button
            onClick={() => mode === "live" ? scanLiveConjunctions() : loadDemoData(demoId)}
            className="p-1.5 border border-slate-800 rounded-lg bg-[#0b0f19] hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
            disabled={isScanning || isNegotiating}
            title="Scan / Refresh Telemetry"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </header>

      {/* Main stats layout */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 px-6 pt-6">
        <div className="glass-panel flex items-center gap-4">
          <div className="p-2.5 bg-cyan-950/40 rounded-lg border border-cyan-500/20 text-[#00e5ff]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xs font-mono uppercase text-slate-500 tracking-wider">Monitored Spacecraft</div>
            <div className="text-xl font-bold font-display text-white">{stats.total_monitored}</div>
          </div>
        </div>

        <div className={`glass-panel flex items-center gap-4 border-l-2 ${stats.conjunctions_24h > 0 ? "border-l-red-500" : "border-l-slate-700"}`}>
          <div className={`p-2.5 rounded-lg border text-red-500 ${stats.conjunctions_24h > 0 ? "bg-red-950/40 border-red-500/20 animate-pulse" : "bg-slate-900 border-slate-800"}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xs font-mono uppercase text-slate-500 tracking-wider">Active Conjunctions</div>
            <div className="text-xl font-bold font-display text-red-500">{stats.conjunctions_24h}</div>
          </div>
        </div>

        <div className="glass-panel flex items-center gap-4">
          <div className="p-2.5 bg-emerald-950/40 rounded-lg border border-emerald-500/20 text-[#00e676]">
            <Check className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xs font-mono uppercase text-slate-500 tracking-wider">Maneuvers Executed</div>
            <div className="text-xl font-bold font-display text-emerald-400">{stats.maneuvers_executed}</div>
          </div>
        </div>

        <div className="glass-panel flex items-center gap-4">
          <div className="p-2.5 bg-amber-950/40 rounded-lg border border-amber-500/20 text-amber-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xs font-mono uppercase text-slate-500 tracking-wider">Avg Fuel Footprint Saved</div>
            <div className="text-xl font-bold font-display text-amber-300">{stats.fuel_saved_pct}%</div>
          </div>
        </div>

        <div className="glass-panel col-span-2 md:col-span-1 flex items-center gap-4">
          <div className="p-2.5 bg-indigo-950/40 rounded-lg border border-indigo-500/20 text-indigo-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xs font-mono uppercase text-slate-500 tracking-wider">Collision Risk Index</div>
            <div className="text-xs font-mono text-indigo-300 font-semibold">{stats.collision_prob_index}</div>
          </div>
        </div>
      </div>

      {/* Main Grid content */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6">
        
        {/* Left Column: Conjunctions Alert Feed */}
        <section className="glass-panel flex flex-col h-[580px]">
          <div className="flex items-center justify-between border-bottom pb-3 mb-3 border-slate-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-500 animate-pulse" />
              <h2 className="text-xs uppercase font-display tracking-wider text-slate-200">Alert Feed</h2>
            </div>
            <span className="bg-red-950/40 border border-red-500/30 text-red-400 text-3xs font-mono px-2 py-0.5 rounded-full uppercase">
              {conjunctions.length} Threats
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {conjunctions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <Shield className="w-10 h-10 text-slate-700 mb-2" />
                <span className="text-xs text-slate-500 font-mono">No active threats detected. System secure.</span>
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
                    className={`p-3 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-slate-900 border-[#00e5ff] shadow-neon-cyan"
                        : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-2xs font-mono font-bold text-slate-100">{conj.satA}</span>
                      <span className={`text-3xs font-mono px-1.5 py-0.5 rounded uppercase ${
                        isCritical ? "bg-red-950/60 text-red-400 border border-red-500/20" : "bg-amber-950/60 text-amber-400 border border-amber-500/20"
                      }`}>
                        {conj.risk} RISK
                      </span>
                    </div>
                    <div className="text-xxs text-slate-500 font-mono mb-2">vs {conj.satB}</div>
                    
                    <div className="flex justify-between items-center text-2xs font-mono bg-[#070b13] p-1.5 rounded">
                      <span className="text-slate-400">Miss:</span>
                      <span className={isCritical ? "text-red-400 font-bold" : "text-amber-400 font-bold"}>
                        {conj.miss_km} km
                      </span>
                    </div>

                    <div className="mt-2 text-3xs font-mono text-slate-600 flex justify-between">
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
        <section className="lg:col-span-2 flex flex-col gap-4">
          <Globe
            orbits={orbits}
            selectedConjunction={selectedConjunction}
            maneuveredOrbit={maneuveredOrbit}
            executor={decision?.executor}
            isManeuverApproved={isApproved}
          />

          <div className="glass-panel flex justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xxs font-mono uppercase tracking-wider text-slate-500">Selected Conjunction</span>
              <span className="text-xs font-bold text-white font-mono">
                {selectedConjunction ? `${selectedConjunction.satA} ⟷ ${selectedConjunction.satB}` : "None Selected"}
              </span>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={startNegotiation}
                disabled={!selectedConjunction || isNegotiating || isApproved}
                className="btn-neon flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Initiate Negotiation</span>
              </button>

              <button
                onClick={handleApprove}
                disabled={!decision || isApproved || isNegotiating}
                className="btn-neon btn-neon-green flex items-center gap-2"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve Burn</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Negotiation logs & Operator Brief */}
        <section className="flex flex-col gap-4 h-[580px]">
          
          {/* Top Right: Realtime Negotiation Logs */}
          <div className="glass-panel flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center gap-2 pb-2 mb-2 border-bottom border-slate-800">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs uppercase font-display tracking-wider text-slate-200">Negotiation Log</h2>
            </div>
            
            <div
              ref={logContainerRef}
              className="flex-1 bg-black/95 p-3 rounded-lg border border-slate-900 overflow-y-auto font-mono text-2xs space-y-2 select-text"
            >
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-center px-4">
                  <span>Start a negotiation session to view live agent reasoning telemetry logs.</span>
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
          <div className={`glass-panel min-h-[260px] flex flex-col border-l-2 transition-all ${
            isApproved 
              ? "border-l-emerald-500 shadow-neon-green bg-emerald-950/10" 
              : decision 
                ? "border-l-amber-500 animate-pulse" 
                : "border-l-slate-800"
          }`}>
            <div className="flex items-center gap-2 pb-2 mb-2 border-bottom border-slate-800">
              <Server className="w-4 h-4 text-amber-500" />
              <h2 className="text-xs uppercase font-display tracking-wider text-slate-200">Operator Action Brief</h2>
            </div>

            <div className="flex-1 overflow-y-auto text-xxs font-mono pr-1 space-y-3 select-text">
              {!decision ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center px-4 py-8">
                  <HelpCircle className="w-8 h-8 mb-2 text-slate-700" />
                  <span>Waiting for negotiated collision avoidance proposals.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className={`p-2.5 rounded border font-semibold ${
                    isApproved 
                      ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-400" 
                      : "bg-red-950/40 border-red-500/30 text-red-400"
                  }`}>
                    {isApproved ? "BURN STATE: APPROVED & TRANSMITTED" : "BURN STATE: PENDING OPERATOR APPROVAL"}
                  </div>

                  <div className="bg-slate-900/50 p-2.5 rounded border border-slate-800/80 space-y-2 text-3xs">
                    <div>
                      <span className="text-slate-500 uppercase">Alert:</span>
                      <p className="text-slate-200">{selectedConjunction.satA} vs {selectedConjunction.satB}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase">TCA:</span>
                      <p className="text-slate-300">{new Date(selectedConjunction.tca).toUTCString()}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <span className="text-slate-500 uppercase">Current Miss:</span>
                        <p className="text-red-400 font-bold">{selectedConjunction.miss_km} km</p>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase">Projected Miss:</span>
                        <p className="text-emerald-400 font-bold">{decision.final_miss_km} km</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-500 uppercase text-3xs">Resolution Order:</span>
                    <p className="text-slate-200 font-bold bg-[#0c1020] p-2 rounded border border-slate-800/60 leading-relaxed">
                      {decision.executor === "BOTH"
                        ? "Execute coordinated double burn."
                        : `Execute a ${decision.executor === selectedConjunction.satA ? decision.satA_action.direction : decision.satB_action.direction} burn on ${decision.executor}.`}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-500 uppercase text-3xs">Technical Justification:</span>
                    <p className="text-slate-400 leading-relaxed bg-black/45 p-2.5 rounded text-3xs border border-slate-900">
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
