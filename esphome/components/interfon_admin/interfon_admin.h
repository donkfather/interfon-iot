// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 donkfather. Built on the ESPHome C++ runtime (GPLv3); see LICENSE here.
#pragma once
// interfon_admin — runtime settings for the intercom: network, MQTT, notification channels,
// plus the /admin/* HTTP API the web page talks to. See __init__.py for the storage rationale.
//
// Threading rule (ESP8266): AsyncWebServer callbacks run in the SYS context, where flash writes,
// blocking HTTP and Wi-Fi reconfiguration are not allowed. handleRequest() therefore only parses,
// validates and answers; everything with side effects is deferred to the main loop.

#include "esphome/core/component.h"
#include "esphome/core/application.h"
#include "esphome/core/helpers.h"
#include "esphome/core/log.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include "esphome/components/wifi/wifi_component.h"
#include "esphome/components/network/ip_address.h"
#include "esphome/components/time/real_time_clock.h"
#ifdef USE_MQTT
#include "esphome/components/mqtt/mqtt_client.h"
#endif
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
extern "C" {
#include "spi_flash.h"
}
#include <string>
#include <vector>
#include <cstring>

namespace esphome {
namespace interfon_admin {

static const char *const TAG = "interfon_admin";

enum NetMode : uint8_t { NET_DHCP = 1, NET_STATIC = 2 };
// Event bits, shared by webhook_events and mqtt_events.
enum EventBit : uint8_t { EV_RING = 1, EV_DOOR = 2, EV_AUTO = 4, EV_ONLINE = 8 };

// Persisted block. Fixed layout, 4-byte aligned, CRC-protected. Bump MAGIC on layout change.
struct Settings {
  uint32_t magic;
  uint32_t seq;
  uint8_t net_mode;
  uint8_t mqtt_enabled;
  uint8_t mqtt_discovery;
  uint8_t webhook_enabled;
  uint8_t ip[4], gw[4], mask[4], dns1[4], dns2[4];
  uint16_t mqtt_port;
  uint8_t webhook_events;
  uint8_t mqtt_events;
  char mqtt_host[64];
  char mqtt_user[48];
  char mqtt_pass[64];
  char mqtt_prefix[48];
  char webhook_url[160];
  uint32_t crc;
};
static const uint32_t SETTINGS_MAGIC = 0x31414649;  // "IFA1"
static_assert(sizeof(Settings) % 4 == 0, "Settings must be 4-byte aligned for spi_flash_write");
static_assert(sizeof(Settings) <= 4096, "Settings must fit one sector");

class InterfonAdmin;

class AdminHandler : public AsyncWebHandler {
 public:
  explicit AdminHandler(InterfonAdmin *parent) : parent_(parent) {}
  bool canHandle(AsyncWebServerRequest *request) const override {
    return request->url().startsWith("/admin/");
  }
  void handleRequest(AsyncWebServerRequest *request) override;
  bool isRequestHandlerTrivial() const override { return false; }  // we read POST bodies

 protected:
  InterfonAdmin *parent_;
};

class InterfonAdmin : public Component {
 public:
  // ---- configuration (from __init__.py) -------------------------------------------
  void set_defaults(const char *ssid, const char *password, const std::string &ip, const std::string &gw,
                    const std::string &mask, const std::string &dns1, const std::string &dns2,
                    const char *mqtt_prefix) {
    def_ssid_ = ssid;
    def_password_ = password;
    def_ip_ = ip;
    def_gw_ = gw;
    def_mask_ = mask;
    def_dns1_ = dns1;
    def_dns2_ = dns2;
    def_prefix_ = mqtt_prefix;
  }
  void set_storage_sector(uint32_t sector) { sector_ = sector; }
  void set_time(time::RealTimeClock *t) { time_ = t; }

  // Before wifi/mqtt set up, so MQTT credentials are in place when they start.
  float get_setup_priority() const override { return setup_priority::HARDWARE; }

  void setup() override;
  void loop() override;
  void dump_config() override;

  // ---- called from YAML automations (main loop) -------------------------------------
  // kind: 1 ring, 2 door auto, 3 door remote, 4 door button (same codes as the history)
  void notify_event(int kind);
  void notify_auto_answer(bool on);

  // ---- used by AdminHandler (SYS context: read-only, then defer) ----------------------
  std::string settings_json() const;
  std::string info_json() const;
  // Validates + stages an update from request params. Returns "" on success, else the error.
  std::string stage_update(AsyncWebServerRequest *req, bool &needs_reboot);
  void request_test(const std::string &what) {
    this->defer([this, what]() { this->run_test_(what); });
  }
  void request_reboot() { reboot_at_ = millis() + 1500; }

 protected:
  // storage
  bool load_();
  bool save_();
  void factory_defaults_(Settings &s) const;
  static uint32_t checksum_(const Settings &s);
  // apply
  void apply_network_();
  void apply_mqtt_();
  // notifications
  struct Pending {
    uint32_t send_at;
    std::string body;
    bool test;
  };
  void queue_(uint8_t bit, const char *event, const char *detail);
  void send_webhook_(const std::string &body);
  void run_test_(const std::string &what);
  std::string now_iso_() const;

  Settings s_{};
  bool loaded_from_flash_{false};
  uint8_t slot_{0};
  bool last_save_ok_{true};
  uint32_t sector_{0x200};
  time::RealTimeClock *time_{nullptr};

  std::string def_ssid_, def_password_, def_ip_, def_gw_, def_mask_, def_dns1_, def_dns2_, def_prefix_;

  bool net_applied_{false};
  bool mqtt_started_{false};
  bool online_sent_{false};
  uint32_t reboot_at_{0};
  std::vector<Pending> queue_items_;

  // last webhook result, for the page
  int wh_code_{0};
  uint32_t wh_at_{0};
  std::string wh_error_;
  std::string wh_event_;

  AdminHandler *handler_{nullptr};
};

}  // namespace interfon_admin
}  // namespace esphome
