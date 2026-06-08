import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Globe({
  orbits,
  selectedConjunction,
  maneuveredOrbit,
  executor,
  isManeuverApproved
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Setup Scene, Camera, Renderer
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 450;
    
    const scene = new THREE.Scene();
    // Dark Space Background
    scene.background = new THREE.Color(0x060814);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 10.0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    // 2. Earth Setup
    const earthRadius = 3.05;
    const scale = earthRadius / 6378.1; // Scale factor from km to three.js units

    // Inner Solid Earth
    const earthGeo = new THREE.SphereGeometry(earthRadius, 64, 64);
    const earthMat = new THREE.MeshBasicMaterial({
      color: 0x090d22,
      transparent: true,
      opacity: 0.9
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);

    // Outer Cyber Grid
    const gridGeo = new THREE.SphereGeometry(earthRadius + 0.01, 32, 32);
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x1d4ed8,
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    const grid = new THREE.Mesh(gridGeo, gridMat);
    scene.add(grid);

    // Equator ring
    const equatorGeo = new THREE.RingGeometry(earthRadius + 0.02, earthRadius + 0.04, 64);
    const equatorMat = new THREE.MeshBasicMaterial({
      color: 0x1e293b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4
    });
    const equator = new THREE.Mesh(equatorGeo, equatorMat);
    equator.rotation.x = Math.PI / 2;
    scene.add(equator);

    // Glow effect helper
    const glowGeo = new THREE.SphereGeometry(earthRadius + 0.15, 32, 32);
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
          gl_FragColor = vec4(0.0, 0.45, 1.0, 0.3) * intensity;
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glow);

    // Group to hold all orbits and satellites for rotation
    const group = new THREE.Group();
    scene.add(group);

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
      let color = 0x06b6d4; // Default starlink cyan
      let opacity = 0.25;
      let linewidth = 1.0;

      const isA = name === activeSatA;
      const isB = name === activeSatB;

      if (isA || isB) {
        color = 0xff1744; // Warning red for conjunction satellites
        opacity = 0.9;
        linewidth = 2.0;
      }

      // If maneuver is approved, change executor's orbit to green
      if (isManeuverApproved) {
        if ((isA && executor === activeSatA) || (isB && executor === activeSatB)) {
          color = 0x00e676; // Green
        }
      }

      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity
      });

      const line = new THREE.Line(geometry, material);
      linesGroup.add(line);

      // Add small satellite dot at its current position (first point in array)
      if (positions.length > 0) {
        const p = positions[0];
        const dotGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: isA || isB ? 0.9 : 0.6
        });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(p[0] * scale, p[1] * scale, p[2] * scale);
        linesGroup.add(dot);
      }
    });

    // Draw maneuvered orbit if present and NOT yet approved (render as dashed green)
    // If approved, we already colored the main line green!
    if (maneuveredOrbit && maneuveredOrbit.length > 0 && !isManeuverApproved) {
      const points = maneuveredOrbit.map(pos => {
        return new THREE.Vector3(pos[0] * scale, pos[1] * scale, pos[2] * scale);
      });
      points.push(points[0]);

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({
        color: 0x00e676, // Green
        dashSize: 0.1,
        gapSize: 0.05,
        transparent: true,
        opacity: 0.8
      });

      const line = new THREE.Line(geometry, material);
      line.computeLineDistances(); // Needed for dashed lines
      linesGroup.add(line);
    }

    // Draw TCA Conjunction point if selected
    let tcaMesh = null;
    if (selectedConjunction && orbits[activeSatA]) {
      // Approximate TCA point (we'll just use the point on Orbit A that is closest to Orbit B)
      const posA = orbits[activeSatA].positions;
      const posB = orbits[activeSatB]?.positions;
      if (posA && posB && posA.length > 0) {
        // Find closest point index
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
        const tcaGeo = new THREE.SphereGeometry(0.08, 16, 16);
        const tcaMat = new THREE.MeshBasicMaterial({
          color: isManeuverApproved ? 0x00e676 : 0xff1744,
          transparent: true,
          opacity: 0.8
        });
        tcaMesh = new THREE.Mesh(tcaGeo, tcaMat);
        tcaMesh.position.set(tcaPos[0] * scale, tcaPos[1] * scale, tcaPos[2] * scale);
        linesGroup.add(tcaMesh);
      }
    }

    // 3. User interaction (Orbit rotation)
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

    // 4. Animation loop
    let reqId;
    let clock = new THREE.Clock();
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      
      // Rotate Earth slowly if not dragging
      if (!isDragging) {
        group.rotation.y += 0.001;
        grid.rotation.y -= 0.0005;
      }

      // Blinking TCA warning
      if (tcaMesh && !isManeuverApproved) {
        const time = clock.getElapsedTime();
        tcaMesh.scale.setScalar(1.0 + Math.sin(time * 10) * 0.25);
      }

      renderer.render(scene, camera);
    };
    animate();

    // 5. Handle Resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight || 450;
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
      
      // Dispose resources
      earthGeo.dispose();
      earthMat.dispose();
      gridGeo.dispose();
      gridMat.dispose();
      equatorGeo.dispose();
      equatorMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [orbits, selectedConjunction, maneuveredOrbit, executor, isManeuverApproved]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[450px] bg-[#060814] rounded-xl border border-slate-800 overflow-hidden shadow-2xl shadow-indigo-950/20"
    >
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1 pointer-events-none">
        <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">3D Orbit Visualizer</span>
        <span className="text-xxs text-slate-500 font-mono">ECI Coordinates scaled to Earth Radii</span>
      </div>
      <div className="absolute bottom-4 right-4 z-10 flex gap-4 pointer-events-none text-xxs font-mono text-slate-400 bg-slate-950/80 px-3 py-1.5 rounded border border-slate-800 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4] inline-block"></span>
          <span>Starlink</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff1744] inline-block"></span>
          <span>In Conjunction</span>
        </div>
        {maneuveredOrbit && (
          <div className="flex items-center gap-1.5 animate-pulse">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00e676] inline-block"></span>
            <span>Maneuver Path</span>
          </div>
        )}
      </div>
    </div>
  );
}
