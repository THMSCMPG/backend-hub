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
        BACKEND_URL: localStorage.getItem('BACKEND_URL') || 'https://aura-mf-backend.onrender.com',
        TIMEOUT: 120000, 
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
    
    async function fetchWithRetry(url, options, attempts = CONFIG.RETRY_ATTEMPTS) {
        for (let i = 0; i < attempts; i++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
            
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
                }

                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    return await response.json();
                } else {
                    return await response.text();
                }
                
            } catch (error) {
                clearTimeout(timeoutId);
                logError(`Attempt ${i + 1}/${attempts} failed`, error);
                
                if (i === attempts - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
            }
        }
    }
    
    // ============================================================================
    // API HANDLERS
    // ============================================================================
    
    /**
     * Handle contact form submissions (Optimized for Async/Fast UI)
     */
    async function handleContactSubmission(payload, id, eventSource, eventOrigin) {
        log('Processing contact form', payload);
        
        // 1. ASYNC PATTERN: Immediate Acknowledgement
        // We tell the frontend "Received" so the website stays fast.
        if (eventSource && eventOrigin) {
            eventSource.postMessage({
                id: id,
                status: 'success',
                data: { message: "Message queued for processing." }
            }, eventOrigin);
        }

        // 2. Background Execution
        // This continues running even after the frontend has been notified.
        try {
            const response = await fetchWithRetry(
                `${CONFIG.BACKEND_URL}/api/contact`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }
            );
            log('Background delivery successful', response);
        } catch (error) {
            logError('Background delivery failed', error);
            // Optional: Store in localStorage queue for later retry if backend is down
        }
    }
    
    async function handleSimulation(payload) {
        log('Processing simulation request', payload);
        return await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/simulate`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );
    }
    
    async function handleHealthCheck() {
        log('Checking backend health');
        return await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/health`,
            {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
    
    // ============================================================================
    // MESSAGE ROUTER
    // ============================================================================
    
    async function routeMessage(action, payload, id = null, source = null, origin = null) {
        switch (action) {
            case 'SUBMIT_CONTACT':
            case 'ENQUEUE_CONTACT':
                // Pass source/origin for immediate acknowledgement
                return await handleContactSubmission(payload, id, source, origin);
                
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
        const allowedOrigins = [
            'https://thmscmpg.github.io',
            'http://localhost:4000',
            'http://127.0.0.1:4000',
            window.location.origin
        ];
        
        if (!allowedOrigins.some(origin => event.origin.includes(origin))) {
            logError('Unauthorized origin', event.origin);
            return;
        }
        
        const { action, payload, id } = event.data;
        if (!action || !id) return;
        
        log(`Received action: ${action}`, { id });
        
        try {
            const data = await routeMessage(action, payload, id, event.source, event.origin);
            
            // If the routeMessage didn't already send a response (like simulation does)
            if (action !== 'SUBMIT_CONTACT' && action !== 'ENQUEUE_CONTACT') {
                event.source.postMessage({
                    id: id,
                    status: 'success',
                    data: data
                }, event.origin);
            }
        } catch (error) {
            logError(`Failed to process: ${action}`, error);
            event.source.postMessage({
                id: id,
                status: 'error',
                error: error.message || 'Unknown error'
            }, event.origin);
        }
    });

    // ============================================================================
    // BROADCAST & LOCALSTORAGE
    // ============================================================================
    
    const broadcastChannel = new BroadcastChannel('site_communication');
    broadcastChannel.onmessage = async (event) => {
        const { source, payload, id, timestamp } = event.data;
        log(`Broadcast from: ${source}`);
        try {
            let action = payload.email ? 'SUBMIT_CONTACT' : (payload.solar ? 'RUN_SIMULATION' : null);
            if (!action) return;
            
            const data = await routeMessage(action, payload, id);
            broadcastChannel.postMessage({ source: 'backend-hub', responseId: id || timestamp, status: 'success', data });
        } catch (e) { logError('Broadcast failed', e); }
    };

    // Initialization
    log('Backend Bridge initialized', { backend: CONFIG.BACKEND_URL });
    handleHealthCheck().catch(e => logError('Initial health check failed', e));

    window.setBackendUrl = function(url) {
        CONFIG.BACKEND_URL = url;
        localStorage.setItem('BACKEND_URL', url);
        log('URL Updated', url);
    };

})();
