import json
import os

def generate():
    print("Compiling JSON cache to JavaScript module...")
    scenarios = {}
    
    for i, name in [(1, "active_active"), (2, "active_debris"), (3, "cooperative_rescue")]:
        path = f"demo_cache/scenario_{i}.json"
        if not os.path.exists(path):
            print(f"Error: {path} not found. Run generate_demo_cache.py first.")
            return
            
        with open(path, "r") as f:
            scenarios[name] = json.load(f)
            
    out_path = "../frontend/src/fallback_scenarios.js"
    with open(out_path, "w") as f:
        f.write("// Self-contained offline data fallback for DebrisMind\n")
        f.write("export const fallbackScenarios = " + json.dumps(scenarios, indent=2) + ";\n")
        
    print(f"Successfully compiled cache to {out_path}")

if __name__ == "__main__":
    generate()
