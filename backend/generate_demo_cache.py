import os
import json
from datetime import datetime, timezone, timedelta
from tle_fetcher import fetch_starlink_tles, generate_tle_line1, generate_tle_line2, get_current_epoch_str
from propagator import propagate_satellites, propagate_maneuvered_orbit
from agents import run_satellite_agent, mediate, generate_brief

def generate_cache():
    print("Generating demo scenarios cache...")
    os.makedirs("demo_cache", exist_ok=True)
    
    now = datetime.now(timezone.utc)
    epoch_str = get_current_epoch_str(now)
    
    # We will generate three distinct scenarios:
    
    # ==========================================
    # SCENARIO 1: STARLINK-1234 vs STARLINK-5678 (Active vs Active)
    # ==========================================
    sat_a_name = "STARLINK-1234"
    sat_b_name = "STARLINK-5678"
    
    # Coordinates parameters for T+31 hours conjunction
    sat_a_cat = 50001
    sat_a_inc = 53.05
    sat_a_raan = 120.0
    sat_a_ecc = 0.0001
    sat_a_arg_p = 45.0
    sat_a_mm = 15.06
    ma_a = 148.3  # places it at Z=0 at T+31
    
    sat_b_cat = 50002
    sat_b_inc = 53.05
    sat_b_raan = 120.010
    sat_b_ecc = 0.0001
    sat_b_arg_p = 45.0
    sat_b_mm = 15.06
    ma_b = 148.3  # same MA, slightly different RAAN -> conjunction!
    
    line1_a = generate_tle_line1(sat_a_cat, "19074A", epoch_str)
    line2_a = generate_tle_line2(sat_a_cat, sat_a_inc, sat_a_raan, sat_a_ecc, sat_a_arg_p, ma_a, sat_a_mm, 100)
    
    line1_b = generate_tle_line1(sat_b_cat, "21100D", epoch_str)
    line2_b = generate_tle_line2(sat_b_cat, sat_b_inc, sat_b_raan, sat_b_ecc, sat_b_arg_p, ma_b, sat_b_mm, 200)
    
    sat_a_meta = {"name": sat_a_name, "line1": line1_a, "line2": line2_a, "fuel_pct": 85.0, "priority": 6}
    sat_b_meta = {"name": sat_b_name, "line1": line1_b, "line2": line2_b, "fuel_pct": 90.0, "priority": 8}
    
    # Propagate orbits over 48 hours (step 5 mins)
    sats_s1 = [sat_a_meta, sat_b_meta]
    orbits_s1 = propagate_satellites(sats_s1, hours=48, step_minutes=5)
    
    tca_time = (now + timedelta(hours=31.0)).isoformat()
    conjs_s1 = {"satA": sat_a_name, "satB": sat_b_name, "miss_km": 1.209, "tca": tca_time, "risk": "HIGH"}
    
    state_a = {"x": orbits_s1[sat_a_name]["positions"][int(31*60/5)][0], "y": orbits_s1[sat_a_name]["positions"][int(31*60/5)][1], "z": orbits_s1[sat_a_name]["positions"][int(31*60/5)][2]}
    state_b = {"x": orbits_s1[sat_b_name]["positions"][int(31*60/5)][0], "y": orbits_s1[sat_b_name]["positions"][int(31*60/5)][1], "z": orbits_s1[sat_b_name]["positions"][int(31*60/5)][2]}
    
    # Run Agent A and Agent B
    proposals_a = run_satellite_agent(sat_a_name, state_a, sat_a_meta["fuel_pct"], sat_a_meta["priority"], conjs_s1)
    proposals_b = run_satellite_agent(sat_b_name, state_b, sat_b_meta["fuel_pct"], sat_b_meta["priority"], conjs_s1)
    
    decision_s1 = mediate(proposals_a, proposals_b, sat_a_name, sat_b_name)
    brief_s1 = generate_brief(conjs_s1, decision_s1, sat_a_name, sat_b_name)
    
    # Calculate maneuvered orbits
    # If A maneuvers:
    # Option chosen for A in local agent: prograde burn of 0.31 m/s
    orbit_a_man = propagate_maneuvered_orbit(sat_a_meta, hours=48, step_minutes=5, burn_time_hours=10, delta_v_ms=0.31, direction="prograde")
    # If B maneuvers:
    # Option chosen for B in local agent: prograde burn of 0.28 m/s
    orbit_b_man = propagate_maneuvered_orbit(sat_b_meta, hours=48, step_minutes=5, burn_time_hours=10, delta_v_ms=0.28, direction="prograde")
    
    scenario_1 = {
        "scenario_id": "active_active",
        "title": "STARLINK-1234 vs STARLINK-5678 (Active/Active)",
        "description": "Two active operational Starlink satellites in intersecting planes negotiate lane priority based on fuel budget and mission priority.",
        "conjunction": conjs_s1,
        "satA": sat_a_meta,
        "satB": sat_b_meta,
        "agentA_proposals": proposals_a,
        "agentB_proposals": proposals_b,
        "decision": decision_s1,
        "brief": brief_s1,
        "orbitA": orbits_s1[sat_a_name]["positions"],
        "orbitB": orbits_s1[sat_b_name]["positions"],
        "orbitA_maneuvered": orbit_a_man,
        "orbitB_maneuvered": orbit_b_man,
        "times": orbits_s1[sat_a_name]["times"]
    }
    
    with open("demo_cache/scenario_1.json", "w") as f:
        json.dump(scenario_1, f, indent=2)
    print("Scenario 1 written.")

    # ==========================================
    # SCENARIO 2: STARLINK-1234 vs COSMOS 1408 DEB (Active vs Debris)
    # ==========================================
    sat_c_name = "COSMOS 1408 DEB"
    sat_c_cat = 50003
    sat_c_inc = 53.05
    sat_c_raan = 120.021
    sat_c_ecc = 0.0001
    sat_c_arg_p = 45.0
    sat_c_mm = 15.06
    ma_c = 148.3
    
    line1_c = generate_tle_line1(sat_c_cat, "21100D", epoch_str)
    line2_c = generate_tle_line2(sat_c_cat, sat_c_inc, sat_c_raan, sat_c_ecc, sat_c_arg_p, ma_c, sat_c_mm, 300)
    
    sat_c_meta = {"name": sat_c_name, "line1": line1_c, "line2": line2_c, "fuel_pct": 0.0, "priority": 0}
    
    sats_s2 = [sat_a_meta, sat_c_meta]
    orbits_s2 = propagate_satellites(sats_s2, hours=48, step_minutes=5)
    
    conjs_s2 = {"satA": sat_a_name, "satB": sat_c_name, "miss_km": 2.539, "tca": tca_time, "risk": "MEDIUM"}
    
    state_c = {"x": orbits_s2[sat_c_name]["positions"][int(31*60/5)][0], "y": orbits_s2[sat_c_name]["positions"][int(31*60/5)][1], "z": orbits_s2[sat_c_name]["positions"][int(31*60/5)][2]}
    
    proposals_a_s2 = run_satellite_agent(sat_a_name, state_a, sat_a_meta["fuel_pct"], sat_a_meta["priority"], conjs_s2)
    proposals_c = run_satellite_agent(sat_c_name, state_c, sat_c_meta["fuel_pct"], sat_c_meta["priority"], conjs_s2)
    
    decision_s2 = mediate(proposals_a_s2, proposals_c, sat_a_name, sat_c_name)
    brief_s2 = generate_brief(conjs_s2, decision_s2, sat_a_name, sat_c_name)
    
    # Calculate maneuvered orbits
    # Since only A can maneuver, C's maneuvered orbit is identical to its original orbit
    orbit_c_man = orbits_s2[sat_c_name]["positions"]
    
    scenario_2 = {
        "scenario_id": "active_debris",
        "title": "STARLINK-1234 vs COSMOS 1408 DEB (Active/Debris)",
        "description": "An active Starlink satellite must perform a unilateral avoidance maneuver because the opposing object is uncontrolled Russian military space debris.",
        "conjunction": conjs_s2,
        "satA": sat_a_meta,
        "satB": sat_c_meta,
        "agentA_proposals": proposals_a_s2,
        "agentB_proposals": proposals_c,
        "decision": decision_s2,
        "brief": brief_s2,
        "orbitA": orbits_s2[sat_a_name]["positions"],
        "orbitB": orbits_s2[sat_c_name]["positions"],
        "orbitA_maneuvered": orbit_a_man,
        "orbitB_maneuvered": orbit_c_man,
        "times": orbits_s2[sat_a_name]["times"]
    }
    
    with open("demo_cache/scenario_2.json", "w") as f:
        json.dump(scenario_2, f, indent=2)
    print("Scenario 2 written.")

    # ==========================================
    # SCENARIO 3: STARLINK-40012 vs STARLINK-40013 (Cooperative Low-Fuel Rescue)
    # ==========================================
    # We will simulate a third scenario where Sat A is extremely low on fuel, so Sat B takes the burn.
    sat_d_name = "STARLINK-40012"
    sat_e_name = "STARLINK-40013"
    
    sat_d_meta = {"name": sat_d_name, "line1": line1_a, "line2": line2_a, "fuel_pct": 12.0, "priority": 7} # Low fuel
    # We place B at a different RAAN offset to create another conjunction
    sat_e_meta = {"name": sat_e_name, "line1": line1_b, "line2": line2_b, "fuel_pct": 95.0, "priority": 5} # High fuel
    
    sats_s3 = [sat_d_meta, sat_e_meta]
    orbits_s3 = propagate_satellites(sats_s3, hours=48, step_minutes=5)
    
    conjs_s3 = {"satA": sat_d_name, "satB": sat_e_name, "miss_km": 0.950, "tca": tca_time, "risk": "CRITICAL"}
    
    # Custom Proposals showing cooperation:
    # Agent D (STARLINK-40012) explains it is low on fuel
    props_d = [
        {
            "delta_v_ms": 0.25,
            "direction": "prograde",
            "new_miss_km": 38.5,
            "fuel_cost_pct": 5.0,
            "justification": "STARLINK-40012 is at 12% critical fuel reserve. Executing a 0.25 m/s burn would reduce our active lifespan by 4 months. Requesting STARLINK-40013 to perform the maneuver if possible."
        },
        {
            "delta_v_ms": 0.38,
            "direction": "retrograde",
            "new_miss_km": 48.2,
            "fuel_cost_pct": 7.6,
            "justification": "STARLINK-40012 is at 12% critical fuel reserve. Executing a 0.38 m/s burn would consume 63% of our remaining maneuver fuel. Requesting assistance."
        },
        {
            "delta_v_ms": 0.0,
            "direction": "none",
            "new_miss_km": 0.0,
            "fuel_cost_pct": 0.0,
            "justification": "Hold position. Preferring cross-satellite mitigation due to low fuel."
        }
    ]
    
    # Agent E (STARLINK-40013) notes its ample fuel (95%) and offers to take the burn
    props_e = [
        {
            "delta_v_ms": 0.28,
            "direction": "prograde",
            "new_miss_km": 41.2,
            "fuel_cost_pct": 3.0,
            "justification": "STARLINK-40013 has 95% fuel reserves. We propose executing a 0.28 m/s prograde burn to assume the avoidance action and protect the fuel-depleted STARLINK-40012."
        },
        {
            "delta_v_ms": 0.42,
            "direction": "retrograde",
            "new_miss_km": 48.6,
            "fuel_cost_pct": 4.5,
            "justification": "STARLINK-40013 has 95% fuel reserves. We propose a 0.42 m/s retrograde burn to resolve the conjunction, absorbing the fuel penalty."
        },
        {
            "delta_v_ms": 0.0,
            "direction": "none",
            "new_miss_km": 0.0,
            "fuel_cost_pct": 0.0,
            "justification": "Hold position."
        }
    ]
    
    # Mediator chooses Agent E's prograde burn option because E has ample fuel, even if A's option is slightly lower delta-V.
    # In mediation logic, we pick the minimum cost.
    # For A: fuel_cost_pct = 5.0% of 12% = huge impact!
    # For E: fuel_cost_pct = 3.0% of 95% = tiny impact.
    # So Mediator selects E's Option 1.
    decision_s3 = {
        "executor": sat_e_name,
        "satA_action": {"delta_v_ms": 0.0, "direction": "none", "new_miss_km": 0.0, "fuel_cost_pct": 0.0, "justification": "Hold position due to low fuel reserve (12%)."},
        "satB_action": props_e[0],
        "final_miss_km": 41.2,
        "total_fuel_pct": 3.0
    }
    
    brief_s3 = """CONJUNCTION ALERT — CRITICAL RISK
Objects: STARLINK-40012 and STARLINK-40013
TCA: """ + tca_time + """
Current Miss Distance: 0.950 km — BELOW SAFE THRESHOLD

Recommended Action: STARLINK-40013 will execute an avoidance maneuver; STARLINK-40012 will hold its current trajectory.
Maneuver Details: STARLINK-40013: prograde burn (0.28 m/s) | Fuel Cost: 3.0% of reserve
New Miss Distance: 41.2 km — SAFE

Maneuver Justification:
STARLINK-40012 is operating on a critical fuel reserve of 12%, making any maneuver highly detrimental to its mission lifespan. STARLINK-40013 has ample fuel reserves (95%) and has agreed to execute a 0.28 m/s prograde burn to assume the entire avoidance penalty, ensuring fleet safety and maximizing collective operational lifetime."""
    
    # Calculate maneuvered orbits
    orbit_d_man = orbits_s3[sat_d_name]["positions"]
    orbit_e_man = propagate_maneuvered_orbit(sat_e_meta, hours=48, step_minutes=5, burn_time_hours=10, delta_v_ms=0.28, direction="prograde")
    
    scenario_3 = {
        "scenario_id": "cooperative_rescue",
        "title": "STARLINK-40012 vs STARLINK-40013 (Cooperative Rescue)",
        "description": "A low-fuel satellite (12% remaining) negotiates with a high-fuel satellite (95% remaining). The high-fuel satellite cooperatively assumes the burn penalty to maximize collective fleet lifespan.",
        "conjunction": conjs_s3,
        "satA": sat_d_meta,
        "satB": sat_e_meta,
        "agentA_proposals": props_d,
        "agentB_proposals": props_e,
        "decision": decision_s3,
        "brief": brief_s3,
        "orbitA": orbits_s3[sat_d_name]["positions"],
        "orbitB": orbits_s3[sat_e_name]["positions"],
        "orbitA_maneuvered": orbit_d_man,
        "orbitB_maneuvered": orbit_e_man,
        "times": orbits_s3[sat_d_name]["times"]
    }
    
    with open("demo_cache/scenario_3.json", "w") as f:
        json.dump(scenario_3, f, indent=2)
    print("Scenario 3 written.")
    print("All scenarios generated successfully.")

if __name__ == "__main__":
    generate_cache()
