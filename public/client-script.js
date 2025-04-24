// Client-side JavaScript for Day Trader Dashboard
// This will handle anything needed for the frontend ONLY

// This object will help us display additional information about moods
const moodDescriptions = {
    "Golden Clarity (아지랑이)": "Clear skies favor tech leaders with strong vision and execution.",
    "Crispy Breeze (여름이었ㄷr..)": "Cool clarity brings focus to established tech companies.",
    "Rising Sun (TVXQ)": "Intense heat channels energy toward solar companies.",
    "Hazy Surge (눈 찌르는 무더위)": "Unpredictable conditions favor fast-moving delivery services.",
    "Black Rain (그런 날도 있는거다)": "Darker days call for essential utilities and infrastructure.",
    "Wind Cries Mary (장미꽃 향기는 바람에 날리고)": "Uncertainty drives interest in healthcare stability.",
    "Sunshower (여우비)": "Bright conditions after rain favor activewear and recreation.",
    "Still Waters (이슬비가 내리는 날이면)": "Cold and wet conditions direct focus to retail essentials."
  };
  
  // Once DOM is loaded, we can enhance the UI
  document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    
    // Add more descriptive mood information when mood is received
    socket.on('weatherMood', ({ mood }) => {
      console.log('Received weather mood:', mood);
      const moodDisplay = document.getElementById('weatherMood');
      const moodExplanation = document.getElementById('moodExplanation');
      
      moodDisplay.innerText = mood;
      
      if (moodDescriptions[mood]) {
        moodExplanation.innerText = moodDescriptions[mood];
      } else {
        moodExplanation.innerText = "Trading based on current environmental conditions.";
      }
    });
    
    // Add visual indicators to market status
    socket.on('marketStatus', ({ open }) => {
      if (open) {
        // Add a pulsing indicator when market is open
        const indicator = document.createElement('span');
        indicator.classList.add('pulse-indicator');
        indicator.innerHTML = " ●"; // Pulsing dot
        
        const statusEl = document.getElementById('marketStatus');
        if (!statusEl.querySelector('.pulse-indicator')) {
          statusEl.appendChild(indicator);
        }
      }
    });
    
    // Add fetch prices functionality for suggested stocks (for future implementation)
    socket.on('suggestedStocks', ({ stocks }) => {
      console.log('Would fetch latest prices for:', stocks);
      // In the future, this could call an API to get current prices
      // and update the stock list with actual prices
    });
  });
  
  // Add a visual trading pulse animation
  const style = document.createElement('style');
  style.innerHTML = `
    .pulse-indicator {
      color: #28a745;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.3; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);