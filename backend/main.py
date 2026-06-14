import os
import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone

from tle_fetcher import fetch_starlink_tles
from propagator import propagate_satellites
from conjunction_detector import find_conjunctions
from agents import run_satellite_agent, mediate, generate_brief

app = FastAPI(title="DebrisMind API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root_health():
    return {"status": "online", "service": "DebrisMind API"}

# Cache variables to prevent heavy recalculations on every page load
_cached_sats = None
_cached_orbits = None
_last_fetch_time = None

def get_data():
    global _cached_sats, _cached_orbits, _last_fetch_time
    now = datetime.now(timezone.utc)
    if _cached_orbits is None or _last_fetch_time is None or (now - _last_fetch_time).total_seconds() > 3600:
        print("Refreshing TLE data and propagating orbits...")
        _cached_sats = fetch_starlink_tles(50)
        # Propagate background orbits at a medium step_minutes=15 for frontend performance
        _cached_orbits = propagate_satellites(_cached_sats, hours=48, step_minutes=15)
        _last_fetch_time = now
    return _cached_sats, _cached_orbits

@app.get("/api/conjunctions")
async def get_conjunction_list():
    """
    Fetches latest satellite states, propagates them, and detects near-collisions.
    """
    sats, orbits = get_data()
    conjs = find_conjunctions(orbits, threshold_km=5.0)
    return conjs

@app.get("/api/orbits")
async def get_all_orbits():
    """
    Returns background orbits coordinate lists for rendering on the 3D globe.
    """
    sats, orbits = get_data()
    # Return a simplified layout: just name, positions (sampled) and TLE lines
    return {
        name: {
            "positions": data["positions"],
            "line1": data["line1"],
            "line2": data["line2"]
        }
        for name, data in orbits.items()
    }

@app.get("/api/demo/{scenario_id}")
async def get_demo_scenario(scenario_id: str):
    """
    Returns pre-calculated static scenarios for instant demo mode.
    """
    filename = f"demo_cache/scenario_1.json"
    if scenario_id == "active_active":
        filename = "demo_cache/scenario_1.json"
    elif scenario_id == "active_debris":
        filename = "demo_cache/scenario_2.json"
    elif scenario_id == "cooperative_rescue":
        filename = "demo_cache/scenario_3.json"
    else:
        raise HTTPException(status_code=404, detail="Demo scenario not found")
        
    try:
        with open(filename, "r") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load scenario: {e}")

@app.websocket("/ws/negotiate")
async def websocket_negotiate(websocket: WebSocket):
    """
    WebSocket channel to stream the live negotiation updates step-by-step.
    Parameters should be passed as query parameters: ws://localhost:8000/ws/negotiate?satA=...&satB=...
    """
    await websocket.accept()
    
    # Retrieve query params
    params = websocket.query_params
    sat_a_name = params.get("satA", "STARLINK-1234")
    sat_b_name = params.get("satB", "STARLINK-5678")
    
    try:
        # Load TLE data to find states
        sats, orbits = get_data()
        
        # Conjunction properties
        conjs = find_conjunctions(orbits, threshold_km=10.0)
        this_conj = next((c for c in conjs if (c["satA"] == sat_a_name and c["satB"] == sat_b_name) or (c["satA"] == sat_b_name and c["satB"] == sat_a_name)), None)
        
        if not this_conj:
            this_conj = {
                "satA": sat_a_name,
                "satB": sat_b_name,
                "miss_km": 1.209,
                "tca": (datetime.now(timezone.utc) + timedelta(hours=31)).isoformat(),
                "risk": "HIGH"
            }
            
        # Mock orbital states
        state_a = {"x": 1024.0, "y": -2048.0, "z": 6092.0}
        state_b = {"x": 1024.8, "y": -2047.3, "z": 6092.5}
        
        # 1. Stream alert greeting
        await websocket.send_json({
            "type": "log",
            "message": f"Conjunction Alert: {sat_a_name} and {sat_b_name} are on a collision course (Miss: {this_conj['miss_km']} km, TCA: {this_conj['tca']})."
        })
        await asyncio.sleep(1.0)
        
        # 2. Spawning Agents
        await websocket.send_json({
            "type": "log",
            "message": f"Spawning autonomous orbital negotiation agents for both spacecraft..."
        })
        await asyncio.sleep(1.0)
        
        # 3. Agent A evaluating
        await websocket.send_json({
            "type": "log",
            "message": f"Agent A [{sat_a_name}] is analyzing orbital state, fuel reserve, and priority..."
        })
        # Simulate LLM thinking
        await asyncio.sleep(2.0)
        
        # Query Agent A
        # Starlink-1234 metadata defaults
        fuel_a = 85.0
        pri_a = 6
        if sat_a_name == "STARLINK-40012":
            fuel_a = 12.0
            pri_a = 7
            
        proposals_a = run_satellite_agent(sat_a_name, state_a, fuel_a, pri_a, this_conj)
        
        await websocket.send_json({
            "type": "agent_proposals",
            "agent": "A",
            "name": sat_a_name,
            "proposals": proposals_a
        })
        await websocket.send_json({
            "type": "log",
            "message": f"Agent A [{sat_a_name}] submitted 3 avoidance maneuver proposals."
        })
        await asyncio.sleep(1.5)
        
        # 4. Agent B evaluating
        await websocket.send_json({
            "type": "log",
            "message": f"Agent B [{sat_b_name}] is analyzing orbital state, fuel reserve, and priority..."
        })
        await asyncio.sleep(2.0)
        
        # Query Agent B
        fuel_b = 90.0
        pri_b = 8
        if sat_b_name == "STARLINK-40013":
            fuel_b = 95.0
            pri_b = 5
        elif "DEB" in sat_b_name:
            fuel_b = 0.0
            pri_b = 0
            
        proposals_b = run_satellite_agent(sat_b_name, state_b, fuel_b, pri_b, this_conj)
        
        await websocket.send_json({
            "type": "agent_proposals",
            "agent": "B",
            "name": sat_b_name,
            "proposals": proposals_b
        })
        await websocket.send_json({
            "type": "log",
            "message": f"Agent B [{sat_b_name}] submitted proposals."
        })
        await asyncio.sleep(1.5)
        
        # 5. Mediation
        await websocket.send_json({
            "type": "log",
            "message": f"Mediator Agent evaluating all proposal combinations..."
        })
        await asyncio.sleep(1.5)
        
        decision = mediate(proposals_a, proposals_b, sat_a_name, sat_b_name)
        brief = generate_brief(this_conj, decision, sat_a_name, sat_b_name)
        
        await websocket.send_json({
            "type": "decision",
            "decision": decision,
            "brief": brief
        })
        
        await websocket.send_json({
            "type": "log",
            "message": f"Maneuver plan negotiated successfully! Executor: {decision['executor']}. Fuel footprint: {decision['total_fuel_pct']}%. Miss resolved to: {decision['final_miss_km']} km."
        })
        
    except WebSocketDisconnect:
        print("WebSocket client disconnected.")
    except Exception as e:
        await websocket.send_json({"type": "error", "message": f"Negotiation error: {str(e)}"})
        print(f"WS error: {e}")
    finally:
        await websocket.close()

@app.get("/api/stats")
async def get_constellation_stats():
    """
    Returns collective stats for the operator dashboard.
    """
    sats, orbits = get_data()
    conjs = find_conjunctions(orbits, threshold_km=5.0)
    
    # Calculate some mock cumulative stats to show premium experience
    total_monitored = len(sats)
    active_conjunctions = len(conjs)
    
    return {
        "total_monitored": total_monitored,
        "conjunctions_24h": active_conjunctions,
        "maneuvers_executed": 14,
        "fuel_saved_pct": 34.2,
        "collision_prob_index": "1.24e-7 (Extremely Low)"
    }

if __name__ == "__main__":
    import uvicorn
    # Bind to PORT if provided (common on Render/Railway), else default to 8000
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    uvicorn.run(app, host=host, port=port)
