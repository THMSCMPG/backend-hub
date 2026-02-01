/**
 * Backend Bridge - Communication Hub
 * Routes messages from GitHub Pages frontends to Render backend
 * Supports: Contact forms, Physics simulations
 */

(function() {
    'use strict';
    
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    
    const CONFIG = {
        // UPDATED: Your actual Render backend URL
        BACKEND_URL: localStorage.getItem('BACKEND_URL') || 'https://aura-mf-backend.onrender.com',
        TIMEOUT: 120000, // 30 seconds
        RETRY_ATTEMPTS: 2,
        RETRY_DELAY: 1000
    };
    
    // ============================================================================
    // UTILITIES
    // ============================================================================
    
    function log(message, data = null) {
        console.log(`[Backend Bridge] ${message}`, data || '');
    }
    
    function logError(message, error) {
        console.error(`[Backend Bridge ERROR] ${message}`, error);
    }
    
    // Retry logic for failed requests
    async function fetchWithRetry(url, options, attempts = CONFIG.RETRY_ATTEMPTS) {
        for (let i = 0; i < attempts; i++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
                
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                // Inside Backend Bridge fetchWithRetry
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    return await response.json();
                } else {
                    const text = await response.text();
                    throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}`);
                }
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return await response.json();
                
            } catch (error) {
                logError(`Attempt ${i + 1}/${attempts} failed`, error);
                
                if (i === attempts - 1) {
                    throw error;
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
            }
        }
    }
    
    // ============================================================================
    // API HANDLERS
    // ============================================================================
    
    /**
     * Handle contact form submissions
     */
    async function handleContactSubmission(payload) {
        log('Processing contact form', payload);
        
        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/contact`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            }
        );

        log('Backend confirmed receipt', responseData);
        return response;
    }
    
    /**
     * Handle physics simulation requests
     */
    async function handleSimulation(payload) {
        log('Processing simulation request', payload);
        
        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/simulate`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            }
        );
        
        return response;
    }
    
    /**
     * Health check
     */
    async function handleHealthCheck() {
        log('Checking backend health');
        
        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/health`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        );
        
        return response;
    }
    
    // ============================================================================
    // MESSAGE ROUTER
    // ============================================================================
    
    /**
     * Route incoming messages to appropriate handlers
     */
    async function routeMessage(action, payload) {
        switch (action) {
            case 'SUBMIT_CONTACT':
                return await handleContactSubmission(payload);
                
            case 'RUN_SIMULATION':
                return await handleSimulation(payload);
                
            case 'HEALTH_CHECK':
                return await handleHealthCheck();
                
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }
    
    // ============================================================================
    // MESSAGE LISTENER
    // ============================================================================
    
    window.addEventListener('message', async (event) => {
        // Security: Validate origin
        const allowedOrigins = [
            'https://thmscmpg.github.io',
            'http://localhost:4000',
            'http://127.0.0.1:4000',
            window.location.origin
        ];
        
        if (!allowedOrigins.includes(event.origin)) {
            logError('Unauthorized origin', event.origin);
            return;
        }
        
        const { action, payload, id } = event.data;
        
        if (!action || !id) {
            logError('Invalid message format', event.data);
            return;
        }
        
        log(`Received action: ${action}`, { id, payload });
        
        try {
            // Route the message to the appropriate handler
            const data = await routeMessage(action, payload);
            
            // Send success response back to the parent
            event.source.postMessage({
                id: id,
                status: 'success',
                data: data
            }, event.origin);
            
            log(`Successfully processed: ${action}`, { id });
            
        } catch (error) {
            logError(`Failed to process: ${action}`, error);
            
            // Send error response back to the parent
            event.source.postMessage({
                id: id,
                status: 'error',
                error: error.message || 'Unknown error occurred'
            }, event.origin);
        }
    });
    
    // ============================================================================
    // BROADCAST CHANNEL API (ALTERNATIVE COMMUNICATION METHOD)
    // ============================================================================
    
    const broadcastChannel = new BroadcastChannel('site_communication');
    
    broadcastChannel.onmessage = async (event) => {
        const { source, payload, timestamp, id } = event.data;
        
        log(`Broadcast received from: ${source}`, { payload, timestamp });
        
        try {
            // Determine action based on payload structure
            let action;
            if (payload.name && payload.email && payload.message) {
                action = 'SUBMIT_CONTACT';
            } else if (payload.solar !== undefined || payload.solar_irradiance !== undefined) {
                action = 'RUN_SIMULATION';
            } else {
                throw new Error('Could not determine action from payload');
            }
            
            const data = await routeMessage(action, payload);
            
            // Broadcast the response back
            broadcastChannel.postMessage({
                source: 'backend-hub',
                responseId: id || timestamp,
                status: 'success',
                data: data,
                timestamp: Date.now()
            });
            
        } catch (error) {
            logError('Broadcast message processing failed', error);
            
            broadcastChannel.postMessage({
                source: 'backend-hub',
                responseId: id || timestamp,
                status: 'error',
                error: error.message,
                timestamp: Date.now()
            });
        }
    };
    
    // ============================================================================
    // LOCALSTORAGE FALLBACK (BACKUP METHOD)
    // ============================================================================
    
    setInterval(() => {
        const pendingRequests = localStorage.getItem('backend_queue');
        
        if (pendingRequests) {
            try {
                const requests = JSON.parse(pendingRequests);
                
                if (Array.isArray(requests) && requests.length > 0) {
                    log('Found pending requests in localStorage', requests);
                    
                    const request = requests[0];
                    
                    routeMessage(request.action, request.payload)
                        .then(data => {
                            localStorage.setItem('backend_response', JSON.stringify({
                                id: request.id,
                                status: 'success',
                                data: data,
                                timestamp: Date.now()
                            }));
                            
                            requests.shift();
                            localStorage.setItem('backend_queue', JSON.stringify(requests));
                            
                            log('Processed localStorage request', request.id);
                        })
                        .catch(error => {
                            logError('Failed to process localStorage request', error);
                            
                            localStorage.setItem('backend_response', JSON.stringify({
                                id: request.id,
                                status: 'error',
                                error: error.message,
                                timestamp: Date.now()
                            }));
                            
                            requests.shift();
                            localStorage.setItem('backend_queue', JSON.stringify(requests));
                        });
                }
            } catch (error) {
                logError('Error processing localStorage queue', error);
                localStorage.removeItem('backend_queue');
            }
        }
    }, 2000);
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    log('Backend Bridge initialized', {
        backendUrl: CONFIG.BACKEND_URL,
        timeout: CONFIG.TIMEOUT,
        retryAttempts: CONFIG.RETRY_ATTEMPTS
    });
    
    // Perform initial health check
    handleHealthCheck()
        .then(() => log('Backend is healthy'))
        .catch(error => logError('Backend health check failed', error));
    
    // Expose configuration setter for external use
    window.setBackendUrl = function(url) {
        CONFIG.BACKEND_URL = url;
        localStorage.setItem('BACKEND_URL', url);
        log('Backend URL updated', url);
    };
    
})();
