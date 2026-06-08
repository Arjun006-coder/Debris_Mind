import numpy as np
from itertools import combinations

def find_conjunctions(propagated, threshold_km=5.0):
    """
    Scans all pairs of propagated satellites, finds their closest approach, 
    and returns a list of conjunction events below the given threshold in km.
    """
    names = list(propagated.keys())
    conjunctions = []
    
    # Process pairwise combinations
    for nameA, nameB in combinations(names, 2):
        posA_raw = propagated[nameA]["positions"]
        posB_raw = propagated[nameB]["positions"]
        times = propagated[nameA]["times"]
        
        # Clean out any None values if propagation failed
        valid_indices = [i for i in range(len(posA_raw)) if posA_raw[i] is not None and posB_raw[i] is not None]
        if not valid_indices:
            continue
            
        A = np.array([posA_raw[i] for i in valid_indices])
        B = np.array([posB_raw[i] for i in valid_indices])
        subset_times = [times[i] for i in valid_indices]
        
        # Vectorized Euclidean distance calculation
        diffs = A - B
        distances = np.linalg.norm(diffs, axis=1)
        
        min_idx = int(np.argmin(distances))
        min_dist = float(distances[min_idx])
        
        if min_dist < threshold_km:
            conjunctions.append({
                "satA": nameA,
                "satB": nameB,
                "miss_km": round(min_dist, 3),
                "tca": subset_times[min_idx],
                "risk": "HIGH" if min_dist < 1.0 else "MEDIUM"
            })
            
    # Sort from closest approach to furthest
    return sorted(conjunctions, key=lambda x: x["miss_km"])

if __name__ == "__main__":
    from tle_fetcher import fetch_starlink_tles
    from propagator import propagate_satellites
    
    print("Testing conjunction detector...")
    sats = fetch_starlink_tles(50)
    prop = propagate_satellites(sats, hours=48, step_minutes=10)
    conjs = find_conjunctions(prop, threshold_km=10.0)
    
    print(f"Found {len(conjs)} conjunctions below 10 km.")
    for c in conjs[:3]:
        print(f"Collision risk: {c['satA']} & {c['satB']} | Miss: {c['miss_km']} km | TCA: {c['tca']} | Risk: {c['risk']}")
