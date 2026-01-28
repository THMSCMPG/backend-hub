This is the backend hub for my website. I am using render to host my backend. THMSCMPG, AURA-MF, and CircuitNotes send and receive informaation from backend-hub using the Broadcast Channel API
backend-hub remains open when any page on https://thmscmpg.github.io is active because it acts as an <ifram>
In case of an issue, information is backed up using the LocalStorage method to persist the data.

### Broadcast Channel API:
in my frontend repo
```html
<iframe src="https://thmscmpg.github.io/" id="backend-hub" style="display:none;"></iframe>
```
```js
const bus = new BroadcastChannel('site_communication');

function notifyMainRepo(info) {
  bus.postMessage({
    source: 'Repo-B',
    payload: info,
    timestamp: Date.now()
  });
}

// Example: Send data when a button is clicked
notifyMainRepo({ action: 'user_signup', email: 'test@example.com' });
```

in my backend repo
```js
// Create a channel named 'site_communication'
const bus = new BroadcastChannel('site_communication');

bus.onmessage = (event) => {
  console.log('Main Repo received data:', event.data);
  
  // Forward the data to your backend
  sendToActualBackend(event.data);
};

function sendToActualBackend(data) {
  // Your existing fetch logic to your server goes here
  console.log('Sending to backend server...');
}
```

### LocalStorage:
in my frontend repos
```js
// Saving data to the shared "bucket"
const dataToSync = { user: "Neo", points: 100 };
localStorage.setItem('shared_backend_queue', JSON.stringify(dataToSync));
```
in my backend repo
```js
// Reading that data
const savedData = localStorage.getItem('shared_backend_queue');
if (savedData) {
    const parsed = JSON.parse(savedData);
    console.log("Found data from AURA-MF:", parsed);
    // Now send 'parsed' to your backend!
}
```

### File Structure
```plaintext
/aura-mf-backend
  ├── README.md
  ├── .gitignore
  ├── app.py
  └── requirements.txt
```


