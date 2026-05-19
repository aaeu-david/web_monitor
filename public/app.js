"use strict";

const MAX_POINTS = 60;

const state = {
  readings: [],
  devices: {
    device_1: [],
    device_2: []
  }
};

const ORIENT_COLORS = { x: "#246bfe", y: "#14945f", z: "#f59e0b" };
const TEMP_COLOR = "#e05050";

function getVal(reading, key) {
  const entry = reading.values.find((v) => v.key === key);
  return entry != null ? entry.value : null;
}

function formatValue(value) {
  return Number(value).toFixed(2);
}

function formatTemp(value) {
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
  state.devices.device_1 = state.readings.filter((r) => r.device_id === "device_1").slice(-MAX_POINTS);
  state.devices.device_2 = state.readings.filter((r) => r.device_id === "device_2").slice(-MAX_POINTS);

  for (const deviceId of Object.keys(summary.devices)) {
    const device = summary.devices[deviceId];
    updateDevice(deviceId, device.latest, device.status);
  }

  renderTable();
  drawCharts();
}

function updateDevice(deviceId, reading, status) {
  const timeEl = document.querySelector(`[data-time="${deviceId}"]`);
  const statusEl = document.querySelector(`[data-status="${deviceId}"]`);

  if (reading && reading.values) {
    for (const { key, value } of reading.values) {
      const el = document.querySelector(`[data-value="${deviceId}-${key}"]`);
      if (el) el.textContent = key === "temperature" ? formatTemp(value) : formatValue(value);
    }
    if (timeEl) timeEl.textContent = formatTime(reading.received_at);
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
    table.innerHTML = '<tr><td colspan="7" class="empty">Waiting for UDP messages</td></tr>';
    return;
  }

  table.innerHTML = rows
    .map((r) => {
      const x = getVal(r, "x");
      const y = getVal(r, "y");
      const z = getVal(r, "z");
      const temp = getVal(r, "temperature");
      return `
        <tr>
          <td>${formatTime(r.received_at)}</td>
          <td>${r.device_id === "device_1" ? "Device 1" : "Device 2"}</td>
          <td>${x != null ? formatValue(x) : "--"}</td>
          <td>${y != null ? formatValue(y) : "--"}</td>
          <td>${z != null ? formatValue(z) : "--"}</td>
          <td>${temp != null ? formatTemp(temp) : "--"}</td>
          <td>${escapeHtml(r.source)}</td>
        </tr>
      `;
    })
    .join("");
}

function drawCharts() {
  for (const deviceId of ["device_1", "device_2"]) {
    const readings = state.devices[deviceId];
    const orientCanvas = document.querySelector(`[data-chart="${deviceId}-orientation"]`);
    const tempCanvas = document.querySelector(`[data-chart="${deviceId}-temperature"]`);
    if (orientCanvas) drawMultiLineChart(orientCanvas, readings);
    if (tempCanvas) drawSingleLineChart(tempCanvas, readings, "temperature", TEMP_COLOR);
  }
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}

function drawGrid(ctx, pad, cw, ch) {
  ctx.strokeStyle = "#dfe5ee";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
  }
}

function drawMultiLineChart(canvas, readings) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { top: 18, right: 18, bottom: 28, left: 48 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  drawGrid(ctx, pad, cw, ch);

  if (readings.length === 0) {
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#65738a";
    ctx.fillText("Waiting for data", pad.left, pad.top + 24);
    return;
  }

  const keys = ["x", "y", "z"];
  let min = Infinity;
  let max = -Infinity;
  for (const r of readings) {
    for (const key of keys) {
      const v = getVal(r, key);
      if (v != null) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  const range = Math.max(max - min, 0.01);

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#65738a";
  ctx.fillText(max.toFixed(2), 4, pad.top + 4);
  ctx.fillText(min.toFixed(2), 4, pad.top + ch);

  for (const key of keys) {
    ctx.strokeStyle = ORIENT_COLORS[key];
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    readings.forEach((r, i) => {
      const v = getVal(r, key);
      if (v == null) return;
      const x = pad.left + (readings.length === 1 ? cw : (cw / (readings.length - 1)) * i);
      const y = pad.top + ch - ((v - min) / range) * ch;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const latest = readings[readings.length - 1];
    const lv = latest ? getVal(latest, key) : null;
    if (lv != null) {
      const lx = pad.left + cw;
      const ly = pad.top + ch - ((lv - min) / range) * ch;
      ctx.fillStyle = ORIENT_COLORS[key];
      ctx.beginPath();
      ctx.arc(lx, ly, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSingleLineChart(canvas, readings, key, color) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { top: 18, right: 18, bottom: 28, left: 48 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  drawGrid(ctx, pad, cw, ch);

  const values = readings.map((r) => getVal(r, key)).filter((v) => v != null);

  if (values.length === 0) {
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#65738a";
    ctx.fillText("Waiting for data", pad.left, pad.top + 24);
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#65738a";
  ctx.fillText(max.toFixed(1), 4, pad.top + 4);
  ctx.fillText(min.toFixed(1), 4, pad.top + ch);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let started = false;
  readings.forEach((r, i) => {
    const v = getVal(r, key);
    if (v == null) return;
    const x = pad.left + (readings.length === 1 ? cw : (cw / (readings.length - 1)) * i);
    const y = pad.top + ch - ((v - min) / range) * ch;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const latest = readings[readings.length - 1];
  const lv = latest ? getVal(latest, key) : null;
  if (lv != null) {
    const lx = pad.left + cw;
    const ly = pad.top + ch - ((lv - min) / range) * ch;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fill();
  }
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
  const summary = await fetch("/api/summary").then((r) => r.json());
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
    const summary = await fetch("/api/summary").then((r) => r.json());
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
