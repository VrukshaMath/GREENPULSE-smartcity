"""
EcoNav - Eco-Friendly Navigation & Transit Web App
Backend: Flask (Python)

API Keys needed (set in .env file or environment):
  - OPENWEATHER_API_KEY : https://openweathermap.org/api (free tier, for AQI)
  - ORS_API_KEY         : https://openrouteservice.org/ (free tier, for routing)
  - GROQ_API_KEY        : https://console.groq.com/ (free AI chatbot, no credit card)
"""

import os
import requests
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable cross-origin requests (needed for popup window communication)

# ─────────────────────────────────────────────
# API KEY CONFIGURATION — Fill these in .env
# ─────────────────────────────────────────────
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "YOUR_OPENWEATHER_API_KEY_HERE")
ORS_API_KEY         = os.getenv("ORS_API_KEY",         "YOUR_ORS_API_KEY_HERE")
OPENAI_API_KEY      = os.getenv("OPENAI_API_KEY",      "YOUR_OPENAI_API_KEY_HERE")
GROQ_API_KEY        = "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"
AI_PROVIDER         = "groq"  # using Groq (free, fast, no credit card)

# ─────────────────────────────────────────────
# CARBON FOOTPRINT CONSTANTS (gCO2 per km)
# Source: European Environment Agency averages
# ─────────────────────────────────────────────
CARBON_FACTORS = {
    "walking":       0.0,    # Zero emissions
    "cycling":       0.0,    # Zero emissions
    "e-bike":        5.0,    # Very low (electricity generation)
    "public_transit": 89.0, # Average bus/metro mix
    "ev_car":        53.0,   # Battery electric vehicle (grid average)
    "hybrid_car":    116.0,  # Hybrid vehicle
    "car":           192.0,  # Average petrol/diesel car
    "motorcycle":    113.0,  # Average motorcycle
}

# ─────────────────────────────────────────────
# AQI CATEGORY HELPERS
# ─────────────────────────────────────────────
def get_aqi_category(aqi: int) -> dict:
    """Return label, color, and emoji for a given AQI value (1–5 OpenWeather scale)."""
    categories = {
        1: {"label": "Good",       "color": "#39d353", "emoji": "🟢", "advice": "Excellent for outdoor activity!"},
        2: {"label": "Fair",       "color": "#b6e84e", "emoji": "🟡", "advice": "Generally acceptable for most."},
        3: {"label": "Moderate",   "color": "#f5a623", "emoji": "🟠", "advice": "Sensitive groups should limit outdoor exertion."},
        4: {"label": "Poor",       "color": "#e05c2a", "emoji": "🔴", "advice": "Avoid prolonged outdoor exertion."},
        5: {"label": "Very Poor",  "color": "#8b1a1a", "emoji": "🟣", "advice": "Stay indoors. Use enclosed transport."},
    }
    return categories.get(aqi, {"label": "Unknown", "color": "#888", "emoji": "⚪", "advice": "No data available."})


def suggest_transport(distance_km: float, aqi: int) -> dict:
    """
    Suggest the optimal eco-friendly transport mode based on distance and AQI.
    Returns a dict with mode, icon, reasoning, and carbon_grams_per_km.
    """
    if distance_km < 1.0 and aqi <= 3:
        return {"mode": "walking", "icon": "🚶", "label": "Walk",
                "reason": f"Short distance ({distance_km:.1f} km) and acceptable air quality — walking is perfect!",
                "carbon": CARBON_FACTORS["walking"]}

    if distance_km < 5.0 and aqi <= 2:
        return {"mode": "cycling", "icon": "🚴", "label": "Cycle",
                "reason": f"Great air quality and moderate distance ({distance_km:.1f} km) — ideal for cycling.",
                "carbon": CARBON_FACTORS["cycling"]}

    if distance_km < 8.0 and aqi <= 3:
        return {"mode": "e-bike", "icon": "⚡🚴", "label": "E-Bike",
                "reason": f"Decent range ({distance_km:.1f} km) — an e-bike keeps emissions near zero.",
                "carbon": CARBON_FACTORS["e-bike"]}

    if aqi >= 4 or distance_km > 15.0:
        return {"mode": "public_transit", "icon": "🚇", "label": "Public Transit",
                "reason": f"Poor air quality (AQI {aqi}) or long distance — public transit is the eco choice.",
                "carbon": CARBON_FACTORS["public_transit"]}

    return {"mode": "ev_car", "icon": "🔋🚗", "label": "EV / Carpool",
            "reason": f"Distance ({distance_km:.1f} km) favors an electric vehicle or shared ride.",
            "carbon": CARBON_FACTORS["ev_car"]}


# ─────────────────────────────────────────────
# ROUTES — Pages
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("homepage.html")


@app.route("/navigate")
def navigate():
    return render_template("navigate.html")


@app.route("/air-quality")
def air_quality():
    return render_template("aqi.html")


@app.route("/carbon")
def carbon_popup():
    return render_template("carbon_popup.html")


# ─────────────────────────────────────────────
# ROUTES — AQI API
# ─────────────────────────────────────────────

@app.route("/api/aqi")
def get_aqi():
    """
    Fetch real-time AQI for a given lat/lon from OpenWeatherMap Air Pollution API.
    Query params: ?lat=<float>&lon=<float>
    """
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)

    if lat is None or lon is None:
        return jsonify({"error": "Missing lat/lon parameters"}), 400

    # ── Mock fallback if no API key set ──
    if OPENWEATHER_API_KEY == "YOUR_OPENWEATHER_API_KEY_HERE":
        mock_aqi = 2
        cat = get_aqi_category(mock_aqi)
        return jsonify({
            "aqi": mock_aqi,
            "category": cat["label"],
            "color": cat["color"],
            "emoji": cat["emoji"],
            "advice": cat["advice"],
            "components": {
                "co": 201.94,  "no": 0.01, "no2": 0.77,
                "o3": 68.66, "so2": 0.64, "pm2_5": 0.5,
                "pm10": 0.54, "nh3": 0.12
            },
            "source": "mock"
        })

    try:
        url = "http://api.openweathermap.org/data/2.5/air_pollution"
        resp = requests.get(url, params={"lat": lat, "lon": lon, "appid": OPENWEATHER_API_KEY}, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        aqi_value = data["list"][0]["main"]["aqi"]
        components = data["list"][0]["components"]
        cat = get_aqi_category(aqi_value)
        return jsonify({
            "aqi": aqi_value,
            "category": cat["label"],
            "color": cat["color"],
            "emoji": cat["emoji"],
            "advice": cat["advice"],
            "components": components,
            "source": "openweathermap"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# ROUTES — Routing API (OpenRouteService)
# ─────────────────────────────────────────────

@app.route("/api/route", methods=["POST"])
def get_route():
    """
    Get optimal route between two points.
    Body JSON: { "from": [lon, lat], "to": [lon, lat], "mode": "foot-walking|cycling-regular|driving-car" }
    """
    body = request.json or {}
    origin      = body.get("from")   # [lon, lat]
    destination = body.get("to")     # [lon, lat]
    profile     = body.get("mode", "foot-walking")

    if not origin or not destination:
        return jsonify({"error": "Missing 'from' or 'to'"}), 400

    # ── Mock fallback if no API key set ──
    if ORS_API_KEY == "YOUR_ORS_API_KEY_HERE":
        # Generate a simple straight-line mock route
        import math
        dx = destination[0] - origin[0]
        dy = destination[1] - origin[1]
        # Rough distance in km (Haversine approximation for short distances)
        R = 6371
        lat1, lat2 = math.radians(origin[1]), math.radians(destination[1])
        dlat = math.radians(destination[1] - origin[1])
        dlon = math.radians(destination[0] - origin[0])
        a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
        distance_km = round(R * 2 * math.asin(math.sqrt(a)), 2)
        duration_min = round(distance_km / (5 if "walk" in profile else 15 if "cycl" in profile else 40) * 60)

        # Interpolate a few waypoints for the mock polyline
        steps = 8
        coords = [[
            origin[0] + (destination[0]-origin[0]) * i/(steps-1),
            origin[1] + (destination[1]-origin[1]) * i/(steps-1)
        ] for i in range(steps)]

        return jsonify({
            "coordinates": coords,   # [[lon, lat], ...]
            "distance_km": distance_km,
            "duration_min": duration_min,
            "source": "mock"
        })

    try:
        url = f"https://api.openrouteservice.org/v2/directions/{profile}/geojson"
        headers = {
            "Authorization": ORS_API_KEY,
            "Content-Type": "application/json"
        }
        payload = {"coordinates": [origin, destination]}
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        feature = data["features"][0]
        props = feature["properties"]["summary"]
        coords = feature["geometry"]["coordinates"]  # [[lon, lat], ...]
        return jsonify({
            "coordinates": coords,
            "distance_km": round(props["distance"] / 1000, 2),
            "duration_min": round(props["duration"] / 60),
            "source": "openrouteservice"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# ROUTES — Transport Suggestion
# ─────────────────────────────────────────────

@app.route("/api/suggest", methods=["POST"])
def suggest():
    """
    Suggest the best eco-friendly transport mode.
    Body JSON: { "distance_km": float, "aqi": int }
    """
    body = request.json or {}
    distance_km = float(body.get("distance_km", 5.0))
    aqi = int(body.get("aqi", 1))
    suggestion = suggest_transport(distance_km, aqi)
    return jsonify(suggestion)


# ─────────────────────────────────────────────
# ROUTES — Carbon Footprint Calculation
# ─────────────────────────────────────────────

@app.route("/api/carbon", methods=["POST"])
def calculate_carbon():
    """
    Calculate carbon footprint for a given trip.
    Body JSON: { "mode": str, "distance_km": float }
    Returns: grams and kg of CO2, tree-absorption equivalent, comparison stats.
    """
    body = request.json or {}
    mode        = body.get("mode", "car")
    distance_km = float(body.get("distance_km", 0))

    factor = CARBON_FACTORS.get(mode, CARBON_FACTORS["car"])
    grams  = factor * distance_km
    kg     = round(grams / 1000, 4)

    # A tree absorbs ~21 kg CO2/year ≈ 0.0575 kg/day
    tree_days = round(kg / 0.0575, 1) if kg > 0 else 0

    # Comparison: same trip by car
    car_grams = CARBON_FACTORS["car"] * distance_km
    savings_kg = round((car_grams - grams) / 1000, 4)
    savings_pct = round((1 - factor / CARBON_FACTORS["car"]) * 100, 1) if CARBON_FACTORS["car"] > 0 else 100

    return jsonify({
        "mode": mode,
        "distance_km": distance_km,
        "co2_grams": round(grams, 2),
        "co2_kg": kg,
        "tree_days_to_absorb": tree_days,
        "vs_car_savings_kg": max(0, savings_kg),
        "vs_car_savings_pct": max(0, savings_pct),
        "carbon_factor_g_per_km": factor,
        "all_modes": {k: round(v * distance_km / 1000, 4) for k, v in CARBON_FACTORS.items()}
    })


# ─────────────────────────────────────────────
# ROUTES — AI Chatbot
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """You are EcoNav AI, a friendly and knowledgeable eco-travel assistant embedded in a green navigation app.

You ONLY answer questions about:
1. The user's current trip (route, distance, duration, navigation advice)
2. Eco-friendly travel tips and sustainable transport choices
3. Local air quality, its health implications, and how it affects outdoor activity
4. Carbon footprint of different transport modes
5. Environmental impact of travel choices

If a user asks about anything outside these topics, politely redirect them:
"I'm specialized in eco-travel and air quality — happy to help with anything in that area! 🌿"

Keep responses concise (2–4 sentences), warm, and practical. Use emojis sparingly.
"""

@app.route("/api/chat", methods=["POST"])
def chat():
    """
    AI Chatbot endpoint.
    Body JSON: { "message": str, "history": [...], "context": { "aqi": int, "distance_km": float, "mode": str } }
    """
    body    = request.json or {}
    message = body.get("message", "")
    history = body.get("history", [])  # [{"role": "user"|"assistant", "content": str}, ...]
    context = body.get("context", {})

    if not message:
        return jsonify({"error": "No message provided"}), 400

    # Enrich system prompt with live trip context
    context_note = ""
    if context:
        context_note = f"\n\nCurrent trip context:\n- AQI: {context.get('aqi', 'N/A')}\n- Distance: {context.get('distance_km', 'N/A')} km\n- Transport mode: {context.get('mode', 'N/A')}"

    full_system = SYSTEM_PROMPT + context_note

    # ── OpenAI Provider ──
    if AI_PROVIDER == "openai":
        if OPENAI_API_KEY == "YOUR_OPENAI_API_KEY_HERE":
            return _mock_ai_response(message)
        try:
            import openai
            client = openai.OpenAI(api_key=OPENAI_API_KEY)
            messages = [{"role": "system", "content": full_system}]
            # Add conversation history (last 10 turns for context window efficiency)
            for turn in history[-10:]:
                messages.append({"role": turn["role"], "content": turn["content"]})
            messages.append({"role": "user", "content": message})

            response = client.chat.completions.create(
                model="gpt-4o-mini",   # Cost-effective; swap to gpt-4o for better quality
                messages=messages,
                max_tokens=300,
                temperature=0.7
            )
            reply = response.choices[0].message.content
            return jsonify({"reply": reply, "source": "openai"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Groq Provider ──
    elif AI_PROVIDER == "groq":
        if GROQ_API_KEY == "YOUR_GROQ_API_KEY_HERE":
            return _mock_ai_response(message)
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            messages_list = [{"role": "system", "content": full_system}]
            for turn in history[-10:]:
                messages_list.append({"role": turn["role"], "content": turn["content"]})
            messages_list.append({"role": "user", "content": message})

            resp = requests.post(url, json={
                "model": "llama-3.3-70b-versatile",
                "messages": messages_list,
                "max_tokens": 300,
                "temperature": 0.7
            }, headers=headers, timeout=15)
            resp.raise_for_status()
            reply = resp.json()["choices"][0]["message"]["content"]
            return jsonify({"reply": reply, "source": "groq"})
        except Exception as e:
            print(f"GROQ ERROR: {e}")
            return jsonify({"error": str(e)}), 500

    return jsonify({"error": "Invalid AI_PROVIDER."}), 400


def _mock_ai_response(message: str):
    """Return a helpful mock response when no AI key is set."""
    msg_lower = message.lower()
    if any(w in msg_lower for w in ["aqi", "air", "quality", "pollution"]):
        reply = "🌿 The Air Quality Index (AQI) measures how clean or polluted the air is. Values 1–2 are great for outdoor activity, while 4–5 suggest staying indoors or using enclosed transport."
    elif any(w in msg_lower for w in ["carbon", "co2", "emission", "footprint"]):
        reply = "🌍 Walking and cycling have zero direct emissions! Public transit produces ~89g CO₂/km vs ~192g for an average car. Choosing greener transport makes a real difference."
    elif any(w in msg_lower for w in ["route", "direction", "walk", "cycle", "transport"]):
        reply = "🗺️ For eco-friendly travel: walk or cycle for trips under 5 km, use public transit for medium distances, and consider EVs or carpooling for longer journeys."
    else:
        reply = "👋 Hi! I'm EcoNav AI. Ask me about air quality, carbon footprints, or eco-friendly transport options for your trip!"
    return jsonify({"reply": reply, "source": "mock"})


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("🌿 EcoNav server starting at http://127.0.0.1:5000")
    app.run(debug=True, port=5000)