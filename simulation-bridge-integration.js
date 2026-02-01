(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        TIMEOUT: 15000,
        BRIDGE_URL: 'https://thmscmpg.github.io/backend-bridge/'
    };
    
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
    
    window.runSimulationThroughBridge = async function() {
        // Collect all 7 parameters — keys match what app.py reads via data.get()
        const params = {
            solar:                parseFloat(document.getElementById('solar-irradiance').value),
            ambient:              parseFloat(document.getElementById('ambient-temperature').value),
            wind:                 parseFloat(document.getElementById('wind-speed').value),
            cell_efficiency:      parseFloat(document.getElementById('cell-efficiency').value),
            thermal_conductivity: parseFloat(document.getElementById('thermal-conductivity').value),
            absorptivity:         parseFloat(document.getElementById('absorptivity').value),
            emissivity:           parseFloat(document.getElementById('emissivity').value)
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
            
            // Display results
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
    
    function displayResults(data) {
        const stats = data.stats;

        // Heatmap
        if (data.visualization) {
            document.getElementById('visualization-image').src = 
                'data:image/png;base64,' + data.visualization;
        }
        
        // Temperature cards
        if (stats) {
            document.getElementById('temp-mean').textContent =
                stats.avg_t.toFixed(1) + ' °C';
            document.getElementById('temp-max').textContent =
                stats.max_t.toFixed(1) + ' °C';

            // Power & efficiency
            document.getElementById('power-total').textContent =
                stats.power_total.toFixed(2) + ' W';
            document.getElementById('efficiency-avg').textContent =
                stats.eff_avg.toFixed(1) + ' %';

            // Runtime
            document.getElementById('runtime').textContent =
                stats.runtime_ms.toFixed(1);
        }
        
        // Fidelity badge (optional element — only present if the page has one)
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
