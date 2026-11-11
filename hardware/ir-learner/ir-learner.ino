// OMP IR learner. Original sketch, GPL-3.0, same license as OMP.
// Raw mark/space timings from a TSOP on GPIO 14. HTTP and a small WebSocket.
// Edit the two Wi-Fi lines. Carrier is not measured (frequency 0).

#include <string.h>
#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <Hash.h>
#define IR_SERVER ESP8266WebServer
#else
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include "mbedtls/sha1.h"
#define IR_SERVER WebServer
#endif

static const char *WIFI_SSID = "your-wifi";
static const char *WIFI_PASS = "your-pass";
static const int IR_PIN = 14;
static const int MAX_PULSES = 256;

static IR_SERVER server(80);
static WiFiServer wsServer(81);
static WiFiClient wsClient;
static char token[33];
static volatile unsigned long lastUs = 0;
static volatile int pulseCount = 0;
static volatile unsigned long pulses[MAX_PULSES];
static volatile bool capturing = false;
static int readyCount = 0;
static unsigned long readyPulses[MAX_PULSES];

static void IRAM_ATTR onEdge() {
  unsigned long now = micros();
  unsigned long dt = now - lastUs;
  lastUs = now;
  if (dt > 20000) {
    pulseCount = 0;
    capturing = true;
    return;
  }
  if (!capturing || pulseCount >= MAX_PULSES) return;
  pulses[pulseCount++] = dt;
}

static void randomToken() {
  for (int i = 0; i < 32; i++) {
    uint8_t b = 0;
#if defined(ESP8266)
    b = (uint8_t)RANDOM_REG32;
#else
    b = (uint8_t)esp_random();
#endif
    token[i] = "0123456789abcdef"[b & 15];
  }
  token[32] = 0;
}

static bool authorized() {
  if (!server.hasHeader("Authorization")) return false;
  String h = server.header("Authorization");
  String want = String("Bearer ") + token;
  return h == want;
}

static String captureJson() {
  String out = "{\"frequency\":0,\"pulses\":[";
  for (int i = 0; i < readyCount; i++) {
    if (i) out += ",";
    out += String(readyPulses[i]);
  }
  out += "]}";
  return out;
}

static void takeCapture() {
  noInterrupts();
  unsigned long idle = micros() - lastUs;
  int n = pulseCount;
  if (capturing && n >= 4 && idle > 20000) {
    readyCount = n > MAX_PULSES ? MAX_PULSES : n;
    for (int i = 0; i < readyCount; i++) readyPulses[i] = pulses[i];
    pulseCount = 0;
    capturing = false;
  }
  interrupts();
}

static void sendWsText(const String &text) {
  if (!wsClient || !wsClient.connected()) return;
  uint8_t hdr[4];
  int n = text.length();
  hdr[0] = 0x81;
  hdr[1] = (uint8_t)n;
  wsClient.write(hdr, 2);
  wsClient.write(text.c_str(), n);
}

static void handleInfo() {
  server.send(200, "application/json", String("{\"name\":\"OMP IR\",\"paired\":") + (token[0] ? "true" : "false") + "}");
}

static void handlePair() {
  if (token[0] && !authorized()) {
    server.send(401, "application/json", "{\"error\":\"paired\"}");
    return;
  }
  if (!token[0]) randomToken();
  server.send(200, "application/json", String("{\"token\":\"") + token + "\"}");
}

static void handleCapture() {
  if (!authorized()) {
    server.send(401, "application/json", "{\"error\":\"auth\"}");
    return;
  }
  takeCapture();
  if (readyCount < 4) {
    server.send(204);
    return;
  }
  String body = captureJson();
  readyCount = 0;
  server.send(200, "application/json", body);
  sendWsText(body);
}

static bool wsAccept(WiFiClient &c, const String &key) {
  String src = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  uint8_t sha[20];
#if defined(ESP8266)
  sha1(src.c_str(), src.length(), sha);
#else
  mbedtls_sha1((const unsigned char *)src.c_str(), src.length(), sha);
#endif
  // 20 bytes of sha1 as base64 is enough for the handshake; a short table keeps the sketch small.
  static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  char out[32];
  int j = 0;
  for (int i = 0; i < 18; i += 3) {
    uint32_t v = ((uint32_t)sha[i] << 16) | ((uint32_t)sha[i + 1] << 8) | sha[i + 2];
    out[j++] = b64[(v >> 18) & 63];
    out[j++] = b64[(v >> 12) & 63];
    out[j++] = b64[(v >> 6) & 63];
    out[j++] = b64[v & 63];
  }
  uint32_t v = ((uint32_t)sha[18] << 16) | ((uint32_t)sha[19] << 8);
  out[j++] = b64[(v >> 18) & 63];
  out[j++] = b64[(v >> 12) & 63];
  out[j++] = b64[(v >> 6) & 63];
  out[j++] = '=';
  out[j] = 0;
  c.print("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ");
  c.print(out);
  c.print("\r\n\r\n");
  return true;
}

void setup() {
  pinMode(IR_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(IR_PIN), onEdge, CHANGE);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (MDNS.begin("omp-ir")) {
#if defined(ESP8266)
    MDNS.addService("omp-ir", "tcp", 80);
#else
    MDNS.addService("_omp-ir", "_tcp", 80);
#endif
  }
  server.on("/api/info", HTTP_GET, handleInfo);
  server.on("/api/pair", HTTP_POST, handlePair);
  server.on("/api/capture", HTTP_GET, handleCapture);
  server.collectHeaders("Authorization");
  server.begin();
  wsServer.begin();
}

void loop() {
#if defined(ESP8266)
  MDNS.update();
#endif
  server.handleClient();
  takeCapture();
  if (wsServer.hasClient()) {
    if (wsClient) wsClient.stop();
    wsClient = wsServer.available();
    String req;
    unsigned long start = millis();
    while (wsClient.connected() && millis() - start < 1000 && req.indexOf("\r\n\r\n") < 0) {
      while (wsClient.available()) req += (char)wsClient.read();
    }
    int auth = req.indexOf("Authorization: Bearer " + String(token));
    int k = req.indexOf("Sec-WebSocket-Key: ");
    if (token[0] && auth < 0) {
      wsClient.stop();
    } else if (k >= 0) {
      int end = req.indexOf("\r\n", k);
      String key = req.substring(k + 19, end);
      key.trim();
      wsAccept(wsClient, key);
    } else if (wsClient) {
      wsClient.stop();
    }
  }
}
