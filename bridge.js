/**
 * Backend Bridge - Communication Hub
 * Routes messages from GitHub Pages frontends to Render backend
 * Supports: Contact forms, Physics simulations
 * 
 * v2.0 — Fixed: fetchWithRetry control flow, dead variable reference,
 *         removed non-functional BroadcastChannel & localStorage polling.
 */

(function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    const CONFIG = {
        BACKEND_URL: 'https://aura-mf-backend.onrender.com',
        TIMEOUT: 120000,        // 120 seconds — covers Render cold-start
        RETRY_ATTEMPTS: 3,
        RETRY_BASE_DELAY: 1500  // Exponential backoff base (ms)
    };

    // ========================================================================
    // UTILITIES
    // ========================================================================

    function log(message, data = null) {
        console.log(`[Backend Bridge] ${message}`, data || '');
    }

    function logError(message, error) {
        console.error(`[Backend Bridge ERROR] ${message}`, error);
    }

    /**
     * Fetch with retry + exponential backoff + per-request AbortController.
     * 
     * FIX: The original had an early `return` inside the content-type block
     * that made clearTimeout() and the response.ok guard unreachable.
     * Restructured so the flow is:
     *   1. fetch with AbortController timeout
     *   2. clearTimeout (always reached)
     *   3. check response.ok
     *   4. parse JSON and return
     */
    async function fetchWithRetry(url, options, attempts = CONFIG.RETRY_ATTEMPTS) {
        for (let i = 0; i < attempts; i++) {
            let timeoutId;
            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });

                // Always clear the timeout once we have a response
                clearTimeout(timeoutId);

                // Guard: reject non-2xx before trying to parse
                if (!response.ok) {
                    let errorBody = `HTTP ${response.status}: ${response.statusText}`;
                    try {
                        const errText = await response.text();
                        if (errText) errorBody += ` — ${errText.substring(0, 200)}`;
                    } catch (_) { /* ignore parse failure on error path */ }
                    throw new Error(errorBody);
                }

                // Parse response — validate content-type first
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    const raw = await response.text();
                    throw new Error(`Non-JSON response from server: ${raw.substring(0, 150)}`);
                }

                return await response.json();

            } catch (error) {
                if (timeoutId) clearTimeout(timeoutId);
                logError(`Attempt ${i + 1}/${attempts} failed`, error);

                if (i === attempts - 1) {
                    throw error; // All retries exhausted
                }

                // Exponential backoff: 1.5s, 3s, 4.5s, ...
                const delay = CONFIG.RETRY_BASE_DELAY * (i + 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // ========================================================================
    // API HANDLERS
    // ========================================================================

    async function handleContactSubmission(payload) {
        log('Processing contact form', payload);

        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/contact`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        log('Backend confirmed receipt', response);
        return response;
    }

    async function handleSimulation(payload) {
        log('Processing simulation request', payload);

        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/simulate`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        return response;
    }

    async function handleHealthCheck() {
        log('Checking backend health');

        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/health`,
            {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            }
        );

        return response;
    }

    // ========================================================================
    // MESSAGE ROUTER
    // ========================================================================

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

    // ========================================================================
    // MESSAGE LISTENER
    //
    // postMessage is the ONLY viable cross-origin channel.
    // BroadcastChannel and localStorage are same-origin only — they cannot
    // cross the boundary between thmscmpg.github.io subpaths.
    // ========================================================================

    window.addEventListener('message', async (event) => {
        // Strict origin allowlist
        const allowedOrigins = [
            'https://thmscmpg.github.io',
            'http://localhost:4000',
            'http://127.0.0.1:4000',
            window.location.origin
        ];

        if (!allowedOrigins.includes(event.origin)) {
            logError('Unauthorized origin rejected', event.origin);
            return;
        }

        const { action, payload, id } = event.data;

        if (!action || !id) {
            logError('Invalid message format (missing action or id)', event.data);
            return;
        }

        log(`Received action: ${action}`, { id, payload });

        try {
            const data = await routeMessage(action, payload);

            // Success: relay full response data back to the parent
            event.source.postMessage({
                id: id,
                status: 'success',
                data: data
            }, event.origin);

            log(`Successfully processed: ${action}`, { id });

        } catch (error) {
            logError(`Failed to process: ${action}`, error);

            event.source.postMessage({
                id: id,
                status: 'error',
                error: error.message || 'Unknown error occurred'
            }, event.origin);
        }
    });

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    log('Backend Bridge initialized', {
        backendUrl: CONFIG.BACKEND_URL,
        timeout: CONFIG.TIMEOUT,
        retryAttempts: CONFIG.RETRY_ATTEMPTS
    });

    // Initial health check to warm the Render instance
    handleHealthCheck()
        .then(() => log('Backend is healthy'))
        .catch(error => logError('Backend health check failed (cold start expected)', error));

})();
