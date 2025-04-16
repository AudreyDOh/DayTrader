const socket = io();

// Display the weather mood
socket.on('weatherMood', data => {
  console.log("Received weatherMood:", data);
  const moodDisplay = document.getElementById('weatherMood');
  if (moodDisplay) {
    moodDisplay.innerText = data.mood ?? 'Unknown';
  }
});

// Display the suggested stock list
socket.on('suggestedStocks', data => {
  console.log("Received suggestedStocks:", data);
  const list = document.getElementById('suggestedStocks');
  if (list && Array.isArray(data.stocks)) {
    list.innerHTML = '';
    data.stocks.forEach(stock => {
      const li = document.createElement('li');
      li.textContent = stock;
      list.appendChild(li);
    });
  }
});

// Update sensor readings
socket.on('mqttData', ({ latest, history }) => {
  console.log("Received mqttData:", { latest, history });

  const latestOutput = `
Lux: ${latest.lux}
Temperature: ${latest.temperature}
Humidity: ${latest.humidity}
Power: ${latest.power}
Battery: ${latest.battery}
  `.trim();

  document.getElementById('timestamp').innerText = `Last data logged at ${latest.time}`;
  document.getElementById('output').innerText = latestOutput;

  const historyContainer = document.getElementById('history');
  historyContainer.innerHTML = history
    .map(entry => {
      return `<pre><strong>${entry.time}</strong>\n${[
        `Lux: ${entry.lux}`, 
        `Temperature: ${entry.temperature}`,
        `Humidity: ${entry.humidity}`,
        `Power: ${entry.power}`,
        `Battery: ${entry.battery}`
      ].join(', ')}</pre>`;
    })
    .join('');
});

// Real-time clock
function updateClock() {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  document.getElementById('clock').innerText = `Current EST Time: ${now}`;
}

setInterval(updateClock, 1000);
updateClock();
