"use strict";

const MAX_POINTS = 60;
const state = {
  readings: [],
  devices: {
    device_1: [],
    device_2: []
  }
};

const charts = {
  device_1: document.querySelector('[data-chart="device_1"]'),
  device_2: document.querySelector('[data-chart="device_2"]')
};

const colors = {
  device_1: "#246bfe",
  device_2: "#14945f"
};

function formatValue(value) {
  return Number(value).toFixed(1);
}

function formatTime(isoString) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(isoString));
}

function renderSummary(summary) {
  document.getElementById("udpPort").textContent = summary.udp_port;
  document.getElementById("messagesPerMinute").textContent = summary.messages_per_minute;
  document.getElementById("invalidMessages").textContent = summary.invalid_messages;

  state.readings = summary.history || [];
  state.devices.device_1 = state.readings.filter((reading) => reading.device_id === "device_1").slice(-MAX_POINTS);
  state.devices.device_2 = state.readings.filter((reading) => reading.device_id === "device_2").slice(-MAX_POINTS);

  for (const deviceId of Object.keys(summary.devices)) {
    const device = summary.devices[deviceId];
    const latest = device.latest;
    updateDevice(deviceId, latest, device.status);
  }

  renderTable();
  drawCharts();
}

function updateDevice(deviceId, reading, status) {
  const valueEl = document.querySelector(`[data-value="${deviceId}"]`);
  const timeEl = document.querySelector(`[data-time="${deviceId}"]`);
  const statusEl = document.querySelector(`[data-status="${deviceId}"]`);

  if (reading) {
    valueEl.textContent = formatValue(reading.value);
    timeEl.textContent = formatTime(reading.received_at);
  }

  statusEl.textContent = status === "online" ? "Online" : "Offline";
  statusEl.classList.toggle("online", status === "online");
  statusEl.classList.toggle("offline", status !== "online");
}

function addReading(reading) {
  state.readings.push(reading);
  state.readings = state.readings.slice(-200);

  if (state.devices[reading.device_id]) {
    state.devices[reading.device_id].push(reading);
    state.devices[reading.device_id] = state.devices[reading.device_id].slice(-MAX_POINTS);
  }

  updateDevice(reading.device_id, reading, "online");
  renderTable();
  drawCharts();
}

function renderTable() {
  const table = document.getElementById("messagesTable");
  const rows = state.readings.slice(-25).reverse();

  if (rows.length === 0) {
    table.innerHTML = '<tr><td colspan="5" class="empty">Waiting for UDP messages</td></tr>';
    return;
  }

  table.innerHTML = rows
    .map(
      (reading) => `
        <tr>
          <td>${formatTime(reading.received_at)}</td>
          <td>${reading.device_id === "device_1" ? "Device 1" : "Device 2"}</td>
          <td>${escapeHtml(reading.key)}</td>
          <td>${formatValue(reading.value)}</td>
          <td>${escapeHtml(reading.source)}</td>
        </tr>
      `
    )
    .join("");
}

function drawCharts() {
  drawChart(charts.device_1, state.devices.device_1, colors.device_1);
  drawChart(charts.device_2, state.devices.device_2, colors.device_2);
}

function drawChart(canvas, readings, color) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);

  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 18, right: 18, bottom: 28, left: 44 };
  const chartWidth = rect.width - padding.left - padding.right;
  const chartHeight = rect.height - padding.top - padding.bottom;

  ctx.strokeStyle = "#dfe5ee";
  ctx.lineWidth = 1;
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#65738a";

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
  }

  if (readings.length === 0) {
    ctx.fillText("Waiting for data", padding.left, padding.top + 24);
    return;
  }

  const values = readings.map((reading) => reading.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  ctx.fillText(max.toFixed(1), 8, padding.top + 4);
  ctx.fillText(min.toFixed(1), 8, padding.top + chartHeight);

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();

  readings.forEach((reading, index) => {
    const x = padding.left + (readings.length === 1 ? chartWidth : (chartWidth / (readings.length - 1)) * index);
    const y = padding.top + chartHeight - ((reading.value - min) / range) * chartHeight;

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  const latest = readings[readings.length - 1];
  const latestX = padding.left + chartWidth;
  const latestY = padding.top + chartHeight - ((latest.value - min) / range) * chartHeight;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(latestX, latestY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function bootstrap() {
  const summary = await fetch("/api/summary").then((response) => response.json());
  renderSummary(summary);

  const events = new EventSource("/events");
  const connectionStatus = document.getElementById("connectionStatus");

  events.addEventListener("open", () => {
    connectionStatus.textContent = "Live";
  });

  events.addEventListener("error", () => {
    connectionStatus.textContent = "Reconnecting";
  });

  events.addEventListener("summary", (event) => {
    renderSummary(JSON.parse(event.data));
  });

  events.addEventListener("reading", (event) => {
    addReading(JSON.parse(event.data));
  });

  events.addEventListener("invalid-message", (event) => {
    const payload = JSON.parse(event.data);
    document.getElementById("invalidMessages").textContent = payload.count;
  });

  setInterval(async () => {
    const summary = await fetch("/api/summary").then((response) => response.json());
    renderSummary(summary);
  }, 10000);
}

document.getElementById("clearView").addEventListener("click", () => {
  state.readings = [];
  state.devices.device_1 = [];
  state.devices.device_2 = [];
  renderTable();
  drawCharts();
});

window.addEventListener("resize", drawCharts);
bootstrap().catch((err) => {
  document.getElementById("connectionStatus").textContent = "Error";
  console.error(err);
});
