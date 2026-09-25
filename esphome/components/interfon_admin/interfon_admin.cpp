// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 donkfather. Built on the ESPHome C++ runtime (GPLv3); see LICENSE here.
#include "interfon_admin.h"

namespace esphome {
namespace interfon_admin {

// ---- small helpers ------------------------------------------------------------------

static void copy_str(char *dst, size_t cap, const std::string &src) {
  memset(dst, 0, cap);
  strncpy(dst, src.c_str(), cap - 1);
}

static bool parse_ip(const std::string &txt, uint8_t out[4]) {
  unsigned a, b, c, d;
  char tail;
  if (sscanf(txt.c_str(), "%u.%u.%u.%u%c", &a, &b, &c, &d, &tail) != 4)
    return false;
  if (a > 255 || b > 255 || c > 255 || d > 255)
    return false;
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  return true;
}

static std::string ip_str(const uint8_t ip[4]) {
  char buf[16];
  snprintf(buf, sizeof(buf), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);
  return buf;
}

static bool ip_zero(const uint8_t ip[4]) { return (ip[0] | ip[1] | ip[2] | ip[3]) == 0; }

static network::IPAddress to_ip(const uint8_t ip[4]) { return network::IPAddress(ip[0], ip[1], ip[2], ip[3]); }

static std::string jstr(const std::string &s) {
  std::string o = "\"";
  for (char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if ((unsigned char) c < 0x20) {
          char b[8];
          snprintf(b, sizeof(b), "\\u%04x", c);
          o += b;
        } else {
          o += c;
        }
    }
  }
  return o + "\"";
}

// A request param from a POST form body, falling back to the query string.
static bool param(AsyncWebServerRequest *req, const char *name, std::string &out) {
  const AsyncWebParameter *p = req->getParam(name, true);
  if (p == nullptr)
    p = req->getParam(name, false);
  if (p == nullptr)
    return false;
  out = p->value().c_str();
  return true;
}

static bool valid_topic_prefix(const std::string &p) {
  if (p.empty() || p.size() > 47)
    return false;
  for (char c : p)
    if (!(isalnum((unsigned char) c) || c == '_' || c == '-' || c == '/'))
      return false;
  return true;
}

// ---- storage: two sectors, newest valid copy wins -------------------------------------

uint32_t InterfonAdmin::checksum_(const Settings &s) {
  // FNV-1a over everything except the crc field itself.
  const uint8_t *p = reinterpret_cast<const uint8_t *>(&s);
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < offsetof(Settings, crc); i++) {
    h ^= p[i];
    h *= 16777619u;
  }
  return h;
}

void InterfonAdmin::factory_defaults_(Settings &s) const {
  memset(&s, 0, sizeof(s));
  s.magic = SETTINGS_MAGIC;
  uint8_t ip[4];
  if (!def_ip_.empty() && parse_ip(def_ip_, ip)) {
    s.net_mode = NET_STATIC;
    memcpy(s.ip, ip, 4);
  } else {
    s.net_mode = NET_DHCP;
  }
  parse_ip(def_gw_, s.gw);
  parse_ip(def_mask_, s.mask);
  parse_ip(def_dns1_, s.dns1);
  parse_ip(def_dns2_, s.dns2);
  s.mqtt_port = 1883;
  s.mqtt_discovery = 1;
  copy_str(s.mqtt_prefix, sizeof(s.mqtt_prefix), def_prefix_);
  // No notification target is compiled in: channels stay off until set on the admin page.
  s.webhook_events = EV_RING | EV_DOOR;
  s.mqtt_events = EV_RING | EV_DOOR | EV_AUTO | EV_ONLINE;
}

bool InterfonAdmin::load_() {
  Settings a{}, b{};
  bool va, vb;
  {
    InterruptLock lock;
    va = spi_flash_read(sector_ * SPI_FLASH_SEC_SIZE, reinterpret_cast<uint32_t *>(&a), sizeof(a)) ==
         SPI_FLASH_RESULT_OK;
    vb = spi_flash_read((sector_ + 1) * SPI_FLASH_SEC_SIZE, reinterpret_cast<uint32_t *>(&b), sizeof(b)) ==
         SPI_FLASH_RESULT_OK;
  }
  va = va && a.magic == SETTINGS_MAGIC && a.crc == checksum_(a);
  vb = vb && b.magic == SETTINGS_MAGIC && b.crc == checksum_(b);
  if (!va && !vb)
    return false;
  if (va && (!vb || a.seq >= b.seq)) {
    s_ = a;
    slot_ = 0;
  } else {
    s_ = b;
    slot_ = 1;
  }
  return true;
}

bool InterfonAdmin::save_() {
  Settings out = s_;
  out.magic = SETTINGS_MAGIC;
  out.seq = s_.seq + 1;
  out.crc = checksum_(out);
  uint8_t target = loaded_from_flash_ ? (slot_ ^ 1) : 0;  // never overwrite the copy we loaded
  uint32_t sec = sector_ + target;
  bool ok;
  {
    InterruptLock lock;
    ok = spi_flash_erase_sector(sec) == SPI_FLASH_RESULT_OK &&
         spi_flash_write(sec * SPI_FLASH_SEC_SIZE, reinterpret_cast<uint32_t *>(&out), sizeof(out)) ==
             SPI_FLASH_RESULT_OK;
  }
  if (ok) {
    // Read back: a write that "succeeded" but doesn't verify is a failed write.
    Settings check{};
    {
      InterruptLock lock;
      spi_flash_read(sec * SPI_FLASH_SEC_SIZE, reinterpret_cast<uint32_t *>(&check), sizeof(check));
    }
    ok = memcmp(&check, &out, sizeof(out)) == 0;
  }
  if (ok) {
    s_ = out;
    slot_ = target;
    loaded_from_flash_ = true;
  }
  last_save_ok_ = ok;
  ESP_LOGI(TAG, "Settings save %s (slot %u, seq %u)", ok ? "OK" : "FAILED", target, out.seq);
  return ok;
}

// ---- lifecycle ------------------------------------------------------------------------

void InterfonAdmin::setup() {
  loaded_from_flash_ = this->load_();
  if (!loaded_from_flash_) {
    ESP_LOGW(TAG, "No saved settings, using firmware defaults");
    this->factory_defaults_(s_);
  }
  this->apply_mqtt_();  // before the MQTT client sets up (lower priority than us)

  handler_ = new AdminHandler(this);  // NOLINT: lives for the lifetime of the device
  web_server_base::global_web_server_base->add_handler(handler_);  // behind the web_server auth
}

void InterfonAdmin::loop() {
  auto *w = wifi::global_wifi_component;

  // Network settings: WiFiComponent::start() (in its setup) rebuilds the station entry from
  // saved credentials WITHOUT the fixed IP. Re-apply ours right after it ran, before the scan
  // it started completes. Our loop() is called while App::setup waits for Wi-Fi to connect.
  if (!net_applied_ && (w->get_component_state() & COMPONENT_STATE_MASK) != COMPONENT_STATE_CONSTRUCTION) {
    net_applied_ = true;
    this->apply_network_();
  }

#ifdef USE_MQTT
  if (!mqtt_started_ && s_.mqtt_enabled && w->is_connected() && mqtt::global_mqtt_client != nullptr) {
    mqtt_started_ = true;
    mqtt::global_mqtt_client->enable();
  }
#endif

  if (!online_sent_ && w->is_connected() && millis() > 10000) {
    online_sent_ = true;
    this->queue_(EV_ONLINE, "online", "");
  }

  // Webhooks: send when due and Wi-Fi is up. One per loop pass (each can block up to 3 s).
  if (!queue_items_.empty() && w->is_connected()) {
    auto it = queue_items_.begin();
    if ((int32_t) (millis() - it->send_at) >= 0) {
      Pending p = *it;
      queue_items_.erase(it);
      this->send_webhook_(p.body);
    }
  }

  if (reboot_at_ != 0 && (int32_t) (millis() - reboot_at_) >= 0) {
    ESP_LOGW(TAG, "Rebooting to apply settings");
    App.safe_reboot();
  }
}

void InterfonAdmin::dump_config() {
  ESP_LOGCONFIG(TAG, "Interfon admin:");
  ESP_LOGCONFIG(TAG, "  Storage: sectors 0x%X/0x%X, %s (slot %u, seq %u)", sector_, sector_ + 1,
                loaded_from_flash_ ? "loaded" : "defaults", slot_, s_.seq);
  ESP_LOGCONFIG(TAG, "  Network: %s %s", s_.net_mode == NET_STATIC ? "static" : "dhcp",
                s_.net_mode == NET_STATIC ? ip_str(s_.ip).c_str() : "");
  ESP_LOGCONFIG(TAG, "  MQTT: %s %s:%u prefix '%s'", s_.mqtt_enabled ? "on" : "off", s_.mqtt_host, s_.mqtt_port,
                s_.mqtt_prefix);
  ESP_LOGCONFIG(TAG, "  Webhook: %s", s_.webhook_enabled ? "on" : "off");
}

// ---- apply ----------------------------------------------------------------------------

void InterfonAdmin::apply_network_() {
  auto *w = wifi::global_wifi_component;
  wifi::WiFiAP ap = w->get_sta();
  if (ap.get_ssid().empty()) {
    ap.set_ssid(def_ssid_);
    ap.set_password(def_password_);
  }
  if (s_.net_mode == NET_STATIC && !ip_zero(s_.ip)) {
    wifi::ManualIP m{to_ip(s_.ip), to_ip(s_.gw), to_ip(s_.mask), to_ip(s_.dns1), to_ip(s_.dns2)};
    ap.set_manual_ip(m);
    ESP_LOGI(TAG, "Network: static %s", ip_str(s_.ip).c_str());
  } else {
    ap.set_manual_ip({});
    ESP_LOGI(TAG, "Network: DHCP");
  }
  w->set_sta(ap);
}

void InterfonAdmin::apply_mqtt_() {
#ifdef USE_MQTT
  auto *m = mqtt::global_mqtt_client;
  if (m == nullptr)
    return;
  m->set_broker_address(s_.mqtt_host);
  m->set_broker_port(s_.mqtt_port ? s_.mqtt_port : 1883);
  m->set_username(s_.mqtt_user);
  m->set_password(s_.mqtt_pass);
  std::string prefix = s_.mqtt_prefix[0] ? s_.mqtt_prefix : def_prefix_;
  m->set_topic_prefix(prefix, prefix);
  if (!s_.mqtt_discovery)
    m->disable_discovery();
#endif
}

// ---- notifications --------------------------------------------------------------------

std::string InterfonAdmin::now_iso_() const {
  if (time_ != nullptr) {
    auto t = time_->now();
    if (t.is_valid())
      return t.strftime("%Y-%m-%dT%H:%M:%S");
  }
  return "";
}

void InterfonAdmin::queue_(uint8_t bit, const char *event, const char *detail) {
  std::string body = "{\"device\":\"interfon\",\"event\":" + jstr(event) + ",\"detail\":" + jstr(detail) +
                     ",\"time\":" + jstr(this->now_iso_()) + ",\"uptime\":" + to_string(millis() / 1000) + "}";
#ifdef USE_MQTT
  if (s_.mqtt_enabled && (s_.mqtt_events & bit) && mqtt::global_mqtt_client != nullptr &&
      mqtt::global_mqtt_client->is_connected()) {
    mqtt::global_mqtt_client->publish(mqtt::global_mqtt_client->get_topic_prefix() + "/event", body);
  }
#endif
  if (s_.webhook_enabled && (s_.webhook_events & bit) && s_.webhook_url[0]) {
    if (queue_items_.size() >= 8)
      queue_items_.erase(queue_items_.begin());  // keep the newest
    // 5 s delay: the door sequence takes 4 s and a slow server must never stall it.
    queue_items_.push_back({millis() + 5000, body, false});
  }
}

void InterfonAdmin::notify_event(int kind) {
  switch (kind) {
    case 1: this->queue_(EV_RING, "ring", ""); break;
    case 2: this->queue_(EV_DOOR, "door_opened", "auto"); break;
    case 3: this->queue_(EV_DOOR, "door_opened", "remote"); break;
    case 4: this->queue_(EV_DOOR, "door_opened", "button"); break;
    default: break;
  }
}

void InterfonAdmin::notify_auto_answer(bool on) { this->queue_(EV_AUTO, "auto_answer", on ? "on" : "off"); }

void InterfonAdmin::send_webhook_(const std::string &body) {
  WiFiClient client;  // must be declared before HTTPClient: destructor order, or it crashes
  HTTPClient http;
  http.setTimeout(3000);
  wh_at_ = millis() / 1000;
  wh_event_ = body;
  if (!http.begin(client, s_.webhook_url)) {
    wh_code_ = -1;
    wh_error_ = "invalid URL";
    return;
  }
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body.c_str());
  wh_code_ = code;
  wh_error_ = code > 0 ? "" : HTTPClient::errorToString(code).c_str();
  http.end();
  ESP_LOGI(TAG, "Webhook -> %d %s", code, wh_error_.c_str());
}

void InterfonAdmin::run_test_(const std::string &what) {
  std::string body = "{\"device\":\"interfon\",\"event\":\"test\",\"detail\":\"sent from the admin page\",\"time\":" +
                     jstr(this->now_iso_()) + "}";
  if (what == "webhook") {
    if (s_.webhook_url[0])
      this->send_webhook_(body);
    else {
      wh_code_ = -1;
      wh_error_ = "no webhook URL set";
      wh_at_ = millis() / 1000;
    }
  }
#ifdef USE_MQTT
  if (what == "mqtt" && mqtt::global_mqtt_client != nullptr && mqtt::global_mqtt_client->is_connected())
    mqtt::global_mqtt_client->publish(mqtt::global_mqtt_client->get_topic_prefix() + "/event", body);
#endif
}

// ---- JSON views (no secrets ever leave the device) ------------------------------------

std::string InterfonAdmin::settings_json() const {
  std::string o = "{";
  o += "\"net_mode\":" + jstr(s_.net_mode == NET_STATIC ? "static" : "dhcp");
  o += ",\"ip\":" + jstr(ip_str(s_.ip)) + ",\"gateway\":" + jstr(ip_str(s_.gw));
  o += ",\"subnet\":" + jstr(ip_str(s_.mask)) + ",\"dns1\":" + jstr(ip_str(s_.dns1));
  o += ",\"dns2\":" + jstr(ip_str(s_.dns2));
  o += ",\"mqtt_enabled\":" + std::string(s_.mqtt_enabled ? "true" : "false");
  o += ",\"mqtt_host\":" + jstr(s_.mqtt_host) + ",\"mqtt_port\":" + to_string(s_.mqtt_port);
  o += ",\"mqtt_user\":" + jstr(s_.mqtt_user);
  o += ",\"mqtt_pass_set\":" + std::string(s_.mqtt_pass[0] ? "true" : "false");
  o += ",\"mqtt_prefix\":" + jstr(s_.mqtt_prefix[0] ? s_.mqtt_prefix : def_prefix_);
  o += ",\"mqtt_discovery\":" + std::string(s_.mqtt_discovery ? "true" : "false");
  o += ",\"mqtt_events\":" + to_string(s_.mqtt_events);
  o += ",\"webhook_enabled\":" + std::string(s_.webhook_enabled ? "true" : "false");
  o += ",\"webhook_url\":" + jstr(s_.webhook_url);
  o += ",\"webhook_events\":" + to_string(s_.webhook_events);
  o += ",\"factory\":{\"ip\":" + jstr(def_ip_) + ",\"gateway\":" + jstr(def_gw_) + ",\"subnet\":" + jstr(def_mask_) +
       ",\"dns1\":" + jstr(def_dns1_) + ",\"dns2\":" + jstr(def_dns2_) + "}";
  o += "}";
  return o;
}

std::string InterfonAdmin::info_json() const {
  auto *w = wifi::global_wifi_component;
  std::string ip;
  for (auto &a : w->get_ip_addresses()) {
    if (a.is_set()) {
      char b[network::IP_ADDRESS_BUFFER_SIZE];
      ip = a.str_to(b);
      break;
    }
  }
  char ssid[wifi::SSID_BUFFER_SIZE] = {0};
  w->wifi_ssid_to(ssid);
  std::string o = "{";
  o += "\"ip\":" + jstr(ip) + ",\"ssid\":" + jstr(ssid) + ",\"rssi\":" + to_string(w->wifi_rssi());
  o += ",\"mac\":" + jstr(get_mac_address_pretty());
  o += ",\"uptime\":" + to_string(millis() / 1000) + ",\"free_heap\":" + to_string(ESP.getFreeHeap());
  char built[Application::BUILD_TIME_STR_SIZE] = {0};
  App.get_build_time_string(built);
  o += ",\"esphome\":" + jstr(ESPHOME_VERSION) + ",\"built\":" + jstr(built);
  o += ",\"storage\":{\"loaded\":" + std::string(loaded_from_flash_ ? "true" : "false") +
       ",\"slot\":" + to_string(slot_) + ",\"seq\":" + to_string(s_.seq) +
       ",\"last_save_ok\":" + std::string(last_save_ok_ ? "true" : "false") + "}";
#ifdef USE_MQTT
  bool mc = mqtt::global_mqtt_client != nullptr && mqtt::global_mqtt_client->is_connected();
  o += ",\"mqtt_connected\":" + std::string(mc ? "true" : "false");
#else
  o += ",\"mqtt_connected\":false";
#endif
  o += ",\"webhook_last\":{\"code\":" + to_string(wh_code_) + ",\"at\":" + to_string(wh_at_) +
       ",\"error\":" + jstr(wh_error_) + "}";
  o += ",\"webhook_queue\":" + to_string(queue_items_.size());
  o += ",\"reboot_pending\":" + std::string(reboot_at_ ? "true" : "false");
  o += "}";
  return o;
}

// ---- updates --------------------------------------------------------------------------

std::string InterfonAdmin::stage_update(AsyncWebServerRequest *req, bool &needs_reboot) {
  Settings n = s_;  // work on a copy; only committed (in the main loop) if all of it is valid
  std::string v, wifi_ssid, wifi_pass;
  needs_reboot = false;

  // network
  if (param(req, "net_mode", v)) {
    if (v != "dhcp" && v != "static")
      return "net_mode must be dhcp or static";
    n.net_mode = v == "static" ? NET_STATIC : NET_DHCP;
  }
  struct {
    const char *name;
    uint8_t *dst;
    const char *label;
    bool allow_empty;
  } ips[] = {{"ip", n.ip, "IP address", false},    {"gateway", n.gw, "Gateway", false},
             {"subnet", n.mask, "Subnet mask", false}, {"dns1", n.dns1, "DNS 1", true},
             {"dns2", n.dns2, "DNS 2", true}};
  for (auto &f : ips) {
    if (!param(req, f.name, v))
      continue;
    if (v.empty() && f.allow_empty) {
      memset(f.dst, 0, 4);
      continue;
    }
    if (!parse_ip(v, f.dst))
      return std::string(f.label) + " is not a valid address";
  }
  if (n.net_mode == NET_STATIC && (ip_zero(n.ip) || ip_zero(n.gw) || ip_zero(n.mask)))
    return "Static IP needs an address, gateway and subnet mask";
  if (param(req, "wifi_ssid", wifi_ssid) && wifi_ssid.size() > 32)
    return "Wi-Fi name is longer than 32 characters";
  if (param(req, "wifi_password", wifi_pass) && !wifi_pass.empty() && (wifi_pass.size() < 8 || wifi_pass.size() > 64))
    return "Wi-Fi password must be 8 to 64 characters";
  if (!wifi_pass.empty() && wifi_ssid.empty())
    return "Enter the Wi-Fi name together with its password";

  // mqtt
  if (param(req, "mqtt_enabled", v))
    n.mqtt_enabled = v == "1" || v == "true";
  if (param(req, "mqtt_host", v)) {
    if (v.size() >= sizeof(n.mqtt_host))
      return "MQTT host is too long";
    copy_str(n.mqtt_host, sizeof(n.mqtt_host), v);
  }
  if (param(req, "mqtt_port", v)) {
    long p = atol(v.c_str());
    if (p < 1 || p > 65535)
      return "MQTT port must be 1-65535";
    n.mqtt_port = p;
  }
  if (param(req, "mqtt_user", v)) {
    if (v.size() >= sizeof(n.mqtt_user))
      return "MQTT username is too long";
    copy_str(n.mqtt_user, sizeof(n.mqtt_user), v);
  }
  if (param(req, "mqtt_pass", v) && !v.empty()) {  // empty = keep the stored password
    if (v.size() >= sizeof(n.mqtt_pass))
      return "MQTT password is too long";
    copy_str(n.mqtt_pass, sizeof(n.mqtt_pass), v);
  }
  if (param(req, "mqtt_pass_clear", v) && v == "1")
    memset(n.mqtt_pass, 0, sizeof(n.mqtt_pass));
  if (param(req, "mqtt_prefix", v)) {
    if (!valid_topic_prefix(v))
      return "MQTT topic prefix: letters, digits, _ - / only";
    copy_str(n.mqtt_prefix, sizeof(n.mqtt_prefix), v);
  }
  if (param(req, "mqtt_discovery", v))
    n.mqtt_discovery = v == "1" || v == "true";
  if (param(req, "mqtt_events", v))
    n.mqtt_events = atoi(v.c_str()) & 0x0F;
  if (n.mqtt_enabled && !n.mqtt_host[0])
    return "MQTT is on but has no broker host";

  // webhook
  if (param(req, "webhook_enabled", v))
    n.webhook_enabled = v == "1" || v == "true";
  if (param(req, "webhook_url", v)) {
    if (!v.empty() && v.rfind("https://", 0) == 0)
      return "This board can't send HTTPS. Use an http:// URL, e.g. a relay on your network";
    if (!v.empty() && v.rfind("http://", 0) != 0)
      return "Webhook URL must start with http://";
    if (v.size() >= sizeof(n.webhook_url))
      return "Webhook URL is too long";
    copy_str(n.webhook_url, sizeof(n.webhook_url), v);
  }
  if (param(req, "webhook_events", v))
    n.webhook_events = atoi(v.c_str()) & 0x0F;
  if (n.webhook_enabled && !n.webhook_url[0])
    return "Webhook is on but has no URL";

  // What needs a reboot: anything network, and MQTT identity (topics/discovery are set at start).
  bool net_changed = n.net_mode != s_.net_mode || memcmp(n.ip, s_.ip, 4) || memcmp(n.gw, s_.gw, 4) ||
                     memcmp(n.mask, s_.mask, 4) || memcmp(n.dns1, s_.dns1, 4) || memcmp(n.dns2, s_.dns2, 4);
  bool mqtt_identity_changed = strcmp(n.mqtt_prefix, s_.mqtt_prefix) != 0 || n.mqtt_discovery != s_.mqtt_discovery;
  bool mqtt_conn_changed = n.mqtt_enabled != s_.mqtt_enabled || strcmp(n.mqtt_host, s_.mqtt_host) != 0 ||
                           n.mqtt_port != s_.mqtt_port || strcmp(n.mqtt_user, s_.mqtt_user) != 0 ||
                           strcmp(n.mqtt_pass, s_.mqtt_pass) != 0;
  needs_reboot = net_changed || mqtt_identity_changed || !wifi_ssid.empty() ||
                 (mqtt_conn_changed && s_.mqtt_enabled && !n.mqtt_enabled);  // clean disconnect

  // Commit in the main loop: flash writes and Wi-Fi/MQTT reconfiguration are not SYS-safe.
  bool reboot = needs_reboot;
  this->defer([this, n, wifi_ssid, wifi_pass, reboot, mqtt_conn_changed]() {
    s_ = n;
    if (!this->save_())
      return;  // last_save_ok_ = false is reported on the page
    if (!wifi_ssid.empty())
      wifi::global_wifi_component->save_wifi_sta(wifi_ssid, wifi_pass);
    if (reboot) {
      this->request_reboot();
      return;
    }
#ifdef USE_MQTT
    if (mqtt_conn_changed && mqtt::global_mqtt_client != nullptr) {
      mqtt::global_mqtt_client->disable();
      this->apply_mqtt_();
      mqtt_started_ = false;  // loop() re-enables once Wi-Fi is up, if enabled
    }
#endif
  });
  return "";
}

// ---- HTTP -----------------------------------------------------------------------------

void AdminHandler::handleRequest(AsyncWebServerRequest *req) {
  const String &url = req->url();
  bool post = req->method() == HTTP_POST;
  if (url == "/admin/settings" && !post) {
    req->send(200, "application/json", parent_->settings_json().c_str());
  } else if (url == "/admin/info" && !post) {
    req->send(200, "application/json", parent_->info_json().c_str());
  } else if (url == "/admin/settings" && post) {
    bool reboot = false;
    std::string err = parent_->stage_update(req, reboot);
    if (!err.empty()) {
      req->send(400, "application/json", ("{\"ok\":false,\"error\":" + jstr(err) + "}").c_str());
    } else {
      req->send(200, "application/json",
                (std::string("{\"ok\":true,\"reboot\":") + (reboot ? "true" : "false") + "}").c_str());
    }
  } else if (url == "/admin/test" && post) {
    std::string what;
    param(req, "what", what);
    if (what != "webhook" && what != "mqtt") {
      req->send(400, "application/json", "{\"ok\":false,\"error\":\"what must be webhook or mqtt\"}");
      return;
    }
    parent_->request_test(what);
    req->send(200, "application/json", "{\"ok\":true}");
  } else if (url == "/admin/reboot" && post) {
    parent_->request_reboot();
    req->send(200, "application/json", "{\"ok\":true}");
  } else {
    req->send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}");
  }
}

}  // namespace interfon_admin
}  // namespace esphome
