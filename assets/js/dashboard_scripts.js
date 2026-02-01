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
 * 
 * Author: THMSCMPG
 * Version: 1.2.0 (Fixed)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = window.DASHBOARD_CONFIG || {
    API_BASE_URL: 'https://aura-mf-backend.onrender.com',
    TIMEOUT: 15000,          // AbortController timeout (ms)
    FETCH_INTERVAL: 5000,    // polling interval (ms) — 5s for free-tier Render
    LIVE_UPDATE_ENABLED: false,
    
    // Dashboard Element IDs
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
        colorScheme: 'thermal',  // 'thermal' or 'viridis'
        showGrid: true,
        showValues: false  // Show temperature values on cells
    }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

// 1. Slider Display Logic
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

// 2. The Toggle Logic
window.toggleLiveUpdates = function(isEnabled) {
    // This assumes you added LIVE_UPDATE_ENABLED: false to your CONFIG object
    CONFIG.LIVE_UPDATE_ENABLED = isEnabled;
    
    if (isEnabled) {
        console.log("▶️ Live Mode Active");
        updateLoop(); 
    } else {
        console.log("⏹️ Live Mode Paused");
        // The loop will naturally stop at the next check in updateLoop()
    }
};

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
// API COMMUNICATION
// ============================================================================

async function fetchSimulationData() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
    
    // Helper to get slider values safely
    const getVal = (id) => parseFloat(document.getElementById(id)?.value);

    const currentParams = {
        solar: getVal('solar-irradiance') || 1000,
        wind: getVal('wind-speed') || 1.0,
        // CRITICAL: Convert Slider Celsius to Backend Kelvin
        ambient: getVal('ambient-temperature') + 273.15, 
        cell_efficiency: getVal('cell-efficiency') || 0.20,
        thermal_conductivity: getVal('thermal-conductivity') || 130,
        absorptivity: getVal('absorptivity') || 0.95,
        emissivity: getVal('emissivity') || 0.90
    };

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentParams),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        dashboardState.recordSuccess(data);
        return data;
    } catch (error) {
        clearTimeout(timeoutId);
        dashboardState.recordError();
        throw error;
    }
}

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
        // 2. Collect Parameters (Direct Kelvin from slider)
        const params = {
            solar: parseFloat(document.getElementById('solar-irradiance').value),
            ambient: parseFloat(document.getElementById('ambient-temperature').value), // Removed + 273.15
            wind: parseFloat(document.getElementById('wind-speed').value),
            cell_efficiency: parseFloat(document.getElementById('cell-efficiency').value),
            thermal_conductivity: parseFloat(document.getElementById('thermal-conductivity').value),
            absorptivity: parseFloat(document.getElementById('absorptivity').value),
            emissivity: parseFloat(document.getElementById('emissivity').value)
        };

        // 3. API Request
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server responded with ${response.status}`);
        }
        
        // 4. Update State and UI
        dashboardState.recordSuccess(data);
        if (results) results.style.display = 'block'; // Ensure container is visible
        updateDashboard(data);

    } catch (error) {
        console.error('Simulation Error:', error);
        if (errorEl) {
            errorEl.textContent = '❌ ' + error.message;
            errorEl.classList.add('active');
        }
    } finally {
        // 5. Restore UI
        if (runBtn) runBtn.disabled = false;
        if (loading) loading.classList.remove('active');
    }
};

// ============================================================================
// VISUALIZATION
// ============================================================================

/**
 * Color interpolation for heatmap
 */
function getHeatmapColor(value, min, max, scheme = 'thermal') {
    // Normalize value to 0-1
    const normalized = (value - min) / (max - min);
    
    if (scheme === 'thermal') {
        // Blue → Green → Yellow → Red (thermal scale)
        if (normalized < 0.25) {
            // Blue to Cyan
            const t = normalized * 4;
            return `rgb(${Math.round(0 * (1-t) + 0 * t)}, 
                        ${Math.round(0 * (1-t) + 255 * t)}, 
                        ${Math.round(255 * (1-t) + 255 * t)})`;
        } else if (normalized < 0.5) {
            // Cyan to Green
            const t = (normalized - 0.25) * 4;
            return `rgb(0, 
                        ${Math.round(255)}, 
                        ${Math.round(255 * (1-t) + 0 * t)})`;
        } else if (normalized < 0.75) {
            // Green to Yellow
            const t = (normalized - 0.5) * 4;
            return `rgb(${Math.round(0 * (1-t) + 255 * t)}, 
                        ${Math.round(255)}, 
                        0)`;
        } else {
            // Yellow to Red
            const t = (normalized - 0.75) * 4;
            return `rgb(255, 
                        ${Math.round(255 * (1-t) + 0 * t)}, 
                        0)`;
        }
    }
    
    // Default: Simple blue to red
    return `rgb(${Math.round(normalized * 255)}, 
                0, 
                ${Math.round((1 - normalized) * 255)})`;
}

/**
 * FIXED: Handles Kelvin-to-Celsius conversion and provides 
 * structural safety for the 2D array rendering.
 */
function drawTemperatureHeatmap(canvasId, temperatureField) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !temperatureField || !temperatureField.length) {
        console.warn('Heatmap skip: Canvas or data field missing');
        return;
    }

    const ctx = canvas.getContext('2d');
    const rows = temperatureField.length;
    const cols = temperatureField[0].length;

    // Canvas/Cell scaling
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    // 1. Data Analysis: Find Min/Max in Kelvin
    let minK = Infinity;
    let maxK = -Infinity;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const val = temperatureField[r][c];
            if (val < minK) minK = val;
            if (val > maxK) maxK = val;
        }
    }

    // 2. Rendering Loop
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const tempK = temperatureField[i][j];
            
            // CONVERSION: Map Kelvin to Celsius for the color logic
            // (Assuming standard 273.15 offset)
            const tempC = tempK - 273.15;
            const minC = minK - 273.15;
            const maxC = maxK - 273.15;

            // Get color based on relative position in the current range
            ctx.fillStyle = getHeatmapColor(tempC, minC, maxC, CONFIG.HEATMAP.colorScheme);
            
            // Draw the cell (using floor/ceil to prevent sub-pixel gaps)
            ctx.fillRect(
                Math.floor(j * cellWidth), 
                Math.floor(i * cellHeight), 
                Math.ceil(cellWidth), 
                Math.ceil(cellHeight)
            );
        }
    }

    // 3. Update Legend Labels
    updateHeatmapLegend(minK - 273.15, maxK - 273.15);
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
    
    const elements = {
        min: document.getElementById(CONFIG.ELEMENTS.minTemp),
        max: document.getElementById(CONFIG.ELEMENTS.maxTemp),
        avg: document.getElementById(CONFIG.ELEMENTS.avgTemp)
    };
    
    if (elements.min) elements.min.textContent = stats.min_t.toFixed(2) + '°C';
    if (elements.max) elements.max.textContent = stats.max_t.toFixed(2) + '°C';
    if (elements.avg) elements.avg.textContent = stats.avg_t.toFixed(2) + '°C';
}

/**
 * Update simulation time
 */
function updateSimulationTime(timestamp) {
    const element = document.getElementById(CONFIG.ELEMENTS.simulationTime);
    if (!element) return;
    
    element.textContent = `${timestamp.toFixed(1)}s`;
}
/**
* Update heatmap legend
**/
function updateHeatmapLegend(minC, maxC) {
    const minEl = document.getElementById('heatmap-min-val');
    const maxEl = document.getElementById('heatmap-max-val');
    if (minEl) minEl.textContent = minC.toFixed(1) + '°C';
    if (maxEl) maxEl.textContent = maxC.toFixed(1) + '°C';
}

/**
 * Update connection status indicator
 */
function updateStatusIndicator(isConnected) {
    const element = document.getElementById(CONFIG.ELEMENTS.statusIndicator);
    if (!element) return;
    
    if (isConnected) {
        element.textContent = '🟢 Connected';
        element.style.color = '#4CAF50';
    } else {
        element.textContent = '🔴 Disconnected';
        element.style.color = '#F44336';
    }
}

/**
 * Update fidelity history chart (simple text-based)
 */
function updateFidelityHistory() {
    const element = document.getElementById(CONFIG.ELEMENTS.fidelityHistory);
    if (!element || dashboardState.fidelityHistory.length === 0) return;
    
    const symbols = ['▁', '▄', '▇'];  // LF, MF, HF
    const colors = ['#4CAF50', '#FF9800', '#F44336'];
    
    let html = '';
    for (let fidelity of dashboardState.fidelityHistory.slice(-30)) {
        html += `<span style="color: ${colors[fidelity]}">${symbols[fidelity]}</span>`;
    }
    
    element.innerHTML = html;
}

/**
 * Update all dashboard elements
 */
function updateDashboard(data) {
    try {
        // Temperature heatmap
        drawTemperatureHeatmap(CONFIG.ELEMENTS.temperatureCanvas, data.temperature_field);
        
        // Fidelity display
        updateFidelityDisplay(data.fidelity_level, data.fidelity_name);
        
        // Energy residuals
        updateEnergyResiduals(data.energy_residuals);
        
        // ML confidence
        updateMLConfidence(data.ml_confidence);
        
        // Simulation time
        updateSimulationTime(data.timestamp);
        
        // Temperature statistics
        updateTemperatureStats(data.stats);
        
        // Status indicator
        updateStatusIndicator(true);
        
        // Fidelity history
        updateFidelityHistory();
        
    } catch (error) {
        console.error('Error updating dashboard:', error);
    }
}

// ============================================================================
// MAIN UPDATE LOOP
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
        const data = await fetchSimulationData();
        updateDashboard(data);
        
    } catch (error) {
        updateStatusIndicator(false);
        
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
    
    // Verify required elements exist
    const requiredElements = [
        CONFIG.ELEMENTS.temperatureCanvas,
        CONFIG.ELEMENTS.fidelityDisplay,
        CONFIG.ELEMENTS.energyResiduals,
        CONFIG.ELEMENTS.mlConfidence
    ];
    
    for (let elementId of requiredElements) {
        if (!document.getElementById(elementId)) {
            console.warn(`Warning: Required element '${elementId}' not found`);
        }
    }
    
    // Set canvas size if exists
    const canvas = document.getElementById(CONFIG.ELEMENTS.temperatureCanvas);
    if (canvas && canvas.width === 0) {
        canvas.width = 400;
        canvas.height = 400;
    }
    
    // Start update loop
    updateLoop();
    
    console.log('✓ Dashboard initialized');
    console.log(`  Fetching from: ${CONFIG.API_BASE_URL}`);
    console.log(`  Update interval: ${CONFIG.FETCH_INTERVAL}ms`);
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
    fetchSimulationData,
    updateDashboard,
    dashboardState,
    CONFIG
};
