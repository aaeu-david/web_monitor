"use strict";

const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const HTTP_HOST = process.env.HTTP_HOST || "0.0.0.0";
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const UDP_HOST = process.env.UDP_HOST || "0.0.0.0";
const UDP_PORT = Number(process.env.UDP_PORT || 5005);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 500);
const ONLINE_TIMEOUT_MS = Number(process.env.ONLINE_TIMEOUT_MS || 30000);

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const READINGS_FILE = path.join(DATA_DIR, "readings.jsonl");
const ALLOWED_DEVICES = new Set(["device_1", "device_2"]);

fs.mkdirSync(DATA_DIR, { recursive: true });

/** @type {Array<{device_id:string,key:string,value:number,received_at:string,source:string}>} */
let readings = loadRecentReadings();
const sseClients = new Set();
const invalidMessages = { count: 0 };

function loadRecentReadings() {
  if (!fs.existsSync(READINGS_FILE)) return [];

  const lines = fs.readFileSync(READINGS_FILE, "utf8").trim().split(/\r?\n/).filter(Boolean);
  return lines
    .slice(-MAX_HISTORY)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function validateReading(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Payload must be a JSON object.";
  }

  if (!ALLOWED_DEVICES.has(payload.device_id)) {
    return "device_id must be device_1 or device_2.";
  }

  if (!Array.isArray(payload.values) || payload.values.length === 0) {
    return "values must be a non-empty array.";
  }

  for (const entry of payload.values) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return "Each entry in values must be an object.";
    }
    if (typeof entry.key !== "string" || entry.key.trim() === "") {
      return "Each entry in values must have a non-empty string key.";
    }
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
      return "Each entry in values must have a finite number value.";
    }
  }

  return null;
}

function addReading(reading) {
  readings.push(reading);
  if (readings.length > MAX_HISTORY) readings = readings.slice(-MAX_HISTORY);

  fs.appendFile(READINGS_FILE, `${JSON.stringify(reading)}\n`, (err) => {
    if (err) console.error("Failed to persist reading:", err.message);
  });

  broadcast("reading", reading);
}

function getSummary() {
  const now = Date.now();
  const byDevice = {};

  for (const deviceId of ALLOWED_DEVICES) {
    const latest = [...readings].reverse().find((reading) => reading.device_id === deviceId) || null;
    byDevice[deviceId] = {
      device_id: deviceId,
      display_name: deviceId === "device_1" ? "Device 1" : "Device 2",
      latest,
      status: latest && now - Date.parse(latest.received_at) <= ONLINE_TIMEOUT_MS ? "online" : "offline"
    };
  }

  const oneMinuteAgo = now - 60000;
  const messagesPerMinute = readings.filter((reading) => Date.parse(reading.received_at) >= oneMinuteAgo).length;

  return {
    udp_port: UDP_PORT,
    messages_per_minute: messagesPerMinute,
    invalid_messages: invalidMessages.count,
    devices: byDevice,
    history: readings
  };
}

function broadcast(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const response of sseClients) {
    response.write(data);
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";

    response.writeHead(200, { "content-type": contentType });
    response.end(content);
  });
}

const httpServer = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/summary") {
    sendJson(response, 200, getSummary());
    return;
  }

  if (url.pathname === "/api/readings") {
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), MAX_HISTORY);
    sendJson(response, 200, readings.slice(-limit));
    return;
  }

  if (url.pathname === "/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    response.write(`event: summary\ndata: ${JSON.stringify(getSummary())}\n\n`);
    sseClients.add(response);
    request.on("close", () => sseClients.delete(response));
    return;
  }

  serveStatic(request, response, url.pathname);
});

const udpServer = dgram.createSocket("udp4");

udpServer.on("message", (message, remote) => {
  let payload;

  try {
    payload = JSON.parse(message.toString("utf8"));
  } catch {
    invalidMessages.count += 1;
    broadcast("invalid-message", { count: invalidMessages.count });
    return;
  }

  const validationError = validateReading(payload);
  if (validationError) {
    invalidMessages.count += 1;
    console.warn(`Invalid UDP message from ${remote.address}:${remote.port}: ${validationError}`);
    broadcast("invalid-message", { count: invalidMessages.count });
    return;
  }

  addReading({
    device_id: payload.device_id,
    values: payload.values,
    received_at: new Date().toISOString(),
    source: `${remote.address}:${remote.port}`
  });
});

udpServer.on("error", (err) => {
  console.error("UDP server error:", err.message);
});

httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log(`HTTP dashboard listening on http://${HTTP_HOST}:${HTTP_PORT}`);
});

udpServer.bind(UDP_PORT, UDP_HOST, () => {
  console.log(`UDP receiver listening on ${UDP_HOST}:${UDP_PORT}`);
});
