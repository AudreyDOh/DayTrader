/**
 * Generate BLE Content sheet with line1, line2 for each minute from EST 9:30am
 * Usage: node generateBLEContent.js [date]
 * Example: node generateBLEContent.js 2026-01-08
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_DISPLAY_SHEET = 'BLE Display';
const BLE_CONTENT_SHEET = 'BLE Content';

async function generateBLEContent() {
  try {
    await authorizeGoogleSheets();
    
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Parse date argument (default: 2026-01-08)
    const dateArg = process.argv[2] || '2026-01-08';
    const [year, month, day] = dateArg.split('-').map(Number);
    
    console.log(`\n📊 Generating BLE Content for ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} EST 9:30am onwards...\n`);

    // Read BLE Display data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_DISPLAY_SHEET}!A:AN`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found in BLE Display sheet');
      return;
    }

    // Parse header
    const headerRow = rows[0];
    const timestampIdx = headerRow.indexOf('timestamp');
    const messageTypeIdx = headerRow.indexOf('message_type');
    const line1Idx = headerRow.indexOf('line1');
    const line2Idx = headerRow.indexOf('line2');
    const luxIdx = headerRow.indexOf('lux');
    const tempIdx = headerRow.indexOf('temperature');
    const humIdx = headerRow.indexOf('humidity');
    const powerIdx = headerRow.indexOf('power');
    const orderSymbolIdx = headerRow.indexOf('order_symbol');
    const orderSideIdx = headerRow.indexOf('order_side');
    const entryPriceIdx = headerRow.indexOf('entry_price');
    const holdMinutesLeftIdx = headerRow.indexOf('hold_minutes_left');
    const positionSymbolIdx = headerRow.indexOf('position_symbol');
    const positionSideIdx = headerRow.indexOf('position_side');
    const pnlPctIdx = headerRow.indexOf('pnl_pct');
    const positionStopLossIdx = headerRow.indexOf('position_stop_loss_pct');
    const positionTakeProfitIdx = headerRow.indexOf('position_take_profit_pct');
    const positionSizeIdx = headerRow.indexOf('position_size');
    const moodIdx = headerRow.indexOf('mood');
    const suggestedStock1Idx = headerRow.indexOf('suggested_stock_1');
    const suggestedStock2Idx = headerRow.indexOf('suggested_stock_2');

    // Filter data from EST 9:30am onwards
    const dataRows = rows.slice(1);
    const filteredData = [];
    
    for (const row of dataRows) {
      const timestamp = row[timestampIdx];
      if (!timestamp) continue;
      
      const date = new Date(timestamp);
      const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      // Check if it's the target date
      if (estDate.getFullYear() !== year || 
          estDate.getMonth() !== month - 1 || 
          estDate.getDate() !== day) {
        continue;
      }
      
      // Check if it's 9:30am or later
      const estHour = estDate.getHours();
      const estMinute = estDate.getMinutes();
      const totalMinutes = estHour * 60 + estMinute;
      const startMinutes = 9 * 60 + 30; // 9:30am
      
      if (totalMinutes >= startMinutes) {
        filteredData.push({
          timestamp,
          estDate,
          estHour,
          estMinute,
          messageType: row[messageTypeIdx] || '',
          line1: row[line1Idx] || '',
          line2: row[line2Idx] || '',
          lux: row[luxIdx] || '',
          temp: row[tempIdx] || '',
          hum: row[humIdx] || '',
          power: row[powerIdx] || '',
          orderSymbol: row[orderSymbolIdx] || '',
          orderSide: row[orderSideIdx] || '',
          entryPrice: row[entryPriceIdx] || '',
          holdMinutesLeft: row[holdMinutesLeftIdx] || '',
          positionSymbol: row[positionSymbolIdx] || '',
          positionSide: row[positionSideIdx] || '',
          pnlPct: row[pnlPctIdx] || '',
          positionStopLoss: row[positionStopLossIdx] || '',
          positionTakeProfit: row[positionTakeProfitIdx] || '',
          positionSize: row[positionSizeIdx] || '',
          mood: row[moodIdx] || '',
          suggested_stock_1: row[suggestedStock1Idx] || '',
          suggested_stock_2: row[suggestedStock2Idx] || '',
          riskStopLoss: row[headerRow.indexOf('risk_stop_loss_pct')] || '',
          riskTakeProfit: row[headerRow.indexOf('risk_take_profit_pct')] || '',
          riskHoldMinutes: row[headerRow.indexOf('risk_hold_minutes')] || '',
          orderSize: row[headerRow.indexOf('order_size')] || '',
          riskStopLoss: row[headerRow.indexOf('risk_stop_loss_pct')] || '',
          riskTakeProfit: row[headerRow.indexOf('risk_take_profit_pct')] || '',
          orderSize: row[headerRow.indexOf('order_size')] || '',
          riskHoldMinutes: row[headerRow.indexOf('risk_hold_minutes')] || ''
        });
      }
    }

    // Sort by time
    filteredData.sort((a, b) => a.estDate.getTime() - b.estDate.getTime());

    if (filteredData.length === 0) {
      console.log(`❌ No data found for ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} EST 9:30am onwards`);
      return;
    }

    console.log(`✅ Found ${filteredData.length} entries from EST 9:30am onwards\n`);

    // Read Alpaca Trades to get ORDER information (do this first)
    const { readTradesFromSheet } = require('./logToSheets');
    const trades = await readTradesFromSheet(1000, 'Alpaca Trades');
    console.log(`✅ Found ${trades.length} trades from Alpaca Trades\n`);
    
    // Convert trades to ORDER format for BLE Content
    const tradeOrders = [];
    for (const trade of trades) {
      const tradeDate = new Date(trade.tsMs || trade.tsIso || Date.now());
      const estDate = new Date(tradeDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      // Check if it's the target date
      if (estDate.getFullYear() === year && 
          estDate.getMonth() === month - 1 && 
          estDate.getDate() === day) {
        const estHour = estDate.getHours();
        const estMinute = estDate.getMinutes();
        const totalMinutes = estHour * 60 + estMinute;
        const startMinutes = 9 * 60 + 30;
        
        if (totalMinutes >= startMinutes && trade.symbol && trade.entryPrice) {
          const timeKey = `${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')}`;
          tradeOrders.push({
            timeKey,
            estHour,
            estMinute,
            symbol: trade.symbol.toUpperCase(),
            side: trade.side === 'long' ? 'BUY' : 'SELL',
            entryPrice: trade.entryPrice,
            shares: trade.shares,
            timestamp: trade.tsIso || trade.tsLocal
          });
        }
      }
    }
    
    // Sort trades by time
    tradeOrders.sort((a, b) => {
      const timeA = a.estHour * 60 + a.estMinute;
      const timeB = b.estHour * 60 + b.estMinute;
      return timeA - timeB;
    });
    
    console.log(`✅ Found ${tradeOrders.length} trades for target date\n`);

    // Group by minute and symbol - keep all positions for each minute
    const minuteMap = new Map(); // key: timeKey, value: array of messages
    const orderWeatherMap = new Map(); // key: timeKey, value: ORDER_WEATHER message
    const orderMap = new Map(); // key: timeKey, value: ORDER message
    
    for (const data of filteredData) {
      const timeKey = `${String(data.estHour).padStart(2, '0')}:${String(data.estMinute).padStart(2, '0')}`;
      const symbol = data.positionSymbol || data.orderSymbol || '';
      
      // Priority: ORDER > POSITION > ORDER_WEATHER > DECISION
      const priority = {
        'ORDER': 4,
        'POSITION': 3,
        'ORDER_WEATHER': 2,
        'DECISION': 1,
        'EXIT': 5
      };
      
      // Store ORDER_WEATHER separately
      if (data.messageType === 'ORDER_WEATHER') {
        orderWeatherMap.set(timeKey, data);
        // Find corresponding ORDER message
        const orderData = filteredData.find(d => 
          d.messageType === 'ORDER' && 
          d.estHour === data.estHour && 
          d.estMinute === data.estMinute &&
          d.orderSymbol === data.orderSymbol
        );
        if (orderData) {
          orderMap.set(timeKey, orderData);
        }
        continue;
      }
      
      // Store ORDER separately (keep the most recent one if multiple orders at same time)
      if (data.messageType === 'ORDER') {
        const existing = orderMap.get(timeKey);
        if (!existing) {
          orderMap.set(timeKey, data);
        } else {
          // Keep the one with later timestamp or higher priority symbol
          const existingTs = existing.timestamp || existing.estDate?.getTime() || 0;
          const newTs = data.timestamp || data.estDate?.getTime() || 0;
          if (newTs > existingTs) {
            orderMap.set(timeKey, data);
          }
        }
        continue;
      }
      
      // For POSITION, store by symbol to track multiple positions
      if (data.messageType === 'POSITION' && symbol) {
        const posKey = `${timeKey}_${symbol}`;
        if (!minuteMap.has(timeKey)) {
          minuteMap.set(timeKey, []);
        }
        const existing = minuteMap.get(timeKey);
        // Check if this symbol already exists
        const existingPos = existing.find(m => 
          m.messageType === 'POSITION' && 
          (m.positionSymbol || m.orderSymbol) === symbol
        );
        if (!existingPos) {
          existing.push(data);
        } else {
          // Replace with newer one (higher priority)
          const idx = existing.indexOf(existingPos);
          existing[idx] = data;
        }
        continue;
      }
      
      // For other types, keep highest priority
      const currentPriority = priority[data.messageType] || 0;
      if (!minuteMap.has(timeKey)) {
        minuteMap.set(timeKey, []);
      }
      const existing = minuteMap.get(timeKey);
      const existingMsg = existing.find(m => m.messageType === data.messageType);
      if (!existingMsg) {
        existing.push(data);
      } else {
        const existingPriority = priority[existingMsg.messageType] || 0;
        if (currentPriority > existingPriority) {
          const idx = existing.indexOf(existingMsg);
          existing[idx] = data;
        }
      }
    }

    // Create BLE Content data
    const bleContentRows = [];
    bleContentRows.push([
      'EST_TIME',
      'STAGE',
      'MESSAGE_TYPE',
      'LINE1',
      'LINE2',
      'DESCRIPTION'
    ]);

    // Track last order for showing "last order" info when no new order
    let lastOrderData = null;
    let lastOrderTimeKey = null;
    
    // Generate content for each minute from 9:30am to 4:00pm (16:00)
    const startHour = 9;
    const startMinute = 30;
    const endHour = 16;
    const endMinute = 0;

    for (let hour = startHour; hour <= endHour; hour++) {
      // For the end hour, include up to endMinute (if endMinute is 0, include 16:00)
      const maxMinute = hour === endHour ? (endMinute === 0 ? 1 : endMinute + 1) : 60;
      const startMin = hour === startHour ? startMinute : 0;
      for (let minute = startMin; minute < maxMinute; minute++) {
        const timeKey = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        
        // Check for ORDER_WEATHER + ORDER pair first
        const weatherData = orderWeatherMap.get(timeKey);
        let orderData = orderMap.get(timeKey);
        
        // Get all orders for this time (from BLE Display or Alpaca Trades)
        let allOrdersAtTime = [];
        
        // First, check BLE Display
        if (orderData) {
          allOrdersAtTime.push(orderData);
        }
        
        // Then, check Alpaca Trades
        const tradeOrdersAtTime = tradeOrders.filter(t => t.timeKey === timeKey);
        if (tradeOrdersAtTime.length > 0) {
          // Sort by timestamp (most recent first)
          tradeOrdersAtTime.sort((a, b) => {
            if (a.timestamp && b.timestamp) {
              try {
                const tsA = new Date(a.timestamp).getTime();
                const tsB = new Date(b.timestamp).getTime();
                return tsB - tsA; // Most recent first
              } catch (e) {
                return 0;
              }
            }
            return 0;
          });
          
          // Convert each trade to orderData format
          for (const tradeOrder of tradeOrdersAtTime) {
            // Only add if not already in allOrdersAtTime (avoid duplicates)
            const alreadyExists = allOrdersAtTime.some(o => 
              o.orderSymbol === tradeOrder.symbol && 
              o.orderSide === tradeOrder.side &&
              Math.abs((o.entryPrice || 0) - tradeOrder.entryPrice) < 0.01
            );
            
            if (!alreadyExists) {
              allOrdersAtTime.push({
                messageType: 'ORDER',
                orderSymbol: tradeOrder.symbol,
                orderSide: tradeOrder.side,
                entryPrice: tradeOrder.entryPrice,
                orderSize: tradeOrder.shares,
                line1: `LIVE TRADE ${timeKey} EST`,
                line2: `${tradeOrder.side} ${tradeOrder.symbol} ${tradeOrder.entryPrice.toFixed(2)} LIVE TRADING`,
                fromAlpacaTrades: true,
                timestamp: tradeOrder.timestamp
              });
            }
          }
        }
        
        // If no orders, use last order
        if (allOrdersAtTime.length === 0 && lastOrderData) {
          allOrdersAtTime.push({ ...lastOrderData, isLastOrder: true, lastOrderTime: lastOrderTimeKey });
        }
        
        // Update last order if we have new ones
        if (allOrdersAtTime.length > 0 && !allOrdersAtTime[0].isLastOrder) {
          lastOrderData = allOrdersAtTime[0];
          lastOrderTimeKey = timeKey;
        }
        
        // If no order for this minute, use last order (for showing "last order" info)
        if (!orderData && lastOrderData) {
          // Use last order but mark it as "last order"
          orderData = { ...lastOrderData, isLastOrder: true, lastOrderTime: lastOrderTimeKey };
        }
        
        // Update last order if we have a new one
        if (orderData && !orderData.isLastOrder) {
          lastOrderData = orderData;
          lastOrderTimeKey = timeKey;
        }
        
        // Get messages for this minute
        const minuteMessages = minuteMap.get(timeKey) || [];
        
        // Helper function to convert English text to uppercase
        const toUpperCase = (text) => {
          if (!text || typeof text !== 'string') return text;
          // Preserve numbers, symbols, and Korean characters, but uppercase English letters
          return text.replace(/[a-z]+/g, (match) => match.toUpperCase());
        };
        
        // Helper function to convert LONG/SHORT to BUY/SELL
        const convertLongShortToBuySell = (text) => {
          if (!text) return text;
          let result = text
            .replace(/\bLONG\b/g, 'BUY')
            .replace(/\bSHORT\b/g, 'SELL')
            .replace(/\blong\b/g, 'BUY')
            .replace(/\bshort\b/g, 'SELL');
          return toUpperCase(result);
        };
        
        // Helper function to create last order display
        const createLastOrderDisplay = (order) => {
          if (!order || !order.orderSymbol) return null;
          const orderSide = order.orderSide === 'LONG' ? 'BUY' : (order.orderSide === 'SHORT' ? 'SELL' : order.orderSide);
          const entryPrice = order.entryPrice ? (typeof order.entryPrice === 'number' ? order.entryPrice.toFixed(2) : parseFloat(order.entryPrice).toFixed(2)) : '—';
          return {
            line1: toUpperCase(`LAST ORDER ${order.lastOrderTime || ''} EST`),
            line2: toUpperCase(`${orderSide} ${order.orderSymbol} ${entryPrice} LIVE TRADING`),
            description: `마지막 ORDER 정보 (${order.orderSymbol} ${orderSide})`
          };
        };
        
        // ===== STAGE 1: 기상 데이터 (항상 표시) =====
        let weatherLine1 = '—';
        let weatherLine2 = '—';
        let weatherDescription = '기상 데이터 없음';
        
        // Find weather data for this minute
        const decisionMsg = minuteMessages.find(m => m.messageType === 'DECISION');
        if (decisionMsg) {
          weatherLine1 = convertLongShortToBuySell(decisionMsg.line1 || '—');
          weatherLine2 = convertLongShortToBuySell(decisionMsg.line2 || '—');
          weatherDescription = '1단계: 기상 데이터';
          // Update lastValidWeatherGlobal
          if (weatherLine1 !== '—' && weatherLine1 !== '' && weatherLine1.includes('LUX')) {
            lastValidWeatherGlobal = { line1: weatherLine1, line2: weatherLine2 };
          }
        } else if (minuteMessages.length > 0) {
          // Use first message's sensor data if available
          const firstMsg = minuteMessages[0];
          if (firstMsg.lux || firstMsg.temp) {
            const lux = firstMsg.lux ? `${Math.round(parseFloat(firstMsg.lux) / 1000)}k` : '—';
            const temp = firstMsg.temp ? Math.round(parseFloat(firstMsg.temp)) : '—';
            const hum = firstMsg.hum ? Math.round(parseFloat(firstMsg.hum)) : '—';
            const pwr = firstMsg.power ? parseFloat(firstMsg.power).toFixed(3) : '—';
            weatherLine1 = toUpperCase(`LUX ${lux} TEMP ${temp} HUM ${hum} PWR ${pwr}`);
            const mood = firstMsg.mood || '—';
            const stock1 = firstMsg.suggested_stock_1 || '';
            const stock2 = firstMsg.suggested_stock_2 || '';
            const stocks = stock1 && stock2 ? `${stock1} ${stock2}` : (stock1 || '—');
            weatherLine2 = toUpperCase(`MOOD ${mood} WATCH ${stocks}`.trim());
            weatherDescription = '1단계: 기상 데이터';
            // Update lastValidWeatherGlobal
            if (weatherLine1 !== '—' && weatherLine1 !== '' && weatherLine1.includes('LUX')) {
              lastValidWeatherGlobal = { line1: weatherLine1, line2: weatherLine2 };
            }
          }
        } else {
          // Try to find nearby minute's data for weather (within 5 minutes)
          let foundNearby = false;
          for (let offset = -5; offset <= 5; offset++) {
            const checkMinute = minute + offset;
            if (checkMinute >= 0 && checkMinute < 60) {
              const checkHour = checkMinute < 0 ? hour - 1 : (checkMinute >= 60 ? hour + 1 : hour);
              if (checkHour >= 0 && checkHour < 24) {
                const checkKey = `${String(checkHour).padStart(2, '0')}:${String(checkMinute >= 0 ? checkMinute : checkMinute + 60).padStart(2, '0')}`;
                const checkMessages = minuteMap.get(checkKey) || [];
                const checkDecision = checkMessages.find(m => m.messageType === 'DECISION');
                if (checkDecision) {
                  weatherLine1 = convertLongShortToBuySell(checkDecision.line1 || '—');
                  weatherLine2 = convertLongShortToBuySell(checkDecision.line2 || '—');
                  weatherDescription = '1단계: 기상 데이터 (근처 시간 데이터 사용)';
                  foundNearby = true;
                  if (weatherLine1 !== '—' && weatherLine1 !== '' && weatherLine1.includes('LUX')) {
                    lastValidWeatherGlobal = { line1: weatherLine1, line2: weatherLine2 };
                  }
                  break;
                } else if (checkMessages.length > 0) {
                  const checkMsg = checkMessages[0];
                  if (checkMsg.lux && checkMsg.lux !== '' && checkMsg.lux !== '0') {
                    const lux = checkMsg.lux ? `${Math.round(parseFloat(checkMsg.lux) / 1000)}k` : '—';
                    const temp = checkMsg.temp ? Math.round(parseFloat(checkMsg.temp)) : '—';
                    const hum = checkMsg.hum ? Math.round(parseFloat(checkMsg.hum)) : '—';
                    const pwr = checkMsg.power ? parseFloat(checkMsg.power).toFixed(3) : '—';
                    weatherLine1 = toUpperCase(`LUX ${lux} TEMP ${temp} HUM ${hum} PWR ${pwr}`);
                    const mood = checkMsg.mood || '—';
                    const stock1 = checkMsg.suggested_stock_1 || '';
                    const stock2 = checkMsg.suggested_stock_2 || '';
                    const stocks = stock1 && stock2 ? `${stock1} ${stock2}` : (stock1 || '—');
                    weatherLine2 = toUpperCase(`MOOD ${mood} WATCH ${stocks}`.trim());
                    weatherDescription = '1단계: 기상 데이터 (근처 시간 데이터 사용)';
                    foundNearby = true;
                    if (weatherLine1 !== '—' && weatherLine1 !== '' && weatherLine1.includes('LUX')) {
                      lastValidWeatherGlobal = { line1: weatherLine1, line2: weatherLine2 };
                    }
                    break;
                  }
                }
              }
            }
          }
          
          // If no nearby data found and we have last valid weather, reuse it
          if (!foundNearby && lastValidWeatherGlobal) {
            weatherLine1 = lastValidWeatherGlobal.line1;
            weatherLine2 = lastValidWeatherGlobal.line2;
            weatherDescription = '1단계: 기상 데이터 (마지막 데이터 재사용)';
          } else if (!foundNearby) {
            // No data at all - mark as no data
            weatherLine1 = '—';
            weatherLine2 = '—';
            weatherDescription = '기상 데이터 없음';
          }
        }
        
        // ===== Generate rows for this minute =====
        // If multiple orders, create: WEATHER - ORDER1 - WEATHER - ORDER2
        // If single order, create: WEATHER - ORDER
        // If no order, create: WEATHER - LAST_ORDER/POSITION/DECISION
        
        // Always add first STAGE 1 (weather)
        bleContentRows.push([
          timeKey,
          '1',
          'WEATHER',
          weatherLine1,
          weatherLine2,
          weatherDescription
        ]);
        
        // Process each order separately
        if (allOrdersAtTime.length > 0) {
          for (let i = 0; i < allOrdersAtTime.length; i++) {
            const currentOrderData = allOrdersAtTime[i];
            
            // If multiple orders and not the first one, add weather again before this order
            if (i > 0) {
              bleContentRows.push([
                timeKey,
                '1',
                'WEATHER',
                weatherLine1,
                weatherLine2,
                weatherDescription + ' (반복)'
              ]);
            }
            
            // Generate STAGE 2 for this order
            let stage2Type = 'NO_DATA';
            let stage2Line1 = '—';
            let stage2Line2 = '—';
            let stage2Description = '데이터 없음';
            
            // Check if this is an ORDER
            const hasOrderAtThisTime = currentOrderData && !currentOrderData.isLastOrder && (
              currentOrderData.messageType === 'ORDER' || currentOrderData.fromAlpacaTrades
            );
            
            if (hasOrderAtThisTime) {
              // ORDER 정보
              const orderSide = currentOrderData.orderSide || 'BUY';
              const entryPrice = currentOrderData.entryPrice ? (typeof currentOrderData.entryPrice === 'number' ? currentOrderData.entryPrice.toFixed(2) : parseFloat(currentOrderData.entryPrice).toFixed(2)) : '';
              const size = currentOrderData.orderSize || currentOrderData.order_size || '';
              
              // Find risk parameters from order data or nearby messages
              let stopLoss = currentOrderData.riskStopLoss || '';
              let takeProfit = currentOrderData.riskTakeProfit || '';
              let hold = currentOrderData.holdMinutesLeft != null && currentOrderData.holdMinutesLeft !== '' ? Math.max(0, Math.round(parseFloat(currentOrderData.holdMinutesLeft))) : 
                        (currentOrderData.riskHoldMinutes ? Math.round(parseFloat(currentOrderData.riskHoldMinutes)) : 8);
              
              if (!stopLoss || !takeProfit) {
                const nearbyMsg = minuteMessages.find(m => m.riskStopLoss || m.riskTakeProfit) || 
                                 filteredData.find(d => d.estHour === hour && Math.abs(d.estMinute - minute) <= 2 && (d.riskStopLoss || d.riskTakeProfit));
                if (nearbyMsg) {
                  stopLoss = stopLoss || nearbyMsg.riskStopLoss || '';
                  takeProfit = takeProfit || nearbyMsg.riskTakeProfit || '';
                  if (!hold || hold === 8) {
                    hold = nearbyMsg.riskHoldMinutes ? Math.round(parseFloat(nearbyMsg.riskHoldMinutes)) : hold;
                  }
                }
              }
              
              const slStr = stopLoss && stopLoss !== '' ? parseFloat(stopLoss).toFixed(1) : '—';
              const tpStr = takeProfit && takeProfit !== '' ? parseFloat(takeProfit).toFixed(1) : '—';
              const sizeStr = size || '—';
              
              stage2Type = 'ORDER';
              stage2Line1 = toUpperCase(convertLongShortToBuySell(currentOrderData.line1 || `LIVE TRADE ${timeKey} EST`));
              
              // Generate line2 with STOP/GAIN info for this specific order
              if (currentOrderData.line2 && currentOrderData.line2.trim() && currentOrderData.line2 !== '—' && currentOrderData.line2.includes('SL') && currentOrderData.line2.includes('TP')) {
                // If line2 already exists with SL/TP, convert to STOP/GAIN
                stage2Line2 = toUpperCase(convertLongShortToBuySell(currentOrderData.line2)
                  .replace(/\bSL\b/g, 'STOP')
                  .replace(/\bTP\b/g, 'GAIN'));
              } else {
                // Generate line2 with STOP/GAIN info
                stage2Line2 = toUpperCase(`${orderSide} ${currentOrderData.orderSymbol} ${entryPrice} HOLD ${hold}m STOP ${slStr} GAIN ${tpStr} SIZE ${sizeStr}`);
              }
              stage2Description = `2단계: ORDER 정보 (${currentOrderData.orderSymbol} ${orderSide})`;
            } else if (currentOrderData && currentOrderData.isLastOrder) {
              // LAST_ORDER 정보
              const lastOrderDisplay = createLastOrderDisplay(currentOrderData);
              if (lastOrderDisplay) {
                stage2Type = 'LAST_ORDER';
                stage2Line1 = lastOrderDisplay.line1;
                stage2Line2 = lastOrderDisplay.line2;
                stage2Description = lastOrderDisplay.description;
              }
            }
            
            // Add STAGE 2 row for this order
            bleContentRows.push([
              timeKey,
              '2',
              stage2Type,
              stage2Line1,
              stage2Line2,
              stage2Description
            ]);
          }
        } else {
          // Check for POSITION
          const positionMsg = minuteMessages.find(m => m.messageType === 'POSITION');
          if (positionMsg) {
            stage2Type = 'POSITION';
            const symbol = positionMsg.positionSymbol || positionMsg.orderSymbol || '—';
            const side = positionMsg.positionSide || positionMsg.orderSide || '—';
            const sideLabel = side === 'LONG' ? 'BUY' : (side === 'SHORT' ? 'SELL' : side);
            const entryPrice = positionMsg.entryPrice ? (typeof positionMsg.entryPrice === 'number' ? positionMsg.entryPrice.toFixed(2) : parseFloat(positionMsg.entryPrice).toFixed(2)) : '—';
            const pnlPct = positionMsg.pnlPct != null && positionMsg.pnlPct !== '' && !isNaN(parseFloat(positionMsg.pnlPct)) ? parseFloat(positionMsg.pnlPct) : null;
            const pnlStr = pnlPct != null ? `${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : '—';
            const holdLeft = positionMsg.holdMinutesLeft != null && positionMsg.holdMinutesLeft !== '' && !isNaN(parseFloat(positionMsg.holdMinutesLeft)) ? Math.max(0, Math.round(parseFloat(positionMsg.holdMinutesLeft))) : 0;
            
            // Generate line1 and line2 from position data
            stage2Line1 = toUpperCase(`OPEN ${symbol} ${sideLabel} ${entryPrice} P/L ${pnlStr} HOLD ${holdLeft}m`);
            
            const sl = positionMsg.positionStopLoss ? parseFloat(positionMsg.positionStopLoss).toFixed(1) : '—';
            const tp = positionMsg.positionTakeProfit ? parseFloat(positionMsg.positionTakeProfit).toFixed(1) : '—';
            const size = positionMsg.positionSize || '—';
            // SL/TP를 더 명확하게 표시: STOP LOSS → STOP, TAKE PROFIT → GAIN
            stage2Line2 = toUpperCase(`STOP ${sl} GAIN ${tp} SIZE ${size}`);
            
            stage2Description = `2단계: 포지션 정보 (${symbol} ${sideLabel})`;
          } else if (decisionMsg) {
            // No ORDER, no POSITION - use DECISION as fallback
            stage2Type = 'DECISION';
            stage2Line1 = toUpperCase(convertLongShortToBuySell(decisionMsg.line1 || '—'));
            stage2Line2 = toUpperCase(convertLongShortToBuySell(decisionMsg.line2 || '—'));
            stage2Description = '2단계: 트레이딩 결정 전';
          }
        }
        
        // Add STAGE 2 row
        bleContentRows.push([
          timeKey,
          '2',
          stage2Type,
          stage2Line1,
          stage2Line2,
          stage2Description
        ]);
      }
    }

    // Check if BLE Content sheet exists, create if not
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });

    const existingSheet = spreadsheet.data.sheets?.find(
      sheet => sheet.properties.title === BLE_CONTENT_SHEET
    );

    if (!existingSheet) {
      // Create new sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: BLE_CONTENT_SHEET
              }
            }
          }]
        }
      });
      console.log(`✅ Created new sheet "${BLE_CONTENT_SHEET}"`);
    }

    // Clear existing data and write new data
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:Z`
    });

      await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: bleContentRows
      }
    });
    
    // Update range to include STAGE column
    const updateRange = `${BLE_CONTENT_SHEET}!A:F`;

    // Format header row
    const sheetId = spreadsheet.data.sheets?.find(
      sheet => sheet.properties.title === BLE_CONTENT_SHEET
    )?.properties.sheetId;

    if (sheetId) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 5
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
                  }
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)'
              }
            },
            {
              updateSheetProperties: {
                properties: {
                  sheetId: sheetId,
                  gridProperties: {
                    frozenRowCount: 1
                  }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            }
          ]
        }
      });
    }

    console.log(`✅ Generated ${bleContentRows.length - 1} rows in "${BLE_CONTENT_SHEET}" sheet`);
    console.log(`\n📋 Summary:`);
    console.log(`   - Date: ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    console.log(`   - Time range: EST 9:30am - 4:00pm`);
    console.log(`   - Total entries: ${bleContentRows.length - 1}`);
    console.log(`\n✅ BLE Content sheet ready!\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

generateBLEContent();

