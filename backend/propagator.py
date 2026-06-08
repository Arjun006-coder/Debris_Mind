import numpy as np
from sgp4.api import Satrec, jday
from datetime import datetime, timedelta, timezone
import math
from tle_fetcher import compute_checksum, get_current_epoch_str, generate_tle_line1, generate_tle_line2

def propagate_satellites(sat_list, hours=48, step_minutes=5):
    """
    Propagates a list of satellites over a given timeframe.
    Returns positions in ECI coordinates (km) and times.
    """
    now = datetime.now(timezone.utc)
    times = [now + timedelta(minutes=i) for i in range(0, hours * 60, step_minutes)]
    results = {}
    
    for sat in sat_list:
        satrec = Satrec.twoline2rv(sat["line1"], sat["line2"])
        positions = []
        for t in times:
            jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second)
            e, r, v = satrec.sgp4(jd, fr)
            if e == 0:
                positions.append(list(r))
            else:
                positions.append(None)
        
        results[sat["name"]] = {
            "positions": positions,
            "times": [t.isoformat() for t in times],
            "line1": sat["line1"],
            "line2": sat["line2"]
        }
    return results

def apply_maneuver_to_tle(line1, line2, delta_v_ms, direction):
    """
    Modifies the TLE parameters to simulate a velocity change (delta-V).
    A prograde burn increases the semi-major axis, decreasing the mean motion (revs/day).
    A retrograde burn decreases the semi-major axis, increasing the mean motion.
    """
    # Parse existing TLE elements from Line 2
    # Line 2 format: 2 NNNNN Inclination RAAN Eccentricity Arg_Perigee Mean_Anomaly Mean_Motion RevNum
    # Column offsets (0-indexed):
    # Inclination: 8-16
    # RAAN: 17-25
    # Eccentricity: 26-33 (with implied leading decimal point)
    # Arg of Perigee: 34-42
    # Mean Anomaly: 43-51
    # Mean Motion: 52-63
    
    try:
        inc = float(line2[8:16].strip())
        raan = float(line2[17:25].strip())
        ecc = float("0." + line2[26:33].strip())
        arg_p = float(line2[34:42].strip())
        mean_anom = float(line2[43:51].strip())
        mean_motion = float(line2[52:63].strip())
        cat_num = int(line2[2:7].strip())
        rev_num = int(line2[63:68].strip())
    except Exception as e:
        # Fallback to defaults if parsing fails
        print(f"Error parsing TLE for maneuver: {e}")
        return line1, line2

    # Circular orbit velocity at ~550km is v = ~7.58 km/s = 7580 m/s
    # A delta_v_ms of 1.0 m/s is 0.001 km/s.
    # We can approximate the change in mean motion (n) using Kepler's Third Law.
    # da = 2 * a * dv / v
    # dn = -1.5 * n * da / a = -3 * n * dv / v
    v_orbit = 7580.0  # m/s
    dn = -3.0 * mean_motion * (delta_v_ms / v_orbit)

    if direction.lower() == "prograde":
        mean_motion += dn
        ecc += 0.0001  # Add slight eccentricity
    elif direction.lower() == "retrograde":
        mean_motion -= dn
        ecc = max(0.0, ecc - 0.0001)
    elif direction.lower() == "radial_in":
        # Radial burns rotate the orbit slightly (Arg of Perigee changes)
        arg_p = (arg_p + 1.0) % 360.0
    elif direction.lower() == "radial_out":
        arg_p = (arg_p - 1.0) % 360.0
    elif direction.lower() == "normal":
        # Normal burns change inclination
        inc = (inc + 0.05) % 180.0
    elif direction.lower() == "antinormal":
        inc = (inc - 0.05) % 180.0

    # Ensure bounds
    mean_motion = max(0.1, min(20.0, mean_motion))
    ecc = max(0.0, min(0.9, ecc))

    # Generate new TLE lines
    now = datetime.now(timezone.utc)
    epoch_str = get_current_epoch_str(now)
    
    new_line1 = generate_tle_line1(cat_num, "19074A", epoch_str)
    new_line2 = generate_tle_line2(cat_num, inc, raan, ecc, arg_p, mean_anom, mean_motion, rev_num + 1)
    
    return new_line1, new_line2

def propagate_maneuvered_orbit(sat, hours=48, step_minutes=5, burn_time_hours=10, delta_v_ms=0.5, direction="prograde"):
    """
    Propagates a satellite's orbit, applying a maneuver at `burn_time_hours`.
    For times before the burn, the original TLE is used.
    For times after the burn, the adjusted TLE is used.
    """
    now = datetime.now(timezone.utc)
    times = [now + timedelta(minutes=i) for i in range(0, hours * 60, step_minutes)]
    
    satrec_orig = Satrec.twoline2rv(sat["line1"], sat["line2"])
    
    # Calculate the adjusted TLE
    line1_man, line2_man = apply_maneuver_to_tle(sat["line1"], sat["line2"], delta_v_ms, direction)
    satrec_man = Satrec.twoline2rv(line1_man, line2_man)
    
    positions = []
    burn_dt = now + timedelta(hours=burn_time_hours)
    
    for t in times:
        if t < burn_dt:
            jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second)
            e, r, v = satrec_orig.sgp4(jd, fr)
        else:
            jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second)
            e, r, v = satrec_man.sgp4(jd, fr)
            
        if e == 0:
            positions.append(list(r))
        else:
            positions.append(None)
            
    return positions

if __name__ == "__main__":
    from tle_fetcher import fetch_starlink_tles
    sats = fetch_starlink_tles(5)
    print("Testing propagator...")
    res = propagate_satellites(sats[:1], hours=2, step_minutes=30)
    name = list(res.keys())[0]
    print(f"Propagated {name}, number of points: {len(res[name]['positions'])}")
    print(f"Sample ECI position: {res[name]['positions'][0]}")
    
    print("Testing maneuver...")
    pos_man = propagate_maneuvered_orbit(sats[0], hours=2, step_minutes=30, burn_time_hours=0.5, delta_v_ms=50.0, direction="prograde")
    print(f"Original position at index 3: {res[name]['positions'][3]}")
    print(f"Maneuvered position at index 3: {pos_man[3]}")
    diff = math.sqrt(sum((x-y)**2 for x, y in zip(res[name]['positions'][3], pos_man[3])))
    print(f"Difference after 1.5 hours: {diff:.3f} km")
