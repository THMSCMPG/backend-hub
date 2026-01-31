/**
 * Physics Simulation - Bridge Integration
 * Add this script to the demo.html to connect simulations to the bridge
 * 
 * This replaces the direct fetch call with bridge communication
 */

(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        TIMEOUT: 15000,
        BRIDGE_URL: 'https://thmscmpg.github.io/backend-bridge/'
    };
    
    /**
     * Send simulation request through the bridge
     */
    function sendSimulationToBridge(params) {
        return new Promise((resolve, reject) => {
            const iframe = document.getElementById('backend-bridge');
            
            if (!iframe) {
                reject(new Error("Backend bridge iframe not found"));
                return;
            }
            
            const requestId = Date.now();
            
            // Response handler
            const handleResponse = (event) => {
                // Security check
                if (event.origin !== window.location.origin) return;
                
                // Check if this is our response
                if (!event.data.id || event.data.id !== requestId) return;
                
                // Cleanup
                window.removeEventListener('message', handleResponse);
                
                if (event.data.status === 'success') {
                    resolve(event.data.data);
                } else {
                    reject(new Error(event.data.error || 'Simulation failed'));
                }
            };
            
            // Start listening
            window.addEventListener('message', handleResponse);
            
            // Send request to bridge
            iframe.contentWindow.postMessage({
                action: 'RUN_SIMULATION',
                id: requestId,
                payload: params
            }, '*');
            
            // Timeout
            setTimeout(() => {
                window.removeEventListener('message', handleResponse);
                reject(new Error("Simulation request timed out"));
            }, CONFIG.TIMEOUT);
        });
    }
    
    /**
     * Alternative: Use Broadcast Channel API
     */
    function sendSimulationViaBroadcast(params) {
        return new Promise((resolve, reject) => {
            const channel = new BroadcastChannel('site_communication');
            const requestId = Date.now();
            
            // Response handler
            const handleResponse = (event) => {
                if (event.data.responseId === requestId) {
                    channel.close();
                    
                    if (event.data.status === 'success') {
                        resolve(event.data.data);
                    } else {
                        reject(new Error(event.data.error || 'Simulation failed'));
                    }
                }
            };
            
            channel.onmessage = handleResponse;
            
            // Send request
            channel.postMessage({
                source: 'AURA-MF',
                payload: params,
                id: requestId,
                timestamp: Date.now()
            });
            
            // Timeout
            setTimeout(() => {
                channel.close();
                reject(new Error("Simulation request timed out"));
            }, CONFIG.TIMEOUT);
        });
    }
    
    /**
     * Updated runSimulation function
     * This replaces the existing runSimulation in demo.html
     */
    window.runSimulationThroughBridge = async function() {
        // Collect parameters (same as original)
        const params = {
            solar: parseFloat(document.getElementById('solar-irradiance').value),
            wind: parseFloat(document.getElementById('wind-speed').value),
            ambient: parseFloat(document.getElementById('ambient-temperature').value)
        };
        
        // Show loading state
        document.getElementById('loading').classList.add('active');
        document.getElementById('results-container').style.display = 'none';
        document.getElementById('error-message').classList.remove('active');
        document.getElementById('run-button').disabled = true;
        
        try {
            // Try bridge method first, fallback to broadcast
            let data;
            try {
                data = await sendSimulationToBridge(params);
            } catch (bridgeError) {
                console.warn('Bridge method failed, trying broadcast...', bridgeError);
                data = await sendSimulationViaBroadcast(params);
            }
            
            // Display results (same as original)
            displayResults(data);
            
        } catch (error) {
            console.error('Simulation Error:', error);
            document.getElementById('error-message').textContent = 
                '❌ Error: ' + error.message;
            document.getElementById('error-message').classList.add('active');
        } finally {
            document.getElementById('loading').classList.remove('active');
            document.getElementById('run-button').disabled = false;
        }
    };
    
    /**
     * Display simulation results
     */
    function displayResults(data) {
        // Show visualization
        if (data.visualization) {
            document.getElementById('visualization-image').src = 
                'data:image/png;base64,' + data.visualization;
        }
        
        // Update result values
        if (data.stats) {
            document.getElementById('temp-mean').textContent = 
                data.stats.avg_t + ' °C';
            document.getElementById('temp-max').textContent = 
                data.stats.max_t + ' °C';
        }
        
        // Show fidelity info
        if (data.fidelity_name) {
            const fidelityEl = document.getElementById('fidelity-level');
            if (fidelityEl) {
                fidelityEl.textContent = data.fidelity_name;
            }
        }
        
        // Show results container
        document.getElementById('results-container').style.display = 'block';
    }
    
    console.log('✓ Physics simulation bridge integration loaded');
    
})();

/**
 * INTEGRATION INSTRUCTIONS:
 * 
 * 1. Add this script to demo.html after the existing scripts
 * 2. Update the run button onclick:
 *    <button onclick="runSimulationThroughBridge()">Run Simulation</button>
 * 
 * 3. Ensure the iframe is present:
 *    <iframe id="backend-bridge" 
 *            src="https://thmscmpg.github.io/backend-bridge/" 
 *            style="display:none"></iframe>
 */
