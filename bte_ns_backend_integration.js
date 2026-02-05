/**
 * BTE-NS Simulator Backend Integration
 * =====================================
 * Connects the BTE-NS simulator frontend to the /api/simulate/bte-ns endpoint
 * Handles visualization updates with base64 images from backend
 * 
 * Version: 1.0.0
 */

(function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    const BTENS_CONFIG = {
        API_BASE_URL: 'https://aura-mf-backend.onrender.com',
        ENDPOINT: '/api/simulate/bte-ns',
        TIMEOUT: 60000,  // 60 seconds for coupled solver
        
        // Canvas element IDs
        CANVASES: {
            temperature: 'temperature-canvas',
            current: 'power-canvas',      // Reuse power canvas for current density
            velocity: 'velocity-canvas',
            phonon: 'phonon-canvas'       // Keep for compatibility
        }
    };

    // ========================================================================
    // STATE MANAGEMENT
    // ========================================================================

    class BTENSState {
        constructor() {
            this.isRunning = false;
            this.lastResults = null;
            this.simulationCount = 0;
            this.errorCount = 0;
        }
        
        recordSuccess(data) {
            this.lastResults = data;
            this.simulationCount++;
            this.errorCount = 0;
        }
        
        recordError() {
            this.errorCount++;
        }
    }

    const btensState = new BTENSState();

    // ========================================================================
    // API COMMUNICATION
    // ========================================================================

    /**
     * Run BTE-NS coupled simulation
     */
    async function runBTENSSimulation() {
        // Prevent concurrent simulations
        if (btensState.isRunning) {
            console.warn('⚠️ Simulation already running, please wait...');
            return;
        }

        const runBtn = document.getElementById('run-button');
        const statusDiv = document.getElementById('realtime-status');
        const resultsDiv = document.getElementById('viz-panel');
        
        try {
            btensState.isRunning = true;
            
            // Update UI - simulation started
            if (runBtn) runBtn.disabled = true;
            if (statusDiv) {
                statusDiv.textContent = '⏳ Running coupled BTE-NS simulation...';
                statusDiv.style.color = '#FF9800';
            }

            // Collect parameters from UI
            const params = collectParameters();
            console.log('📤 Sending BTE-NS simulation request:', params);

            // Make API request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), BTENS_CONFIG.TIMEOUT);

            const response = await fetch(
                `${BTENS_CONFIG.API_BASE_URL}${BTENS_CONFIG.ENDPOINT}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                    signal: controller.signal
                }
            );

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error ${response.status}`);
            }

            const data = await response.json();
            console.log('📥 BTE-NS simulation completed:', data);

            // Update state
            btensState.recordSuccess(data);

            // Update visualizations
            updateVisualizations(data);

            // Update statistics
            updateStatistics(data);

            // Show results panel
            if (resultsDiv) resultsDiv.style.display = 'block';

            // Update UI - success
            if (statusDiv) {
                statusDiv.textContent = `✅ Simulation completed in ${data.runtime_ms.toFixed(1)}ms`;
                statusDiv.style.color = '#4CAF50';
            }

        } catch (error) {
            console.error('❌ BTE-NS Simulation Error:', error);
            
            btensState.recordError();
            
            // Enhanced error messages
            let errorMessage = error.message;
            if (error.name === 'AbortError') {
                errorMessage = 'Simulation timeout (>60s). Try reducing fidelity level.';
            } else if (errorMessage.includes('Failed to fetch')) {
                errorMessage = 'Cannot connect to backend. Check if server is online.';
            }
            
            if (statusDiv) {
                statusDiv.textContent = `❌ Error: ${errorMessage}`;
                statusDiv.style.color = '#F44336';
            }
            
            // Show error alert
            alert(`Simulation Error:\n${errorMessage}\n\nPlease try again or contact support.`);
            
        } finally {
            btensState.isRunning = false;
            if (runBtn) runBtn.disabled = false;
        }
    }

    // ========================================================================
    // PARAMETER COLLECTION
    // ========================================================================

    /**
     * Collect parameters from UI sliders/inputs
     */
    function collectParameters() {
        // Get fidelity level from active button
        const fidelityBtns = document.querySelectorAll('.fidelity-btn');
        let fidelityLevel = 1; // default to Medium
        
        fidelityBtns.forEach((btn, index) => {
            if (btn.classList.contains('active')) {
                fidelityLevel = index;
            }
        });

        return {
            fidelity_level: fidelityLevel,
            solar_irradiance: parseFloat(document.getElementById('solar-value')?.value || 1000),
            ambient_temperature: parseFloat(document.getElementById('temp-value')?.value || 298.15),
            wind_speed: parseFloat(document.getElementById('wind-value')?.value || 2.0),
            cell_efficiency: parseFloat(document.getElementById('efficiency-value')?.value || 0.20),
            thermal_conductivity: parseFloat(document.getElementById('conductivity-value')?.value || 130),
            absorptivity: parseFloat(document.getElementById('absorptivity-value')?.value || 0.95),
            emissivity: parseFloat(document.getElementById('emissivity-value')?.value || 0.90)
        };
    }

    // ========================================================================
    // VISUALIZATION UPDATES
    // ========================================================================

    /**
     * Update all visualizations with backend data
     * Backend returns base64-encoded PNG images
     */
    function updateVisualizations(data) {
        if (!data.visualizations) {
            console.warn('⚠️ No visualizations in response');
            return;
        }

        const viz = data.visualizations;

        // Temperature heatmap
        if (viz.temperature_heatmap) {
            displayBase64Image(BTENS_CONFIG.CANVASES.temperature, viz.temperature_heatmap);
        }

        // Current density (replace power canvas)
        if (viz.current_density) {
            displayBase64Image(BTENS_CONFIG.CANVASES.current, viz.current_density);
        }

        // Velocity field
        if (viz.velocity_field) {
            displayBase64Image(BTENS_CONFIG.CANVASES.velocity, viz.velocity_field);
        }

        console.log('✅ Visualizations updated');
    }

    /**
     * Display base64-encoded image on canvas
     */
    function displayBase64Image(canvasId, base64Data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn(`⚠️ Canvas #${canvasId} not found`);
            return;
        }

        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = function() {
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw image scaled to canvas size
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };

        img.onerror = function() {
            console.error(`❌ Failed to load image for canvas #${canvasId}`);
            
            // Draw error message on canvas
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#F44336';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Image Load Error', canvas.width / 2, canvas.height / 2);
        };

        // Set image source (already includes data:image/png;base64, prefix from backend)
        img.src = base64Data;
    }

    // ========================================================================
    // STATISTICS UPDATES
    // ========================================================================

    /**
     * Update statistics panel with simulation results
     */
    function updateStatistics(data) {
        if (!data.statistics) return;

        const stats = data.statistics;

        // Temperature statistics
        updateElement('max-temp-value', `${stats.temp_max} °C`);
        updateElement('min-temp-value', `${stats.temp_min} °C`);
        updateElement('avg-temp-value', `${stats.temp_avg} °C`);

        // Power and efficiency
        updateElement('power-total-value', `${stats.power_total} W`);
        updateElement('efficiency-value', `${stats.efficiency_avg} %`);

        // Advanced metrics
        updateElement('current-density-value', `${stats.current_density_max} A/m²`);
        updateElement('velocity-max-value', `${stats.velocity_max} m/s`);
        updateElement('carrier-density-value', stats.carrier_density_avg);

        // Fidelity info
        updateElement('fidelity-display', data.fidelity_name);
        updateElement('runtime-display', `${data.runtime_ms.toFixed(1)} ms`);

        console.log('✅ Statistics updated');
    }

    /**
     * Update element text content if element exists
     */
    function updateElement(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Initialize BTE-NS simulator
     */
    function initializeBTENS() {
        console.log('🚀 BTE-NS Backend Integration initializing...');
        console.log('📍 API Endpoint:', BTENS_CONFIG.API_BASE_URL + BTENS_CONFIG.ENDPOINT);

        // Attach to run button
        const runBtn = document.getElementById('run-button');
        if (runBtn) {
            runBtn.addEventListener('click', runBTENSSimulation);
            console.log('✅ Run button attached');
        } else {
            console.warn('⚠️ Run button (#run-button) not found');
        }

        // Check backend health
        fetch(`${BTENS_CONFIG.API_BASE_URL}/api/health`)
            .then(response => response.json())
            .then(data => {
                console.log('✅ Backend health check passed:', data);
            })
            .catch(error => {
                console.warn('⚠️ Backend health check failed (may be in cold start):', error.message);
            });

        console.log('✓ BTE-NS Backend Integration ready');
    }

    // ========================================================================
    // EXPOSE GLOBAL API
    // ========================================================================

    window.BTENSSimulator = {
        run: runBTENSSimulation,
        getState: () => btensState,
        getLastResults: () => btensState.lastResults,
        config: BTENS_CONFIG
    };

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeBTENS);
    } else {
        initializeBTENS();
    }

    console.log('📦 bte_ns_backend_integration.js v1.0.0 loaded');

})();