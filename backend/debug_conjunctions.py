from tle_fetcher import fetch_starlink_tles
from propagator import propagate_satellites
from conjunction_detector import find_conjunctions

try:
    print("1. Fetching TLEs...")
    sats = fetch_starlink_tles(50)
    print(f"Loaded {len(sats)} satellites.")

    print("2. Propagating orbits...")
    orbits = propagate_satellites(sats, hours=48, step_minutes=15)
    print(f"Propagated {len(orbits)} orbits.")

    print("3. Scanning conjunctions...")
    conjs = find_conjunctions(orbits, threshold_km=5.0)
    print(f"Found {len(conjs)} conjunctions.")
    for c in conjs:
        print(c)
except Exception as e:
    import traceback
    traceback.print_exc()
