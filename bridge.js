// Listen for messages from the parent window (Frontend)
window.addEventListener('message', async (event) => {
    // Security: Ensure the message comes from your own domain
    if (event.origin !== window.location.origin) return;

    const { action, payload, id } = event.data;

    if (action === 'PING_BACKEND') {
        try {
            // This is where you connect to Render
            const response = await fetch('https://your-render-app.onrender.com/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();

            // Send the result back to the frontend
            event.source.postMessage({ 
                id: id, 
                status: 'success', 
                data: data 
            }, event.origin);

        } catch (error) {
            // Send error back
            event.source.postMessage({ 
                id: id, 
                status: 'error', 
                error: error.message 
            }, event.origin);
        }
    }
});
