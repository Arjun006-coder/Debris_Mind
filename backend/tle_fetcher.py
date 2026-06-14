import requests
from datetime import datetime, timezone, timedelta
import math
from sgp4.api import Satrec, jday

def compute_checksum(line):
    total = 0
    for char in line[:68]:
        if char.isdigit():
            total += int(char)
        elif char == '-':
            total += 1
    return str(total % 10)

def generate_tle_line1(cat_num, designator, epoch_str):
    base = f"1 {cat_num:05d}U {designator:<8s} {epoch_str:<14s}  .00001000  00000-0  99999-4 0  999"
    line_sans = base[:68].ljust(68)
    return line_sans + compute_checksum(line_sans)

def generate_tle_line2(cat_num, inc, raan, ecc, arg_perigee, mean_anomaly, mean_motion, rev_num):
    ecc_str = f"{int(ecc * 1e7):07d}"[:7]
    base = f"2 {cat_num:05d} {inc:8.4f} {raan:8.4f} {ecc_str} {arg_perigee:8.4f} {mean_anomaly:8.4f} {mean_motion:11.8f}{rev_num:5d}"
    line_sans = base[:68].ljust(68)
    return line_sans + compute_checksum(line_sans)

def get_current_epoch_str(dt):
    year_short = dt.strftime("%y")
    start_of_year = datetime(dt.year, 1, 1, tzinfo=timezone.utc)
    delta = dt - start_of_year
    day_fraction = delta.total_seconds() / 86400.0 + 1.0
    return f"{year_short}{day_fraction:012.8f}"[:14]

def generate_fallback_sats():
    sats = []
    now = datetime.now(timezone.utc)
    epoch_str = get_current_epoch_str(now)

    # 1. Generate 47 background satellites in 6 planes
    cat_start = 40001
    for plane in range(6):
        raan = plane * 60.0
        for i in range(8):
            if plane == 0 and i == 0:
                continue
            cat_num = cat_start + plane * 8 + i
            name = f"STARLINK-{cat_num}"
            mean_anomaly = i * 45.0
            inc = 53.05
            ecc = 0.0001
            arg_perigee = 90.0
            mean_motion = 15.06 + (i * 0.0001)
            
            line1 = generate_tle_line1(cat_num, "19074A", epoch_str)
            line2 = generate_tle_line2(cat_num, inc, raan, ecc, arg_perigee, mean_anomaly, mean_motion, 12345)
            sats.append({"name": name, "line1": line1, "line2": line2})

    # 2. Add our 3 custom satellites for conjunction scenarios:
    # STARLINK-1234 (active, catalog 50001)
    # STARLINK-5678 (active, catalog 50002) - target 1.2 km miss at TCA
    # COSMOS 1408 DEB (debris, catalog 50003) - target 2.5 km miss at TCA
    
    sat_a_cat = 50001
    sat_a_inc = 53.05
    sat_a_raan = 120.0
    sat_a_ecc = 0.0001
    sat_a_arg_p = 45.0
    sat_a_mm = 15.06
    
    target_tca_hours = 31.0
    tca_dt = now + timedelta(hours=target_tca_hours)
    jd, fr = jday(tca_dt.year, tca_dt.month, tca_dt.day, tca_dt.hour, tca_dt.minute, tca_dt.second)

    # Find Mean Anomaly of Sat A that puts it at equator crossing (Z = 0) at TCA
    best_ma_a = 0.0
    min_z = float('inf')
    for ma in range(0, 3600):
        ma_val = ma / 10.0
        rec = Satrec.twoline2rv(
            generate_tle_line1(sat_a_cat, '19074A', epoch_str),
            generate_tle_line2(sat_a_cat, sat_a_inc, sat_a_raan, sat_a_ecc, sat_a_arg_p, ma_val, sat_a_mm, 100)
        )
        _, r, _ = rec.sgp4(jd, fr)
        if abs(r[2]) < min_z:
            min_z = abs(r[2])
            best_ma_a = ma_val

    # Place B (1.2 km) and C (2.5 km) at the same node crossing with RAAN offsets
    ma_a = best_ma_a
    ma_b = best_ma_a
    ma_c = best_ma_a
    
    # 0.01 deg RAAN offset gives ~1.2 km
    # 0.021 deg RAAN offset gives ~2.5 km
    raan_a = 120.0
    raan_b = 120.010
    raan_c = 120.021

    line1_a = generate_tle_line1(sat_a_cat, "19074A", epoch_str)
    line2_a = generate_tle_line2(sat_a_cat, sat_a_inc, raan_a, sat_a_ecc, sat_a_arg_p, ma_a, sat_a_mm, 100)
    
    line1_b = generate_tle_line1(50002, "21100D", epoch_str)
    line2_b = generate_tle_line2(50002, sat_a_inc, raan_b, sat_a_ecc, sat_a_arg_p, ma_b, sat_a_mm, 200)

    line1_c = generate_tle_line1(50003, "21100D", epoch_str)
    line2_c = generate_tle_line2(50003, sat_a_inc, raan_c, sat_a_ecc, sat_a_arg_p, ma_c, sat_a_mm, 300)

    sats.append({"name": "STARLINK-1234", "line1": line1_a, "line2": line2_a})
    sats.append({"name": "STARLINK-5678", "line1": line1_b, "line2": line2_b})
    sats.append({"name": "COSMOS 1408 DEB", "line1": line1_c, "line2": line2_c})
    
    return sats

def fetch_starlink_tles(limit=50):
    url = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle"
    try:
        r = requests.get(url, timeout=5)
        if r.status_code == 200 and len(r.text.strip()) > 100:
            lines = r.text.strip().split("\n")
            sats = []
            for i in range(0, min(len(lines) - 2, limit * 3), 3):
                sats.append({
                    "name": lines[i].strip(),
                    "line1": lines[i+1].strip(),
                    "line2": lines[i+2].strip()
                })
            fallback = generate_fallback_sats()
            sats.extend(fallback[-3:])
            return sats[:limit]
    except Exception:
        pass
    
    return generate_fallback_sats()

if __name__ == "__main__":
    sats = fetch_starlink_tles(50)
    print(f"Total satellites loaded/generated: {len(sats)}")
    for s in sats[-3:]:
        print(f"Name: {s['name']}")
