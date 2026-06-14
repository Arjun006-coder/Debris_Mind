import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ZoomIn, ZoomOut, RotateCw, RefreshCcw } from "lucide-react";

export default function Globe({
  orbits,
  selectedConjunction,
  maneuveredOrbit,
  executor,
  isManeuverApproved
}) {
  const containerRef = useRef(null);
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const groupRef = useRef(null);
  const starParticlesRef = useRef(null);
  const [autoRotate, setAutoRotate] = useState(true);

  // Direct handlers for camera and group view manipulation
  const handleZoomIn = () => {
    if (cameraRef.current) {
      cameraRef.current.position.z = Math.max(5.0, cameraRef.current.position.z - 1.0);
    }
  };

  const handleZoomOut = () => {
    if (cameraRef.current) {
      cameraRef.current.position.z = Math.min(20.0, cameraRef.current.position.z + 1.0);
    }
  };

  const handleReset = () => {
    if (groupRef.current) {
      groupRef.current.rotation.set(0, 0, 0);
    }
    if (cameraRef.current) {
      cameraRef.current.position.z = 10.0;
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Setup Scene, Camera, Renderer
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 520;
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07070f); // Deep space — matches container bg

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 10.0;
    cameraRef.current = camera;

    const currentMount = mountRef.current;
    if (!currentMount) return;
    
    // Clear any previous canvases to guarantee exactly one renderer is ever active
    currentMount.innerHTML = "";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    currentMount.appendChild(renderer.domElement);

    // Note: Stars are handled by the Galaxy backdrop component behind this canvas.
    // Small internal starfield inside the Globe viewport for depth
    const starsGeo = new THREE.BufferGeometry();
    const starsPos = new Float32Array(600 * 3);
    for (let i = 0; i < 600 * 3; i++) starsPos[i] = (Math.random() - 0.5) * 40;
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.35 });
    scene.add(new THREE.Points(starsGeo, starsMat));

    // 3. Earth Setup (EXACTLY 1 SINGLE HOLOGRAM SPHERE)
    const earthRadius = 3.05;
    const scale = earthRadius / 6378.1; // Scale factor from km to three.js units

    // Single Wireframe Earth Globe
    const earthGeo = new THREE.SphereGeometry(earthRadius, 36, 18);
    const earthMat = new THREE.MeshBasicMaterial({
      color: 0xd4c4a8, // Champagne gold
      wireframe: true,
      transparent: true,
      opacity: 0.16 // Holographic cyber-grid earth
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);

    // Group to hold all orbits and satellites for rotation
    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    // Keep track of line meshes to dispose/remove them on updates
    const linesGroup = new THREE.Group();
    group.add(linesGroup);

    // Draw orbits
    const activeSatA = selectedConjunction?.satA;
    const activeSatB = selectedConjunction?.satB;

    Object.entries(orbits).forEach(([name, data]) => {
      const positions = data.positions;
      if (!positions || positions.length === 0) return;

      const points = positions.map(pos => {
        return new THREE.Vector3(pos[0] * scale, pos[1] * scale, pos[2] * scale);
      });

      // Close the loop
      points.push(points[0]);

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      
      // Determine line color
      let color = 0x00e5ff; // Sleek Cyan
      let opacity = 0.25;

      const isA = name === activeSatA;
      const isB = name === activeSatB;

      if (isA || isB) {
        color = 0xf43f5e; // Warning rose red for conjunction
        opacity = 0.95;
      }

      // If maneuver is approved, change executor's orbit to emerald green
      if (isManeuverApproved) {
        if ((isA && executor === activeSatA) || (isB && executor === activeSatB)) {
          color = 0x10b981; // Green
        }
      }

      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity
      });

      const line = new THREE.Line(geometry, material);
      linesGroup.add(line);

      // Add small satellite dot at its current position
      if (positions.length > 0) {
        const p = positions[0];
        const dotGeo = new THREE.SphereGeometry(0.05, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: isA || isB ? 0.95 : 0.6
        });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(p[0] * scale, p[1] * scale, p[2] * scale);
        linesGroup.add(dot);
      }
    });

    // Draw maneuvered orbit if present and NOT yet approved (render as dashed emerald)
    if (maneuveredOrbit && maneuveredOrbit.length > 0 && !isManeuverApproved) {
      const points = maneuveredOrbit.map(pos => {
        return new THREE.Vector3(pos[0] * scale, pos[1] * scale, pos[2] * scale);
      });
      points.push(points[0]);

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({
        color: 0x10b981, // Emerald green
        dashSize: 0.15,
        gapSize: 0.08,
        transparent: true,
        opacity: 0.85
      });

      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      linesGroup.add(line);
    }

    // Draw TCA Conjunction point if selected
    let tcaMesh = null;
    if (selectedConjunction && orbits[activeSatA]) {
      const posA = orbits[activeSatA].positions;
      const posB = orbits[activeSatB]?.positions;
      if (posA && posB && posA.length > 0) {
        let minD = Infinity;
        let idx = 0;
        for (let i = 0; i < Math.min(posA.length, posB.length); i++) {
          const dx = posA[i][0] - posB[i][0];
          const dy = posA[i][1] - posB[i][1];
          const dz = posA[i][2] - posB[i][2];
          const d = dx*dx + dy*dy + dz*dz;
          if (d < minD) {
            minD = d;
            idx = i;
          }
        }
        const tcaPos = posA[idx];
        const tcaGeo = new THREE.SphereGeometry(0.09, 16, 16);
        const tcaMat = new THREE.MeshBasicMaterial({
          color: isManeuverApproved ? 0x10b981 : 0xf43f5e,
          transparent: true,
          opacity: 0.9
        });
        tcaMesh = new THREE.Mesh(tcaGeo, tcaMat);
        tcaMesh.position.set(tcaPos[0] * scale, tcaPos[1] * scale, tcaPos[2] * scale);
        linesGroup.add(tcaMesh);
      }
    }

    // 4. User interaction (Orbit rotation)
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    const handleMouseDown = (e) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      group.rotation.y += deltaX * 0.005;
      group.rotation.x += deltaY * 0.005;
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const domElement = renderer.domElement;
    domElement.addEventListener("mousedown", handleMouseDown);
    domElement.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    // 5. Animation loop
    let reqId;
    let clock = new THREE.Clock();
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      
      // Auto-spin logic checked via React state (autoRotate variable)
      if (!isDragging && autoRotate) {
        group.rotation.y += 0.001;
        earth.rotation.y -= 0.0003;
      }

      // Blinking TCA warning
      if (tcaMesh && !isManeuverApproved) {
        const time = clock.getElapsedTime();
        tcaMesh.scale.setScalar(1.0 + Math.sin(time * 12) * 0.2);
      }

      renderer.render(scene, camera);
    };
    animate();

    // 6. Handle Resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener("resize", handleResize);
      domElement.removeEventListener("mousedown", handleMouseDown);
      domElement.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      
      earthGeo.dispose();
      earthMat.dispose();
      
      if (currentMount && renderer.domElement && renderer.domElement.parentNode === currentMount) {
        currentMount.removeChild(renderer.domElement);
      }
    };
  }, [orbits, selectedConjunction, maneuveredOrbit, executor, isManeuverApproved, autoRotate]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[520px] rounded-xl border border-slate-800/80 overflow-hidden shadow-2xl shadow-black/80"
      style={{ background: "#07070f" }}
    >
      {/* Dedicated mount point for the WebGL canvas to prevent duplicates */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />
      {/* Corner HUD framing */}
      <div className="hud-corner tl"></div>
      <div className="hud-corner tr"></div>
      <div className="hud-corner bl"></div>
      <div className="hud-corner br"></div>

      {/* Title & Metadata HUD overlay */}
      <div style={{ position: "absolute", top: "20px", left: "20px", zIndex: 10, display: "flex", flexDirection: "column", gap: "4px", pointerEvents: "none" }}>
        <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.15em", color: "#d4c4a8", fontWeight: "bold", fontFamily: "monospace" }}>3D Orbital Telemetry Visualizer</span>
        <span style={{ fontSize: "9px", color: "#64748b", fontFamily: "monospace", letterSpacing: "0.05em" }}>ECI Coordinate Frame | Scaled to Earth Radii</span>
      </div>

      {/* On-screen HUD Controls */}
      <div style={{ position: "absolute", top: "20px", right: "20px", zIndex: 10, display: "flex", gap: "8px" }}>
        <button
          onClick={handleZoomIn}
          className="p-2 bg-black/60 border border-slate-800 hover:border-[#d4c4a8] text-slate-400 hover:text-white rounded backdrop-blur transition-all"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2 bg-black/60 border border-slate-800 hover:border-[#d4c4a8] text-slate-400 hover:text-white rounded backdrop-blur transition-all"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          className={`p-2 border rounded backdrop-blur transition-all ${
            autoRotate
              ? "bg-[#d4c4a8]/10 border-[#d4c4a8] text-[#d4c4a8]"
              : "bg-black/60 border-slate-800 text-slate-400 hover:text-white hover:border-[#d4c4a8]"
          }`}
          title="Toggle Auto Rotation"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleReset}
          className="p-2 bg-black/60 border border-slate-800 hover:border-[#d4c4a8] text-slate-400 hover:text-white rounded backdrop-blur transition-all"
          title="Reset Camera View"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Legend overlay */}
      <div style={{ position: "absolute", bottom: "20px", right: "20px", zIndex: 10, display: "flex", gap: "16px", pointerEvents: "none", fontSize: "10px", fontFamily: "monospace", color: "#94a3b8", backgroundColor: "rgba(0,0,0,0.8)", padding: "6px 12px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-1.5" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="w-2 h-2 rounded-full bg-[#00e5ff] inline-block" style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#00e5ff", display: "inline-block" }}></span>
          <span>Starlink Fleet</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="w-2 h-2 rounded-full bg-[#f43f5e] inline-block" style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#f43f5e", display: "inline-block" }}></span>
          <span>Threat Zone</span>
        </div>
        {maneuveredOrbit && (
          <div className="flex items-center gap-1.5 animate-pulse" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="w-2 h-2 rounded-full bg-[#10b981] inline-block" style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981", display: "inline-block" }}></span>
            <span>Avoidance Burn</span>
          </div>
        )}
      </div>
    </div>
  );
}
