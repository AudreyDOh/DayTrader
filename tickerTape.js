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
  const v = clampNumber(pct);
  if (v == null) return '';
  if (v > 0) return '▲';
  if (v < 0) return '▼';
  return '•';
}

function sideToVerb(side) {
  return side === 'short' ? 'SELL' : 'BUY';
}

function sideToLabel(side) {
  return side === 'short' ? 'SHORT' : 'LONG';
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

function buildSunLine(sensor) {
  const lux = formatThousands(sensor?.lux);
  const temp = Math.round(clampNumber(sensor?.temperature) ?? 0);
  const hum = Math.round(clampNumber(sensor?.humidity) ?? 0);
  const cur = formatOneDecimal(sensor?.current);
  const pwrKw = clampNumber(sensor?.power) != null ? `${formatThreeDecimals(sensor.power)}` : '—';
  return `LUX ${lux} TEMP ${temp} HUM ${hum} CUR ${cur} PWR ${pwrKw}`;
}

function formatThreeDecimals(n) {
  const v = clampNumber(n);
  if (v == null) return '—';
  return (Math.round(v * 1000) / 1000).toFixed(3);
}

// ---- Message builders ----

// Decision (pre-trade): uses mood and suggested stocks; computes risk from sensor if not provided
function formatDecision(sensor, mood, suggestedStocks = [], risk, account) {
  const line1 = buildSunLine(sensor);
  const primary = suggestedStocks[0];
  const secondary = suggestedStocks[1];

  const localRisk = risk ?? (() => {
    const rp = getRiskProfile(sensor?.lux ?? 0);
    const hold = getMaxHoldMinutes(sensor?.humidity ?? 0);
    return { takeProfitPct: rp.takeProfit, stopLossPct: rp.stopLoss, holdMinutes: hold };
  })();

  const sl = toPct(localRisk.stopLossPct);
  const tp = toPct(localRisk.takeProfitPct);
  const hold = Math.round(localRisk.holdMinutes ?? 0);

  const picks =
    primary && secondary ? `${primary}, ${secondary}` :
    primary ? primary : '—';

  const cashStr = formatMoney(account?.cash);
  const cashBlock = cashStr ? ` CASH ${cashStr}` : '';
  const line2 = `MOOD ${mood?.toUpperCase() ?? '—'} BUY ${picks} SL ${sl} TP ${tp} HOLD ${hold}m${cashBlock}`;
  return `${line1}\n${line2}`;
}

// Order (at execution)
function formatOrder(sensor, order, risk, account) {
  const line1 = buildSunLine(sensor);
  const verb = sideToVerb(order?.side);
  const cashStr = formatMoney(account?.cash);
  const sl = toPct(risk?.stopLossPct);
  const tp = toPct(risk?.takeProfitPct);
  const size = order?.size != null ? `${order.size}` : '—';
  const hold = order?.holdMinutesLeft != null
    ? Math.max(0, Math.round(order.holdMinutesLeft))
    : Math.round(risk?.holdMinutes ?? 0);
  const moneyBlock = cashStr ? ` CASH ${cashStr}` : '';
  const line2 = `${verb} ${order?.symbol ?? '—'} @ MKT SL ${sl} TP ${tp} SIZE ${size} HOLD ${hold}m${moneyBlock}`;
  return `${line1}\n${line2}`;
}

// Active position
function formatActivePosition(position) {
  const pl = clampNumber(position?.pnlPct);
  const arrow = emojiForDelta(pl);
  const plStr = pl == null ? '—' : `${toPct(pl)}`;
  const price = position?.entryPrice != null ? formatTwoDecimals(position.entryPrice) : '—';
  const line1 = `${position?.symbol ?? '—'} ${sideToLabel(position?.side)} @ ${price} P/L ${plStr} ${arrow}`;

  const sl = toPct(position?.slPct);
  const tp = toPct(position?.tpPct);
  const size = position?.size != null ? `${position.size}` : '—';
  const eqt = formatMoney(position?.equity);
  const eqtBlock = eqt ? ` EQT ${eqt}` : '';
  const holdLeft = position?.holdMinutesLeft != null ? ` HOLD ${Math.max(0, Math.round(position.holdMinutesLeft))}m` : '';
  const line2 = `SL ${sl} TP ${tp} SIZE ${size}${holdLeft}${eqtBlock}`;
  return `${line1}\n${line2}`;
}

// Exit event
function formatExit(exit) {
  const entry = exit?.entryPrice != null ? formatTwoDecimals(exit.entryPrice) : '—';
  const out = exit?.exitPrice != null ? formatTwoDecimals(exit.exitPrice) : '—';
  const dir = emojiForDelta((exit?.exitPrice ?? 0) - (exit?.entryPrice ?? 0));
  const line1 = `${exit?.symbol ?? '—'} ${sideToLabel(exit?.side)} @ ${entry} EXIT ${out} ${dir}`;

  const cause = reasonLabel(exit?.reason);
  const held = exit?.heldMinutes != null ? `${Math.round(exit.heldMinutes)}m` : '—';
  const pl = clampNumber(exit?.pnlPct);
  const plStr = pl == null ? '—' : `${toPct(pl)}`;
  const line2 = `${cause} ${plStr} HELD ${held}`;
  return `${line1}\n${line2}`;
}

// Market closed fallback
function formatMarketClosed(sensor, mood, suggestedStocks = [], market = {}, account = {}) {
  const line1 = buildSunLine(sensor);
  const parts = ['MARKET CLOSED'];

  if (market?.nextOpenMinutes != null) {
    const mins = Math.max(0, Math.round(market.nextOpenMinutes));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    parts.push(`OPEN IN ${h}h${m}m`);
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

  const line2 = parts.join(' ');
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
    messages.push(formatMarketClosed(sensor || {}, mood || 'Unknown', suggestedStocks || [], market, account || {}));
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
  messages.push(formatDecision(sensor || {}, mood || 'Unknown', suggestedStocks || [], risk, account || {}));

  if (derivedOrder && derivedOrder.symbol && derivedOrder.side) {
    // Show order placement intent/state
    const r = risk ?? (() => {
      const rp = getRiskProfile(sensor?.lux ?? 0);
      const hold = getMaxHoldMinutes(sensor?.humidity ?? 0);
      return { takeProfitPct: rp.takeProfit, stopLossPct: rp.stopLoss, holdMinutes: hold };
    })();
    messages.push(formatOrder(sensor || {}, derivedOrder, r, account || {}));
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


