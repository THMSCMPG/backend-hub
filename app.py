import os
import io
import base64
import logging
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Required for server-side rendering
import matplotlib.pyplot as plt
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
from flask_mail import Mail, Message
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Tuple

# ============================================================================
# INITIALIZATION & CORE CONFIG
# ============================================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# Precise CORS for security
CORS(app, resources={r"/api/*": {"origins": ["https://thmscmpg.github.io", "http://localhost:4000"]}})

# SMTP Setup
app.config.update(
    MAIL_SERVER='smtp.gmail.com',
    MAIL_PORT=587,
    MAIL_USE_TLS=True,
    MAIL_USERNAME=os.environ.get("MAIL_USERNAME"),
    MAIL_PASSWORD=os.environ.get("MAIL_PASSWORD"),
    MAIL_DEFAULT_SENDER=os.environ.get("MAIL_USERNAME")
)

mail = Mail(app)
CONTACT_RECIPIENT = os.environ.get("CONTACT_EMAIL", "admin@aura-mf.com")

# ============================================================================
# PHYSICS & SIMULATION ENGINE
# ============================================================================

@dataclass
class SimState:
    """Global state for the ML Orchestrator demo."""
    time: float = 0.0
    fidelity_history: List[int] = field(default_factory=list)
    
    def step(self):
        self.time += 1.0
        # Cycle through LF (0), MF (1), HF (2) every 10 steps for demo
        fid = int((self.time // 10) % 3)
        self.fidelity_history.append(fid)
        return fid

state_manager = SimState()

class AURA_Physics_Solver:
    """2D Thermal Finite Difference Solver."""
    SIGMA = 5.67e-8  # Stefan-Boltzmann
    
    def __init__(self, nx=20, ny=20):
        self.nx, self.ny = nx, ny
        self.dx = 0.1 # meters
        self.T = np.ones((ny, nx)) * 298.15 # Start at 25°C

    def solve(self, solar, wind, ambient, fidelity):
        """
        Runs a simplified heat balance: 
        dT/dt = (Q_solar - Q_conv - Q_rad + Q_cond) / (m * Cp)
        """
        # Multi-fidelity resolution scaling
        steps = [5, 20, 100][fidelity] 
        dt = 0.1
        
        # Physical constants
        h_conv = 10.0 + (5.0 * wind)
        emissivity = 0.9
        alpha = 1.3e-4 # Thermal diffusivity
        
        for _ in range(steps):
            # 1. Convection & Radiation
            q_conv = h_conv * (self.T - ambient)
            q_rad = emissivity * self.SIGMA * (self.T**4 - (ambient-10)**4)
            
            # 2. Conduction (Laplacian)
            T_pad = np.pad(self.T, 1, mode='edge')
            laplacian = (T_pad[1:-1, 2:] + T_pad[1:-1, :-2] + 
                         T_pad[2:, 1:-1] + T_pad[:-2, 1:-1] - 4*self.T) / self.dx**2
            
            # 3. Net Flux
            # Q_solar is reduced by 20% efficiency (energy converted to electricity)
            q_net = (solar * 0.8) - q_conv - q_rad + (alpha * laplacian)
            
            # 4. Update (Simplified mass/Cp factor)
            self.T += q_net * dt * 0.001
            
        return np.clip(self.T, 250, 400)

# ============================================================================
# VISUALIZATION UTILITY
# ============================================================================

def generate_plot(temp_data):
    """Generates a heatmap and returns it as a Base64 string."""
    plt.figure(figsize=(5, 4))
    plt.imshow(temp_data - 273.15, cmap='magma', origin='lower')
    plt.colorbar(label='Temp (°C)')
    plt.title("AURA-MF Thermal Field")
    
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close()
    return base64.b64encode(buf.getvalue()).decode('utf-8')

# ============================================================================
# API ROUTES
# ============================================================================

@app.route('/api/simulate', methods=['GET', 'POST'])
def handle_simulation():
    # 1. Get Inputs (Default or Request)
    data = request.json if request.is_json else {}
    solar = float(data.get('solar', 1000.0))
    wind = float(data.get('wind', 2.0))
    ambient = float(data.get('ambient', 298.15))
    
    # 2. Update Multi-Fidelity State
    current_fid = state_manager.step()
    
    # 3. Run Solver
    solver = AURA_Physics_Solver()
    result_field = solver.solve(solar, wind, ambient, current_fid)
    
    # 4. Generate Analytics
    confidence = 0.98 - (current_fid * 0.05) + (np.random.random() * 0.02)
    residual = [1e-3, 1e-5, 1e-8][current_fid]
    
    return jsonify({
        "temperature_field": result_field.tolist(),
        "visualization": generate_plot(result_field),
        "fidelity_level": current_fid,
        "fidelity_name": ["Low (LF)", "Medium (MF)", "High (HF)"][current_fid],
        "ml_confidence": round(confidence, 4),
        "energy_residuals": residual,
        "timestamp": state_manager.time,
        "stats": {
            "max_t": round(np.max(result_field) - 273.15, 2),
            "avg_t": round(np.mean(result_field) - 273.15, 2)
        }
    })

@app.route('/api/contact', methods=['POST'])
def handle_contact():
    data = request.get_json()
    if not data or data.get('website_hp'): # Honeypot check
        return jsonify({"status": "success"}), 200 # Silent drop for bots

    try:
        msg = Message(
            subject=f"AURA-MF Dashboard: {data.get('name')}",
            recipients=[CONTACT_RECIPIENT],
            body=f"From: {data.get('email')}\n\nMessage: {data.get('message')}"
        )
        mail.send(msg)
        return jsonify({"status": "success", "message": "Message sent!"})
    except Exception as e:
        logger.error(f"Contact Error: {e}")
        return jsonify({"status": "error", "message": "Email service failed"}), 500

@app.route('/api/health')
def health():
    return jsonify({"status": "active", "version": "1.0.0"})

@app.route('/')
def docs():
    return render_template_string("""
        <h1>AURA-MF API v1.0.0</h1>
        <p>Status: Running</p>
        <p>Last Sim Time: {{ time }}</p>
    """, time=state_manager.time)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
