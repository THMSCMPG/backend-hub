/**
 * Backend Bridge v3.0 - Enhanced Communication Hub with Terminal Tracker
 * Routes messages from GitHub Pages frontends to Render backend
 * Supports: Contact forms, Physics simulations, Terminal Tracking
 * 
 * NEW in v3.0:
 * - Terminal Tracker: Intercepts and logs all postMessage events
 * - Email Request tracking (Contact Form)
 * - Physics Sim API call tracking
 * - Visual telemetry log for debugging
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
    // TERMINAL TRACKER STATE
    // ========================================================================

    const TRACKER = {
        requests: new Map(),  // requestId -> {type, status, timestamp, payload}
        emailRequests: new Map(),
        physicsRequests: new Map(),
        totalMessages: 0,
        successCount: 0,
        errorCount: 0
    };

    // ========================================================================
    // TERMINAL LOGGING
    // ========================================================================

    function terminalLog(type, message, data = null) {
        const timestamp = new Date().toISOString().slice(11, 19);
        const logEntry = {
            timestamp,
            type,
            message,
            data
        };

        // Console log
        const prefix = `[Bridge v3.0 | ${timestamp}]`;
        switch(type) {
            case 'success':
                console.log(`%c${prefix} ✓ ${message}`, 'color: #4CAF50', data || '');
                break;
            case 'error':
                console.error(`%c${prefix} ✗ ${message}`, 'color: #f44336', data || '');
                break;
            case 'traffic':
                console.log(`%c${prefix} ⇄ ${message}`, 'color: #f59e0b', data || '');
                break;
            case 'info':
                console.log(`%c${prefix} ℹ ${message}`, 'color: #667eea', data || '');
                break;
            default:
                console.log(`${prefix} ${message}`, data || '');
        }

        // Dispatch custom event for Terminal UI
        window.dispatchEvent(new CustomEvent('bridge-log', { 
            detail: logEntry 
        }));

        return logEntry;
    }

    // ========================================================================
    // REQUEST TRACKING
    // ========================================================================

    function trackRequest(id, type, payload) {
        const request = {
            id,
            type,
            payload,
            status: 'pending',
            timestamp: Date.now(),
            startTime: performance.now()
        };

        TRACKER.requests.set(id, request);
        TRACKER.totalMessages++;

        // Track by type
        if (type === 'SUBMIT_CONTACT') {
            TRACKER.emailRequests.set(id, request);
        } else if (type === 'RUN_SIMULATION') {
            TRACKER.physicsRequests.set(id, request);
        }

        terminalLog('traffic', `New ${type} request`, { id, payloadSize: JSON.stringify(payload).length });
    }

    function updateRequestStatus(id, status, result = null) {
        const request = TRACKER.requests.get(id);
        if (!request) return;

        request.status = status;
        request.result = result;
        request.duration = performance.now() - request.startTime;

        if (status === 'success') {
            TRACKER.successCount++;
            terminalLog('success', `Request ${id} completed in ${request.duration.toFixed(2)}ms`, result);
        } else if (status === 'error') {
            TRACKER.errorCount++;
            terminalLog('error', `Request ${id} failed`, result);
        }

        // Update type-specific trackers
        if (TRACKER.emailRequests.has(id)) {
            TRACKER.emailRequests.get(id).status = status;
        }
        if (TRACKER.physicsRequests.has(id)) {
            TRACKER.physicsRequests.get(id).status = status;
        }

        // Dispatch update event
        window.dispatchEvent(new CustomEvent('bridge-status-update', {
            detail: { id, status, duration: request.duration }
        }));
    }

    function getTrackerStats() {
        return {
            total: TRACKER.totalMessages,
            success: TRACKER.successCount,
            error: TRACKER.errorCount,
            pending: TRACKER.totalMessages - TRACKER.successCount - TRACKER.errorCount,
            emailRequests: Array.from(TRACKER.emailRequests.values()),
            physicsRequests: Array.from(TRACKER.physicsRequests.values())
        };
    }

    // Expose tracker stats globally for debugging
    window.bridgeTracker = {
        getStats: getTrackerStats,
        getRequests: () => Array.from(TRACKER.requests.values()),
        getEmailRequests: () => Array.from(TRACKER.emailRequests.values()),
        getPhysicsRequests: () => Array.from(TRACKER.physicsRequests.values())
    };

    // ========================================================================
    // UTILITIES
    // ========================================================================

    function log(message, data = null) {
        terminalLog('info', message, data);
    }

    function logError(message, error) {
        terminalLog('error', message, error);
    }

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

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let errorBody = `HTTP ${response.status}: ${response.statusText}`;
                    try {
                        const errText = await response.text();
                        if (errText) errorBody += ` — ${errText.substring(0, 200)}`;
                    } catch (_) { }
                    throw new Error(errorBody);
                }

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
                    throw error;
                }

                const delay = CONFIG.RETRY_BASE_DELAY * (i + 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // ========================================================================
    // API HANDLERS
    // ========================================================================

    async function handleContactSubmission(payload) {
        log('Processing contact form submission', payload);

        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/contact`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        log('Backend confirmed email receipt', response);
        return response;
    }

    async function handleSimulation(payload) {
        log('Processing physics simulation request', payload);

        const response = await fetchWithRetry(
            `${CONFIG.BACKEND_URL}/api/simulate`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        log('Simulation completed', response);
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
    // MESSAGE LISTENER WITH TERMINAL TRACKING
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

        // Track the request
        trackRequest(id, action, payload);

        try {
            const data = await routeMessage(action, payload);

            // Update tracker: success
            updateRequestStatus(id, 'success', data);

            // Send response back to origin
            event.source.postMessage({
                id: id,
                status: 'success',
                data: data
            }, event.origin);

        } catch (error) {
            // Update tracker: error
            updateRequestStatus(id, 'error', error.message);

            // Send error back to origin
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

    log('Backend Bridge v3.0 with Terminal Tracker initialized', {
        backendUrl: CONFIG.BACKEND_URL,
        timeout: CONFIG.TIMEOUT,
        retryAttempts: CONFIG.RETRY_ATTEMPTS
    });

    // Initial health check
    handleHealthCheck()
        .then(() => {
            log('Backend is healthy and ready');
            window.dispatchEvent(new CustomEvent('bridge-ready'));
        })
        .catch(error => logError('Backend health check failed (cold start expected)', error));

    // Periodic stats logging (every 30 seconds)
    setInterval(() => {
        const stats = getTrackerStats();
        terminalLog('info', 'Bridge Stats', stats);
    }, 30000);

})();
