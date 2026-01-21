const state = {
  baseUrl: "http://localhost:52465",
  windowSeconds: 1,
  levels: 10,
  pollInterval: 1000,
  pollTimer: null,
  history: {
    buy: [],
    sell: [],
    prl: [],
  },
  boxes: {
    buy: 0,
    sell: 0,
    prl: 0,
  },
  alerts: [],
  useSimulation: false,
};

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  clock: document.getElementById("clock"),
  baseUrl: document.getElementById("baseUrl"),
  windowSeconds: document.getElementById("windowSeconds"),
  levels: document.getElementById("levels"),
  pollInterval: document.getElementById("pollInterval"),
  applySettings: document.getElementById("applySettings"),
  toggleSim: document.getElementById("toggleSim"),
  buyWindow: document.getElementById("buyWindow"),
  sellWindow: document.getElementById("sellWindow"),
  prlWindow: document.getElementById("prlWindow"),
  buyAvg: document.getElementById("buyAvg"),
  sellAvg: document.getElementById("sellAvg"),
  prlAvg: document.getElementById("prlAvg"),
  buyBox: document.getElementById("buyBox"),
  sellBox: document.getElementById("sellBox"),
  prlBox: document.getElementById("prlBox"),
  imbalanceValue: document.getElementById("imbalanceValue"),
  imbalanceFill: document.getElementById("imbalanceFill"),
  imbalanceBuy: document.getElementById("imbalanceBuy"),
  imbalanceSell: document.getElementById("imbalanceSell"),
  levelsLabel: document.getElementById("levelsLabel"),
  deltaAccum: document.getElementById("deltaAccum"),
  volumeMinute: document.getElementById("volumeMinute"),
  avgPrice: document.getElementById("avgPrice"),
  tapeBody: document.getElementById("tapeBody"),
  alertsList: document.getElementById("alertsList"),
  lastUpdate: document.getElementById("lastUpdate"),
};

const SIM_TIME_TRADES = [
  { date: "09:01:34", aggressor: "Comprador", price: "165480", quantity: "2", buyer: "XP", seller: "BTG" },
  { date: "09:01:34", aggressor: "Comprador", price: "165480", quantity: "10", buyer: "XP", seller: "BTG" },
  { date: "09:01:35", aggressor: "Vendedor", price: "165475", quantity: "4", buyer: "BTG", seller: "XP" },
  { date: "09:01:35", aggressor: "Comprador", price: "165482", quantity: "1", buyer: "XP", seller: "BTG" },
  { date: "09:01:35", aggressor: "Vendedor", price: "165470", quantity: "6", buyer: "BTG", seller: "XP" },
  { date: "09:01:36", aggressor: "Comprador", price: "165485", quantity: "3", buyer: "XP", seller: "BTG" },
];

const SIM_BOOK = [
  { buyPrice: "165475", buyQuantity: "1", sellPrice: "165480", sellQuantity: "8" },
  { buyPrice: "165475", buyQuantity: "4", sellPrice: "165485", sellQuantity: "1" },
  { buyPrice: "165470", buyQuantity: "6", sellPrice: "165490", sellQuantity: "11" },
  { buyPrice: "165465", buyQuantity: "3", sellPrice: "165495", sellQuantity: "2" },
  { buyPrice: "165460", buyQuantity: "2", sellPrice: "165500", sellQuantity: "5" },
  { buyPrice: "165455", buyQuantity: "4", sellPrice: "165505", sellQuantity: "1" },
  { buyPrice: "165450", buyQuantity: "1", sellPrice: "165510", sellQuantity: "3" },
  { buyPrice: "165445", buyQuantity: "2", sellPrice: "165515", sellQuantity: "2" },
  { buyPrice: "165440", buyQuantity: "5", sellPrice: "165520", sellQuantity: "4" },
  { buyPrice: "165435", buyQuantity: "3", sellPrice: "165525", sellQuantity: "2" },
];

const parseNumber = (value) => Number(String(value).replace(/[^0-9.-]/g, "")) || 0;

const sumOfferLots = (value) => {
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + parseNumber(entry?.quantity ?? entry), 0);
  }
  if (typeof value === "string" && /[|,;/]/.test(value)) {
    return value
      .split(/[|,;/]/)
      .reduce((sum, part) => sum + parseNumber(part), 0);
  }
  return parseNumber(value);
};

const toTodaySeconds = (timeString) => {
  const [h, m, s] = timeString.split(":").map((value) => parseInt(value, 10));
  if ([h, m, s].some(Number.isNaN)) {
    return null;
  }
  const now = new Date();
  const trade = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s);
  return trade.getTime();
};

const updateClock = () => {
  const now = new Date();
  elements.clock.textContent = now.toLocaleTimeString("pt-BR");
};

const updateConnectionBadge = (ok, message) => {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.toggle("ok", ok);
  elements.connectionStatus.classList.toggle("warn", !ok);
};

const average = (arr) => {
  if (!arr.length) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
};

const pushHistory = (key, value) => {
  state.history[key].push(value);
  if (state.history[key].length > 60) {
    state.history[key].shift();
  }
};

const updateBox = (key, value, avg) => {
  if (avg > 0 && value > avg) {
    state.boxes[key] += 1;
  }
};

const getLatestTradeTime = (trades) => {
  const times = trades
    .map((trade) => toTodaySeconds(trade.date || ""))
    .filter((time) => typeof time === "number");
  if (!times.length) {
    return { timeMs: Date.now(), label: new Date().toLocaleTimeString("pt-BR") };
  }
  const timeMs = Math.max(...times);
  const label = new Date(timeMs).toLocaleTimeString("pt-BR");
  return { timeMs, label };
};

const addAlert = (side, volume, timeLabel) => {
  state.alerts.unshift({ side, volume, timeLabel });
  if (state.alerts.length > 30) {
    state.alerts.pop();
  }
  elements.alertsList.innerHTML = state.alerts
    .map((alert) => {
      const cls = alert.side === "Compra" ? "buy" : "sell";
      return `
        <li class="${cls}">
          <span>${alert.side} acima da média · ${alert.volume}</span>
          <span class="meta">${alert.timeLabel}</span>
        </li>
      `;
    })
    .join("");
};

const computeWindowMetrics = (trades) => {
  const latest = getLatestTradeTime(trades);
  const windowMs = state.windowSeconds * 1000;
  const from = latest.timeMs - windowMs;

  const windowTrades = trades.filter((trade) => {
    const tradeTime = toTodaySeconds(trade.date || "");
    if (!tradeTime) return false;
    return tradeTime >= from && tradeTime <= latest.timeMs;
  });

  const buy = windowTrades
    .filter((trade) => trade.aggressor?.toLowerCase().includes("comprador"))
    .reduce((sum, trade) => sum + parseNumber(trade.quantity), 0);

  const sell = windowTrades
    .filter((trade) => trade.aggressor?.toLowerCase().includes("vendedor"))
    .reduce((sum, trade) => sum + parseNumber(trade.quantity), 0);

  const prl = buy - sell;

  pushHistory("buy", buy);
  pushHistory("sell", sell);
  pushHistory("prl", prl);

  const buyAvg = average(state.history.buy);
  const sellAvg = average(state.history.sell);
  const prlAvg = average(state.history.prl);

  updateBox("buy", buy, buyAvg);
  updateBox("sell", sell, sellAvg);
  updateBox("prl", prl, prlAvg);

  if (buyAvg > 0 && buy > buyAvg) {
    addAlert("Compra", buy.toFixed(0), latest.label);
  }
  if (sellAvg > 0 && sell > sellAvg) {
    addAlert("Venda", sell.toFixed(0), latest.label);
  }

  elements.buyWindow.textContent = buy.toFixed(0);
  elements.sellWindow.textContent = sell.toFixed(0);
  elements.prlWindow.textContent = prl.toFixed(0);
  elements.buyAvg.textContent = buyAvg.toFixed(2);
  elements.sellAvg.textContent = sellAvg.toFixed(2);
  elements.prlAvg.textContent = prlAvg.toFixed(2);
  elements.buyBox.textContent = state.boxes.buy;
  elements.sellBox.textContent = state.boxes.sell;
  elements.prlBox.textContent = state.boxes.prl;
};

const computeExtras = (trades) => {
  const latest = getLatestTradeTime(trades);
  const delta = trades.reduce((sum, trade) => {
    const qty = parseNumber(trade.quantity);
    if (trade.aggressor?.toLowerCase().includes("comprador")) return sum + qty;
    if (trade.aggressor?.toLowerCase().includes("vendedor")) return sum - qty;
    return sum;
  }, 0);

  const from = latest.timeMs - 60 * 1000;
  const volumeMinute = trades.reduce((sum, trade) => {
    const tradeTime = toTodaySeconds(trade.date || "");
    if (!tradeTime || tradeTime < from) return sum;
    return sum + parseNumber(trade.quantity);
  }, 0);

  const totals = trades.reduce(
    (acc, trade) => {
      const qty = parseNumber(trade.quantity);
      const price = parseNumber(trade.price);
      acc.volume += qty;
      acc.weighted += price * qty;
      return acc;
    },
    { volume: 0, weighted: 0 }
  );

  const avgPrice = totals.volume ? totals.weighted / totals.volume : 0;

  elements.deltaAccum.textContent = delta.toFixed(0);
  elements.volumeMinute.textContent = volumeMinute.toFixed(0);
  elements.avgPrice.textContent = avgPrice.toFixed(2);
};

const updateTape = (trades) => {
  const recent = trades.slice(0, 10);
  elements.tapeBody.innerHTML = recent
    .map((trade) => {
      const broker = trade.buyer || trade.seller || "-";
      const aggressor = trade.aggressor?.toLowerCase() || "";
      const rowClass = aggressor.includes("comprador") ? "buy-row" : aggressor.includes("vendedor") ? "sell-row" : "";
      return `
        <tr class="${rowClass}">
          <td>${trade.date || "--"}</td>
          <td>${trade.aggressor || "--"}</td>
          <td>${trade.price || "--"}</td>
          <td>${trade.quantity || "--"}</td>
          <td>${broker}</td>
        </tr>
      `;
    })
    .join("");
};

const computeImbalance = (book) => {
  const levels = Math.min(state.levels, book.length);
  const slice = book.slice(0, levels);
  const buy = slice.reduce((sum, row) => {
    if (row.buyOffers) return sum + sumOfferLots(row.buyOffers);
    return sum + sumOfferLots(row.buyQuantity);
  }, 0);
  const sell = slice.reduce((sum, row) => {
    if (row.sellOffers) return sum + sumOfferLots(row.sellOffers);
    return sum + sumOfferLots(row.sellQuantity);
  }, 0);
  const total = buy + sell;
  const imbalance = total ? (buy - sell) / total : 0;

  elements.levelsLabel.textContent = levels.toString();
  elements.imbalanceValue.textContent = `${(imbalance * 100).toFixed(1)}%`;
  elements.imbalanceBuy.textContent = buy.toFixed(0);
  elements.imbalanceSell.textContent = sell.toFixed(0);

  const normalized = Math.max(0, Math.min(1, (imbalance + 1) / 2));
  elements.imbalanceFill.style.width = `${normalized * 100}%`;
};

const fetchJson = async (path) => {
  const response = await fetch(`${state.baseUrl}${path}`);
  if (!response.ok) {
    throw new Error("Falha ao carregar dados");
  }
  return response.json();
};

const loadData = async () => {
  updateClock();
  let trades;
  let book;
  try {
    if (state.useSimulation) {
      trades = SIM_TIME_TRADES;
      book = SIM_BOOK;
    } else {
      [trades, book] = await Promise.all([
        fetchJson("/api/time-trades"),
        fetchJson("/api/book"),
      ]);
    }
    updateConnectionBadge(true, state.useSimulation ? "Simulado" : "Online");
  } catch (error) {
    updateConnectionBadge(false, "Sem conexão");
    trades = SIM_TIME_TRADES;
    book = SIM_BOOK;
  }

  const sortedTrades = Array.isArray(trades)
    ? [...trades].sort((a, b) => {
        const timeA = toTodaySeconds(a.date || "") || 0;
        const timeB = toTodaySeconds(b.date || "") || 0;
        if (timeA === timeB) return (b.row || 0) - (a.row || 0);
        return timeB - timeA;
      })
    : [];
  const bookRows = Array.isArray(book) ? book : [];

  computeWindowMetrics(sortedTrades);
  computeExtras(sortedTrades);
  computeImbalance(bookRows);
  updateTape(sortedTrades);

  elements.lastUpdate.textContent = `Última atualização: ${new Date().toLocaleTimeString("pt-BR")}`;
};

const applySettings = () => {
  state.baseUrl = elements.baseUrl.value.trim();
  state.windowSeconds = Math.max(1, parseInt(elements.windowSeconds.value, 10) || 1);
  state.levels = Math.max(1, parseInt(elements.levels.value, 10) || 1);
  state.pollInterval = Math.max(250, parseInt(elements.pollInterval.value, 10) || 1000);

  elements.levelsLabel.textContent = state.levels.toString();

  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.pollTimer = setInterval(loadData, state.pollInterval);
  loadData();
};

const toggleSimulation = () => {
  state.useSimulation = !state.useSimulation;
  elements.toggleSim.textContent = state.useSimulation ? "Usar API" : "Modo simulado";
  loadData();
};

const init = () => {
  updateClock();
  setInterval(updateClock, 1000);
  elements.applySettings.addEventListener("click", applySettings);
  elements.toggleSim.addEventListener("click", toggleSimulation);
  applySettings();
};

init();
