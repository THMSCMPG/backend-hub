/**
 * AURA-MF Dashboard - Frontend JavaScript
 * ========================================
 * 
 * Purpose: Fetch real-time simulation data from Render API
 *          and update dashboard visualizations
 * 
 * Features:
 *   - Automatic data fetching every 5 seconds
 *   - Temperature heatmap visualization
 *   - Fidelity level display with color coding
 *   - Energy balance monitoring
 *   - ML confidence tracking
 *   - Error handling and reconnection logic
 * 
 * Version: 1.3.0 (Production-Ready)
 * Fixed: Temperature unit handling, heatmap rendering, ID synchronization
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = window.DASHBOARD_CONFIG || {
    API_BASE_URL: 'https://aura-mf-backend.onrender.com',
    TIMEOUT: 30000,          // Extended for cold starts
    FETCH_INTERVAL: 5000,    // 5 seconds for live updates
    LIVE_UPDATE_ENABLED: false,
    
    // Dashboard Element IDs - SYNCHRONIZED WITH HTML
    ELEMENTS: {
        temperatureCanvas: 'temperatureHeatmap',
        runButton: 'run-button',
        loading: 'loading',
        results: 'results-container',
        fidelityDisplay: 'fidelityLevel',
        energyResiduals: 'energyResiduals',
        mlConfidence: 'mlConfidence',
        simulationTime: 'simulationTime',
        statusIndicator: 'statusIndicator',
        minTemp: 'minTemp',
        maxTemp: 'maxTemp',
        avgTemp: 'avgTemp',
        fidelityHistory: 'fidelityHistory'
    },
    
    // Visualization Settings
    HEATMAP: {
        colorScheme: 'turbo',  // 'turbo' or 'thermal'
        showGrid: false,
        showValues: false
    }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

class DashboardState {
    constructor() {
        this.isConnected = false;
        this.fetchCount = 0;
        this.errorCount = 0;
        this.lastUpdate = null;
        this.currentData = null;
        this.fidelityHistory = [];
    }
    
    recordSuccess(data) {
        this.isConnected = true;
        this.errorCount = 0;
        this.lastUpdate = new Date();
        this.currentData = data;
        this.fetchCount++;
        
        // Track fidelity changes
        if (this.fidelityHistory.length === 0 || 
            this.fidelityHistory[this.fidelityHistory.length - 1] !== data.fidelity_level) {
            this.fidelityHistory.push(data.fidelity_level);
            if (this.fidelityHistory.length > 50) {
                this.fidelityHistory.shift();
            }
        }
    }
    
    recordError() {
        this.isConnected = false;
        this.errorCount++;
    }
}

const dashboardState = new DashboardState();

// ============================================================================
// SLIDER INITIALIZATION
// ============================================================================

const sliderConfigs = [
    {id: 'solar-irradiance', display: 'solar-value', format: v => v},
    {id: 'ambient-temperature', display: 'temp-value', format: v => (v - 273.15).toFixed(1)},
    {id: 'wind-speed', display: 'wind-value', format: v => parseFloat(v).toFixed(1)},
    {id: 'cell-efficiency', display: 'efficiency-value', format: v => (v * 100).toFixed(0)},
    {id: 'thermal-conductivity', display: 'conductivity-value', format: v => v},
    {id: 'absorptivity', display: 'absorptivity-value', format: v => parseFloat(v).toFixed(2)},
    {id: 'emissivity', display: 'emissivity-value', format: v => parseFloat(v).toFixed(2)}
];

// Initialize sliders when the page loads
window.addEventListener('DOMContentLoaded', () => {
    sliderConfigs.forEach(s => {
        const el = document.getElementById(s.id);
        const disp = document.getElementById(s.display);
        if (el && disp) {
            el.addEventListener('input', () => disp.textContent = s.format(el.value));
            // Set initial values
            disp.textContent = s.format(el.value);
        }
    });
});

// ============================================================================
// LIVE UPDATE TOGGLE
// ============================================================================

window.toggleLiveUpdates = function(isEnabled) {
    CONFIG.LIVE_UPDATE_ENABLED = isEnabled;
    
    if (isEnabled) {
        console.log("▶️ Live Mode Active");
        updateLoop(); 
    } else {
        console.log("⏹️ Live Mode Paused");
    }
};

// ============================================================================
// API COMMUNICATION
// ============================================================================

/**
 * Main simulation function - called by button click or live updates
 */
window.runSimulation = async function() {
    const runBtn = document.getElementById(CONFIG.ELEMENTS.runButton);
    const loading = document.getElementById(CONFIG.ELEMENTS.loading);
    const results = document.getElementById(CONFIG.ELEMENTS.results);
    const errorEl = document.getElementById('error-message');
    
    // 1. Reset UI State
    if (runBtn) runBtn.disabled = true;
    if (loading) loading.classList.add('active');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.remove('active');
    }

    try {
        // 2. Collect Parameters
        // CRITICAL FIX: Slider value is ALREADY in Kelvin (280-330 range)
        // Do NOT add 273.15!
        const params = {
            solar: parseFloat(document.getElementById('solar-irradiance')?.value || 1000),
            ambient: parseFloat(document.getElementById('ambient-temperature')?.value || 298.15), // Already Kelvin
            wind: parseFloat(document.getElementById('wind-speed')?.value || 2.0),
            cell_efficiency: parseFloat(document.getElementById('cell-efficiency')?.value || 0.20),
            thermal_conductivity: parseFloat(document.getElementById('thermal-conductivity')?.value || 130),
            absorptivity: parseFloat(document.getElementById('absorptivity')?.value || 0.95),
            emissivity: parseFloat(document.getElementById('emissivity')?.value || 0.90)
        };

        console.log('📤 Sending parameters:', params);

        // 3. API Request with extended timeout for cold starts
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

        const response = await fetch(`${CONFIG.API_BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error ${response.status}`);
        }

        const data = await response.json();
        console.log('📥 Received data:', data);
        
        // 4. Update State and UI
        dashboardState.recordSuccess(data);
        if (results) results.style.display = 'block';
        updateDashboard(data);
        updateStatusIndicator(true);

    } catch (error) {
        console.error('❌ Simulation Error:', error);
        
        // Enhanced error messages
        let errorMessage = error.message;
        if (error.name === 'AbortError') {
            errorMessage = 'Backend is waking up (cold start). Please try again in 10 seconds.';
        } else if (errorMessage.includes('Failed to fetch')) {
            errorMessage = 'Cannot connect to backend. Check if https://aura-mf-backend.onrender.com is online.';
        }
        
        if (errorEl) {
            errorEl.textContent = `❌ ${errorMessage}`;
            errorEl.classList.add('active');
        }
        
        dashboardState.recordError();
        updateStatusIndicator(false);
        
    } finally {
        // 5. Restore UI
        if (runBtn) runBtn.disabled = false;
        if (loading) loading.classList.remove('active');
    }
};

// ============================================================================
// VISUALIZATION - HEATMAP
// ============================================================================

/**
 * Turbo colormap - perceptually uniform, blue to red
 */
function getTurboColor(normalized) {
    // Clamp to [0, 1]
    const t = Math.max(0, Math.min(1, normalized));
    
    // Turbo-inspired HSL gradient
    const hue = (1 - t) * 240;  // 240 (blue) → 0 (red)
    const saturation = 70 + t * 20;  // 70% → 90%
    const lightness = 45 + t * 10;   // 45% → 55%
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Thermal colormap - blue → cyan → yellow → red
 */
function getThermalColor(normalized) {
    const t = Math.max(0, Math.min(1, normalized));
    
    if (t < 0.25) {
        // Blue to Cyan
        const local = t * 4;
        return `rgb(0, ${Math.round(local * 255)}, 255)`;
    } else if (t < 0.5) {
        // Cyan to Green
        const local = (t - 0.25) * 4;
        return `rgb(0, 255, ${Math.round((1 - local) * 255)})`;
    } else if (t < 0.75) {
        // Green to Yellow
        const local = (t - 0.5) * 4;
        return `rgb(${Math.round(local * 255)}, 255, 0)`;
    } else {
        // Yellow to Red
        const local = (t - 0.75) * 4;
        return `rgb(255, ${Math.round((1 - local) * 255)}, 0)`;
    }
}

/**
 * CRITICAL FIX: Proper heatmap rendering with correct temperature handling
 */
function drawTemperatureHeatmap(canvasId, temperatureField) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn('Canvas element not found:', canvasId);
        return;
    }
    
    if (!temperatureField || !temperatureField.length) {
        console.warn('Temperature field data is invalid or empty');
        return;
    }

    const ctx = canvas.getContext('2d');
    const rows = temperatureField.length;
    const cols = temperatureField[0].length;

    // Canvas/Cell scaling
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    // 1. Find Min/Max in the temperature field (Kelvin)
    let minK = Infinity;
    let maxK = -Infinity;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const val = temperatureField[r][c];
            if (val < minK) minK = val;
            if (val > maxK) maxK = val;
        }
    }

    // Convert to Celsius for display
    const minC = minK - 273.15;
    const maxC = maxK - 273.15;
    const range = maxC - minC || 1;  // Avoid division by zero

    // 2. Rendering Loop
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const tempK = temperatureField[row][col];
            const tempC = tempK - 273.15;
            
            // Normalize to [0, 1]
            const normalized = (tempC - minC) / range;
            
            // Get color based on scheme
            if (CONFIG.HEATMAP.colorScheme === 'thermal') {
                ctx.fillStyle = getThermalColor(normalized);
            } else {
                ctx.fillStyle = getTurboColor(normalized);
            }
            
            // Draw the cell with slight overlap to avoid gaps
            ctx.fillRect(
                Math.floor(col * cellWidth), 
                Math.floor(row * cellHeight), 
                Math.ceil(cellWidth + 1), 
                Math.ceil(cellHeight + 1)
            );
        }
    }

    // 3. Update Legend Labels
    updateHeatmapLegend(minC, maxC);
}

// ============================================================================
// UI UPDATES
// ============================================================================

/**
 * Update fidelity display with color coding
 */
function updateFidelityDisplay(fidelityLevel, fidelityName) {
    const element = document.getElementById(CONFIG.ELEMENTS.fidelityDisplay);
    if (!element) return;
    
    const colors = ['#4CAF50', '#FF9800', '#F44336'];  // LF=Green, MF=Orange, HF=Red
    const icons = ['⚡', '⚙️', '🔥'];
    
    element.textContent = `${icons[fidelityLevel]} ${fidelityName}`;
    element.style.color = colors[fidelityLevel];
}

/**
 * Update energy residuals display
 */
function updateEnergyResiduals(residuals) {
    const element = document.getElementById(CONFIG.ELEMENTS.energyResiduals);
    if (!element) return;
    
    element.textContent = residuals.toExponential(2);
    
    // Color code based on magnitude
    if (residuals < 1e-4) {
        element.style.color = '#4CAF50';  // Good (green)
    } else if (residuals < 1e-2) {
        element.style.color = '#FF9800';  // Moderate (orange)
    } else {
        element.style.color = '#F44336';  // Poor (red)
    }
}

/**
 * Update ML confidence display
 */
function updateMLConfidence(confidence) {
    const element = document.getElementById(CONFIG.ELEMENTS.mlConfidence);
    if (!element) return;
    
    const percentage = (confidence * 100).toFixed(1);
    element.textContent = `${percentage}%`;
    
    // Color code
    if (confidence > 0.9) {
        element.style.color = '#4CAF50';  // High confidence (green)
    } else if (confidence > 0.8) {
        element.style.color = '#FF9800';  // Moderate (orange)
    } else {
        element.style.color = '#F44336';  // Low (red)
    }
}

/**
 * Update temperature statistics
 */
function updateTemperatureStats(stats) {
    if (!stats) return;
    
    // CRITICAL: Stats are already in Celsius from backend
    const avgEl = document.getElementById(CONFIG.ELEMENTS.avgTemp);
    if (avgEl) avgEl.textContent = `${stats.avg_t.toFixed(1)} °C`;
    
    const maxEl = document.getElementById(CONFIG.ELEMENTS.maxTemp);
    if (maxEl) maxEl.textContent = `${stats.max_t.toFixed(1)} °C`;
    
    const minEl = document.getElementById('minTemp');
    if (minEl) minEl.textContent = `${stats.min_t.toFixed(1)} °C`;
}

/**
 * Update simulation time
 */
function updateSimulationTime(runtimeMs) {
    const element = document.getElementById(CONFIG.ELEMENTS.simulationTime);
    if (!element) return;
    
    element.textContent = `${runtimeMs.toFixed(1)} ms`;
}

/**
 * Update heatmap legend
 */
function updateHeatmapLegend(minC, maxC) {
    const minEl = document.getElementById('heatmap-min-val');
    const maxEl = document.getElementById('heatmap-max-val');
    if (minEl) minEl.textContent = `${minC.toFixed(1)}°C`;
    if (maxEl) maxEl.textContent = `${maxC.toFixed(1)}°C`;
}

/**
 * Update connection status indicator
 */
function updateStatusIndicator(isConnected) {
    const element = document.getElementById(CONFIG.ELEMENTS.statusIndicator);
    if (!element) return;
    
    if (isConnected) {
        element.textContent = '🟢 Engine Connected';
        element.className = 'status-online';
        element.style.color = '#4CAF50';
    } else {
        element.textContent = '🔴 Connection Lost';
        element.className = '';
        element.style.color = '#F44336';
    }
}

/**
 * Update fidelity history chart
 */
function updateFidelityHistory() {
    const element = document.getElementById(CONFIG.ELEMENTS.fidelityHistory);
    if (!element || dashboardState.fidelityHistory.length === 0) return;
    
    const icons = ['⚡', '⚙️', '🔥'];  // LF, MF, HF
    const colors = ['#4CAF50', '#FF9800', '#F44336'];
    
    let html = '';
    for (let fidelity of dashboardState.fidelityHistory.slice(-30)) {
        html += `<span style="color: ${colors[fidelity]}">${icons[fidelity]}</span>`;
    }
    
    element.innerHTML = html;
}

/**
 * Update all dashboard elements
 */
function updateDashboard(data) {
    try {
        console.log('🔄 Updating dashboard with data:', data);
        
        // Temperature heatmap
        drawTemperatureHeatmap(CONFIG.ELEMENTS.temperatureCanvas, data.temperature_field);
        
        // Fidelity display
        updateFidelityDisplay(data.fidelity_level, data.fidelity_name);
        
        // Energy residuals
        updateEnergyResiduals(data.energy_residuals);
        
        // ML confidence
        updateMLConfidence(data.ml_confidence);
        
        // Simulation time (use runtime_ms from stats)
        if (data.stats && data.stats.runtime_ms !== undefined) {
            updateSimulationTime(data.stats.runtime_ms);
        }
        
        // Temperature statistics
        updateTemperatureStats(data.stats);
        
        // Fidelity history
        updateFidelityHistory();
        
        console.log('✅ Dashboard updated successfully');
        
    } catch (error) {
        console.error('❌ Error updating dashboard:', error);
    }
}

// ============================================================================
// MAIN UPDATE LOOP (for live updates)
// ============================================================================

/**
 * Main update loop - fetches data and updates dashboard
 */
async function updateLoop() {
    if (!CONFIG.LIVE_UPDATE_ENABLED) {
        console.log("⏸️ Live updates are currently disabled.");
        return; 
    }
    
    try {
        // Reuse the runSimulation function for consistency
        await window.runSimulation();
        
    } catch (error) {
        console.error('Update loop error:', error);
        
        // Exponential backoff on errors
        if (dashboardState.errorCount > 5) {
            console.warn('Multiple connection failures. Retrying less frequently...');
            setTimeout(updateLoop, CONFIG.FETCH_INTERVAL * 3);
            return;
        }
    }
    
    if (CONFIG.LIVE_UPDATE_ENABLED) {
        setTimeout(updateLoop, CONFIG.FETCH_INTERVAL);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize dashboard when page loads
 */
function initializeDashboard() {
    console.log('🚀 AURA-MF Dashboard initializing...');
    console.log('📍 API URL:', CONFIG.API_BASE_URL);
    
    // Verify required elements exist
    const requiredElements = [
        CONFIG.ELEMENTS.temperatureCanvas,
        CONFIG.ELEMENTS.fidelityDisplay,
        CONFIG.ELEMENTS.energyResiduals,
        CONFIG.ELEMENTS.mlConfidence
    ];
    
    const missing = [];
    for (let elementId of requiredElements) {
        if (!document.getElementById(elementId)) {
            missing.push(elementId);
            console.warn(`⚠️ Warning: Required element '${elementId}' not found`);
        }
    }
    
    if (missing.length === 0) {
        console.log('✅ All required elements found');
    } else {
        console.error('❌ Missing elements:', missing);
    }
    
    // Set canvas size if exists
    const canvas = document.getElementById(CONFIG.ELEMENTS.temperatureCanvas);
    if (canvas) {
        if (canvas.width === 0 || canvas.height === 0) {
            canvas.width = 400;
            canvas.height = 400;
        }
        console.log(`📐 Canvas size: ${canvas.width}×${canvas.height}`);
    }
    
    // Check backend health
    fetch(`${CONFIG.API_BASE_URL}/api/health`)
        .then(response => response.json())
        .then(data => {
            console.log('✅ Backend health check passed:', data);
            updateStatusIndicator(true);
        })
        .catch(error => {
            console.warn('⚠️ Backend not immediately available (may be in cold start):', error.message);
            updateStatusIndicator(false);
        });
    
    console.log('✓ Dashboard initialized');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
} else {
    initializeDashboard();
}

// ============================================================================
// EXPORT FOR TESTING
// ============================================================================

// Make functions available globally for testing
window.AURADashboard = {
    runSimulation: window.runSimulation,
    updateDashboard,
    dashboardState,
    CONFIG,
    drawTemperatureHeatmap
};

console.log('📦 dashboard_scripts.js v1.3.0 loaded');
