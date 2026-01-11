/* 
Two-line LED ticker message generator.
Generates short, gallery-friendly strings that map solar sensor data → trading decisions/state.
*/

const { getRiskProfile, getMaxHoldMinutes } = require('./solarStrategy');

// ---- Formatting helpers ----
function clampNumber(value) {
  if (value == null || Number.isNaN(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatThousands(n) {
  const v = clampNumber(n);
  if (v == null) return '—';
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

function formatOneDecimal(n) {
  const v = clampNumber(n);
  if (v == null) return '—';
  return `${Math.round(v * 10) / 10}`;
}

function formatTwoDecimals(n) {
  const v = clampNumber(n);
  if (v == null) return '—';
  return (Math.round(v * 100) / 100).toFixed(2);
}

function formatMoney(n) {
  const v = clampNumber(n);
  if (v == null) return undefined;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function toPct(n) {
  const v = clampNumber(n);
  if (v == null) return '—';
  return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
}

function emojiForDelta(pct) {
  // 이모티콘 제거 - 숫자로만 표시
  const v = clampNumber(pct);
  if (v == null) return '';
  if (v > 0) return '+';
  if (v < 0) return '-';
  return '';
}

function sideToVerb(side) {
  return side === 'short' ? 'SELL' : 'BUY';
}

function sideToLabel(side) {
  // BUY/SELL로 표시 (LONG/SHORT 대신)
  return side === 'short' ? 'SELL' : 'BUY';
}

function reasonLabel(reason) {
  switch (reason) {
    case 'take_profit': return 'TP HIT';
    case 'stop_loss': return 'SL HIT';
    case 'max_hold_time': return 'TIMEOUT';
    case 'market_close': return 'MKT CLOSE';
    default: return 'EXIT';
  }
}

// Helper function to convert English text to uppercase
function toUpperCase(text) {
  if (!text || typeof text !== 'string') return text;
  // Preserve numbers, symbols, and Korean characters, but uppercase English letters
  return text.replace(/[a-z]+/g, (match) => match.toUpperCase());
}

function buildSunLine(sensor) {
  const lux = formatThousands(sensor?.lux);
  const temp = Math.round(clampNumber(sensor?.temperature) ?? 0);
  const hum = Math.round(clampNumber(sensor?.humidity) ?? 0);
  const pwrKw = clampNumber(sensor?.power) != null ? `${formatThreeDecimals(sensor.power)}` : '—';
  return toUpperCase(`LUX ${lux} TEMP ${temp} HUM ${hum} PWR ${pwrKw}`);
}

function formatThreeDecimals(n) {
  const v = clampNumber(n);
  if (v == null) return '—';
  return (Math.round(v * 1000) / 1000).toFixed(3);
}

// ---- Message builders ----

// Decision (pre-trade): 아무것도 안 샀을 때
function formatDecision(sensor, mood, suggestedStocks = [], risk, account) {
  const line1 = buildSunLine(sensor);
  const primary = suggestedStocks[0];
  const secondary = suggestedStocks[1];

  const picks =
    primary && secondary ? `${primary} ${secondary}` :
    primary ? primary : '—';

  // WATCH로 표시 (아직 안 샀을 때)
  const moodStr = mood ? mood.toUpperCase().replace(/ & /g, ' ') : '—';
  const line2 = toUpperCase(`MOOD ${moodStr} WATCH ${picks}`);
  return `${line1}\n${line2}`;
}

// Order (at execution) - 단타 투자 시작 표시
// Returns both weather data message and order message separately
function formatOrder(sensor, order, risk, account, mood = null) {
  // 1차: 기상 데이터 메시지
  const weatherLine1 = buildSunLine(sensor);
  const moodStr = mood ? mood.toUpperCase().replace(/ & /g, ' ') : '—';
  const weatherLine2 = toUpperCase(`MOOD ${moodStr} LIVE TRADING`);
  const weatherMessage = `${weatherLine1}\n${weatherLine2}`;
  
  // 2차: ORDER 정보 메시지
  const now = new Date();
  const estTime = now.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const verb = sideToVerb(order?.side); // BUY or SELL
  const symbol = order?.symbol ?? '—';
  const entryPrice = order?.entryPrice != null ? formatTwoDecimals(order.entryPrice) : 'MKT';
  const sl = toPct(risk?.stopLossPct);
  const tp = toPct(risk?.takeProfitPct);
  const size = order?.size != null ? `${order.size}` : '—';
  const hold = order?.holdMinutesLeft != null
    ? Math.max(0, Math.round(order.holdMinutesLeft))
    : Math.round(risk?.holdMinutes ?? 0);
  
  // 이모티콘과 기호 제거
  const orderLine1 = toUpperCase(`LIVE TRADE ${estTime} EST`);
  // SL/TP를 더 명확하게 표시: STOP LOSS → STOP, TAKE PROFIT → GAIN
  const orderLine2 = toUpperCase(`${verb} ${symbol} ${entryPrice} HOLD ${hold}m STOP ${sl} GAIN ${tp} SIZE ${size}`);
  const orderMessage = `${orderLine1}\n${orderLine2}`;
  
  // Return both messages
  return {
    weather: weatherMessage,
    order: orderMessage,
    weatherLine1,
    weatherLine2,
    orderLine1,
    orderLine2
  };
}

// Active position - 사 놓고 HOLD 할 때
function formatActivePosition(position) {
  const pl = clampNumber(position?.pnlPct);
  const sign = emojiForDelta(pl); // + or - or ''
  const plStr = pl == null ? '—' : `${sign}${Math.abs(pl).toFixed(1)}%`;
  const price = position?.entryPrice != null ? formatTwoDecimals(position.entryPrice) : '—';
  const holdLeft = position?.holdMinutesLeft != null ? Math.max(0, Math.round(position.holdMinutesLeft)) : 0;
  const sideLabel = sideToLabel(position?.side); // BUY or SELL
  
  // 이모티콘 제거, 간결하게
  const line1 = toUpperCase(`OPEN ${position?.symbol ?? '—'} ${sideLabel} ${price} P/L ${plStr} HOLD ${holdLeft}m`);

  const sl = toPct(position?.slPct);
  const tp = toPct(position?.tpPct);
  const size = position?.size != null ? `${position.size}` : '—';
  // SL/TP를 더 명확하게 표시: STOP LOSS → STOP, TAKE PROFIT → GAIN
  const line2 = toUpperCase(`STOP ${sl} GAIN ${tp} SIZE ${size}`);
  return `${line1}\n${line2}`;
}

// Exit event - 포지션 청산
function formatExit(exit) {
  const entry = exit?.entryPrice != null ? formatTwoDecimals(exit.entryPrice) : '—';
  const out = exit?.exitPrice != null ? formatTwoDecimals(exit.exitPrice) : '—';
  const sideLabel = sideToLabel(exit?.side); // BUY or SELL
  const cause = reasonLabel(exit?.reason);
  
  // 이모티콘 제거
  const line1 = toUpperCase(`EXIT ${exit?.symbol ?? '—'} ${sideLabel} ${entry} ${out} ${cause}`);

  const held = exit?.heldMinutes != null ? `${Math.round(exit.heldMinutes)}m` : '—';
  const pl = clampNumber(exit?.pnlPct);
  const sign = emojiForDelta(pl);
  const plStr = pl == null ? '—' : `${sign}${Math.abs(pl).toFixed(1)}%`;
  const line2 = toUpperCase(`P/L ${plStr} HELD ${held}`);
  return `${line1}\n${line2}`;
}

// Market closed fallback
function formatMarketClosed(sensor, mood, suggestedStocks = [], market = {}, account = {}) {
  const line1 = buildSunLine(sensor);
  const parts = ['MARKET CLOSED'];

  if (market?.nextOpenMinutes != null) {
    // nextOpenMinutes는 미국 시간(EST) 기준이므로, 한국 시간으로 표시할 때는 시차(14시간)를 빼야 함
    const mins = Math.max(0, Math.round(market.nextOpenMinutes));
    const timezoneOffsetHours = 14; // KST is 14 hours ahead of EST
    const adjustedMins = mins - (timezoneOffsetHours * 60);
    
    if (adjustedMins > 0) {
      const h = Math.floor(adjustedMins / 60);
      const m = adjustedMins % 60;
      parts.push(`OPEN IN ${h}h${m}m`);
    } else {
      // If adjusted time is negative or zero, market opens very soon (within 14 hours)
      parts.push('OPEN SOON');
    }
  } else {
    parts.push('NEXT 09:30ET');
  }

  if (market?.cooldownMinutesLeft != null && market.cooldownMinutesLeft > 0) {
    parts.push(`COOLDOWN ${Math.round(market.cooldownMinutesLeft)}m`);
  }

  const cashStr = formatMoney(account?.cash);
  if (cashStr) parts.push(`CASH ${cashStr}`);

  const primary = suggestedStocks[0];
  const secondary = suggestedStocks[1];
  const queue =
    primary && secondary ? `${primary}, ${secondary}` :
    primary ? primary : null;
  if (mood) parts.push(`MOOD ${mood.toUpperCase()}`);
  if (queue) parts.push(`QUEUE ${queue}`);

  const line2 = toUpperCase(parts.join(' '));
  return `${line1}\n${line2}`;
}

// Orchestrator: given a snapshot, return an array of messages to rotate
// context = {
//   sensor: { lux, temperature, humidity, current, power },
//   mood, suggestedStocks,
//   risk: { takeProfitPct, stopLossPct, holdMinutes } (optional),
//   order: { symbol, side, size } (optional),
//   position: { symbol, side, entryPrice, size, pnlPct, equity, tpPct, slPct, holdMinutesLeft } (optional),
//   exit: { symbol, side, entryPrice, exitPrice, reason, heldMinutes, pnlPct } (optional),
//   market: { open: boolean, nextOpenMinutes?: number, cooldownMinutesLeft?: number } (optional),
//   account: { cash, buyingPower, equity } (optional)
// }
function createTickerMessages(context) {
  const messages = [];
  const { sensor, mood, suggestedStocks, risk, order, position, exit, market, account } = context || {};

  if (market && market.open === false) {
    messages.push(formatMarketClosed(sensor || {}, mood || 'Undecided', suggestedStocks || [], market, account || {}));
    return messages;
  }

  // Compute HOLD countdowns when possible
  const nowMs = context?.nowMs != null ? Number(context.nowMs) : Date.now();
  let derivedOrder = order;
  if (order && order.maxHoldMinutes != null) {
    const entryMs = order.entryTime != null ? Number(order.entryTime) : null;
    if (entryMs != null && Number.isFinite(entryMs)) {
      const elapsedMin = (nowMs - entryMs) / 60000;
      const left = Math.max(0, Number(order.maxHoldMinutes) - elapsedMin);
      derivedOrder = { ...order, holdMinutesLeft: left };
    } else if (risk?.holdMinutes != null) {
      derivedOrder = { ...order, holdMinutesLeft: Number(risk.holdMinutes) };
    }
  } else if (order && risk?.holdMinutes != null && derivedOrder?.holdMinutesLeft == null) {
    // If no maxHoldMinutes on order, fall back to planned hold
    derivedOrder = { ...order, holdMinutesLeft: Number(risk.holdMinutes) };
  }

  let derivedPosition = position;
  if (position && position.maxHoldMinutes != null && position.entryTime != null) {
    const entryMs = Number(position.entryTime);
    if (Number.isFinite(entryMs)) {
      const elapsedMin = (nowMs - entryMs) / 60000;
      const left = Math.max(0, Number(position.maxHoldMinutes) - elapsedMin);
      derivedPosition = { ...position, holdMinutesLeft: left };
    }
  }

  // Decision message is always useful as the baseline
  messages.push(formatDecision(sensor || {}, mood || 'Undecided', suggestedStocks || [], risk, account || {}));

  if (derivedOrder && derivedOrder.symbol && derivedOrder.side) {
    // Show order placement intent/state
    const r = risk ?? (() => {
      const rp = getRiskProfile(sensor?.lux ?? 0);
      const hold = getMaxHoldMinutes(sensor?.humidity ?? 0);
      return { takeProfitPct: rp.takeProfit, stopLossPct: rp.stopLoss, holdMinutes: hold };
    })();
    const orderResult = formatOrder(sensor || {}, derivedOrder, r, account || {}, mood || null);
    // If formatOrder returns an object with weather and order, add both
    if (orderResult && typeof orderResult === 'object' && orderResult.weather) {
      messages.push(orderResult.weather);
      messages.push(orderResult.order);
    } else {
      // Fallback for old format
      messages.push(orderResult);
    }
  }

  if (derivedPosition && derivedPosition.symbol) {
    messages.push(formatActivePosition(derivedPosition));
  }

  if (exit && exit.symbol) {
    messages.push(formatExit(exit));
  }

  return messages;
}

module.exports = {
  formatDecision,
  formatOrder,
  formatActivePosition,
  formatExit,
  formatMarketClosed,
  createTickerMessages
};


